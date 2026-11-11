/**
 * Voxel grid and chunk mesher (docs/impl/contracts.md §8.2). Pure.
 *
 * Chunk size is 16. Meshing is culled-face with per-vertex ambient occlusion (the classic
 * 3-neighbor rule) and AO-aware quad flipping. Greedy meshing is optional (M6 perf).
 *
 * Stubs only; M1-13 implements them.
 */
import type { Vec3 } from "../types";

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
    void [x, y, z];
    throw new Error("not implemented: VoxelGrid.get");
  }

  set(x: number, y: number, z: number, id: number): void {
    void [x, y, z, id];
    throw new Error("not implemented: VoxelGrid.set");
  }

  /** Run-length encoded, for saves. */
  toJSON(): { sx: number; sy: number; sz: number; rle: number[] } {
    throw new Error("not implemented: VoxelGrid.toJSON");
  }

  static fromJSON(j: ReturnType<VoxelGrid["toJSON"]>): VoxelGrid {
    void j;
    throw new Error("not implemented: VoxelGrid.fromJSON");
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

/**
 * Meshes the `size`³ chunk of `grid` that starts at `origin`. Faces at the chunk border look up
 * their neighbors in the full grid, not just in the chunk.
 */
export function meshChunk(
  grid: VoxelGrid,
  origin: Vec3,
  size: number,
  atlas: AtlasLookup,
  opts: { ao: boolean },
): ChunkMesh {
  void [grid, origin, size, atlas, opts];
  throw new Error("not implemented: meshChunk");
}
