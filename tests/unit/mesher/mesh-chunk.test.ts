/**
 * Chunk mesher tests (docs/impl/contracts.md §8.2, task card M1-13).
 *
 * Corner conventions under test are the ones documented on `meshChunk`:
 * - A quad's corners are emitted in the order (cu, cv) = (0,0), (1,0), (1,1), (0,1) in face
 *   (u, v) space, counter-clockwise seen from outside.
 * - AO corners are numbered ao0 = (0,0), ao1 = (1,0), ao2 = (0,1), ao3 = (1,1), so in emit
 *   order: emit0 = ao0, emit1 = ao1, emit2 = ao3, emit3 = ao2.
 * - The quad splits along the ao1–ao2 diagonal, flipped to the ao0–ao3 diagonal when
 *   `ao0 + ao3 > ao1 + ao2`.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  meshChunk,
  VoxelGrid,
  type AtlasLookup,
  type ChunkMesh,
} from "../../../src/render/mesher/voxel-grid";

type Triplet = readonly [number, number, number];

const SEED = 474711;

/** Block ids used below; 5–7 are the transparent ones (glass, leaves, water). */
const GRASS = 1;
const DIRT = 2;
const STONE = 150;
const GLASS = 5;
const LEAVES = 6;
const WATER = 7;
const TRANSPARENT_IDS: ReadonlySet<number> = new Set([GLASS, LEAVES, WATER]);

/** Test atlas: a distinct UV rect per (block, face) so UV assertions pin the face mapping. */
const ATLAS: AtlasLookup = {
  uv(blockNum, face) {
    const u = blockNum / 1000;
    const v = face === "top" ? 0.5 : face === "bottom" ? 0.25 : 0;
    return [u, v, u + 0.01, v + 0.01];
  },
  transparent(blockNum) {
    return TRANSPARENT_IDS.has(blockNum);
  },
};

/** AO level → brightness, pinned by the card: {0,1,2,3} → {1.0, 0.8, 0.65, 0.5}. */
const BRIGHTNESS: readonly number[] = [1.0, 0.8, 0.65, 0.5];

/** Default indices of a quad, relative to its own 4 vertices. */
const IDX_DEFAULT: readonly number[] = [0, 1, 3, 1, 2, 3];
/** Flipped indices (ao0–ao3 diagonal). */
const IDX_FLIPPED: readonly number[] = [0, 1, 2, 0, 2, 3];

const mesh = (
  g: VoxelGrid,
  opts: { ao?: boolean; origin?: Triplet; size?: number; atlas?: AtlasLookup } = {},
): ChunkMesh => {
  const [x, y, z] = opts.origin ?? [0, 0, 0];
  return meshChunk(g, { x, y, z }, opts.size ?? 16, opts.atlas ?? ATLAS, {
    ao: opts.ao ?? true,
  });
};

const quadCount = (m: ChunkMesh): number => m.indices.length / 6;

const atF = (a: Float32Array, i: number): number => a[i] ?? Number.NaN;
const atU = (a: Uint32Array, i: number): number => a[i] ?? Number.NaN;

const normalAt = (m: ChunkMesh, q: number): Triplet => [
  atF(m.normals, q * 12),
  atF(m.normals, q * 12 + 1),
  atF(m.normals, q * 12 + 2),
];

const cornerAt = (m: ChunkMesh, q: number, c: number): Triplet => [
  atF(m.positions, q * 12 + c * 3),
  atF(m.positions, q * 12 + c * 3 + 1),
  atF(m.positions, q * 12 + c * 3 + 2),
];

const vertexAt = (m: ChunkMesh, i: number): Triplet => [
  atF(m.positions, i * 3),
  atF(m.positions, i * 3 + 1),
  atF(m.positions, i * 3 + 2),
];

/** The quad's 6 indices, relative to its own 4 vertices. */
const localIndices = (m: ChunkMesh, q: number): number[] =>
  Array.from({ length: 6 }, (_, i) => atU(m.indices, q * 6 + i) - q * 4);

