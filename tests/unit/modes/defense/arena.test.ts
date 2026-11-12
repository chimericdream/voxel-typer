/**
 * Night Defense's arena (task M4-04): the same grid for the same seed, flat clear lanes from the
 * far end to the camp's fence, lanterns to light it, and nothing standing where a mob walks.
 */
import { describe, expect, it } from "vitest";
import { blocks } from "../../../../src/content/blocks";
import {
  ARENA_MAX_LANES,
  ARENA_SIZE,
  LANE_WIDTH,
  WAIT_SHARE,
  arenaLayout,
  generateArena,
} from "../../../../src/content/worldgen/defense-arena";
import { BAND_LANES } from "../../../../src/modes/defense/logic";
import { BIOME_ORDER } from "../../../../src/types/core";

const byNum = new Map(blocks.map((b) => [b.num, b]));
const LANTERN = blocks.find((b) => b.id === "lantern")?.num ?? -1;

describe("arena layout", () => {
  it("centres 1 to 5 lanes, with the waiting line 85 % of the way to the camp", () => {
    for (let n = 1; n <= ARENA_MAX_LANES; n++) {
      const l = arenaLayout(n);
      expect(l.lanes).toBe(n);
      expect(l.laneX).toHaveLength(n);
      const mid = ((l.laneX[0] ?? 0) + (l.laneX[n - 1] ?? 0)) / 2;
      // The field is centred on its lanes, within a block of the grid's middle, and every lane's
      // middle is the middle of a cell.
      expect(l.center.x).toBeCloseTo(mid);
      expect(Math.abs(mid - ARENA_SIZE.sx / 2)).toBeLessThanOrEqual(1);
      for (const x of l.laneX) expect(x - Math.floor(x)).toBeCloseTo(0.5);
      expect(l.farZ).toBeLessThan(l.waitZ);
      expect(l.waitZ).toBeLessThan(l.baseZ);
      expect((l.waitZ - l.farZ) / (l.baseZ - l.farZ)).toBeCloseTo(WAIT_SHARE);
      // The field fits the grid with room for scenery at the sides.
      expect(l.center.x - l.width / 2).toBeGreaterThan(4);
      expect(l.center.x + l.width / 2).toBeLessThan(ARENA_SIZE.sx - 4);
    }
    expect(arenaLayout(0).lanes).toBe(1);
    expect(arenaLayout(99).lanes).toBe(ARENA_MAX_LANES);
    expect(arenaLayout(Number.NaN).lanes).toBe(1);
  });
});

describe("arena grid", () => {
  it("is the same for the same seed and differs with the seed", () => {
    const a = generateArena("meadow", 11, 3);
    expect(a.data).toEqual(generateArena("meadow", 11, 3).data);
    expect(a.data).not.toEqual(generateArena("meadow", 12, 3).data);
    expect([a.sx, a.sy, a.sz]).toEqual([ARENA_SIZE.sx, ARENA_SIZE.sy, ARENA_SIZE.sz]);
  });

  it("uses only known blocks, in every biome", () => {
    for (const biome of BIOME_ORDER) {
      const g = generateArena(biome, 3, 4);
      for (const n of new Set(g.data))
        if (n !== 0) expect(byNum.has(n), `block ${String(n)}`).toBe(true);
    }
  });

  it("keeps every lane flat and clear from the far end to the fence, for each band's arena", () => {
    for (const lanes of Object.values(BAND_LANES))
      for (const seed of [1, 2, 3, 4, 5]) {
        const g = generateArena("meadow", seed, lanes);
        const l = arenaLayout(lanes);
        const floor = l.groundY - 1;
        for (const x of l.laneX)
          for (let z = Math.floor(l.farZ); z <= Math.floor(l.baseZ); z++)
            for (let dx = -Math.floor(LANE_WIDTH / 2); dx <= Math.floor(LANE_WIDTH / 2); dx++) {
              const cx = Math.floor(x + dx);
              // Solid ground under the mob, and air above it up to where its plate floats.
              expect(g.get(cx, floor, z), `floor at ${cx},${z}`).not.toBe(0);
              for (let y = l.groundY; y < l.groundY + 7; y++)
                expect(g.get(cx, y, z), `air at ${cx},${y},${z}`).toBe(0);
            }
      }
  });

  it("lights the camp: a lantern on a post beside each lane, and the campfire", () => {
    for (const lanes of Object.values(BAND_LANES)) {
      const g = generateArena("meadow", 1, lanes);
      const l = arenaLayout(lanes);
      const lanterns: { x: number; z: number }[] = [];
      for (let z = 0; z < g.sz; z++)
        for (let x = 0; x < g.sx; x++)
          for (let y = 0; y < g.sy; y++) if (g.get(x, y, z) === LANTERN) lanterns.push({ x, z });
      // One post per lane and one more, plus the fire.
      expect(lanterns.length).toBe(lanes + 2);
      // None stands on a lane, where it would hide a mob at the base.
      for (const lamp of lanterns)
        for (const x of l.laneX) expect(Math.abs(lamp.x + 0.5 - x)).toBeGreaterThan(LANE_WIDTH / 2);
    }
  });

  it("puts nothing tall between the camera and the field", () => {
    const g = generateArena("meadow", 9, 5);
    const l = arenaLayout(5);
    // In front of the fence, across the field's width: nothing higher than the fence's lanterns.
    for (let z = Math.floor(l.baseZ) + 3; z < g.sz; z++)
      for (let x = Math.floor(l.center.x - l.width / 2); x <= l.center.x + l.width / 2; x++)
        for (let y = l.groundY + 2; y < g.sy; y++) expect(g.get(x, y, z)).toBe(0);
  });
});
