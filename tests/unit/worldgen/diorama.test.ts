/**
 * Diorama worldgen (task M2-03): determinism (hash pinned), the clear stage, gentle slopes around
 * it, contained water and the templates it uses.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { blocks as flora } from "../../../src/content/blocks/flora";
import { blocks as ores } from "../../../src/content/blocks/ores";
import { blocks as stone } from "../../../src/content/blocks/stone";
import { blocks as terrain } from "../../../src/content/blocks/terrain";
import { blocks as wood } from "../../../src/content/blocks/wood";
import {
  DIORAMA_SIZE,
  dioramaStage,
  generateDiorama,
  recipeFor,
} from "../../../src/content/worldgen/diorama";
import {
  TREE_MAX_HEIGHT,
  TREE_MAX_REACH,
  TREE_VARIANTS,
  oakTree,
} from "../../../src/content/worldgen/templates/trees";
import type { TreeVariant } from "../../../src/content/worldgen/templates/trees";
import { createRng } from "../../../src/engine/rng";
import type { VoxelGrid } from "../../../src/render/mesher/voxel-grid";

const SEED = 20251111;
const blocks = [...flora, ...ores, ...stone, ...terrain, ...wood];
const numOf = (id: string): number => {
  const b = blocks.find((x) => x.id === id);
  if (!b) throw new Error(`no block ${id}`);
  return b.num;
};
const R = recipeFor("meadow").blocks;
const WATER = numOf(R.water);
/** Blocks the ground is made of (templates sit on top of these). */
const GROUND = new Set([R.top, R.sub, R.deep, R.shore, R.bed, R.path].map(numOf));

