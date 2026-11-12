/**
 * Sprig meshing tests (task card M2-FIX-4, decision 82).
 *
 * A sprig (flowers) is a thin stem, a small bloom and two leaf nubs built from sub-voxel boxes
 * inside its cell. It counts as air to its neighbours (no culling, no AO either way), shares the
 * chunk mesh and is deterministic.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  meshChunk,
  sprigTurned,
  VoxelGrid,
  type AtlasLookup,
  type ChunkMesh,
} from "../../../src/render/mesher/voxel-grid";
import { blocks as flora } from "../../../src/content/blocks/flora";

type Triplet = readonly [number, number, number];

const SEED = 820_011;

const STONE = 150;
const GLASS = 5;
const FLOWER = 310;
const FLOWER_B = 311;
const SPRIGS: ReadonlySet<number> = new Set([FLOWER, FLOWER_B]);

/** A distinct UV rect per (block, face), 0.01 on a side, so UV checks pin the face and sub-rect. */
const ATLAS: AtlasLookup = {
  uv(blockNum, face) {
    const u = blockNum / 1000;
    const v = face === "top" ? 0.5 : face === "bottom" ? 0.25 : 0;
    return [u, v, u + 0.01, v + 0.01];
  },
  transparent: (n) => n === GLASS,
  shape: (n) => (SPRIGS.has(n) ? "sprig" : "cube"),
};

/** The same atlas without `shape`: every block is a cube (atlases from before M2-FIX-4). */
const CUBE_ATLAS: AtlasLookup = {
  uv: (n, face) => ATLAS.uv(n, face),
  transparent: (n) => ATLAS.transparent(n),
};

const mesh = (g: VoxelGrid, opts: { atlas?: AtlasLookup; ao?: boolean } = {}): ChunkMesh =>
  meshChunk(g, { x: 0, y: 0, z: 0 }, 16, opts.atlas ?? ATLAS, { ao: opts.ao ?? true });

const quadCount = (m: ChunkMesh): number => m.indices.length / 6;
const f = (a: Float32Array, i: number): number => a[i] ?? Number.NaN;
const corner = (m: ChunkMesh, q: number, c: number): Triplet => [
  f(m.positions, q * 12 + c * 3),
  f(m.positions, q * 12 + c * 3 + 1),
  f(m.positions, q * 12 + c * 3 + 2),
];
const normal = (m: ChunkMesh, q: number): Triplet => [
  f(m.normals, q * 12),
  f(m.normals, q * 12 + 1),
  f(m.normals, q * 12 + 2),
];

/** The cell a quad belongs to: just behind its centre (the rule `splitByBucket` uses). */
const cellOf = (m: ChunkMesh, q: number): Triplet => {
  const n = normal(m, q);
  const c = [0, 1, 2].map((a) =>
    Math.floor(
      [0, 1, 2, 3].reduce((s, k) => s + (corner(m, q, k)[a] ?? 0), 0) / 4 - (n[a] ?? 0) / 64,
    ),
  );
  return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
};

/** A mesh's quads as comparable records: corners, normal, uvs, colors and local indices. */
const quadsOf = (m: ChunkMesh, keep: (q: number) => boolean = () => true): string[] => {
  const out: string[] = [];
  for (let q = 0; q < quadCount(m); q++) {
    if (!keep(q)) continue;
    out.push(
      JSON.stringify([
        Array.from(m.positions.subarray(q * 12, q * 12 + 12)),
        Array.from(m.normals.subarray(q * 12, q * 12 + 12)),
        Array.from(m.uvs.subarray(q * 8, q * 8 + 8)),
        Array.from(m.colors.subarray(q * 12, q * 12 + 12)),
        Array.from(m.indices.subarray(q * 6, q * 6 + 6), (i) => i - q * 4),
      ]),
    );
  }
  return out;
};

