/**
 * Chunked voxel meshes (task M2-01, PLAN.md §6.4).
 *
 * Splits a {@link VoxelGrid} into 16³ chunks and meshes each with `meshChunk`. Every chunk gets up
 * to three meshes, one per material bucket:
 * - `opaque`: shared `MeshLambertMaterial` (vertex AO colors × atlas).
 * - `transparent`: shared Lambert material with `transparent: true, depthWrite: false`. three.js
 *   sorts transparent objects back to front per chunk mesh.
 * - `glow`: faces of `light`-tagged blocks, drawn unlit (`MeshBasicMaterial`, AO kept) so lamps
 *   read as lit at every quality level, including `low` where no point light is cast.
 *
 * `meshChunk` returns one mesh holding every face; each quad is split into its bucket by the block
 * that emitted it (the cell half a unit behind the quad's center along its normal).
 *
 * `markDirty(x, y, z)` queues the chunk holding that cell, plus every neighbor chunk whose meshes
 * read it (face culling and AO look one cell across a border, diagonals included). `flush()`
 * rebuilds queued chunks; the scene calls it once per frame.
 */
import * as THREE from "three";
import type { AtlasLookup, ChunkMesh, VoxelGrid } from "./mesher/voxel-grid";
import { meshChunk } from "./mesher/voxel-grid";

export const CHUNK_SIZE = 16;

/** Which material a block's faces use. */
export type Bucket = "opaque" | "transparent" | "glow";
export const BUCKETS: readonly Bucket[] = ["opaque", "transparent", "glow"];

/** `meshChunk`'s signature, so tests can count calls. */
export type Mesher = typeof meshChunk;

export interface ChunkStoreOptions {
  grid: VoxelGrid;
  atlas: AtlasLookup;
  materials: Readonly<Record<Bucket, THREE.Material>>;
  /** Bucket of a block num. Default: `transparent` when `atlas.transparent(num)`, else `opaque`. */
  bucketOf?: (blockNum: number) => Bucket;
  ao?: boolean;
  shadows?: boolean;
  mesher?: Mesher;
  /** Called when a chunk is marked dirty, so the scene can request a frame. */
  onDirty?: () => void;
}

export interface ChunkStore {
  /** Holds every chunk mesh. Add it to the scene. */
  readonly group: THREE.Group;
  /** Grid size in chunks. */
  readonly dims: { readonly cx: number; readonly cy: number; readonly cz: number };
  /** Queues the chunk(s) that read cell (x, y, z). Out-of-grid cells are ignored. */
  markDirty(x: number, y: number, z: number): void;
  /** Queues every chunk (after an atlas or palette change). */
  markAllDirty(): void;
  /** Rebuilds queued chunks. Returns how many were rebuilt. */
  flush(): number;
  /** True while chunks are queued. */
  readonly dirty: boolean;
  /** Swaps the atlas lookup (keeps meshes until the next flush; call markAllDirty). */
  setAtlas(atlas: AtlasLookup): void;
  setShadows(on: boolean): void;
  /** Number of meshes in the group (each is one draw call when visible). */
  meshCount(): number;
  /** Disposes every geometry. Materials belong to the caller. */
  dispose(): void;
}

interface Chunk {
  meshes: Partial<Record<Bucket, THREE.Mesh>>;
}

const key = (cx: number, cy: number, cz: number): number => cx + 1024 * (cz + 1024 * cy);

