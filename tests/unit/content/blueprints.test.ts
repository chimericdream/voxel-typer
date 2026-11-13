/**
 * Blueprints (task M4-08). Each one fits the starter plot and uses only blocks the game hands out;
 * each costs a block that only Mine loot gives (decision 99); its price matches its shape; a stamp
 * and its undo keep every block (conservation, decision 99); and it is offered only once its
 * unlock condition holds.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { achievementById } from "../../../src/content/achievements";
import { blocks } from "../../../src/content/blocks";
import {
  biomeBadgeId,
  biomeCompleted,
  blueprintCells,
  blueprintCost,
  blueprintGrid,
  blueprints,
  blueprintSize,
  unlocked,
  unlockedBlueprints,
} from "../../../src/content/blueprints";
import type { BlueprintDef } from "../../../src/content/blueprints";
import { meadowLoot } from "../../../src/content/loot/meadow";
import { soundsUnsafe } from "../../../src/content/wordlists/spoken-blocklist";
import {
  ISLAND_MAX,
  MAX_EXPANSIONS,
  PLOT_SIZE,
  countBlocks,
  createIsland,
  footprint,
  islandBlocks,
  openIsland,
} from "../../../src/engine/island";
import type { IslandEditor } from "../../../src/engine/island";
import { t } from "../../../src/i18n";
import { blueprintsFor } from "../../../src/modes/builder/blueprints";
import { buildVocabulary } from "../../../src/modes/builder/commands";
import { stampOrigin, startCursor } from "../../../src/modes/builder/logic";
import type { Profile } from "../../../src/save/schema";
import { BIOME_ORDER } from "../../../src/types/core";
import type { AgeBand, BlockId } from "../../../src/types/core";
import { fixture } from "../app/helpers";

const SEED = 20261113;
const lookup = islandBlocks(blocks);
const numOf = (id: BlockId): number | undefined => lookup.numOf(id);
const placeable = blocks.filter((b) => b.tags.includes("placeable"));
const placeableIds = new Set(placeable.map((b) => b.id));
const LOOT = new Set(meadowLoot.entries.map((e) => e.block));
const BANNED = ["creeper", "enderman", "redstone", "nether", "steve", "minecraft", "mojang"];

/** Every block starter terrain can hold: the plot and every ring, for many islands. */
const TERRAIN: ReadonlySet<BlockId> = (() => {
  const seen = new Set<BlockId>();
  for (let i = 0; i < 24; i++) {
    const id = `terrain-${i}`;
    const ed = openIsland({
      island: createIsland(id, lookup, 0),
      inventory: {},
      blocks: lookup,
      profileId: id,
    });
    for (const biome of BIOME_ORDER) ed.expand(biome);
    for (const b of Object.keys(countBlocks(ed.grid, lookup))) seen.add(b);
  }
  return seen;
})();

/** Placeable blocks only Mine loot gives: in a loot table, never in starter terrain. */
const MINE_ONLY = new Set([...LOOT].filter((b) => !TERRAIN.has(b) && placeableIds.has(b)));

const profileWith = (achievements: Record<string, number>): Profile => ({
  ...fixture("meadow-done-miner"),
  achievements,
});

/** Island blocks plus the bag, per block, zero counts left out. */
function totals(ed: IslandEditor): Record<BlockId, number> {
  const out: Record<BlockId, number> = { ...countBlocks(ed.grid, lookup) };
  for (const [id, n] of Object.entries(ed.inventory())) out[id] = (out[id] ?? 0) + n;
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n !== 0));
}

const nonZero = (bag: Record<BlockId, number>): Record<BlockId, number> =>
  Object.fromEntries(Object.entries(bag).filter(([, n]) => n !== 0));

const openFresh = (inventory: Record<BlockId, number>, profileId = "bp-test"): IslandEditor =>
  openIsland({
    island: createIsland(profileId, lookup, 0),
    inventory,
    blocks: lookup,
    profileId,
  });

const ids = blueprints.map((b) => b.id);

