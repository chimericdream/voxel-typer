/** Builder's cursor, camera and palette rules, and what it tells the play host to save (M4-07). */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { footprint } from "../../../../src/engine/island";
import { DIRECTIONS } from "../../../../src/modes/builder/commands";
import { attachNavKeys, navKeyOf } from "../../../../src/modes/builder/keys";
import {
  BUILDER_ISLAND_EXTRA,
  BUILDER_LESSON,
  isBuilderLesson,
  islandPatchOf,
  withBuilderIsland,
  withIslandPatch,
} from "../../../../src/modes/builder/lesson";
import {
  FOLLOW_SLACK,
  RING_BIOMES,
  ZOOM_MAX,
  ZOOM_MIN,
  arrowDirection,
  cameraPose,
  createTouchLog,
  digCell,
  facing,
  followTarget,
  isBuried,
  mostOwned,
  moveCursor,
  putCell,
  stampOrigin,
  startCursor,
  restorePalette,
  ringCells,
  ringsToAdd,
  steadyPalette,
  turn,
} from "../../../../src/modes/builder/logic";
import type { Quarter } from "../../../../src/modes/builder/logic";
import { VoxelGrid } from "../../../../src/render/mesher/voxel-grid";
import { fixture } from "../../app/helpers";

const area = footprint(0);
const HEIGHT = 32;

/** A column of blocks at (1, 0–2, 1) in a small grid. */
function column(): VoxelGrid {
  const g = new VoxelGrid(4, 8, 4);
  for (let y = 0; y <= 2; y++) g.set(1, y, 1, 7);
  return g;
}

describe("moveCursor", () => {
  it("moves along the island's compass: north is −z, east is +x, up is +y", () => {
    const at = { x: 20, y: 5, z: 20 };
    expect(moveCursor(at, "north", 2, area, HEIGHT).cell).toEqual({ x: 20, y: 5, z: 18 });
    expect(moveCursor(at, "south", 1, area, HEIGHT).cell).toEqual({ x: 20, y: 5, z: 21 });
    expect(moveCursor(at, "east", 3, area, HEIGHT).cell).toEqual({ x: 23, y: 5, z: 20 });
    expect(moveCursor(at, "west", 1, area, HEIGHT).cell).toEqual({ x: 19, y: 5, z: 20 });
    expect(moveCursor(at, "up", 4, area, HEIGHT)).toEqual({
      cell: { x: 20, y: 9, z: 20 },
      moved: 4,
    });
    expect(moveCursor(at, "down", 9, area, HEIGHT)).toEqual({
      cell: { x: 20, y: 0, z: 20 },
      moved: 5,
    });
  });

  it("never leaves the build area (seed 4707)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...DIRECTIONS), fc.integer({ min: 0, max: 60 })), {
          maxLength: 30,
        }),
        fc.integer({ min: 0, max: 6 }),
        (moves, expansions) => {
          const f = footprint(expansions);
          let at = { x: 24, y: 5, z: 24 };
          for (const [dir, steps] of moves) at = moveCursor(at, dir, steps, f, HEIGHT).cell;
          expect(at.x).toBeGreaterThanOrEqual(f.x0);
          expect(at.x).toBeLessThan(f.x1);
          expect(at.z).toBeGreaterThanOrEqual(f.z0);
          expect(at.z).toBeLessThan(f.z1);
          expect(at.y).toBeGreaterThanOrEqual(0);
          expect(at.y).toBeLessThan(HEIGHT);
        },
      ),
      { seed: 4707, numRuns: 200 },
    );
  });
});