/** Axis-aligned bounds of the given quads. */
const bounds = (m: ChunkMesh, qs: readonly number[]): { lo: number[]; hi: number[] } => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const q of qs) {
    for (let c = 0; c < 4; c++) {
      const p = corner(m, q, c);
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a] ?? 0, p[a] ?? 0);
        hi[a] = Math.max(hi[a] ?? 0, p[a] ?? 0);
      }
    }
  }
  return { lo, hi };
};

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** A column (x, z) with the given turn, searched from the origin. */
const columnWith = (turned: boolean): [number, number] => {
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) if (sprigTurned(x, z) === turned) return [x, z];
  }
  throw new Error("no such column");
};

describe("content", () => {
  it("every flower is a sprig, and nothing else in flora is", () => {
    for (const b of flora) {
      expect(b.shape === "sprig", b.id).toBe(b.tags.includes("flower"));
    }
    expect(flora.filter((b) => b.shape === "sprig")).toHaveLength(4);
  });
});

/** A grid with one flower at (x, 1, z), meshed. */
const lone = (x: number, z: number): ChunkMesh => {
  const g = new VoxelGrid(16, 3, 16);
  g.set(x, 1, z, FLOWER);
  return mesh(g);
};

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Each quad's corners relative to its cell (x and z swapped when `swap`), order-free. */
const quadShapes = (m: ChunkMesh, x: number, z: number, swap: boolean): string[] =>
  range(quadCount(m))
    .map((q) =>
      [0, 1, 2, 3]
        .map((c) => corner(m, q, c))
        .map((p) => (swap ? [p[2] - z, p[1], p[0] - x] : [p[0] - x, p[1], p[2] - z]))
        .map((p) => JSON.stringify(p))
        .toSorted(byText)
        .join(" "),
    )
    .toSorted(byText);