const vocabulary = (band: AgeBand, withBlueprints: boolean) =>
  buildVocabulary({
    blocks: placeable,
    blueprints: withBlueprints ? blueprints.map((b) => b.typedName) : [],
    photo: true,
    band,
  });

describe("the blueprint list", () => {
  it("has the card's ten blueprints, each id once", () => {
    expect(ids).toEqual([
      "well",
      "lantern-post",
      "garden",
      "house",
      "farm",
      "bridge",
      "tower",
      "boat",
      "statue",
      "castle-gate",
    ]);
  });

  it("knows the terrain and Mine-only sets it tests against", () => {
    // If starter terrain ever grows, the Mine-only set shrinks; these pins make that visible.
    expect(TERRAIN.has("grass")).toBe(true);
    expect(TERRAIN.has("cobble")).toBe(true);
    expect(MINE_ONLY.has("oak-planks")).toBe(true);
    expect(MINE_ONLY.has("cobble")).toBe(false);
  });
});

describe.each(blueprints.map((b) => [b.id, b] as const))("blueprint %s", (_id, def) => {
  it("has rectangular layers", () => {
    const { sx, sy, sz } = blueprintSize(def);
    expect(sx * sy * sz).toBeGreaterThan(0);
    for (const rows of def.layers) {
      expect(rows).toHaveLength(sz);
      for (const row of rows) expect(row).toHaveLength(sx);
    }
  });

  it("fits within the island bounds (the starter plot, 24 × 32 × 24)", () => {
    const { sx, sy, sz } = blueprintSize(def);
    const f = footprint(0);
    expect(sx).toBeLessThanOrEqual(f.x1 - f.x0);
    expect(sz).toBeLessThanOrEqual(f.z1 - f.z0);
    expect(sy).toBeLessThanOrEqual(ISLAND_MAX.sy);
    expect(sx).toBeLessThanOrEqual(PLOT_SIZE.sx);
  });

  it("only uses existing, placeable blocks that the game hands out", () => {
    for (const c of blueprintCells(def)) {
      expect(lookup.numOf(c.block), c.block).toBeDefined();
      expect(placeableIds.has(c.block), c.block).toBe(true);
      expect(LOOT.has(c.block) || TERRAIN.has(c.block), c.block).toBe(true);
    }
    // The grid builds against the real registry.
    expect(() => blueprintGrid(def, numOf)).not.toThrow();
  });

  it("costs at least one block that only Mine loot gives (decision 99)", () => {
    const mine = Object.keys(def.cost).filter((b) => MINE_ONLY.has(b));
    expect(mine.length, `${def.id} costs ${JSON.stringify(def.cost)}`).toBeGreaterThan(0);
  });

  it("lists the cost its layers take", () => {
    expect(blueprintCost(def)).toEqual(def.cost);
    for (const n of Object.values(def.cost)) expect(n).toBeGreaterThan(0);
  });

  it("takes exactly its cost from the bag on empty ground, and undo gives it back", () => {
    const ed = openFresh({ ...def.cost });
    // In the air over the clearing every cell is empty, so the stamp replaces nothing.
    const at = stampOrigin({ x: 24, y: 12, z: 24 }, blueprintSize(def));
    const grid = blueprintGrid(def, numOf);
    const before = totals(ed);
    const res = ed.apply({ kind: "stamp", ...at, blueprint: grid });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.fromEntries(Object.entries(res.delta).map(([b, d]) => [b, -d]))).toEqual(
      def.cost,
    );
    for (const b of Object.keys(def.cost)) expect(ed.inventory()[b]).toBe(0);
    expect(totals(ed)).toEqual(before);
    expect(ed.undo()).toBe(true);
    expect(ed.inventory()).toEqual(def.cost);
    expect(totals(ed)).toEqual(before);
  });

  it("is refused, changing nothing, when one block is short", () => {
    const [first] = Object.keys(def.cost);
    if (first === undefined) throw new Error("empty cost");
    const bag = { ...def.cost, [first]: (def.cost[first] ?? 1) - 1 };
    const ed = openFresh(bag);
    const at = stampOrigin({ x: 24, y: 12, z: 24 }, blueprintSize(def));
    const res = ed.apply({ kind: "stamp", ...at, blueprint: blueprintGrid(def, numOf) });
    expect(res).toMatchObject({ ok: false, reason: "not-enough", missing: { [first]: 1 } });
    expect(ed.inventory()).toEqual(bag);
    expect(ed.undoDepth).toBe(0);
  });

  it("has a name a child can type and read, that is safe read aloud", () => {
    expect(def.typedName).toMatch(/^[a-z]{3,8}$/);
    expect(soundsUnsafe(def.typedName)).toBe(false);
    const shown = t(def.nameKey);
    expect(shown).not.toBe(def.nameKey);
    expect(shown.length).toBeLessThanOrEqual(12);
    for (const word of shown.toLowerCase().split(/\s+/)) expect(soundsUnsafe(word)).toBe(false);
    // "You built a House!": the name reads after "a".
    expect(shown).toMatch(/^[^AEIOU]/);
    const all = `${def.id} ${def.typedName} ${shown}`.toLowerCase();
    for (const term of BANNED) expect(all).not.toContain(term);
  });
});