describe("where put and dig land", () => {
  it("the cursor starts in the first free cell above the middle of the island", () => {
    const g = new VoxelGrid(48, 32, 48);
    for (let y = 0; y <= 4; y++) g.set(24, y, 24, 1);
    expect(startCursor(g, area)).toEqual({ x: 24, y: 5, z: 24 });
    expect(startCursor(new VoxelGrid(48, 32, 48), area)).toEqual({ x: 24, y: 0, z: 24 });
  });

  it("put fills the cursor's cell, or the first free cell above it", () => {
    const g = column();
    expect(putCell(g, { x: 1, y: 5, z: 1 })).toEqual({ x: 1, y: 5, z: 1 });
    expect(putCell(g, { x: 1, y: 1, z: 1 })).toEqual({ x: 1, y: 3, z: 1 });
    for (let y = 3; y < 8; y++) g.set(1, y, 1, 7);
    expect(putCell(g, { x: 1, y: 1, z: 1 })).toBeNull();
  });

  it("a cursor is buried when any block sits above it in its column", () => {
    const g = column();
    expect(isBuried(g, { x: 1, y: 0, z: 1 })).toBe(true);
    expect(isBuried(g, { x: 1, y: 1, z: 1 })).toBe(true);
    expect(isBuried(g, { x: 1, y: 2, z: 1 })).toBe(false);
    expect(isBuried(g, { x: 1, y: 5, z: 1 })).toBe(false);
    expect(isBuried(g, { x: 2, y: 0, z: 2 })).toBe(false);
  });

  it("dig empties the cursor's cell, or the first block under it", () => {
    const g = column();
    expect(digCell(g, { x: 1, y: 1, z: 1 })).toEqual({ x: 1, y: 1, z: 1 });
    expect(digCell(g, { x: 1, y: 6, z: 1 })).toEqual({ x: 1, y: 2, z: 1 });
    expect(digCell(g, { x: 2, y: 6, z: 2 })).toBeNull();
  });
});

const dot = (a: readonly number[], b: readonly number[]): number =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0);

describe("camera", () => {
  it("in view 0 away is north and right is east; each turn to the right shifts them", () => {
    expect((["away", "right", "near", "left"] as const).map((a) => arrowDirection(a, 0))).toEqual([
      "north",
      "east",
      "south",
      "west",
    ]);
    expect(arrowDirection("right", 1)).toBe("south");
    expect(arrowDirection("away", 1)).toBe("east");
    expect(arrowDirection("left", 3)).toBe("south");
    expect(([0, 1, 2, 3] as const).map(facing)).toEqual(["north", "east", "south", "west"]);
  });

  it("an arrow always moves the cursor the way it points on screen", () => {
    // The camera looks along (−sin yaw, −cos yaw) in x/z; its right is (cos yaw, −sin yaw).
    const step = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] } as const;
    for (const view of [0, 1, 2, 3] as const) {
      const { yaw } = cameraPose({ x: 0, y: 0, z: 0 }, view, 2);
      const look = [-Math.sin(yaw), -Math.cos(yaw)] as const;
      const right = [Math.cos(yaw), -Math.sin(yaw)] as const;
      const dirOf = (arrow: "away" | "right" | "near" | "left"): readonly number[] => {
        const d = arrowDirection(arrow, view);
        return d === "up" || d === "down" ? [0, 0] : step[d];
      };
      expect(dot(dirOf("away"), look)).toBeGreaterThan(0.7);
      expect(dot(dirOf("near"), look)).toBeLessThan(-0.7);
      expect(dot(dirOf("right"), right)).toBeGreaterThan(0.7);
      expect(dot(dirOf("left"), right)).toBeLessThan(-0.7);
    }
  });

  it("turn wraps both ways", () => {
    let q: Quarter = 0;
    for (let i = 0; i < 4; i++) q = turn(q, 1);
    expect(q).toBe(0);
    expect(turn(0, -1)).toBe(3);
  });

  it("zoom is clamped, and nearer steps are closer", () => {
    const at = { x: 0, y: 0, z: 0 };
    expect(cameraPose(at, 0, -5).distance).toBe(cameraPose(at, 0, ZOOM_MIN).distance);
    expect(cameraPose(at, 0, 99).distance).toBe(cameraPose(at, 0, ZOOM_MAX).distance);
    expect(cameraPose(at, 0, ZOOM_MAX).distance).toBeLessThan(cameraPose(at, 0, ZOOM_MIN).distance);
  });

  it("follows the cursor only past the slack, and then just far enough", () => {
    const target = { x: 24, y: 5, z: 24 };
    expect(followTarget(target, { x: 24 + FOLLOW_SLACK.xz, y: 5, z: 24 })).toEqual(target);
    expect(followTarget(target, { x: 24 + FOLLOW_SLACK.xz + 2, y: 5, z: 24 })).toEqual({
      x: 26,
      y: 5,
      z: 24,
    });
    expect(followTarget(target, { x: 24, y: 5 - FOLLOW_SLACK.y - 1, z: 10 })).toEqual({
      x: 24,
      y: 4,
      z: 10 + FOLLOW_SLACK.xz,
    });
  });
});

