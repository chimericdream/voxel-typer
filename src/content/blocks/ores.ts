/**
 * Ores (nums 200–249) and the lantern, a light made with copper (deco/light range 300–399;
 * docs/impl/contracts.md §17). Pure data.
 *
 * Ore names are original: copper is a real metal, "char" is a coal-like rock, and meadowstone is
 * the Meadow's own gem.
 */
import type { TextureRecipe } from "@/render/atlas/recipes";
import type { BlockDef } from "./types";

const STONE: TextureRecipe = { kind: "noise", ramp: "stone", scale: 4, contrast: 0.8 };
const same = (r: TextureRecipe): BlockDef["faces"] => ({ top: r, side: r, bottom: r });

export const blocks: BlockDef[] = [
  {
    id: "copper-ore",
    num: 200,
    nameKey: "blocks.copperOre",
    faces: same({ kind: "ore", base: STONE, ore: "ore-copper", density: 0.5 }),
    material: "stone",
    rarity: "rare",
    tags: ["ore", "placeable"],
    typedName: "copper",
  },
  {
    id: "char-ore",
    num: 201,
    nameKey: "blocks.charOre",
    faces: same({ kind: "ore", base: STONE, ore: "wool-black", density: 0.5 }),
    material: "stone",
    rarity: "uncommon",
    tags: ["ore", "placeable"],
    typedName: "char",
  },
  {
    id: "meadowstone",
    num: 202,
    nameKey: "blocks.meadowstone",
    faces: same({ kind: "ore", base: STONE, ore: "ore-gem", density: 0.3 }),
    material: "crystal",
    rarity: "epic",
    tags: ["ore", "placeable", "biome:meadow"],
    typedName: "gem",
  },
  {
    id: "lantern",
    num: 300,
    nameKey: "blocks.lantern",
    faces: same({ kind: "custom", paint: "lamp:ore-amber" }),
    material: "metal",
    rarity: "rare",
    tags: ["light", "placeable"],
    light: { color: "#ffc46b", intensity: 1 },
    typedName: "lantern",
  },
];