describe("blueprint names in Builder", () => {
  it.each(["sprout", "miner", "builder"] as const)(
    "clash with no block, direction or command for %s",
    (band) => {
      expect(vocabulary(band, true).conflicts).toEqual([]);
      expect(new Set(blueprints.map((b) => b.typedName)).size).toBe(blueprints.length);
    },
  );

  it.each(["sprout", "miner", "builder"] as const)(
    "leave every block's word as it was for %s",
    (band) => {
      const before = vocabulary(band, false);
      const after = vocabulary(band, true);
      for (const b of placeable) expect(after.wordOf(b.id), b.id).toBe(before.wordOf(b.id));
    },
  );

  it("adding photo leaves every block's word as it was", () => {
    for (const band of ["sprout", "miner", "builder"] as const) {
      const without = buildVocabulary({ blocks: placeable, band });
      const withPhoto = buildVocabulary({ blocks: placeable, band, photo: true });
      for (const b of placeable) expect(withPhoto.wordOf(b.id)).toBe(without.wordOf(b.id));
      expect(withPhoto.conflicts).toEqual([]);
    }
  });
});

describe("conservation through stamp and undo", () => {
  const defArb = fc.constantFrom(...blueprints);
  /** A stamp point anywhere near the plot, from under the ground to above it. */
  const cell = {
    x: fc.integer({ min: 8, max: 40 }),
    y: fc.integer({ min: 0, max: 10 }),
    z: fc.integer({ min: 8, max: 40 }),
  };
  type Step =
    | { kind: "stamp"; def: BlueprintDef; x: number; y: number; z: number }
    | { kind: "undo" };
  const stepArb: fc.Arbitrary<Step> = fc.oneof(
    {
      weight: 3,
      arbitrary: fc.record({ kind: fc.constant("stamp" as const), def: defArb, ...cell }),
    },
    { weight: 2, arbitrary: fc.constant({ kind: "undo" as const }) },
  );

  it("keeps island blocks plus the bag the same per block after every stamp and undo", () => {
    const bagIds = [...new Set(blueprints.flatMap((b) => Object.keys(b.cost)))];
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 120 }), {
          minLength: bagIds.length,
          maxLength: bagIds.length,
        }),
        fc.integer({ min: 0, max: MAX_EXPANSIONS }),
        fc.array(stepArb, { minLength: 1, maxLength: 20 }),
        (counts, expansions, steps) => {
          const bag = Object.fromEntries(bagIds.map((b, i) => [b, counts[i] ?? 0]));
          const ed = openFresh(bag, "bp-prop");
          for (let e = 0; e < expansions; e++) ed.expand("birch");
          const start = totals(ed);
          const startBag = ed.inventory();
          let applied = 0;
          for (const s of steps) {
            if (s.kind === "undo") {
              if (ed.undo()) applied -= 1;
            } else {
              const grid = blueprintGrid(s.def, numOf);
              const at = stampOrigin(s, blueprintSize(s.def));
              if (ed.apply({ kind: "stamp", ...at, blueprint: grid }).ok) applied += 1;
            }
            expect(totals(ed)).toEqual(start);
            for (const n of Object.values(ed.inventory())) expect(n).toBeGreaterThanOrEqual(0);
          }
          while (applied > 0 && ed.undo()) applied -= 1;
          // Kinds refunded on the way stay listed at 0 (M4-06), so compare the counts.
          expect(nonZero(ed.inventory())).toEqual(nonZero(startBag));
        },
      ),
      { seed: SEED, numRuns: 60 },
    );
  });

  it("stamps onto real ground: replaced blocks are refunded, and undo puts them back", () => {
    const house = blueprints.find((b) => b.id === "house");
    if (house === undefined) throw new Error("no house");
    const ed = openFresh({ ...house.cost });
    const cursor = startCursor(ed.grid, ed.footprint);
    // One layer down, so the floor replaces the ground it lands on.
    const at = stampOrigin({ ...cursor, y: cursor.y - 1 }, blueprintSize(house));
    const before = totals(ed);
    const gridBefore = Uint16Array.from(ed.grid.data);
    const res = ed.apply({ kind: "stamp", ...at, blueprint: blueprintGrid(house, numOf) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.values(res.delta).some((d) => d > 0)).toBe(true);
    expect(totals(ed)).toEqual(before);
    expect(ed.undo()).toBe(true);
    expect(totals(ed)).toEqual(before);
    expect(Uint16Array.from(ed.grid.data)).toEqual(gridBefore);
  });
});

