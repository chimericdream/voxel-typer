/**
 * Home Island data and persistence (task M4-06): the starter plot, expansion rings, the edit
 * commands and undo, inventory conservation and exact save round-trips.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { blocks as flora } from "../../../src/content/blocks/flora";
import { blocks as ores } from "../../../src/content/blocks/ores";
import { blocks as stone } from "../../../src/content/blocks/stone";
import { blocks as terrain } from "../../../src/content/blocks/terrain";
import { blocks as wood } from "../../../src/content/blocks/wood";
import { recipeFor } from "../../../src/content/worldgen/diorama";
import {
  countBlocks,
  createIsland,
  footprint,
  inBuildArea,
  ISLAND_MAX,
  islandBlocks,
  islandSeed,
  MAX_EXPANSIONS,
  openIsland,
  PLOT_SIZE,
  ringPalette,
  UNDO_LIMIT,
} from "../../../src/engine/island";
import type { IslandCommand, IslandEditor, IslandSave } from "../../../src/engine/island";
import { VoxelGrid } from "../../../src/render/mesher/voxel-grid";
import type { BlockId } from "../../../src/types/core";

const SEED = 20261112;
const defs = [...flora, ...ores, ...stone, ...terrain, ...wood];
const blocks = islandBlocks(defs);
const num = (id: BlockId): number => {
  const n = blocks.numOf(id);
  if (n === undefined) throw new Error(`no block ${id}`);
  return n;
};
const PROFILE = "4b1f7c2e-0000-4000-8000-000000000001";
const T0 = 1_700_000_000_000;
const STARTER: IslandSave = createIsland(PROFILE, blocks, T0);

const open = (inventory: Record<BlockId, number> = {}, island: IslandSave = STARTER) =>
  openIsland({ island, inventory, blocks, profileId: PROFILE });

/** The top non-air y of a column, or -1. */
function topY(g: VoxelGrid, x: number, z: number): number {
  for (let y = g.sy - 1; y >= 0; y--) if (g.get(x, y, z) !== 0) return y;
  return -1;
}

/** inventory[b] + cells of b on the island, for every block id seen in either. */
function totals(e: IslandEditor): Record<BlockId, number> {
  const out: Record<BlockId, number> = { ...countBlocks(e.grid, blocks) };
  for (const [id, n] of Object.entries(e.inventory())) out[id] = (out[id] ?? 0) + n;
  for (const id of Object.keys(out)) if (out[id] === 0) delete out[id];
  return out;
}

/** A clear spot in the middle of the plot: ground top is at y = 4 there. */
const MID = { x: 24, y: 5, z: 24 };

/** A 2×2×1 slab of planks with one cobble corner, and an air cell at (1, 1, 0) above. */
const blueprint = (): VoxelGrid => {
  const bp = new VoxelGrid(2, 2, 2);
  bp.set(0, 0, 0, num("oak-planks"));
  bp.set(1, 0, 0, num("oak-planks"));
  bp.set(0, 0, 1, num("oak-planks"));
  bp.set(1, 0, 1, num("cobble"));
  bp.set(0, 1, 0, num("oak-planks"));
  return bp;
};
const stamp = (at = MID): IslandCommand => ({ kind: "stamp", ...at, blueprint: blueprint() });