/**
 * The 4 vertex brightnesses (r channel) in emit order, rounded to 4 places so Float32 storage
 * (0.8 is stored as 0.800000011920929) compares equal to the card's decimal values.
 */
const brightnessOf = (m: ChunkMesh, q: number): number[] =>
  Array.from({ length: 4 }, (_, c) => Math.round(atF(m.colors, q * 12 + c * 3) * 1e4) / 1e4);

const quadsWithNormal = (m: ChunkMesh, n: Triplet): number[] => {
  const out: number[] = [];
  for (let q = 0; q < quadCount(m); q++) {
    const qn = normalAt(m, q);
    if (qn[0] === n[0] && qn[1] === n[1] && qn[2] === n[2]) out.push(q);
  }
  return out;
};

const sub = (a: Triplet, b: Triplet): Triplet => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Triplet, b: Triplet): Triplet => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Triplet, b: Triplet): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Every triangle winds counter-clockwise seen from outside (three.js front faces). */
function expectOutwardWinding(m: ChunkMesh): void {
  for (let q = 0; q < quadCount(m); q++) {
    const n = normalAt(m, q);
    for (const t of [0, 1] as const) {
      const p0 = vertexAt(m, atU(m.indices, q * 6 + t * 3));
      const p1 = vertexAt(m, atU(m.indices, q * 6 + t * 3 + 1));
      const p2 = vertexAt(m, atU(m.indices, q * 6 + t * 3 + 2));
      const c = cross(sub(p1, p0), sub(p2, p0));
      expect(dot(c, n), `quad ${q} triangle ${t} winds outward`).toBeGreaterThan(0);
    }
  }
}

/** Contract §8.2 shapes: typed arrays, one quad = 4 vertices = 6 indices, indices stay in-quad. */
function expectConsistentBuffers(m: ChunkMesh): void {
  expect(m.positions).toBeInstanceOf(Float32Array);
  expect(m.normals).toBeInstanceOf(Float32Array);
  expect(m.uvs).toBeInstanceOf(Float32Array);
  expect(m.colors).toBeInstanceOf(Float32Array);
  expect(m.indices).toBeInstanceOf(Uint32Array);
  const q = quadCount(m);
  expect(m.positions).toHaveLength(q * 12);
  expect(m.normals).toHaveLength(q * 12);
  expect(m.colors).toHaveLength(q * 12);
  expect(m.uvs).toHaveLength(q * 8);
  expect(m.indices).toHaveLength(q * 6);
  for (let i = 0; i < m.indices.length; i++) {
    const own = Math.floor(i / 6);
    const v = atU(m.indices, i);
    expect(v, `index ${i} points into its own quad`).toBeGreaterThanOrEqual(own * 4);
    expect(v, `index ${i} points into its own quad`).toBeLessThan(own * 4 + 4);
  }
}

/** Every stored brightness is one of the four AO levels, as gray (r = g = b). */
function expectValidAoColors(m: ChunkMesh): void {
  for (let i = 0; i < m.colors.length; i += 3) {
    const r = atF(m.colors, i);
    expect(atF(m.colors, i + 1)).toBeCloseTo(r, 6);
    expect(atF(m.colors, i + 2)).toBeCloseTo(r, 6);
    const level = BRIGHTNESS.findIndex((v) => Math.abs(v - r) < 1e-6);
    expect(level, `brightness ${r} is one of ${BRIGHTNESS.join(", ")}`).toBeGreaterThanOrEqual(0);
  }
}

/**
 * An independent, deliberately naive face counter (the card's visibility rule, restated):
 * a non-air cell shows a face toward a neighbor cell when the neighbor is air, or when the
 * neighbor is transparent and not the same transparent id as the cell itself. Out of bounds
 * is air (`VoxelGrid.get` already does that).
 */
