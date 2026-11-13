/**
 * No block is ever lost on the Home Island (task M4-FIX-1, the no-failure rule). For any run of
 * Builder's `put`, `dig` and `undo`, with saves and reloads between them, the island's blocks plus
 * the inventory add up to what they were at the start, block by block. Grass stays grass: it is a
 * placeable block the Mine hands out, so digging it refunds grass, never dirt.
 *
 * The edits go where Builder sends them (`putCell`, `digCell`), and each reload goes through the
 * real save path: `withIslandPatch` onto the profile, the save store (its validator runs on every
 * save), JSON, and `openIsland` from what was loaded.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { blocks } from "../../../../src/content/blocks";
import { countBlocks, createIsland, islandBlocks, openIsland } from "../../../../src/engine/island";
import type { IslandEditor } from "../../../../src/engine/island";
import { withIslandPatch } from "../../../../src/modes/builder/lesson";
import { digCell, putCell } from "../../../../src/modes/builder/logic";
import { VoxelGrid } from "../../../../src/render/mesher/voxel-grid";
import type { Profile } from "../../../../src/save/schema";
import { createMemoryStore } from "../../../../src/save/store";
import type { BlockId } from "../../../../src/types/core";
import { fixture } from "../../app/helpers";

const SEED = 181;
const lookup = islandBlocks(blocks);
const placeable = blocks.filter((b) => b.tags.includes("placeable")).map((b) => b.id);
const T0 = 1_800_000_000_000;

/** Blocks a bag may start with. Grass is left out on purpose for half the runs (see below). */
const POOL: BlockId[] = ["dirt", "cobble", "oak-planks", "stone", "glass", "red-blooms", "grass"];

/** Island blocks plus the bag, per block id, with zero counts left out. */
function totals(grid: VoxelGrid, inventory: Readonly<Record<BlockId, number>>) {
  const out: Record<BlockId, number> = { ...countBlocks(grid, lookup) };
  for (const [id, n] of Object.entries(inventory)) out[id] = (out[id] ?? 0) + n;
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n !== 0));
}

type Step =
  | { kind: "put"; x: number; y: number; z: number; block: BlockId }
  | { kind: "dig"; x: number; y: number; z: number }
  | { kind: "undo" }
  | { kind: "reload" };

/** Columns over the plot (12–35) and a little past its edge, from under the ground to above it. */
const cell = {
  x: fc.integer({ min: 10, max: 37 }),
  y: fc.integer({ min: 0, max: 9 }),
  z: fc.integer({ min: 10, max: 37 }),
};

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("put" as const),
      ...cell,
      block: fc.constantFrom(...POOL),
    }),
  },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("dig" as const), ...cell }) },
  { weight: 2, arbitrary: fc.constant({ kind: "undo" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "reload" as const }) },
);

const bagArb = fc.record({
  inventory: fc.dictionary(fc.constantFrom(...POOL), fc.integer({ min: 0, max: 5 })),
  noGrass: fc.boolean(),
});

/** One step as Builder does it. Water is left alone, the way `dig` leaves it. */
function step(e: IslandEditor, s: Exclude<Step, { kind: "reload" }>): void {
  if (s.kind === "undo") {
    e.undo();
  } else if (s.kind === "put") {
    const at = putCell(e.grid, s);
    if (at !== null) e.apply({ kind: "place", ...at, block: s.block });
  } else {
    const at = digCell(e.grid, s);
    if (at === null) return;
    const id = lookup.idOf(e.grid.get(at.x, at.y, at.z));
    if (id !== undefined && placeable.includes(id)) e.apply({ kind: "remove", ...at });
  }
}

describe("Builder conservation (M4-FIX-1)", () => {
  it("island + bag stay the same per block across put, dig, undo, saves and reloads", async () => {
    const base = fixture("fresh-sprout");
    await fc.assert(
      fc.asyncProperty(
        bagArb,
        fc.array(stepArb, { minLength: 1, maxLength: 40 }),
        async ({ inventory, noGrass }, steps) => {
          const bag = { ...inventory };
          if (noGrass) delete bag["grass"];
          const store = createMemoryStore();
          let profile: Profile = { ...base, inventory: bag, island: null };
          const island = createIsland(profile.id, lookup, T0);
          const start = totals(VoxelGrid.fromJSON(island.grid), bag);
          const reopen = (): IslandEditor => {
            if (profile.island === null) throw new Error("no island saved");
            return openIsland({
              island: profile.island,
              inventory: profile.inventory,
              blocks: lookup,
              profileId: profile.id,
            });
          };
          let e = openIsland({ island, inventory: bag, blocks: lookup, profileId: profile.id });
          let now = T0;
          const reload = async (): Promise<void> => {
            now += 1000;
            profile = withIslandPatch(profile, {
              island: e.save(now),
              inventory: e.inventory(),
            });
            await store.save(profile);
            const loaded = await store.load(profile.id);
            if (loaded === null) throw new Error("the save did not load");
            profile = loaded;
            e = reopen();
          };
          for (const s of steps) {
            if (s.kind === "reload") await reload();
            else step(e, s);
            expect(totals(e.grid, e.inventory())).toEqual(start);
          }
          await reload();
          expect(totals(e.grid, e.inventory())).toEqual(start);
          expect(
            totals(VoxelGrid.fromJSON(profile.island?.grid ?? island.grid), profile.inventory),
          ).toEqual(start);
          for (const n of Object.values(profile.inventory)) expect(n).toBeGreaterThanOrEqual(0);
          // Digging never counts as a find.
          expect(profile.found).toEqual(bag);
        },
      ),
      { seed: SEED, numRuns: 40 },
    );
  });

  it("grass dug with none in the bag comes back as grass, and survives a reload", async () => {
    const profile: Profile = { ...fixture("fresh-sprout"), inventory: { dirt: 2 } };
    const island = createIsland(profile.id, lookup, T0);
    const e = openIsland({
      island,
      inventory: profile.inventory,
      blocks: lookup,
      profileId: profile.id,
    });
    const at = digCell(e.grid, { x: 24, y: 9, z: 24 });
    expect(at).not.toBeNull();
    if (at === null) return;
    expect(lookup.idOf(e.grid.get(at.x, at.y, at.z))).toBe("grass");
    expect(e.apply({ kind: "remove", ...at })).toMatchObject({ ok: true, delta: { grass: 1 } });
    const store = createMemoryStore();
    const next = withIslandPatch(profile, { island: e.save(T0 + 1), inventory: e.inventory() });
    await store.save(next);
    const loaded = await store.load(next.id);
    expect(loaded?.inventory).toEqual({ dirt: 2, grass: 1 });
    expect(loaded?.found).toEqual({ dirt: 2 });
  });
});