describe("palette", () => {
  const order = ["grass", "dirt", "cobble", "planks", "glass", "brick", "sand", "clay"];

  it("shows the six blocks the player owns most of, most first", () => {
    const inv = { grass: 3, dirt: 9, cobble: 9, planks: 1, glass: 0, brick: 2, sand: 5, clay: 4 };
    expect(mostOwned(inv, order)).toEqual(["dirt", "cobble", "sand", "clay", "grass", "brick"]);
    expect(mostOwned({}, order)).toEqual([]);
    expect(mostOwned({ "not-a-block": 50, dirt: 1 }, order)).toEqual(["dirt"]);
  });

  it("keeps blocks in their slots while they are owned, and fills a freed slot", () => {
    const shown = ["dirt", "cobble", "sand"];
    expect(steadyPalette(shown, { dirt: 1, cobble: 30, sand: 5 }, order)).toEqual(shown);
    expect(steadyPalette(shown, { dirt: 0, cobble: 30, sand: 5, clay: 2 }, order)).toEqual([
      "cobble",
      "sand",
      "clay",
    ]);
    expect(steadyPalette([], { dirt: 1, cobble: 30 }, order, { n: 1 })).toEqual(["cobble"]);
    // The block in hand keeps its slot when it runs out.
    expect(steadyPalette(shown, { dirt: 0, cobble: 30, sand: 5 }, order, { held: "dirt" })).toEqual(
      shown,
    );
  });

  it("a block just dug, and the block in hand, always get a slot (M4-FIX-1)", () => {
    const six = ["dirt", "cobble", "planks", "glass", "brick", "sand"];
    const inv = { dirt: 9, cobble: 9, planks: 8, glass: 7, brick: 6, sand: 5, grass: 1, clay: 2 };
    // Without them a single grass never outranks six kinds owned by the handful.
    expect(steadyPalette(six, inv, order)).toEqual(six);
    // Dug: it takes the last slot, the others stay put.
    expect(steadyPalette(six, inv, order, { held: "dirt", picked: "grass" })).toEqual([
      "dirt",
      "cobble",
      "planks",
      "glass",
      "brick",
      "grass",
    ]);
    // In hand (armed by name), and dug, at once: the last two slots that are neither.
    expect(steadyPalette(six, inv, order, { held: "clay", picked: "grass" })).toEqual([
      "dirt",
      "cobble",
      "planks",
      "glass",
      "grass",
      "clay",
    ]);
    // Already shown: nothing moves.
    expect(steadyPalette(six, inv, order, { held: "sand", picked: "dirt" })).toEqual(six);
    // Room to spare: it is simply added.
    expect(
      steadyPalette(["dirt"], { dirt: 3, grass: 1 }, order, { held: "dirt", picked: "grass" }),
    ).toEqual(["dirt", "grass"]);
    // Only placeable blocks get a slot.
    expect(
      steadyPalette(six, { ...inv, water: 1 }, order, { held: null, picked: "water" }),
    ).toEqual(six);
  });

  it("in a full palette a new block takes the least recently used slot (review of M4-FIX-1)", () => {
    // A bag of six kinds owned by the dozen, and a hole dug down through grass, dirt and stone.
    const order2 = [...order, "stone"];
    const six = ["cobble", "planks", "glass", "brick", "sand", "clay"];
    let inv: Record<string, number> = {
      cobble: 30,
      planks: 20,
      glass: 18,
      brick: 14,
      sand: 12,
      clay: 10,
    };
    const used = new Map<string, number>();
    let shown = steadyPalette([], inv, order2, { held: "cobble" });
    expect(shown).toEqual(six);
    let tick = 0;
    const dig = (id: string): void => {
      inv = { ...inv, [id]: (inv[id] ?? 0) + 1 };
      used.set(id, ++tick);
      shown = steadyPalette(shown, inv, order2, { held: "cobble", picked: id, used });
    };
    dig("grass");
    dig("dirt");
    dig("stone");
    // All three dug blocks are in view; the three least used slots made room, last first.
    expect(shown).toEqual(["cobble", "planks", "glass", "stone", "dirt", "grass"]);
    // A block used this visit outlives one that wasn't: planks, once placed, stays.
    used.set("planks", ++tick);
    dig("clay");
    expect(shown).toEqual(["cobble", "planks", "clay", "stone", "dirt", "grass"]);
    // And the slots survive a reload when saved: restored as they were.
    expect(restorePalette(shown, inv, order2)).toEqual(shown);
    expect(
      steadyPalette(restorePalette(shown, inv, order2), inv, order2, { held: "cobble" }),
    ).toEqual(shown);
  });

  it("a saved palette is made safe: unknown, used-up, repeated and extra ids are dropped", () => {
    const inv = { dirt: 2, cobble: 0, grass: 1, sand: 4, clay: 1, brick: 1, glass: 1, planks: 1 };
    expect(restorePalette(["dirt", "nope", "cobble", "dirt", "grass", 7], inv, order)).toEqual([
      "dirt",
      "grass",
    ]);
    expect(restorePalette(order, inv, order)).toHaveLength(6);
    expect(restorePalette(undefined, inv, order)).toEqual([]);
    expect(restorePalette("dirt", inv, order)).toEqual([]);
  });
});

