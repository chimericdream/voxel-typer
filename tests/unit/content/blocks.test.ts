/**
 * Block registry v1 invariants (task M2-04, docs/impl/contracts.md §17, §18): ids, nums, typed
 * names, i18n names, recipes, safety and IP checks, and the Meadow loot table.
 */
import { describe, expect, it } from "vitest";
import { loadBlocklist, blocklistHits } from "../../../tools/validate-wordlists";
import { blocks } from "../../../src/content/blocks";
import * as flora from "../../../src/content/blocks/flora";
import * as ores from "../../../src/content/blocks/ores";
import * as stone from "../../../src/content/blocks/stone";
import * as terrain from "../../../src/content/blocks/terrain";
import * as wood from "../../../src/content/blocks/wood";
import type { BlockDef } from "../../../src/content/blocks/types";
import { meadowLoot } from "../../../src/content/loot/meadow";
import en from "../../../src/i18n/en";
import { paletteFor, BASE_PALETTE } from "../../../src/render/atlas/palettes";
import { PALETTE_RAMP_IDS, TILE_BYTES, paintTile } from "../../../src/render/atlas/recipes";
import type { TextureRecipe } from "../../../src/render/atlas/recipes";
import { createRng } from "../../../src/engine/rng";
import { BIOME_ORDER } from "../../../src/types/core";

const FACES = ["top", "side", "bottom"] as const;
type Range = readonly [min: number, max: number];
const TERRAIN: Range = [1, 99];
const WOOD: Range = [100, 149];
const STONE: Range = [150, 199];
const ORES: Range = [200, 249];
const WOOL: Range = [250, 299];
const DECO: Range = [300, 399];

/** Each group file and the num ranges (contracts §17) its blocks may use. */
const FILES: readonly [name: string, list: readonly BlockDef[], ranges: readonly Range[]][] = [
  ["terrain", terrain.blocks, [TERRAIN]],
  ["wood", wood.blocks, [WOOD]],
  ["stone", stone.blocks, [STONE]],
  ["ores", ores.blocks, [ORES, DECO]],
  ["flora", flora.blocks, [WOOL, DECO]],
];

/** IP terms that must never appear (CLAUDE.md), on top of the blocklist's `ip` category. */
const BANNED = ["creeper", "enderman", "redstone", "nether", "steve", "minecraft", "mojang"];

const blocklist = loadBlocklist();