describe("starter plot", () => {
  it("is the same for the same profile id and differs between ids", () => {
    expect(createIsland(PROFILE, blocks, T0)).toEqual(STARTER);
    expect(createIsland("another-profile", blocks, T0).grid.rle).not.toEqual(STARTER.grid.rle);
    expect(islandSeed(PROFILE)).toBe(islandSeed(PROFILE));
    expect(islandSeed(PROFILE)).not.toBe(islandSeed("another-profile"));
  });

  it("starts at 0 expansions in a 48×32×48 grid, timestamped by the caller", () => {
    expect(STARTER.expansions).toBe(0);
    expect(STARTER.lastEdited).toBe(T0);
    expect(STARTER.grid).toMatchObject({ sx: 48, sy: 32, sz: 48 });
  });

  it("keeps every voxel inside the 24×16×24 plot, with ground under every column", () => {
    const g = VoxelGrid.fromJSON(STARTER.grid);
    const f = footprint(0);
    expect(f.x1 - f.x0).toBe(PLOT_SIZE.sx);
    expect(f.z1 - f.z0).toBe(PLOT_SIZE.sz);
    for (let y = 0; y < g.sy; y++) {
      for (let z = 0; z < g.sz; z++) {
        for (let x = 0; x < g.sx; x++) {
          const inside = x >= f.x0 && x < f.x1 && z >= f.z0 && z < f.z1 && y < PLOT_SIZE.sy;
          if (!inside) expect(g.get(x, y, z)).toBe(0);
        }
      }
    }
    for (let z = f.z0; z < f.z1; z++) {
      for (let x = f.x0; x < f.x1; x++) expect(g.get(x, 0, z)).not.toBe(0);
    }
  });

  it("has a flat, empty clearing in the middle and Meadow features around it", () => {
    const g = VoxelGrid.fromJSON(STARTER.grid);
    for (let z = 19; z < 29; z++) {
      for (let x = 19; x < 29; x++) {
        expect(g.get(x, 4, z)).toBe(num("grass"));
        expect(topY(g, x, z)).toBe(4);
      }
    }
    const counts = countBlocks(g, blocks);
    for (const id of ["grass", "dirt", "stone", "water", "sand", "oak-log", "oak-leaves"]) {
      expect(counts[id] ?? 0).toBeGreaterThan(0);
    }
    const flowers = recipeFor("meadow").blocks.flowers;
    expect(flowers.some((id) => (counts[id] ?? 0) > 0)).toBe(true);
  });
});

describe("footprint and expansions", () => {
  it("grows 8 cells a ring, 24 to 48, and clamps", () => {
    expect(MAX_EXPANSIONS).toBe(3);
    expect(footprint(0)).toEqual({ x0: 12, x1: 36, z0: 12, z1: 36 });
    expect(footprint(1)).toEqual({ x0: 8, x1: 40, z0: 8, z1: 40 });
    expect(footprint(3)).toEqual({ x0: 0, x1: 48, z0: 0, z1: 48 });
    expect(footprint(9)).toEqual(footprint(3));
    expect(footprint(-2)).toEqual(footprint(0));
  });

  it("builds over unlocked columns up to the top of the grid", () => {
    expect(inBuildArea(0, 12, 0, 12)).toBe(true);
    expect(inBuildArea(0, 35, 31, 35)).toBe(true);
    expect(inBuildArea(0, 11, 5, 20)).toBe(false);
    expect(inBuildArea(1, 11, 5, 20)).toBe(true);
    expect(inBuildArea(0, 20, 32, 20)).toBe(false);
    expect(inBuildArea(0, 20, -1, 20)).toBe(false);
    expect(inBuildArea(0, 20.5, 5, 20)).toBe(false);
  });

  it("adds a ring of starter terrain outside the old footprint only", () => {
    const e = open();
    const before = e.grid.data.slice();
    expect(e.expand("birch")).toBe(true);
    expect(e.expansions).toBe(1);
    const inner = footprint(0);
    const outer = footprint(1);
    for (let y = 0; y < ISLAND_MAX.sy; y++) {
      for (let z = 0; z < ISLAND_MAX.sz; z++) {
        for (let x = 0; x < ISLAND_MAX.sx; x++) {
          const i = x + ISLAND_MAX.sx * (z + ISLAND_MAX.sz * y);
          const inInner = x >= inner.x0 && x < inner.x1 && z >= inner.z0 && z < inner.z1;
          const inOuter = x >= outer.x0 && x < outer.x1 && z >= outer.z0 && z < outer.z1;
          if (inInner || !inOuter || y >= PLOT_SIZE.sy) expect(e.grid.data[i]).toBe(before[i]);
        }
      }
    }
    for (let z = outer.z0; z < outer.z1; z++) {
      for (let x = outer.x0; x < outer.x1; x++) {
        expect(e.grid.get(x, 0, z)).not.toBe(0);
        expect(topY(e.grid, x, z)).toBeGreaterThanOrEqual(3);
      }
    }
    expect(e.dirty).toBe(true);
  });

  it("is deterministic, stops at the full grid and fills it", () => {
    const a = open();
    const b = open();
    for (const biome of ["meadow", "birch", "shore"] as const) {
      expect(a.expand(biome)).toBe(true);
      b.expand(biome);
    }
    expect(a.grid.data).toEqual(b.grid.data);
    expect(a.expand("frosty")).toBe(false);
    expect(a.expansions).toBe(3);
    for (let z = 0; z < 48; z++)
      for (let x = 0; x < 48; x++) expect(a.grid.get(x, 0, z)).not.toBe(0);
  });

  it("falls back to the Meadow palette, per slot, when a biome has no worldgen yet", () => {
    const meadow = ringPalette("meadow", blocks);
    expect(meadow).toMatchObject({ top: "grass", sub: "dirt", deep: "stone" });
    expect(ringPalette("frosty", blocks)).toEqual(meadow);
    // A registry without the flowers: the ring just gets no sprigs.
    const bare = islandBlocks(defs.filter((d) => d.shape !== "sprig"));
    expect(ringPalette("meadow", bare).flowers).toEqual([]);
  });

  it("keeps the undo steps across an expansion", () => {
    const e = open({ "oak-planks": 1 });
    expect(e.apply({ kind: "place", ...MID, block: "oak-planks" }).ok).toBe(true);
    e.expand("meadow");
    expect(e.undo()).toBe(true);
    expect(e.grid.get(MID.x, MID.y, MID.z)).toBe(0);
    expect(e.inventory()["oak-planks"]).toBe(1);
  });
});