describe("redraw bookkeeping", () => {
  it("the touch log keeps the newest boxes, newest out first", () => {
    const log = createTouchLog(2);
    for (const x of [1, 2, 3]) log.push({ min: { x, y: 0, z: 0 }, max: { x, y: 0, z: 0 } });
    expect(log.size).toBe(2);
    expect(log.pop()?.min.x).toBe(3);
    expect(log.pop()?.min.x).toBe(2);
    expect(log.pop()).toBeNull();
  });

  it("a blueprint stands on the cursor's layer, centered on its column", () => {
    expect(stampOrigin({ x: 10, y: 5, z: 10 }, { sx: 3, sz: 5 })).toEqual({ x: 9, y: 5, z: 8 });
    expect(stampOrigin({ x: 10, y: 5, z: 10 }, { sx: 1, sz: 2 })).toEqual({ x: 10, y: 5, z: 9 });
  });
});

const event = (key: string, over: object = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  defaultPrevented: false,
  preventDefault: () => undefined,
  ...over,
});
describe("nav keys", () => {
  it("maps the arrows and the Page keys, and nothing else", () => {
    expect(
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"].map((k) =>
        navKeyOf(event(k)),
      ),
    ).toEqual(["left", "right", "away", "near", "up", "down"]);
    for (const k of ["a", " ", "Enter", "Escape", "Home", "Tab"])
      expect(navKeyOf(event(k))).toBeNull();
  });

  it("leaves handled events, chords and IME composition alone", () => {
    expect(navKeyOf(event("ArrowUp", { defaultPrevented: true }))).toBeNull();
    for (const mod of ["ctrlKey", "metaKey", "altKey", "isComposing"]) {
      expect(navKeyOf(event("ArrowUp", { [mod]: true }))).toBeNull();
    }
  });

  it("with no window there is nothing to listen to", () => {
    expect(() =>
      attachNavKeys(
        null,
        () => true,
        () => undefined,
      )(),
    ).not.toThrow();
  });
});