describe("sprig geometry", () => {
  it.each([false, true])("a lone sprig (turned: %s) is 20 quads inside its cell", (turned) => {
    const [x, z] = columnWith(turned);
    const m = lone(x, z);
    // Stem 4 sides, bloom 6 faces, two leaf nubs of 5 faces each.
    expect(quadCount(m)).toBe(20);
    const all = bounds(m, range(20));
    // The leaves reach 4/16–12/16 along one axis; the bloom spans 5/16–11/16 along the other.
    const [lx, lz] = turned ? [5, 4] : [4, 5];
    expect(all.lo).toEqual([x + lx / 16, 1, z + lz / 16]);
    expect(all.hi).toEqual([x + (16 - lx) / 16, 1 + 10 / 16, z + (16 - lz) / 16]);
    for (let q = 0; q < 20; q++) expect(cellOf(m, q)).toEqual([x, 1, z]);
    // Full brightness everywhere: a sprig takes no AO.
    expect(new Set(m.colors)).toEqual(new Set([1]));
  });

  it("the bloom is 6/16 wide and sits on a 2/16 stem, 10/16 tall overall", () => {
    const [x, z] = columnWith(false);
    const m = lone(x, z);
    const top = range(20).filter((q) => normal(m, q)[1] === 1);
    // Only the bloom and the two leaves face up; the bloom's top is the highest.
    const bloomTop = top.find((q) => corner(m, q, 0)[1] === 1 + 10 / 16);
    expect(bloomTop).toBeDefined();
    const b = bounds(m, [bloomTop ?? 0]);
    expect((b.hi[0] ?? 0) - (b.lo[0] ?? 0)).toBe(6 / 16);
    expect((b.hi[2] ?? 0) - (b.lo[2] ?? 0)).toBe(6 / 16);
    // The stem: side quads that start on the ground.
    const stem = range(20).filter((q) => normal(m, q)[1] === 0 && bounds(m, [q]).lo[1] === 1);
    expect(stem).toHaveLength(4);
    const s = bounds(m, stem);
    expect(s.lo).toEqual([x + 7 / 16, 1, z + 7 / 16]);
    expect(s.hi).toEqual([x + 9 / 16, 1 + 6 / 16, z + 9 / 16]);
  });

  it("every triangle winds outward", () => {
    for (const turned of [false, true]) {
      const [x, z] = columnWith(turned);
      const m = lone(x, z);
      for (let q = 0; q < quadCount(m); q++) {
        const n = normal(m, q);
        for (const t of [0, 1]) {
          const [p0, p1, p2] = [0, 1, 2].map((k) => {
            const i = m.indices[q * 6 + t * 3 + k] ?? 0;
            return [f(m.positions, i * 3), f(m.positions, i * 3 + 1), f(m.positions, i * 3 + 2)];
          });
          const a = [0, 1, 2].map((k) => (p1?.[k] ?? 0) - (p0?.[k] ?? 0));
          const b = [0, 1, 2].map((k) => (p2?.[k] ?? 0) - (p0?.[k] ?? 0));
          const c = [
            (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
            (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
            (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
          ];
          const d = (c[0] ?? 0) * n[0] + (c[1] ?? 0) * n[1] + (c[2] ?? 0) * n[2];
          expect(d, `quad ${q} triangle ${t}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the bloom top shows the middle of the top tile; leaves sample the side tile's leaf strip", () => {
    const [x, z] = columnWith(false);
    const m = lone(x, z);
    const u0 = FLOWER / 1000;
    const uvs = (q: number): number[] => Array.from(m.uvs.subarray(q * 8, q * 8 + 8));
    const bloomTop = range(20).find(
      (q) => normal(m, q)[1] === 1 && corner(m, q, 0)[1] === 1 + 10 / 16,
    );
    const uv = uvs(bloomTop ?? 0);
    const us = uv.filter((_, i) => i % 2 === 0);
    const vs = uv.filter((_, i) => i % 2 === 1);
    expect(close(Math.min(...us), u0 + 0.01 * (5 / 16))).toBe(true);
    expect(close(Math.max(...us), u0 + 0.01 * (11 / 16))).toBe(true);
    expect(close(Math.min(...vs), 0.5 + 0.01 * (5 / 16))).toBe(true);
    expect(close(Math.max(...vs), 0.5 + 0.01 * (11 / 16))).toBe(true);
    // Leaf tops (the low up-facing quads) sample the side tile's columns 9–11 of row 2.
    const leafTops = range(20).filter((q) => normal(m, q)[1] === 1 && q !== bloomTop);
    expect(leafTops).toHaveLength(2);
    for (const q of leafTops) {
      const l = uvs(q);
      const lu = l.filter((_, i) => i % 2 === 0);
      const lv = l.filter((_, i) => i % 2 === 1);
      expect(close(Math.min(...lu), u0 + 0.01 * (9 / 16))).toBe(true);
      expect(close(Math.max(...lu), u0 + 0.01 * (12 / 16))).toBe(true);
      expect(close(Math.min(...lv), 0.01 * (2 / 16))).toBe(true);
      expect(close(Math.max(...lv), 0.01 * (3 / 16))).toBe(true);
    }
  });

  it("the two turns differ only by swapping x and z", () => {
    const [ax, az] = columnWith(false);
    const [bx, bz] = columnWith(true);
    const a = lone(ax, az);
    const b = lone(bx, bz);
    expect(quadShapes(b, bx, bz, true)).toEqual(quadShapes(a, ax, az, false));
    expect(quadShapes(b, bx, bz, false)).not.toEqual(quadShapes(a, ax, az, false));
  });

  it("an atlas without shape() meshes the flower as a cube", () => {
    const g = new VoxelGrid(3, 3, 3);
    g.set(1, 1, 1, FLOWER);
    expect(quadCount(mesh(g, { atlas: CUBE_ATLAS }))).toBe(6);
  });
});

describe("a sprig is air to its neighbours", () => {
  it("an enclosed sprig still meshes, and its six neighbours show their faces toward it", () => {
    const g = new VoxelGrid(3, 3, 3);
    for (const [x, y, z] of [
      [0, 1, 1],
      [2, 1, 1],
      [1, 0, 1],
      [1, 2, 1],
      [1, 1, 0],
      [1, 1, 2],
    ] as const) {
      g.set(x, y, z, STONE);
    }
    g.set(1, 1, 1, FLOWER);
    const m = mesh(g);
    // Six lone stones (6 faces each) plus the sprig's 20.
    expect(quadCount(m)).toBe(36 + 20);
  });

  it("a stone under and beside a sprig keeps every face and gets no AO from it", () => {
    const g = new VoxelGrid(4, 3, 4);
    g.set(1, 0, 1, STONE);
    g.set(2, 1, 1, STONE);
    const without = mesh(g);
    g.set(1, 1, 1, FLOWER);
    g.set(2, 1, 2, FLOWER);
    g.set(1, 1, 2, FLOWER);
    const withSprigs = mesh(g);
    const isSprig = (q: number): boolean => {
      const [x, y, z] = cellOf(withSprigs, q);
      return SPRIGS.has(g.get(x, y, z));
    };
    expect(quadsOf(withSprigs, (q) => !isSprig(q))).toEqual(quadsOf(without));
  });

  it("property: the non-sprig quads equal the mesh with every sprig turned to air", () => {
    const gridArb = fc
      .record({
        sx: fc.integer({ min: 1, max: 5 }),
        sy: fc.integer({ min: 1, max: 4 }),
        sz: fc.integer({ min: 1, max: 5 }),
      })
      .chain(({ sx, sy, sz }) =>
        fc
          .array(fc.constantFrom(0, 0, STONE, GLASS, FLOWER, FLOWER_B), {
            minLength: sx * sy * sz,
            maxLength: sx * sy * sz,
          })
          .map((cells) => new VoxelGrid(sx, sy, sz, Uint16Array.from(cells))),
      );
    fc.assert(
      fc.property(gridArb, fc.boolean(), (g, ao) => {
        const m = mesh(g, { ao });
        const air = new VoxelGrid(
          g.sx,
          g.sy,
          g.sz,
          g.data.map((id) => (SPRIGS.has(id) ? 0 : id)),
        );
        const sprigCells = g.data.reduce((n, id) => n + (SPRIGS.has(id) ? 1 : 0), 0);
        const isSprig = (q: number): boolean => {
          const [x, y, z] = cellOf(m, q);
          return SPRIGS.has(g.get(x, y, z));
        };
        expect(quadsOf(m, (q) => !isSprig(q))).toEqual(quadsOf(mesh(air, { ao })));
        expect(quadsOf(m, isSprig)).toHaveLength(sprigCells * 20);
      }),
      { seed: SEED, numRuns: 200 },
    );
  });
});

describe("determinism", () => {
  it("the same grid gives the same mesh, byte for byte", () => {
    const g = new VoxelGrid(8, 4, 8);
    for (let i = 0; i < 60; i++) {
      g.set((i * 7) % 8, (i * 3) % 4, (i * 11) % 8, [STONE, GLASS, FLOWER, FLOWER_B][i % 4] ?? 0);
    }
    const a = mesh(g);
    const b = mesh(g);
    expect(a.positions).toEqual(b.positions);
    expect(a.normals).toEqual(b.normals);
    expect(a.uvs).toEqual(b.uvs);
    expect(a.colors).toEqual(b.colors);
    expect(a.indices).toEqual(b.indices);
  });

  it("the turn depends only on the column", () => {
    const turns = range(64).map((i) => sprigTurned(i % 8, Math.floor(i / 8)));
    expect(turns).toEqual(range(64).map((i) => sprigTurned(i % 8, Math.floor(i / 8))));
    // Both turns occur in a small patch, so flowers don't all face one way.
    expect(new Set(turns)).toEqual(new Set([false, true]));
  });
});