describe("edits", () => {
  it("place spends one block; remove refunds it; zero counts stay listed", () => {
    const e = open({ "oak-planks": 1 });
    const r = e.apply({ kind: "place", ...MID, block: "oak-planks" });
    expect(r).toEqual({ ok: true, changed: 1, delta: { "oak-planks": -1 } });
    expect(e.grid.get(MID.x, MID.y, MID.z)).toBe(num("oak-planks"));
    expect(e.inventory()).toEqual({ "oak-planks": 0 });
    expect(e.apply({ kind: "remove", ...MID })).toEqual({
      ok: true,
      changed: 1,
      delta: { "oak-planks": 1 },
    });
    expect(e.inventory()).toEqual({ "oak-planks": 1 });
  });

  it("removing starter terrain puts it in the inventory", () => {
    const e = open();
    expect(e.apply({ kind: "remove", x: MID.x, y: 4, z: MID.z }).ok).toBe(true);
    expect(e.inventory()).toEqual({ grass: 1 });
  });

  it("refuses bad places and removes, changing nothing", () => {
    const e = open({ "oak-planks": 1 });
    const data = e.grid.data.slice();
    expect(e.apply({ kind: "place", x: 2, y: 5, z: 2, block: "oak-planks" })).toEqual({
      ok: false,
      reason: "out-of-bounds",
    });
    expect(e.apply({ kind: "place", ...MID, y: 4, block: "oak-planks" }).ok).toBe(false);
    expect(e.preview({ kind: "place", ...MID, y: 4, block: "oak-planks" })).toEqual({
      ok: false,
      reason: "occupied",
    });
    expect(e.apply({ kind: "place", ...MID, block: "no-such-block" })).toEqual({
      ok: false,
      reason: "unknown-block",
    });
    expect(e.apply({ kind: "place", ...MID, block: "cobble" })).toEqual({
      ok: false,
      reason: "not-enough",
      missing: { cobble: 1 },
    });
    expect(e.apply({ kind: "remove", ...MID })).toEqual({ ok: false, reason: "empty" });
    expect(e.apply({ kind: "remove", x: 0, y: 0, z: 0 })).toEqual({
      ok: false,
      reason: "out-of-bounds",
    });
    expect(e.grid.data).toEqual(data);
    expect(e.inventory()).toEqual({ "oak-planks": 1 });
    expect(e.undoDepth).toBe(0);
    expect(e.dirty).toBe(false);
  });

  it("refuses to remove a block the registry doesn't know", () => {
    const g = VoxelGrid.fromJSON(STARTER.grid);
    g.set(MID.x, MID.y, MID.z, 999);
    const e = open({}, { ...STARTER, grid: g.toJSON() });
    expect(e.apply({ kind: "remove", ...MID })).toEqual({ ok: false, reason: "unknown-block" });
  });

  it("places and removes sprigs like any block", () => {
    const e = open({ bluebells: 2 });
    expect(e.apply({ kind: "place", ...MID, block: "bluebells" }).ok).toBe(true);
    expect(e.apply({ kind: "place", ...MID, block: "bluebells" })).toEqual({
      ok: false,
      reason: "occupied",
    });
    expect(e.apply({ kind: "remove", ...MID }).ok).toBe(true);
    expect(e.inventory()).toEqual({ bluebells: 2 });
  });

  describe("stamp", () => {
    it("writes the blueprint's blocks and charges for them", () => {
      const e = open({ "oak-planks": 4, cobble: 1 });
      expect(e.apply(stamp())).toEqual({
        ok: true,
        changed: 5,
        delta: { "oak-planks": -4, cobble: -1 },
      });
      expect(e.inventory()).toEqual({ "oak-planks": 0, cobble: 0 });
      expect(e.grid.get(MID.x + 1, MID.y, MID.z + 1)).toBe(num("cobble"));
      expect(e.grid.get(MID.x + 1, MID.y + 1, MID.z)).toBe(0);
    });

    it("says what's missing without changing anything", () => {
      const e = open({ "oak-planks": 1 });
      expect(e.preview(stamp())).toEqual({
        ok: false,
        reason: "not-enough",
        missing: { "oak-planks": 3, cobble: 1 },
      });
      expect(e.apply(stamp()).ok).toBe(false);
      expect(e.inventory()).toEqual({ "oak-planks": 1 });
    });

    it("skips cells that already match and refunds the blocks it replaces", () => {
      const e = open({ "oak-planks": 5, cobble: 1, grass: 0 });
      // A matching plank, and a cobble where the blueprint puts a plank. The blueprint's air cell
      // leaves the plank above alone.
      e.apply({ kind: "place", ...MID, block: "oak-planks" });
      e.apply({ kind: "place", x: MID.x + 1, y: MID.y, z: MID.z, block: "cobble" });
      e.apply({ kind: "place", x: MID.x + 1, y: MID.y + 1, z: MID.z, block: "oak-planks" });
      const r = e.apply(stamp());
      expect(r).toEqual({
        ok: true,
        changed: 4,
        // 3 new planks; the cobble it replaced comes back and pays for the corner.
        delta: { "oak-planks": -3, cobble: 0 },
      });
      expect(e.grid.get(MID.x + 1, MID.y + 1, MID.z)).toBe(num("oak-planks"));
      expect(e.inventory()).toEqual({ "oak-planks": 0, cobble: 0, grass: 0 });
    });

    it("refuses a stamp that changes nothing; a replacement still needs its own block", () => {
      // The stamp lands on the grass at y = 4: two grass come back, nothing else is owned.
      const bp = new VoxelGrid(2, 1, 1);
      bp.set(0, 0, 0, num("grass"));
      bp.set(1, 0, 0, num("grass"));
      const e = open();
      expect(e.apply({ kind: "stamp", ...MID, y: 4, blueprint: bp })).toEqual({
        ok: false,
        reason: "nothing-to-do",
      });
      const dirt = new VoxelGrid(1, 1, 1);
      dirt.set(0, 0, 0, num("dirt"));
      expect(e.apply({ kind: "stamp", ...MID, y: 4, blueprint: dirt })).toEqual({
        ok: false,
        reason: "not-enough",
        missing: { dirt: 1 },
      });
    });

    it("writes nothing when any block cell falls outside the build area", () => {
      const e = open({ "oak-planks": 9, cobble: 9 });
      const data = e.grid.data.slice();
      expect(e.apply(stamp({ x: 35, y: 5, z: 20 }))).toEqual({
        ok: false,
        reason: "out-of-bounds",
      });
      expect(e.apply(stamp({ x: 20, y: 31, z: 20 }))).toEqual({
        ok: false,
        reason: "out-of-bounds",
      });
      expect(e.grid.data).toEqual(data);
      // Only the blueprint's air hangs over the edge: fine.
      const bp = new VoxelGrid(3, 1, 1);
      bp.set(0, 0, 0, num("cobble"));
      expect(e.apply({ kind: "stamp", x: 35, y: 5, z: 20, blueprint: bp }).ok).toBe(true);
    });

    it("refuses a blueprint block the registry doesn't know", () => {
      const bp = new VoxelGrid(1, 1, 1);
      bp.set(0, 0, 0, 999);
      expect(open().apply({ kind: "stamp", ...MID, blueprint: bp })).toEqual({
        ok: false,
        reason: "unknown-block",
      });
    });
  });
});