export function createChunkStore(opts: ChunkStoreOptions): ChunkStore {
  const { grid, materials } = opts;
  const mesher = opts.mesher ?? meshChunk;
  const ao = opts.ao ?? true;
  let atlas = opts.atlas;
  let shadows = opts.shadows ?? false;
  const bucketOf =
    opts.bucketOf ?? ((n: number): Bucket => (atlas.transparent(n) ? "transparent" : "opaque"));

  const dims = {
    cx: Math.ceil(grid.sx / CHUNK_SIZE),
    cy: Math.ceil(grid.sy / CHUNK_SIZE),
    cz: Math.ceil(grid.sz / CHUNK_SIZE),
  };
  if (dims.cx > 1024 || dims.cz > 1024) throw new RangeError("chunks: grid too large");

  const group = new THREE.Group();
  group.name = "chunks";
  const chunks = new Map<number, Chunk>();
  const queue = new Set<number>();

  const inChunks = (cx: number, cy: number, cz: number): boolean =>
    cx >= 0 && cy >= 0 && cz >= 0 && cx < dims.cx && cy < dims.cy && cz < dims.cz;

  const enqueue = (cx: number, cy: number, cz: number): void => {
    if (inChunks(cx, cy, cz)) queue.add(key(cx, cy, cz));
  };

  const markAllDirty = (): void => {
    for (let cy = 0; cy < dims.cy; cy++) {
      for (let cz = 0; cz < dims.cz; cz++) {
        for (let cx = 0; cx < dims.cx; cx++) enqueue(cx, cy, cz);
      }
    }
    opts.onDirty?.();
  };

  /** Chunk indices along one axis whose meshes read cell `v`: its own, plus the neighbor across a border. */
  const axis = (v: number): number[] => {
    const c = Math.floor(v / CHUNK_SIZE);
    const local = v - c * CHUNK_SIZE;
    const out = [c];
    if (local === 0) out.push(c - 1);
    if (local === CHUNK_SIZE - 1) out.push(c + 1);
    return out;
  };

  const disposeChunk = (chunk: Chunk): void => {
    for (const bucket of BUCKETS) {
      const mesh = chunk.meshes[bucket];
      if (!mesh) continue;
      group.remove(mesh);
      mesh.geometry.dispose();
    }
    chunk.meshes = {};
  };

  const build = (k: number): void => {
    const cx = k % 1024;
    const cz = Math.floor(k / 1024) % 1024;
    const cy = Math.floor(k / (1024 * 1024));
    const origin = { x: cx * CHUNK_SIZE, y: cy * CHUNK_SIZE, z: cz * CHUNK_SIZE };
    const mesh = mesher(grid, origin, CHUNK_SIZE, atlas, { ao });
    const parts = splitByBucket(mesh, grid, bucketOf);

    const old = chunks.get(k);
    if (old) disposeChunk(old);
    const chunk: Chunk = old ?? { meshes: {} };
    for (const bucket of BUCKETS) {
      const part = parts[bucket];
      if (!part) continue;
      const m = new THREE.Mesh(toGeometry(part), materials[bucket]);
      m.name = `chunk ${cx},${cy},${cz} ${bucket}`;
      m.castShadow = shadows && bucket !== "transparent";
      m.receiveShadow = shadows;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      chunk.meshes[bucket] = m;
      group.add(m);
    }
    if (Object.keys(chunk.meshes).length > 0) chunks.set(k, chunk);
    else chunks.delete(k);
  };

  markAllDirty();

  return {
    group,
    dims,
    markDirty(x, y, z) {
      if (x < 0 || y < 0 || z < 0 || x >= grid.sx || y >= grid.sy || z >= grid.sz) return;
      for (const cy of axis(y)) {
        for (const cz of axis(z)) {
          for (const cx of axis(x)) enqueue(cx, cy, cz);
        }
      }
      opts.onDirty?.();
    },
    markAllDirty,
    flush() {
      const keys = [...queue];
      queue.clear();
      for (const k of keys) build(k);
      return keys.length;
    },
    get dirty() {
      return queue.size > 0;
    },
    setAtlas(next) {
      atlas = next;
    },
    setShadows(on) {
      shadows = on;
      for (const chunk of chunks.values()) {
        for (const bucket of BUCKETS) {
          const m = chunk.meshes[bucket];
          if (!m) continue;
          m.castShadow = on && bucket !== "transparent";
          m.receiveShadow = on;
        }
      }
    },
    meshCount: () => group.children.length,
    dispose() {
      for (const chunk of chunks.values()) disposeChunk(chunk);
      chunks.clear();
      queue.clear();
    },
  };
}

/** Splits a chunk mesh into per-bucket meshes by the block behind each quad. Empty buckets are absent. */
export function splitByBucket(
  mesh: ChunkMesh,
  grid: VoxelGrid,
  bucketOf: (blockNum: number) => Bucket,
): Partial<Record<Bucket, ChunkMesh>> {
  const quads = mesh.positions.length / 12;
  if (quads === 0) return {};
  const owner = new Uint8Array(quads);
  const counts = [0, 0, 0];
  const cache = new Map<number, number>();
  const { positions: p, normals: n } = mesh;
  for (let q = 0; q < quads; q++) {
    const v = q * 12;
    const cx = (p[v]! + p[v + 3]! + p[v + 6]! + p[v + 9]!) / 4 - n[v]! * 0.5;
    const cy = (p[v + 1]! + p[v + 4]! + p[v + 7]! + p[v + 10]!) / 4 - n[v + 1]! * 0.5;
    const cz = (p[v + 2]! + p[v + 5]! + p[v + 8]! + p[v + 11]!) / 4 - n[v + 2]! * 0.5;
    const id = grid.get(Math.floor(cx), Math.floor(cy), Math.floor(cz));
    let b = cache.get(id);
    if (b === undefined) {
      b = BUCKETS.indexOf(bucketOf(id));
      cache.set(id, b);
    }
    owner[q] = b;
    counts[b]!++;
  }
  // One bucket: return the mesh as is.
  for (let b = 0; b < 3; b++) {
    if (counts[b] === quads) return { [BUCKETS[b]!]: mesh };
  }
  const out: Partial<Record<Bucket, ChunkMesh>> = {};
  for (let b = 0; b < 3; b++) {
    const count = counts[b]!;
    if (count === 0) continue;
    const part: ChunkMesh = {
      positions: new Float32Array(count * 12),
      normals: new Float32Array(count * 12),
      uvs: new Float32Array(count * 8),
      colors: new Float32Array(count * 12),
      indices: new Uint32Array(count * 6),
    };
    let w = 0;
    for (let q = 0; q < quads; q++) {
      if (owner[q] !== b) continue;
      part.positions.set(mesh.positions.subarray(q * 12, q * 12 + 12), w * 12);
      part.normals.set(mesh.normals.subarray(q * 12, q * 12 + 12), w * 12);
      part.colors.set(mesh.colors.subarray(q * 12, q * 12 + 12), w * 12);
      part.uvs.set(mesh.uvs.subarray(q * 8, q * 8 + 8), w * 8);
      // Indices of quad q refer to its own 4 vertices; rebase them onto quad w.
      for (let i = 0; i < 6; i++) {
        part.indices[w * 6 + i] = mesh.indices[q * 6 + i]! - q * 4 + w * 4;
      }
      w++;
    }
    out[BUCKETS[b]!] = part;
  }
  return out;
}

function toGeometry(mesh: ChunkMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  g.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
