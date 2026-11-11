import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { VoxelGrid } from "../../../src/render/mesher/voxel-grid";

const SEED = 1313;

describe("VoxelGrid get/set (contracts §8.2)", () => {
  it("indexes x + sx * (z + sz * y), y up", () => {
    const g = new VoxelGrid(3, 4, 5);
    g.set(2, 3, 1, 7);
    expect(g.data[2 + 3 * (1 + 5 * 3)]).toBe(7);
    expect(g.get(2, 3, 1)).toBe(7);
    expect(g.get(1, 3, 2)).toBe(0);
  });

  it("reads out of bounds as air and ignores out-of-bounds writes", () => {
    const g = new VoxelGrid(2, 2, 2, new Uint16Array(8).fill(5));
    for (const [x, y, z] of [
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, -1],
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ] as const) {
      expect(g.get(x, y, z)).toBe(0);
      g.set(x, y, z, 9);
    }
    expect([...g.data]).toEqual(Array.from({ length: 8 }, () => 5));
  });
});

describe("VoxelGrid RLE (toJSON/fromJSON)", () => {
  it("encodes runs as [id, count] pairs in index order", () => {
    const g = new VoxelGrid(4, 1, 2, Uint16Array.from([0, 0, 3, 3, 3, 0, 0, 0]));
    expect(g.toJSON()).toEqual({ sx: 4, sy: 1, sz: 2, rle: [0, 2, 3, 3, 0, 3] });
    expect(new VoxelGrid(0, 0, 0).toJSON().rle).toEqual([]);
  });

  it("round-trips random grids (property)", () => {
    const grid = fc
      .record({
        sx: fc.integer({ min: 0, max: 9 }),
        sy: fc.integer({ min: 0, max: 9 }),
        sz: fc.integer({ min: 0, max: 9 }),
      })
      .chain(({ sx, sy, sz }) =>
        fc
          .array(fc.oneof(fc.constantFrom(0, 0, 0, 1, 2), fc.integer({ min: 0, max: 0xffff })), {
            minLength: sx * sy * sz,
            maxLength: sx * sy * sz,
          })
          .map((cells) => new VoxelGrid(sx, sy, sz, Uint16Array.from(cells))),
      );
    fc.assert(
      fc.property(grid, (g) => {
        const json = g.toJSON();
        // Survives a real JSON trip, as in a save.
        const back = VoxelGrid.fromJSON(json);
        const reparsed = VoxelGrid.fromJSON(json);
        expect([back.sx, back.sy, back.sz]).toEqual([g.sx, g.sy, g.sz]);
        expect(back.data).toEqual(g.data);
        expect(reparsed.data).toEqual(g.data);
        expect(JSON.parse(JSON.stringify(json))).toEqual(json);
        // Runs are maximal: no two neighbors share an id, and every count is positive.
        for (let k = 0; k < json.rle.length; k += 2) {
          expect(json.rle[k + 1]).toBeGreaterThan(0);
          if (k >= 2) expect(json.rle[k]).not.toBe(json.rle[k - 2]);
        }
      }),
      { seed: SEED, numRuns: 300 },
    );
  });

  it("encodes a 48×32×48 island of mostly air to < 5% of raw size", () => {
    const sx = 48;
    const sy = 32;
    const sz = 48;
    const g = new VoxelGrid(sx, sy, sz);
    const STONE = 150;
    const DIRT = 2;
    const GRASS = 1;
    const WATER = 5;
    // A round island: a dome of stone under dirt and a grass top, sitting in a shallow pond ring.
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const d = Math.hypot(x - 23.5, z - 23.5);
        if (d > 22) continue;
        if (d > 19) {
          g.set(x, 0, z, WATER);
          continue;
        }
        const h = Math.round(10 - (d * d) / 40); // 10 at the middle, ~1 at the rim
        for (let y = 0; y < h; y++) g.set(x, y, z, y < h - 3 ? STONE : DIRT);
        g.set(x, h, z, GRASS);
      }
    }
    const filled = g.data.reduce((n, id) => n + (id === 0 ? 0 : 1), 0);
    expect(filled / g.data.length).toBeLessThan(0.25); // "mostly air"
    const { rle } = g.toJSON();
    // Raw size = one number per cell; encoded size = numbers in `rle`.
    const ratio = rle.length / g.data.length;
    // Same ratio in serialized bytes: JSON of the RLE against 2 bytes per cell.
    const byteRatio = JSON.stringify(rle).length / (g.data.length * 2);
    console.info(
      `[M1-13] island RLE: ${rle.length} numbers for ${g.data.length} cells ` +
        `(${(ratio * 100).toFixed(2)}%), ${JSON.stringify(rle).length} JSON bytes ` +
        `(${(byteRatio * 100).toFixed(2)}% of 2 bytes/cell)`,
    );
    expect(ratio).toBeLessThan(0.05);
    expect(byteRatio).toBeLessThan(0.05);
    expect(VoxelGrid.fromJSON({ sx, sy, sz, rle }).data).toEqual(g.data);
  });

  it("rejects malformed input", () => {
    const ok = { sx: 2, sy: 1, sz: 1 };
    expect(() => VoxelGrid.fromJSON({ ...ok, rle: [0, 1] })).toThrow(RangeError); // too short
    expect(() => VoxelGrid.fromJSON({ ...ok, rle: [0, 3] })).toThrow(RangeError); // too long
    expect(() => VoxelGrid.fromJSON({ ...ok, rle: [0, 2, 1] })).toThrow(RangeError); // odd
    expect(() => VoxelGrid.fromJSON({ ...ok, rle: [0, 0, 1, 2] })).toThrow(RangeError); // empty run
    expect(() => VoxelGrid.fromJSON({ ...ok, rle: [0, 1.5, 1, 0.5] })).toThrow(RangeError);
    expect(() => VoxelGrid.fromJSON({ ...ok, rle: [70000, 2] })).toThrow(RangeError);
    expect(() => VoxelGrid.fromJSON({ ...ok, rle: [-1, 2] })).toThrow(RangeError);
    expect(() => VoxelGrid.fromJSON({ sx: -1, sy: 1, sz: 1, rle: [] })).toThrow(RangeError);
  });
});