/** FNV-1a over the grid data. */
function gridHash(g: VoxelGrid): string {
  let h = 0x811c9dc5;
  for (const v of g.data) {
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ (v >>> 8), 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Height of the topmost ground block of a column, counting up from the bottom. */
function groundTop(g: VoxelGrid, x: number, z: number): number {
  let y = 0;
  while (y + 1 < g.sy && GROUND.has(g.get(x, y + 1, z))) y++;
  return y;
}

/** True if the column holds pond water. */
const wet = (g: VoxelGrid, x: number, z: number): boolean =>
  g.get(x, groundTop(g, x, z) + 1, z) === WATER;

/** A tree variant's voxel positions, as one sortable string. */
const shape = (v: TreeVariant): string =>
  oakTree(v, { log: 1, leaves: 2 }, createRng(1))
    .voxels.map((p) => `${p.dx},${p.dy},${p.dz}`)
    .toSorted()
    .join(";");

const cache = new Map<number, VoxelGrid>();
const meadow = (seed: number): VoxelGrid => {
  let g = cache.get(seed);
  if (!g) {
    g = generateDiorama("meadow", seed);
    cache.set(seed, g);
  }
  return g;
};

describe("generateDiorama", () => {
  it("has the card's size: 64 × 24 × 64", () => {
    const g = meadow(1);
    expect([g.sx, g.sy, g.sz]).toEqual([64, 24, 64]);
    expect(DIORAMA_SIZE).toEqual({ sx: 64, sy: 24, sz: 64 });
  });

  it("is deterministic: same seed, identical grid (hash pinned)", () => {
    expect(gridHash(generateDiorama("meadow", 1))).toBe(gridHash(generateDiorama("meadow", 1)));
    // Pinned. A change here means every Meadow looks different; update it on purpose only.
    expect(gridHash(meadow(1))).toBe("6080a2e0");
    expect(gridHash(meadow(42))).toBe("51605bb8");
  });

  it("differs between seeds", () => {
    expect(gridHash(meadow(1))).not.toBe(gridHash(meadow(2)));
  });

  it("uses only registry blocks", () => {
    const known = new Set(blocks.map((b) => b.num));
    for (const v of new Set(meadow(1).data)) if (v !== 0) expect(known.has(v)).toBe(true);
  });

  it("places trees, flowers, rocks, a fence, a path and a pond", () => {
    const used = new Set(meadow(1).data);
    for (const id of [R.log, R.leaves, R.rail, R.path, R.water, R.shore]) {
      expect(used.has(numOf(id)), id).toBe(true);
    }
    expect(R.flowers.some((f) => used.has(numOf(f)))).toBe(true);
    expect(used.has(numOf(R.rock)) || used.has(numOf(R.mossyRock))).toBe(true);
  });

  it("keeps the fence out past the sides of the Mine view, and behind the target (M2-FIX-2)", () => {
    const { target } = dioramaStage("meadow");
    const rail = numOf(R.rail);
    for (let seed = 1; seed <= 10; seed++) {
      const g = meadow(seed);
      let rails = 0;
      for (let z = 0; z < g.sz; z++) {
        for (let y = 0; y < g.sy; y++) {
          for (let x = 0; x < g.sx; x++) {
            if (g.get(x, y, z) !== rail) continue;
            rails++;
            expect(Math.abs(x - target.x), `seed ${seed}`).toBeGreaterThanOrEqual(13);
            expect(z, `seed ${seed}`).toBeLessThanOrEqual(target.z - 5);
          }
        }
      }
      expect(rails, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it("puts flowers on the front lawn's corners (M2-FIX-2)", () => {
    const { clear, target } = dioramaStage("meadow");
    const flowers = new Set(R.flowers.map(numOf));
    for (let seed = 1; seed <= 10; seed++) {
      const g = meadow(seed);
      let front = 0;
      for (let z = target.z - 4; z < g.sz; z++) {
        for (let y = 0; y < g.sy; y++) {
          for (let x = 0; x < g.sx; x++) {
            if (x > clear.x0 - 6 && x < clear.x1 + 6) continue;
            if (flowers.has(g.get(x, y, z))) front++;
          }
        }
      }
      expect(front, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it("keeps the stage clear over a flat floor (property over 50 seeds)", () => {
    const { clear, floorY, target } = dioramaStage("meadow");
    expect(target.y).toBe(floorY + 2);
    expect(target.x).toBeGreaterThanOrEqual(clear.x0);
    expect(target.z).toBeGreaterThanOrEqual(clear.z0);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0x7fffffff }), (seed) => {
        const g = generateDiorama("meadow", seed);
        for (let z = clear.z0; z <= clear.z1; z++) {
          for (let x = clear.x0; x <= clear.x1; x++) {
            const floor = g.get(x, floorY, z);
            if (floor === 0 || floor === WATER) expect.fail(`seed ${seed}: no floor at ${x},${z}`);
            for (let y = clear.y0; y <= clear.y1; y++) {
              if (g.get(x, y, z) !== 0) expect.fail(`seed ${seed}: ${x},${y},${z} not clear`);
            }
          }
        }
      }),
      { seed: SEED, numRuns: 50 },
    );
  });

  it("has no drops or pits near the stage, and gentle slopes everywhere (20 seeds)", () => {
    const { clear } = dioramaStage("meadow");
    const near = (x: number, z: number): boolean =>
      x >= clear.x0 - 8 && x <= clear.x1 + 8 && z >= clear.z0 - 8;
    for (let seed = 1; seed <= 20; seed++) {
      const g = meadow(seed);
      for (let z = 0; z < g.sz; z++) {
        for (let x = 0; x < g.sx; x++) {
          if (wet(g, x, z)) {
            if (near(x, z)) expect.fail(`seed ${seed}: pond near the stage at ${x},${z}`);
            continue;
          }
          const h = groundTop(g, x, z);
          for (const [nx, nz] of [
            [x + 1, z],
            [x, z + 1],
          ] as const) {
            if (nx >= g.sx || nz >= g.sz || wet(g, nx, nz)) continue;
            const d = Math.abs(groundTop(g, nx, nz) - h);
            if (d > 1) expect.fail(`seed ${seed}: step of ${d} at ${x},${z}`);
          }
        }
      }
    }
  });

  it("keeps the water in: no water cell touches air at its sides or below", () => {
    const sides = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, -1, 0],
    ] as const;
    for (const seed of [1, 2, 3, 42, 99]) {
      const g = meadow(seed);
      let cells = 0;
      for (let y = 0; y < g.sy; y++) {
        for (let z = 0; z < g.sz; z++) {
          for (let x = 0; x < g.sx; x++) {
            if (g.get(x, y, z) !== WATER) continue;
            cells++;
            for (const [dx, dy, dz] of sides) {
              if (g.get(x + dx, y + dy, z + dz) === 0) {
                expect.fail(`seed ${seed}: water at ${x},${y},${z} leaks`);
              }
            }
          }
        }
      }
      expect(cells).toBeGreaterThan(20);
    }
  });

  it("other biomes fall back to the Meadow recipe until they get their own", () => {
    expect(recipeFor("birch")).toBe(recipeFor("meadow"));
  });

  it("rejects a size too small for the stage", () => {
    expect(() => generateDiorama("meadow", 1, { sx: 16, sy: 24, sz: 16 })).toThrow(RangeError);
  });
});

describe("oak tree templates", () => {
  it("every variant fits the declared height and reach, trunk first", () => {
    for (const variant of TREE_VARIANTS) {
      for (let s = 0; s < 30; s++) {
        const t = oakTree(variant, { log: 1, leaves: 2 }, createRng(s));
        expect(t.voxels[0]).toEqual({ dx: 0, dy: 0, dz: 0, block: 1 });
        for (const v of t.voxels) {
          expect(v.dy).toBeGreaterThanOrEqual(0);
          expect(v.dy).toBeLessThan(TREE_MAX_HEIGHT);
          expect(Math.max(Math.abs(v.dx), Math.abs(v.dz))).toBeLessThanOrEqual(TREE_MAX_REACH);
        }
      }
    }
  });

  it("the three variants have different shapes", () => {
    expect(new Set(TREE_VARIANTS.map(shape)).size).toBe(3);
  });
});
