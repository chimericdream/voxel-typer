/**
 * Voxel grid and chunk mesher (docs/impl/contracts.md §8.2). Pure.
 *
 * Chunk size is 16. Meshing is culled-face with per-vertex ambient occlusion (the classic
 * 3-neighbor rule) and AO-aware quad flipping. Greedy meshing is optional (M6 perf).
 */
import type { Vec3 } from "../types";

/** The id of air. Air is never meshed and never occludes. */
const AIR = 0;

/** A dense 3D grid of numeric block ids. y is up. */
export class VoxelGrid {
  /** One numeric block id per cell. Index = `x + sx * (z + sz * y)`. */
  readonly data: Uint16Array;

  /** `data`, when given, is used as-is (not copied). Otherwise the grid starts as all air. */
  constructor(
    readonly sx: number,
    readonly sy: number,
    readonly sz: number,
    data?: Uint16Array,
  ) {
    this.data = data ?? new Uint16Array(sx * sy * sz);
  }

  /** The numeric block id at a cell. 0 is air. Out of bounds is 0. */
  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return AIR;
    return this.data[x + this.sx * (z + this.sz * y)] ?? AIR;
  }

  /** Sets the block id at a cell. Out of bounds is a no-op, matching `get`. */
  set(x: number, y: number, z: number, id: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return;
    this.data[x + this.sx * (z + this.sz * y)] = id;
  }

  /**
   * Run-length encoded, for saves. `rle` is flat `[id, count, id, count, …]` pairs over `data` in
   * index order; every count is ≥ 1 and the counts sum to `sx * sy * sz`.
   */
  toJSON(): { sx: number; sy: number; sz: number; rle: number[] } {
    const rle: number[] = [];
    const { data } = this;
    const n = data.length;
    let i = 0;
    while (i < n) {
      const id = data[i] ?? AIR;
      let j = i + 1;
      while (j < n && data[j] === id) j++;
      rle.push(id, j - i);
      i = j;
    }
    return { sx: this.sx, sy: this.sy, sz: this.sz, rle };
  }

  /** Decodes `toJSON` output. Throws `RangeError` on malformed input (bad sizes, ids or counts). */
  static fromJSON(j: ReturnType<VoxelGrid["toJSON"]>): VoxelGrid {
    const { sx, sy, sz, rle } = j;
    for (const s of [sx, sy, sz]) {
      if (!Number.isInteger(s) || s < 0) throw new RangeError(`VoxelGrid.fromJSON: bad size ${s}`);
    }
    if (rle.length % 2 !== 0) throw new RangeError("VoxelGrid.fromJSON: odd rle length");
    const total = sx * sy * sz;
    const data = new Uint16Array(total);
    let at = 0;
    for (let k = 0; k < rle.length; k += 2) {
      const id = rle[k] ?? -1;
      const count = rle[k + 1] ?? 0;
      if (!Number.isInteger(id) || id < 0 || id > 0xffff) {
        throw new RangeError(`VoxelGrid.fromJSON: bad id ${id}`);
      }
      if (!Number.isInteger(count) || count < 1 || at + count > total) {
        throw new RangeError(`VoxelGrid.fromJSON: bad run length ${count}`);
      }
      data.fill(id, at, at + count);
      at += count;
    }
    if (at !== total) throw new RangeError(`VoxelGrid.fromJSON: rle covers ${at} of ${total}`);
    return new VoxelGrid(sx, sy, sz, data);
  }
}

/** The geometry of one chunk, ready for a `BufferGeometry`. `colors` carries the AO brightness. */
export interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** What the mesher needs to know about the texture atlas. */
export interface AtlasLookup {
  /** The UV rectangle of a block face in the atlas. */
  uv(
    blockNum: number,
    face: "top" | "bottom" | "side",
  ): [u0: number, v0: number, u1: number, v1: number];
  transparent(blockNum: number): boolean;
}

/** AO occlusion level 0–3 (0 = open, 3 = fully occluded) → vertex brightness. */
const AO_BRIGHTNESS = [1.0, 0.8, 0.65, 0.5] as const;

type V3 = readonly [number, number, number];

/**
 * One face direction. The quad's corners are `o + cu*u + cv*v` for `(cu, cv)` in the block's unit
 * cube, and `u × v = n`, so the corners in the order (0,0) (1,0) (1,1) (0,1) wind counter-clockwise
 * seen from outside (three.js front faces). On side faces `v` is +y, so textures stand upright.
 */