describe("undo", () => {
  it("restores the grid and inventory exactly, newest first", () => {
    const e = open({ "oak-planks": 3 });
    const data0 = e.grid.data.slice();
    e.apply({ kind: "place", ...MID, block: "oak-planks" });
    const data1 = e.grid.data.slice();
    e.apply({ kind: "remove", x: MID.x, y: 4, z: MID.z });
    expect(e.undoDepth).toBe(2);
    expect(e.undo()).toBe(true);
    expect(e.grid.data).toEqual(data1);
    expect(e.inventory()).toEqual({ "oak-planks": 2, grass: 0 });
    expect(e.undo()).toBe(true);
    expect(e.grid.data).toEqual(data0);
    expect(e.inventory()).toEqual({ "oak-planks": 3, grass: 0 });
    expect(e.undo()).toBe(false);
  });

  it(`keeps the last ${UNDO_LIMIT} steps`, () => {
    const e = open({ "oak-planks": 60 });
    for (let i = 0; i < 60; i++) {
      e.apply({
        kind: "place",
        x: 13 + (i % 20),
        y: 20,
        z: 13 + Math.floor(i / 20),
        block: "oak-planks",
      });
    }
    expect(e.undoDepth).toBe(UNDO_LIMIT);
    let n = 0;
    while (e.undo()) n++;
    expect(n).toBe(UNDO_LIMIT);
    expect(e.inventory()["oak-planks"]).toBe(50);
  });

  it("is not saved: a reopened island has no undo steps", () => {
    const e = open({ "oak-planks": 1 });
    e.apply({ kind: "place", ...MID, block: "oak-planks" });
    const reopened = open(e.inventory(), e.save(T0 + 1));
    expect(reopened.undoDepth).toBe(0);
    expect(reopened.undo()).toBe(false);
  });
});