describe("unlock conditions", () => {
  it("every condition names a real badge", () => {
    for (const def of blueprints) {
      const id =
        def.unlock.kind === "biome" ? biomeBadgeId(def.unlock.biome) : def.unlock.achievement;
      expect(achievementById(id), `${def.id}: ${id}`).not.toBeNull();
    }
  });

  it("offers nothing to a player with no badges", () => {
    expect(unlockedBlueprints(profileWith({}))).toEqual([]);
    expect(blueprintsFor(profileWith({}))).toEqual([]);
  });

  it.each(blueprints.map((b) => [b.id, b] as const))(
    "%s unlocks with its own badge and no other",
    (_id, def) => {
      const id =
        def.unlock.kind === "biome" ? biomeBadgeId(def.unlock.biome) : def.unlock.achievement;
      const offered = unlockedBlueprints(profileWith({ [id]: 1 })).map((b) => b.id);
      expect(offered).toEqual([def.id]);
      expect(unlocked(def.unlock, profileWith({ [id]: 1 }))).toBe(true);
    },
  );

  it("a biome counts as completed once its badge is earned", () => {
    expect(biomeCompleted(profileWith({}), "meadow")).toBe(false);
    expect(biomeCompleted(profileWith({ "meadow-master": 5 }), "meadow")).toBe(true);
    expect(biomeCompleted(profileWith({ "meadow-master": 5 }), "birch")).toBe(false);
  });

  it("blueprintsFor gives Builder each unlocked blueprint's word, name and grid", () => {
    const all = Object.fromEntries(
      blueprints.map((b) => [
        b.unlock.kind === "biome" ? biomeBadgeId(b.unlock.biome) : b.unlock.achievement,
        1,
      ]),
    );
    const out = blueprintsFor(profileWith(all));
    expect(out.map((b) => b.typedName)).toEqual(blueprints.map((b) => b.typedName));
    for (const [i, b] of out.entries()) {
      const def = blueprints[i];
      if (def === undefined) throw new Error("missing");
      expect(b.nameKey).toBe(def.nameKey);
      expect([b.grid.sx, b.grid.sy, b.grid.sz]).toEqual(Object.values(blueprintSize(def)));
      expect(Array.from(b.grid.data).filter((n) => n !== 0)).toHaveLength(
        blueprintCells(def).length,
      );
    }
  });
});