interface FaceDef {
  n: V3;
  face: "top" | "bottom" | "side";
  o: V3;
  u: V3;
  v: V3;
}

const FACES: readonly FaceDef[] = [
  { n: [1, 0, 0], face: "side", o: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], face: "side", o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], face: "top", o: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], face: "bottom", o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], face: "side", o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], face: "side", o: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0] },
];

/** Quad corners in emit order: (cu, cv). */
const CORNERS: readonly (readonly [0 | 1, 0 | 1])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** Growable typed-array output for one chunk. */
class MeshBuilder {
  private cap = 0;
  quads = 0;
  positions = new Float32Array(0);
  normals = new Float32Array(0);
  uvs = new Float32Array(0);
  colors = new Float32Array(0);
  indices = new Uint32Array(0);

  constructor(initialQuads: number) {
    this.grow(Math.max(16, initialQuads));
  }

  ensure(): void {
    if (this.quads >= this.cap) this.grow(this.cap * 2);
  }

  private grow(cap: number): void {
    const copy = <T extends Float32Array | Uint32Array>(old: T, fresh: T): T => {
      fresh.set(old);
      return fresh;
    };
    this.positions = copy(this.positions, new Float32Array(cap * 12));
    this.normals = copy(this.normals, new Float32Array(cap * 12));
    this.uvs = copy(this.uvs, new Float32Array(cap * 8));
    this.colors = copy(this.colors, new Float32Array(cap * 12));
    this.indices = copy(this.indices, new Uint32Array(cap * 6));
    this.cap = cap;
  }

  finish(): ChunkMesh {
    const q = this.quads;
    return {
      positions: this.positions.slice(0, q * 12),
      normals: this.normals.slice(0, q * 12),
      uvs: this.uvs.slice(0, q * 8),
      colors: this.colors.slice(0, q * 12),
      indices: this.indices.slice(0, q * 6),
    };
  }
}

/**
 * Meshes the `size`³ chunk of `grid` that starts at `origin`. Faces at the chunk border look up
 * their neighbors in the full grid, not just in the chunk.
 *
 * - Positions are in grid coordinates (block `(x, y, z)` spans `[x, x+1]` on each axis), so every
 *   chunk mesh of one grid shares one transform.
 * - A face of an opaque block is meshed against air and against transparent blocks. A face of a
 *   transparent block is meshed against air and against a *different* transparent block only.
 *   Outside the grid is air.
 * - With `opts.ao`, each vertex counts its occluders among the 3 opaque cells beside it in the layer
 *   the face looks into (two sides and the corner; both sides ⇒ 3). Level 0–3 becomes brightness
 *   1.0/0.8/0.65/0.5 in `colors` (RGB, all three equal). Transparent blocks don't occlude. Without
 *   `opts.ao`, every vertex is 1.0.
 * - Each quad's corners are numbered ao0 = (0,0), ao1 = (1,0), ao2 = (0,1), ao3 = (1,1) in face
 *   (u, v). The quad splits along the ao1–ao2 diagonal, flipped to ao0–ao3 when
 *   `ao0 + ao3 > ao1 + ao2`, so the split always runs through the darker pair (smooth AO).
 * - UVs: corner (cu, cv) gets `(u0 + cu·(u1−u0), v0 + cv·(v1−v0))`; on sides v runs upward.
 */