describe("save", () => {
  it("round-trips exactly when nothing changed, keeping lastEdited", () => {
    const e = open();
    expect(e.save(T0 + 5000)).toEqual(STARTER);
  });

  it("stamps lastEdited with the save time after an edit, once", () => {
    const e = open({ "oak-planks": 1 });
    e.apply({ kind: "place", ...MID, block: "oak-planks" });
    expect(e.dirty).toBe(true);
    expect(e.save(T0 + 10).lastEdited).toBe(T0 + 10);
    expect(e.dirty).toBe(false);
    expect(e.save(T0 + 20).lastEdited).toBe(T0 + 10);
  });

  it("keeps an over-range expansion count as saved", () => {
    const e = open({}, { ...STARTER, expansions: 7 });
    expect(e.footprint).toEqual(footprint(3));
    expect(e.expand("meadow")).toBe(false);
    expect(e.save(T0).expansions).toBe(7);
  });

  it("refuses a grid of the wrong size or a malformed one", () => {
    const small = new VoxelGrid(24, 16, 24).toJSON();
    expect(() => open({}, { ...STARTER, grid: small })).toThrow(RangeError);
    expect(() => open({}, { ...STARTER, grid: { ...STARTER.grid, rle: [0, 1] } })).toThrow(
      RangeError,
    );
  });

  it("does not change the caller's inventory or save", () => {
    const inventory = { "oak-planks": 1 };
    const island = structuredClone(STARTER);
    const e = open(inventory, island);
    e.apply({ kind: "place", ...MID, block: "oak-planks" });
    expect(inventory).toEqual({ "oak-planks": 1 });
    expect(island).toEqual(STARTER);
  });
});

describe("countBlocks", () => {
  it("counts by id and names unknown nums", () => {
    const g = new VoxelGrid(2, 1, 1);
    g.set(0, 0, 0, num("dirt"));
    g.set(1, 0, 0, 999);
    expect(countBlocks(g, blocks)).toEqual({ dirt: 1, "#999": 1 });
  });
});

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