describe("what Builder tells the play host", () => {
  const miner = fixture("meadow-done-miner");
  const island = {
    grid: { sx: 48, sy: 32, sz: 48, rle: [0, 73728] },
    expansions: 0,
    lastEdited: 5,
  };

  it("is a lesson record for the play host, outside the curriculum", () => {
    expect(isBuilderLesson(BUILDER_LESSON)).toBe(true);
    expect(BUILDER_LESSON).toMatchObject({
      id: "builder",
      mode: "builder",
      targets: { accuracy: 0 },
    });
  });

  it("reads a patch, and refuses anything malformed", () => {
    const patch = { island, inventory: { dirt: 2, cobble: 0 } };
    expect(islandPatchOf(patch)).toEqual(patch);
    const bad: unknown[] = [
      null,
      "x",
      [],
      {},
      { island },
      { island, inventory: { dirt: -1 } },
      { island, inventory: { dirt: 1.5 } },
      { island, inventory: { dirt: "2" } },
      { island: { ...island, grid: { ...island.grid, rle: "x" } }, inventory: {} },
      { island: { ...island, grid: { ...island.grid, rle: [-2, 1] } }, inventory: {} },
      { island: { ...island, expansions: "1" }, inventory: {} },
      { island: { grid: null, expansions: 0, lastEdited: 0 }, inventory: {} },
    ];
    for (const v of bad) expect(islandPatchOf(v), JSON.stringify(v)).toBeNull();
  });

  it("keeps a patch's palette slots when they are a short list of ids, and drops them otherwise", () => {
    const inventory = { grass: 1 };
    const slots = { island: { ...island, palette: ["grass", "dirt"] }, inventory };
    expect(islandPatchOf(slots)).toEqual(slots);
    // A bad palette never stops the island being saved: it is only left out.
    for (const palette of ["grass", [1], ["a", "b", "c", "d", "e", "f", "g"], [""]]) {
      expect(
        islandPatchOf({ island: { ...island, palette }, inventory }),
        JSON.stringify(palette),
      ).toEqual({
        island,
        inventory,
      });
    }
  });

  it("a patch changes the island and the bag, and nothing else", () => {
    const next = withIslandPatch(miner, { island, inventory: { dirt: 2 } });
    expect(next).toEqual({ ...miner, island, inventory: { dirt: 2 }, found: miner.inventory });
    expect(miner.island).toBeNull();
  });

  it("writes lifetime finds only when the profile has none recorded", () => {
    const had = { ...miner, found: { cobble: 4 } };
    expect(withIslandPatch(had, { island, inventory: {} }).found).toEqual({ cobble: 4 });
  });

  it("a result with no island, or a broken one, leaves the profile as it is", () => {
    expect(withBuilderIsland(miner, {})).toBe(miner);
    expect(withBuilderIsland(miner, { extra: { [BUILDER_ISLAND_EXTRA]: { island: 3 } } })).toBe(
      miner,
    );
    expect(
      withBuilderIsland(miner, { extra: { [BUILDER_ISLAND_EXTRA]: { island, inventory: {} } } })
        .island,
    ).toEqual(island);
  });
});

describe("expansions (M4-08)", () => {
  const miner = fixture("meadow-done-miner");
  const badges = (...ids: string[]) => ({
    ...miner,
    achievements: Object.fromEntries(ids.map((id) => [id, 1])),
  });

  it("owes one ring per completed core biome after the Meadow, less the rings given", () => {
    expect(RING_BIOMES).toEqual(["birch", "shore", "frosty", "mines", "marsh", "caverns"]);
    expect(ringsToAdd(badges("meadow-master"), 0)).toEqual([]);
    expect(ringsToAdd(badges("birch-master", "shore-master"), 0)).toEqual(["birch", "shore"]);
    expect(ringsToAdd(badges("birch-master", "shore-master"), 1)).toEqual(["shore"]);
    expect(ringsToAdd(badges("birch-master"), 3)).toEqual([]);
    // A save's count out of range is clamped, never negative.
    expect(ringsToAdd(badges("birch-master"), -2)).toEqual(["birch"]);
  });

  it("names exactly the new ring's cells", () => {
    const cells = ringCells(1);
    const inner = footprint(0);
    const outer = footprint(1);
    const cols = new Set(cells.map((c) => `${c.x},${c.z}`));
    expect(cols.size).toBe(
      (outer.x1 - outer.x0) * (outer.z1 - outer.z0) - (inner.x1 - inner.x0) * (inner.z1 - inner.z0),
    );
    for (const c of cells) {
      expect(c.x >= inner.x0 && c.x < inner.x1 && c.z >= inner.z0 && c.z < inner.z1).toBe(false);
    }
  });
});