const DIRS: readonly Triplet[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function referenceQuads(g: VoxelGrid): number {
  let n = 0;
  for (let y = 0; y < g.sy; y++) {
    for (let z = 0; z < g.sz; z++) {
      for (let x = 0; x < g.sx; x++) {
        const id = g.get(x, y, z);
        if (id === 0) continue;
        for (const [dx, dy, dz] of DIRS) {
          const nb = g.get(x + dx, y + dy, z + dz);
          if (nb === 0) {
            n++;
          } else if (TRANSPARENT_IDS.has(nb) && !(TRANSPARENT_IDS.has(id) && nb === id)) {
            n++;
          }
        }
      }
    }
  }
  return n;
}

/** Two blocks side by side along x, meshed without AO. */
const pair = (a: number, b: number): ChunkMesh => {
  const g = new VoxelGrid(4, 3, 3);
  g.set(1, 1, 1, a);
  g.set(2, 1, 1, b);
  return mesh(g, { ao: false });
};

/** Top face of a stone floor block with `wallId` in the cell beside its emit0/emit1 corners. */
const buildWall = (wallId: number): ChunkMesh => {
  const g = new VoxelGrid(4, 3, 4);
  g.set(1, 0, 1, STONE);
  g.set(1, 1, 2, wallId); // the cell beside the top face's emit0/emit1 corners
  return mesh(g, { origin: [1, 0, 1], size: 1 });
};
const topOf = (m: ChunkMesh): number => quadsWithNormal(m, [0, 1, 0])[0] ?? 0;

/**
 * All AO fixtures mesh the floor block A = (1,0,1) of a 4×3×4 grid as a 1×1×1 chunk, so its
 * top face is the only quad with normal (0,1,0). Occluders go into the y=1 layer the face
 * looks into; the nine cells of that layer, seen from above (x right, z down):
 *
 *           x=0      x=1      x=2
 *   z=0   (0,1,0)  (1,1,0)  (2,1,0)
 *   z=1   (0,1,1)  (1,1,1)* (2,1,1)      * the air cell above A, the face's neighbor
 *   z=2   (0,1,2)  (1,1,2)  (2,1,2)
 *
 * The top face uses u = +x and v = −z, so its corners (world positions, y = 1) are
 *   emit0 = (0,0) at (x1, z2), emit1 = (1,0) at (x2, z2),
 *   emit2 = (1,1) at (x2, z1), emit3 = (0,1) at (x1, z1),
 * and in the card's numbering ao0 = emit0, ao1 = emit1, ao2 = emit3, ao3 = emit2.
 *
 * Per the classic 3-neighbor rule, each vertex counts the opaque cells among the three
 * layer cells that touch it (two sides and the corner; two sides ⇒ 3 regardless of the
 * corner). For example emit1 (x2, z2) touches (2,1,1), (1,1,2) and corner (2,1,2).
 */
const buildTop = (occluders: readonly (readonly [number, Triplet])[]): ChunkMesh => {
  const g = new VoxelGrid(4, 3, 4);
  g.set(1, 0, 1, STONE);
  for (const [id, [x, y, z]] of occluders) g.set(x, y, z, id);
  return mesh(g, { origin: [1, 0, 1], size: 1 });
};
const topQuad = (m: ChunkMesh): number => {
  const found = quadsWithNormal(m, [0, 1, 0]);
  expect(found).toHaveLength(1);
  return found[0] ?? 0;
};
const d = (x: number, z: number): readonly [number, Triplet] => [DIRT, [x, 1, z]];

describe("face culling (card acceptance)", () => {
  it("a single block meshes 6 quads: 24 vertices, 36 indices", () => {
    const g = new VoxelGrid(3, 3, 3);
    g.set(1, 1, 1, STONE);
    const m = mesh(g, { ao: false });
    expect(quadCount(m)).toBe(6);
    expect(m.positions).toHaveLength(24 * 3);
    expect(m.indices).toHaveLength(36);
    expectConsistentBuffers(m);
    expectOutwardWinding(m);

    // Block (1,1,1) spans [1,2]³, so every face is one unit plane of that cube.
    const expected: { n: Triplet; axis: 0 | 1 | 2; plane: number }[] = [
      { n: [1, 0, 0], axis: 0, plane: 2 },
      { n: [-1, 0, 0], axis: 0, plane: 1 },
      { n: [0, 1, 0], axis: 1, plane: 2 },
      { n: [0, -1, 0], axis: 1, plane: 1 },
      { n: [0, 0, 1], axis: 2, plane: 2 },
      { n: [0, 0, -1], axis: 2, plane: 1 },
    ];
    for (const { n, axis, plane } of expected) {
      const found = quadsWithNormal(m, n);
      expect(found, `one quad with normal ${n.join(",")}`).toHaveLength(1);
      const q = found[0] ?? 0;
      const corners = Array.from({ length: 4 }, (_, c) => cornerAt(m, q, c));
      const inPlane = new Set<string>();
      for (const p of corners) {
        expect(p[axis], "face lies in its plane").toBe(plane);
        inPlane.add(`${p[(axis + 1) % 3]},${p[(axis + 2) % 3]}`);
      }
      // The 4 corners are the 4 distinct corners of the unit square [1,2]² in that plane.
      expect([...inPlane].toSorted()).toEqual(["1,1", "1,2", "2,1", "2,2"]);
      // Corners come out in emit order (0,0), (1,0), (1,1), (0,1): distinct, in-quad indices.
      expect(localIndices(m, q)).toEqual([...IDX_DEFAULT]);
    }
  });

  it("maps each face to its atlas rect, corners (u0,v0), (u1,v0), (u1,v1), (u0,v1)", () => {
    const g = new VoxelGrid(3, 3, 3);
    g.set(1, 1, 1, GRASS);
    const m = mesh(g, { ao: false });
    for (let q = 0; q < quadCount(m); q++) {
      const n = normalAt(m, q);
      const face = n[1] === 1 ? "top" : n[1] === -1 ? "bottom" : "side";
      const [u0, v0, u1, v1] = ATLAS.uv(GRASS, face);
      const expected: (readonly [number, number])[] = [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ];
      expected.forEach(([eu, ev], c) => {
        expect(atF(m.uvs, q * 8 + c * 2), `quad ${q} corner ${c} u`).toBeCloseTo(eu, 6);
        expect(atF(m.uvs, q * 8 + c * 2 + 1), `quad ${q} corner ${c} v`).toBeCloseTo(ev, 6);
      });
    }
  });

  it("two adjacent blocks mesh 10 quads (the shared face is culled)", () => {
    const g = new VoxelGrid(4, 3, 3);
    g.set(1, 1, 1, STONE);
    g.set(2, 1, 1, DIRT);
    const m = mesh(g, { ao: false });
    expect(quadCount(m)).toBe(10);
    // Both blocks are opaque, so the shared plane x=2 carries no quad at all.
    const onShared = [...quadsWithNormal(m, [1, 0, 0]), ...quadsWithNormal(m, [-1, 0, 0])].filter(
      (q) => cornerAt(m, q, 0)[0] === 2,
    );
    expect(onShared).toHaveLength(0);
    expectConsistentBuffers(m);
    expectOutwardWinding(m);
  });

  it("a fully enclosed block contributes 0 quads", () => {
    const g = new VoxelGrid(3, 3, 3, new Uint16Array(27).fill(STONE));
    // The full cube shows only its shell: 6 sides × 3×3 = 54 quads; the middle adds none.
    const whole = mesh(g, { ao: false });
    expect(quadCount(whole)).toBe(54);
    // Meshing a 1×1×1 chunk around the middle cell finds 0 faces: its neighbors live outside
    // the chunk and are looked up in the full grid.
    const middle = mesh(g, { origin: [1, 1, 1], size: 1, ao: false });
    expect(quadCount(middle)).toBe(0);
    expect(middle.positions).toHaveLength(0);
    expect(middle.indices).toHaveLength(0);
  });
});

describe("chunk borders", () => {
  it("culls against the next chunk through the full grid, positions stay grid-absolute", () => {
    const g = new VoxelGrid(32, 3, 3);
    g.set(15, 1, 1, STONE);
    g.set(16, 1, 1, STONE);
    const a = mesh(g, { origin: [0, 0, 0], ao: false });
    const b = mesh(g, { origin: [16, 0, 0], ao: false });
    // Same as two adjacent blocks in one chunk: 5 + 5.
    expect(quadCount(a)).toBe(5);
    expect(quadCount(b)).toBe(5);
    // Grid-absolute positions: chunk b's vertices live at x ∈ [16, 17].
    let minX = Number.POSITIVE_INFINITY;
    for (let i = 0; i < b.positions.length; i += 3) minX = Math.min(minX, atF(b.positions, i));
    expect(minX).toBe(16);
    expectOutwardWinding(a);
    expectOutwardWinding(b);
  });

  it("a chunk outside the grid is empty", () => {
    const g = new VoxelGrid(4, 4, 4);
    g.set(1, 1, 1, STONE);
    expect(quadCount(mesh(g, { origin: [16, 0, 0] }))).toBe(0);
    expect(quadCount(mesh(g, { origin: [0, 16, 0] }))).toBe(0);
  });
});

describe("transparent blocks (glass, leaves, water)", () => {
  it("same transparent type merges: glass–glass and leaves–leaves mesh 10 quads", () => {
    expect(quadCount(pair(GLASS, GLASS))).toBe(10);
    expect(quadCount(pair(LEAVES, LEAVES))).toBe(10);
  });

  it("different transparent types mesh both faces: glass–water gives 12 quads", () => {
    const m = pair(GLASS, WATER);
    expect(quadCount(m)).toBe(12);
    // Both sides of the shared plane x=2 are meshed (glass' +x and water's -x).
    const atPlane = [0, 1].flatMap((s) =>
      quadsWithNormal(m, s === 0 ? [1, 0, 0] : [-1, 0, 0]).filter((q) =>
        Array.from({ length: 4 }, (_, c) => cornerAt(m, q, c)[0]).every((x) => x === 2),
      ),
    );
    expect(atPlane).toHaveLength(2);
  });

  it("opaque–transparent meshes only the opaque face: 11 quads either way", () => {
    for (const [a, b] of [
      [STONE, GLASS],
      [GLASS, STONE],
    ] as const) {
      const m = pair(a, b);
      expect(quadCount(m)).toBe(11);
    }
    // Which face is missing: the glass block culls its face toward the opaque block.
    const m = pair(STONE, GLASS); // stone at x=1, glass at x=2
    // +x quads: stone's (plane x=2) and glass' (plane x=3) → 2; -x quads: only stone's → 1.
    expect(quadsWithNormal(m, [1, 0, 0])).toHaveLength(2);
    expect(quadsWithNormal(m, [-1, 0, 0])).toHaveLength(1);
  });

  it("transparent blocks do not occlude AO", () => {
    // Opaque wall: emit0 and emit1 each count one side → ao 1 → 0.8.
    expect(brightnessOf(buildWall(DIRT), topOf(buildWall(DIRT)))).toEqual([0.8, 0.8, 1.0, 1.0]);
    // Glass wall in the same cell: no occlusion at all.
    const glass = buildWall(GLASS);
    expect(brightnessOf(glass, topOf(glass))).toEqual([1.0, 1.0, 1.0, 1.0]);
  });
});

describe("ambient occlusion", () => {
  interface AoCase {
    name: string;
    occluders: readonly (readonly [number, Triplet])[];
    /** AO level per emit corner, hand-computed from the diagram above. */
    ao: readonly [number, number, number, number];
    flipped: boolean;
  }

  const CASES: readonly AoCase[] = [
    { name: "open face", occluders: [], ao: [0, 0, 0, 0], flipped: false },
    {
      // emit0's corner cell only → ao0 = 1; ao0 + ao3 = 1 > ao1 + ao2 = 0 → flip.
      name: "one corner cell",
      occluders: [d(0, 2)],
      ao: [1, 0, 0, 0],
      flipped: true,
    },
    {
      // emit1: side (2,1,1) + corner (2,1,2) = 2; emit2: side (2,1,1) = 1.
      // ao0 + ao3 = 0 + 1 vs ao1 + ao2 = 2 + 0 → keep.
      name: "side plus corner = 2",
      occluders: [d(2, 1), d(2, 2)],
      ao: [0, 2, 1, 0],
      flipped: false,
    },
    {
      // emit1 touches both (2,1,1) and (1,1,2) as sides → 3 (the corner cell no longer matters);
      // emit0 and emit2 each count one of them as a side → 1. 1 + 1 vs 3 + 0 → keep.
      name: "two sides = 3",
      occluders: [d(2, 1), d(1, 2)],
      ao: [1, 3, 1, 0],
      flipped: false,
    },
    {
      // The card's L-shape: wall B behind the face, step C beside it, corner D behind C.
      // Same values as "two sides = 3": D touches only emit1, which is already at 3.
      name: "L-shape (card fixture)",
      occluders: [d(1, 2), d(2, 1), d(2, 2)],
      ao: [1, 3, 1, 0],
      flipped: false,
    },
    {
      // Both cells on the ao0–ao3 diagonal: ao0 = ao3 = 1 → 1 + 1 > 0 + 0 → flip.
      name: "ao0–ao3 diagonal flips",
      occluders: [d(0, 2), d(2, 0)],
      ao: [1, 0, 1, 0],
      flipped: true,
    },
    {
      // Both cells on the ao1–ao2 diagonal: 0 + 0 > 1 + 1 is false → keep.
      name: "ao1–ao2 diagonal keeps",
      occluders: [d(2, 2), d(0, 0)],
      ao: [0, 1, 0, 1],
      flipped: false,
    },
    {
      // Every corner at 1: 1 + 1 > 1 + 1 is false (strict) → keep.
      name: "tie keeps the default diagonal",
      occluders: [d(0, 2), d(2, 0), d(2, 2), d(0, 0)],
      ao: [1, 1, 1, 1],
      flipped: false,
    },
  ];

  it.each(CASES)("$name: brightness {0,1,2,3} → {1.0, 0.8, 0.65, 0.5}, flip = $flipped", (c) => {
    const m = buildTop(c.occluders);
    const q = topQuad(m);
    const expected = c.ao.map((level) => BRIGHTNESS[level] ?? Number.NaN);
    brightnessOf(m, q).forEach((b, i) => {
      expect(b, `emit${i} brightness`).toBeCloseTo(expected[i] ?? Number.NaN, 6);
    });
    expect(localIndices(m, q)).toEqual([...(c.flipped ? IDX_FLIPPED : IDX_DEFAULT)]);
    // Flipping changes the diagonal only: both triangulations still face outward.
    expectOutwardWinding(m);
    expectValidAoColors(m);
  });

  it("L-shape corner values, spelled out against the card fixture", () => {
    // Hand-computed (see the diagram above): with B (1,1,2), C (2,1,1), D (2,1,2) —
    //   emit0 (x1,z2) touches (0,1,1)·, (1,1,2)=B side, (0,1,2)· corner → ao 1 → 0.8
    //   emit1 (x2,z2) touches (2,1,1)=C side, (1,1,2)=B side             → ao 3 → 0.5
    //   emit2 (x2,z1) touches (2,1,1)=C side, (1,1,0)·, (2,1,0)·         → ao 1 → 0.8
    //   emit3 (x1,z1) touches (0,1,1)·, (1,1,0)·, (0,1,0)·               → ao 0 → 1.0
    const m = buildTop([d(1, 2), d(2, 1), d(2, 2)]);
    const q = topQuad(m);
    expect(brightnessOf(m, q)).toEqual([0.8, 0.5, 0.8, 1.0]);
    // ao0 + ao3 = 1 + 1 = 2, ao1 + ao2 = 3 + 0 = 3 → no flip.
    expect(localIndices(m, q)).toEqual([...IDX_DEFAULT]);
  });

  it("opts.ao = false keeps every vertex at full brightness", () => {
    const g = new VoxelGrid(4, 3, 4);
    g.set(1, 0, 1, STONE);
    for (const [x, z] of [
      [1, 2],
      [2, 1],
      [2, 2],
    ] as const) {
      g.set(x, 1, z, DIRT);
    }
    const m = mesh(g, { origin: [1, 0, 1], size: 1, ao: false });
    expect(Array.from(m.colors).every((v) => v === 1)).toBe(true);
    const q = topQuad(m);
    expect(localIndices(m, q)).toEqual([...IDX_DEFAULT]);
  });

  it("AO reads across the chunk border: the L walls may sit outside the meshed chunk", () => {
    // Same L as the card fixture, but only A's cell is inside the chunk (it is by construction
    // above); this asserts the values equal the full-grid mesh, i.e. neighbors came from the grid.
    const g = new VoxelGrid(4, 3, 4);
    g.set(1, 0, 1, STONE);
    g.set(1, 1, 2, DIRT);
    g.set(2, 1, 1, DIRT);
    g.set(2, 1, 2, DIRT);
    const whole = mesh(g);
    const wholeTop = quadsWithNormal(whole, [0, 1, 0]).filter((q) =>
      Array.from({ length: 4 }, (_, c) => cornerAt(whole, q, c)[1]).every((y) => y === 1),
    );
    expect(wholeTop).toHaveLength(1);
    const chunked = buildTop([d(1, 2), d(2, 1), d(2, 2)]);
    expect(brightnessOf(chunked, topQuad(chunked))).toEqual(brightnessOf(whole, wholeTop[0] ?? 0));
  });
});

describe("mesh output contract", () => {
  it("is deterministic for the same grid", () => {
    const g = new VoxelGrid(5, 4, 5);
    for (let i = 0; i < 40; i++) {
      g.set((i * 7) % 5, (i * 3) % 4, (i * 11) % 5, 1 + (i % 7));
    }
    const a = mesh(g);
    const b = mesh(g);
    expect(a.positions).toEqual(b.positions);
    expect(a.normals).toEqual(b.normals);
    expect(a.uvs).toEqual(b.uvs);
    expect(a.colors).toEqual(b.colors);
    expect(a.indices).toEqual(b.indices);
    expectConsistentBuffers(a);
    expectOutwardWinding(a);
    expectValidAoColors(a);
  });
});

describe("property: mesh matches an independent face counter", () => {
  it("quad counts, chunk splits, buffer shapes and AO values agree on random grids", () => {
    const gridArb = fc
      .record({
        sx: fc.integer({ min: 0, max: 5 }),
        sy: fc.integer({ min: 0, max: 4 }),
        sz: fc.integer({ min: 0, max: 5 }),
      })
      .chain(({ sx, sy, sz }) =>
        fc
          .array(fc.integer({ min: 0, max: 7 }), {
            minLength: sx * sy * sz,
            maxLength: sx * sy * sz,
          })
          .map((cells) => new VoxelGrid(sx, sy, sz, Uint16Array.from(cells))),
      );
    fc.assert(
      fc.property(gridArb, (g) => {
        const expected = referenceQuads(g);
        const whole = mesh(g);
        expect(quadCount(whole)).toBe(expected);
        expectConsistentBuffers(whole);
        expectValidAoColors(whole);
        expectOutwardWinding(whole);

        // Splitting into size-2 chunks changes nothing: border faces see the full grid.
        let split = 0;
        for (let y = 0; y < Math.max(g.sy, 1); y += 2) {
          for (let z = 0; z < Math.max(g.sz, 1); z += 2) {
            for (let x = 0; x < Math.max(g.sx, 1); x += 2) {
              split += quadCount(mesh(g, { origin: [x, y, z], size: 2 }));
            }
          }
        }
        expect(split).toBe(expected);
      }),
      { seed: SEED, numRuns: 200 },
    );
  });
});