/** Blocks the random edits use: cubes, a transparent block, sprigs, and terrain the plot has. */
const POOL: readonly BlockId[] = [
  "grass",
  "dirt",
  "oak-planks",
  "cobble",
  "water",
  "oak-leaves",
  "red-blooms",
  "bluebells",
];

/** Cells around the clearing's surface, plus a margin past the plot's edge. */
const coord = {
  x: fc.integer({ min: 10, max: 26 }),
  y: fc.integer({ min: 3, max: 8 }),
  z: fc.integer({ min: 20, max: 26 }),
};

const blueprintArb = fc
  .record({
    sx: fc.integer({ min: 1, max: 3 }),
    sy: fc.integer({ min: 1, max: 2 }),
    sz: fc.integer({ min: 1, max: 3 }),
  })
  .chain(({ sx, sy, sz }) =>
    fc
      .array(fc.option(fc.constantFrom(...POOL), { nil: undefined, freq: 3 }), {
        minLength: sx * sy * sz,
        maxLength: sx * sy * sz,
      })
      .map((cells) => {
        const bp = new VoxelGrid(sx, sy, sz);
        cells.forEach((id, i) => {
          if (id !== undefined) bp.data[i] = num(id);
        });
        return bp;
      }),
  );

type Step = IslandCommand | { kind: "undo" };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("place" as const),
      ...coord,
      block: fc.constantFrom(...POOL),
    }),
  },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant("remove" as const), ...coord }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("stamp" as const),
      ...coord,
      blueprint: blueprintArb,
    }),
  },
  { weight: 2, arbitrary: fc.constant({ kind: "undo" as const }) },
);

const inventoryArb = fc.dictionary(fc.constantFrom(...POOL), fc.integer({ min: 0, max: 6 }));

const run = (e: IslandEditor, step: Step): void => {
  if (step.kind === "undo") e.undo();
  else e.apply(step);
};

describe("properties", () => {
  it("conserves inventory + island blocks across any place/remove/stamp/undo sequence", () => {
    fc.assert(
      fc.property(inventoryArb, fc.array(stepArb, { maxLength: 30 }), (inventory, steps) => {
        const e = open(inventory);
        const start = totals(e);
        for (const step of steps) {
          run(e, step);
          expect(totals(e)).toEqual(start);
          for (const n of Object.values(e.inventory())) expect(n).toBeGreaterThanOrEqual(0);
        }
        // Undoing everything gets back the exact start.
        while (e.undo());
        if (steps.length <= UNDO_LIMIT) {
          expect(e.inventory()).toEqual({ ...zeroes(e.inventory()), ...inventory });
        }
      }),
      { seed: SEED, numRuns: 80 },
    );
  });

  it("round-trips save/load exactly after any edit sequence", () => {
    fc.assert(
      fc.property(
        inventoryArb,
        fc.array(stepArb, { maxLength: 30 }),
        fc.integer({ min: 0, max: MAX_EXPANSIONS }),
        (inventory, steps, rings) => {
          const e = open(inventory);
          for (let r = 0; r < rings; r++) e.expand(r % 2 === 0 ? "birch" : "meadow");
          for (const step of steps) run(e, step);
          const saved = e.save(T0 + 1);
          // Through JSON, as the store writes it.
          const loaded: IslandSave = JSON.parse(JSON.stringify(saved)) as IslandSave;
          expect(loaded).toEqual(saved);
          const back = open(e.inventory(), loaded);
          expect(back.grid.data).toEqual(e.grid.data);
          expect(back.expansions).toBe(e.expansions);
          expect(back.inventory()).toEqual(e.inventory());
          expect(back.save(T0 + 2)).toEqual(saved);
        },
      ),
      { seed: SEED, numRuns: 60 },
    );
  });
});

/** The same keys as `inv`, all 0: keys an edit added stay listed after undo. */
function zeroes(inv: Record<BlockId, number>): Record<BlockId, number> {
  return Object.fromEntries(Object.keys(inv).map((k) => [k, 0]));
}