export function meshChunk(
  grid: VoxelGrid,
  origin: Vec3,
  size: number,
  atlas: AtlasLookup,
  opts: { ao: boolean },
): ChunkMesh {
  const { sx, sy, sz, data } = grid;
  const x0 = Math.max(0, origin.x);
  const y0 = Math.max(0, origin.y);
  const z0 = Math.max(0, origin.z);
  const x1 = Math.min(sx, origin.x + size);
  const y1 = Math.min(sy, origin.y + size);
  const z1 = Math.min(sz, origin.z + size);

  // 0 = not asked yet, 1 = opaque, 2 = transparent. Asked once per block id per call.
  const kind = new Uint8Array(0x10000);
  const isTransparent = (id: number): boolean => {
    let k = kind[id] ?? 0;
    if (k === 0) {
      k = atlas.transparent(id) ? 2 : 1;
      kind[id] = k;
    }
    return k === 2;
  };
  const at = (x: number, y: number, z: number): number =>
    x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz
      ? AIR
      : (data[x + sx * (z + sz * y)] ?? AIR);
  const occludes = (x: number, y: number, z: number): number => {
    const id = at(x, y, z);
    return id !== AIR && !isTransparent(id) ? 1 : 0;
  };

  const out = new MeshBuilder(Math.max(0, (x1 - x0) * (z1 - z0)) * 2);
  const ao = [0, 0, 0, 0];

  for (let y = y0; y < y1; y++) {
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        const id = data[x + sx * (z + sz * y)] ?? AIR;
        if (id === AIR) continue;
        const selfTransparent = isTransparent(id);

        for (const f of FACES) {
          const lx = x + f.n[0];
          const ly = y + f.n[1];
          const lz = z + f.n[2];
          const nb = at(lx, ly, lz);
          if (nb !== AIR) {
            const nbTransparent = isTransparent(nb);
            if (!nbTransparent) continue; // nothing shows through an opaque neighbor
            if (selfTransparent && nb === id) continue; // same transparent type: merge
          }

          // Per-corner occlusion, indexed in emit order (CORNERS).
          for (let c = 0; c < 4; c++) {
            if (!opts.ao) {
              ao[c] = 0;
              continue;
            }
            const corner = CORNERS[c] ?? [0, 0];
            const du = corner[0] === 1 ? 1 : -1;
            const dv = corner[1] === 1 ? 1 : -1;
            const ux = f.u[0] * du;
            const uy = f.u[1] * du;
            const uz = f.u[2] * du;
            const vx = f.v[0] * dv;
            const vy = f.v[1] * dv;
            const vz = f.v[2] * dv;
            const s1 = occludes(lx + ux, ly + uy, lz + uz);
            const s2 = occludes(lx + vx, ly + vy, lz + vz);
            ao[c] =
              s1 === 1 && s2 === 1 ? 3 : s1 + s2 + occludes(lx + ux + vx, ly + uy + vy, lz + uz + vz);
          }

          out.ensure();
          const q = out.quads;
          const [u0, v0, u1, v1] = atlas.uv(id, f.face);
          for (let c = 0; c < 4; c++) {
            const corner = CORNERS[c] ?? [0, 0];
            const cu = corner[0];
            const cv = corner[1];
            const p = q * 12 + c * 3;
            out.positions[p] = x + f.o[0] + cu * f.u[0] + cv * f.v[0];
            out.positions[p + 1] = y + f.o[1] + cu * f.u[1] + cv * f.v[1];
            out.positions[p + 2] = z + f.o[2] + cu * f.u[2] + cv * f.v[2];
            out.normals[p] = f.n[0];
            out.normals[p + 1] = f.n[1];
            out.normals[p + 2] = f.n[2];
            const b = AO_BRIGHTNESS[ao[c] ?? 0] ?? 1;
            out.colors[p] = b;
            out.colors[p + 1] = b;
            out.colors[p + 2] = b;
            const t = q * 8 + c * 2;
            out.uvs[t] = u0 + cu * (u1 - u0);
            out.uvs[t + 1] = v0 + cv * (v1 - v0);
          }

          // Emit order is (0,0) (1,0) (1,1) (0,1) → ao0 = ao[0], ao1 = ao[1], ao3 = ao[2], ao2 = ao[3].
          const base = q * 4;
          const i = q * 6;
          const idx = out.indices;
          const flip = (ao[0] ?? 0) + (ao[2] ?? 0) > (ao[1] ?? 0) + (ao[3] ?? 0);
          idx[i] = base;
          idx[i + 1] = base + 1;
          idx[i + 4] = base + 2;
          idx[i + 5] = base + 3;
          if (flip) {
            // Diagonal (0,0)–(1,1): triangles 0-1-2 and 0-2-3.
            idx[i + 2] = base + 2;
            idx[i + 3] = base;
          } else {
            // Diagonal (1,0)–(0,1): triangles 0-1-3 and 1-2-3.
            idx[i + 2] = base + 3;
            idx[i + 3] = base + 1;
          }
          out.quads = q + 1;
        }
      }
    }
  }

  return out.finish();
}