function englishName(block: BlockDef): string | undefined {
  const [ns, key, ...rest] = block.nameKey.split(".");
  if (ns !== "blocks" || key === undefined || rest.length > 0) return undefined;
  const table: Readonly<Record<string, string>> = en.blocks;
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function rampsOf(recipe: TextureRecipe): string[] {
  switch (recipe.kind) {
    case "noise":
    case "planks":
      return [recipe.ramp];
    case "bricks":
      return [recipe.ramp, recipe.mortar];
    case "ore":
      return [recipe.ore, ...rampsOf(recipe.base)];
    case "overlay-top":
      return [recipe.top, ...rampsOf(recipe.base)];
    case "custom": {
      const colon = recipe.paint.indexOf(":");
      return colon < 0 ? [] : [recipe.paint.slice(colon + 1)];
    }
    case "crack":
    default:
      return [];
  }
}

const tagged = (tag: string): number => blocks.filter((b) => b.tags.includes(tag)).length;

describe("block registry", () => {
  it("has about 30 blocks, all from the group files", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(25);
    expect(blocks.length).toBe(FILES.reduce((n, [, list]) => n + list.length, 0));
  });

  it("ids are unique kebab-case slugs", () => {
    const ids = blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  });

  it("nums are unique integers, never 0, inside their file's ranges", () => {
    const nums = blocks.map((b) => b.num);
    expect(new Set(nums).size).toBe(nums.length);
    for (const [name, list, ranges] of FILES) {
      for (const b of list) {
        expect(Number.isInteger(b.num), b.id).toBe(true);
        const inRange = ranges.some(([lo, hi]) => b.num >= lo && b.num <= hi);
        expect(inRange, `${name}: ${b.id} has num ${b.num}`).toBe(true);
      }
    }
  });

  it("typedName is one typeable word: a–z only, at most 8 letters, unique", () => {
    const typed = blocks.map((b) => b.typedName);
    expect(new Set(typed).size).toBe(typed.length);
    for (const b of blocks) expect(b.typedName, b.id).toMatch(/^[a-z]{1,8}$/);
  });

  it("every nameKey has English text", () => {
    for (const b of blocks) {
      const name = englishName(b);
      expect(name, b.nameKey).toBeTypeOf("string");
      expect(name?.length ?? 0, b.nameKey).toBeGreaterThan(0);
    }
  });

  it("display names are short", () => {
    for (const b of blocks) {
      const name = englishName(b) ?? "";
      expect(name.length, name).toBeLessThanOrEqual(16);
      expect(name.split(" ").length, name).toBeLessThanOrEqual(2);
    }
  });

  it("no typed name or display name trips the word-list blocklist", () => {
    for (const b of blocks) {
      for (const text of [b.typedName, englishName(b) ?? "", b.id.replaceAll("-", " ")]) {
        expect(blocklistHits(text, blocklist), `${b.id}: "${text}"`).toEqual([]);
      }
    }
  });

  it("no banned IP term appears in an id, name or typed name", () => {
    for (const b of blocks) {
      const all = `${b.id} ${b.typedName} ${englishName(b) ?? ""}`.toLowerCase();
      for (const term of BANNED) expect(all, b.id).not.toContain(term);
    }
  });

  it("recipes only use palette ramps", () => {
    const ramps: ReadonlySet<string> = new Set(PALETTE_RAMP_IDS);
    for (const b of blocks) {
      for (const face of FACES) {
        for (const ramp of rampsOf(b.faces[face])) {
          expect(ramps.has(ramp), `${b.id} ${face}: ${ramp}`).toBe(true);
        }
      }
    }
  });

  it("every face renders in every biome palette", () => {
    const palettes = [BASE_PALETTE, ...BIOME_ORDER.map((biome) => paletteFor(biome))];
    for (const palette of palettes) {
      for (const b of blocks) {
        for (const face of FACES) {
          const px = paintTile(b.faces[face], palette, createRng(`tile:${b.id}:${face}`));
          expect(px.length, `${b.id} ${face}`).toBe(TILE_BYTES);
        }
      }
    }
  });

  it("a cube block with see-through pixels is tagged transparent", () => {
    for (const b of blocks) {
      // A sprig's tiles are clear around the parts the mesher samples (M2-FIX-4); it is never
      // tagged transparent, so it shares the chunk's opaque mesh.
      if (b.shape === "sprig") {
        expect(b.tags.includes("transparent"), b.id).toBe(false);
        continue;
      }
      const seeThrough = FACES.some((face) => {
        const px = paintTile(b.faces[face], BASE_PALETTE, createRng(`tile:${b.id}:${face}`));
        for (let i = 3; i < px.length; i += 4) if ((px[i] ?? 255) < 255) return true;
        return false;
      });
      expect(b.tags.includes("transparent"), b.id).toBe(seeThrough);
    }
  });

  it("lights have a light and the light tag, and nothing else does", () => {
    for (const b of blocks) {
      expect(b.light !== undefined, b.id).toBe(b.tags.includes("light"));
      if (b.light) {
        expect(b.light.color).toMatch(/^#[0-9a-f]{6}$/);
        expect(b.light.intensity).toBeGreaterThan(0);
      }
    }
  });

  it("has the card's set: ores, flowers ×4, wool ×4, glass, a lantern", () => {
    expect(tagged("ore")).toBe(3);
    expect(tagged("flower")).toBe(4);
    expect(tagged("wool")).toBe(4);
    expect(tagged("light")).toBe(1);
    expect(blocks.some((b) => b.id === "glass")).toBe(true);
  });
});

describe("meadow loot table", () => {
  const byId = new Map(blocks.map((b) => [b.id, b]));

  it("is for the meadow and names only real blocks", () => {
    expect(meadowLoot.biome).toBe("meadow");
    for (const e of meadowLoot.entries) expect(byId.has(e.block), e.block).toBe(true);
  });

  it("entry rarity matches the block's rarity; weights are positive integers", () => {
    for (const e of meadowLoot.entries) {
      expect(e.rarity, e.block).toBe(byId.get(e.block)?.rarity);
      expect(Number.isInteger(e.weight) && e.weight > 0, e.block).toBe(true);
    }
  });

  it("lists each block once and covers every tier", () => {
    const ids = meadowLoot.entries.map((e) => e.block);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of ["common", "uncommon", "rare", "epic"] as const) {
      expect(
        meadowLoot.entries.some((e) => e.rarity === r),
        r,
      ).toBe(true);
    }
  });

  it("leaves out water and other biomes' blocks", () => {
    for (const e of meadowLoot.entries) {
      const tags = byId.get(e.block)?.tags ?? [];
      expect(tags.includes("liquid"), e.block).toBe(false);
      expect(
        tags.some((t) => t.startsWith("biome:") && t !== "biome:meadow"),
        e.block,
      ).toBe(false);
    }
  });
});
