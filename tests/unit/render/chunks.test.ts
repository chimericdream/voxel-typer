/**
 * Chunk store (task M2-01): which chunks a voxel edit rebuilds, counted with a fake mesher, and
 * the split of a chunk mesh into material buckets.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BUCKETS, CHUNK_SIZE, createChunkStore, splitByBucket } from "../../../src/render/chunks";
import type { Bucket, Mesher } from "../../../src/render/chunks";
import { VoxelGrid, meshChunk } from "../../../src/render/mesher/voxel-grid";
import type { AtlasLookup } from "../../../src/render/mesher/voxel-grid";

const GLASS = 9;
const LAMP = 11;
const WATER = 7;

const atlas: AtlasLookup = {
  uv: () => [0, 0, 1, 1],
  transparent: (n) => n === GLASS || n === WATER,
};

const materials: Record<Bucket, THREE.Material> = {
  opaque: new THREE.MeshBasicMaterial(),
  transparent: new THREE.MeshBasicMaterial(),
  glow: new THREE.MeshBasicMaterial(),
  water: new THREE.MeshBasicMaterial(),
};

const bucketOf = (n: number): Bucket =>
  n === LAMP ? "glow" : n === GLASS ? "transparent" : n === WATER ? "water" : "opaque";

/** The real mesher, counting calls by chunk origin. */
function countingMesher(): { mesher: Mesher; calls: string[]; reset(): void } {
  const calls: string[] = [];
  return {
    calls,
    mesher: (grid, origin, size, a, opts) => {
      calls.push(`${origin.x / size},${origin.y / size},${origin.z / size}`);
      return meshChunk(grid, origin, size, a, opts);
    },
    reset() {
      calls.length = 0;
    },
  };
}

/** A 48×32×48 grid (3×2×3 chunks) with a solid floor 20 blocks thick, so every chunk has faces. */
function floorGrid(): VoxelGrid {
  const g = new VoxelGrid(48, 32, 48);
  for (let y = 0; y < 20; y++) {
    for (let z = 0; z < 48; z++) {
      for (let x = 0; x < 48; x++) g.set(x, y, z, 1);
    }
  }
  return g;
}

function setup(grid = floorGrid()) {
  const counter = countingMesher();
  let dirtyCalls = 0;
  const store = createChunkStore({
    grid,
    atlas,
    materials,
    bucketOf,
    mesher: counter.mesher,
    onDirty: () => dirtyCalls++,
  });
  return { grid, store, counter, dirtyCalls: () => dirtyCalls };
}

describe("chunk store", () => {
  it("splits the grid into 16³ chunks and meshes each once on the first flush", () => {
    const { store, counter } = setup();
    expect(CHUNK_SIZE).toBe(16);
    expect(store.dims).toEqual({ cx: 3, cy: 2, cz: 3 });
    expect(store.flush()).toBe(18);
    expect(counter.calls).toHaveLength(18);
    expect(new Set(counter.calls).size).toBe(18);
    expect(store.dirty).toBe(false);
  });

  it("an empty chunk adds no mesh", () => {
    const g = new VoxelGrid(32, 16, 16);
    g.set(3, 3, 3, 1);
    const { store } = setup(g);
    store.flush();
    expect(store.meshCount()).toBe(1);
    expect(store.group.children[0]?.name).toBe("chunk 0,0,0 opaque");
  });

  it("editing an interior voxel rebuilds only its chunk", () => {
    const { grid, store, counter, dirtyCalls } = setup();
    store.flush();
    counter.reset();
    grid.set(20, 19, 20, 0);
    store.markDirty(20, 19, 20);
    expect(dirtyCalls()).toBeGreaterThan(0);
    expect(store.flush()).toBe(1);
    expect(counter.calls).toEqual(["1,1,1"]);
  });

  it("a voxel on a chunk face rebuilds its neighbor across that face too", () => {
    const { store, counter } = setup();
    store.flush();
    counter.reset();
    store.markDirty(15, 19, 20);
    store.flush();
    expect(counter.calls.toSorted()).toEqual(["0,1,1", "1,1,1"]);
    counter.reset();
    store.markDirty(32, 19, 20);
    store.flush();
    expect(counter.calls.toSorted()).toEqual(["1,1,1", "2,1,1"]);
  });

  it("a voxel on a chunk corner rebuilds all 8 chunks around it (AO reads diagonals)", () => {
    const { store, counter } = setup();
    store.flush();
    counter.reset();
    store.markDirty(15, 15, 15);
    expect(store.flush()).toBe(8);
    expect(new Set(counter.calls)).toEqual(
      new Set(["0,0,0", "1,0,0", "0,0,1", "1,0,1", "0,1,0", "1,1,0", "0,1,1", "1,1,1"]),
    );
  });

  it("a border voxel at the grid edge doesn't queue chunks outside the grid", () => {
    const { store, counter } = setup();
    store.flush();
    counter.reset();
    store.markDirty(0, 0, 0);
    store.flush();
    expect(counter.calls).toEqual(["0,0,0"]);
  });

  it("ignores out-of-grid cells and does nothing when nothing is dirty", () => {
    const { store, counter } = setup();
    store.flush();
    counter.reset();
    store.markDirty(-1, 0, 0);
    store.markDirty(0, 32, 0);
    store.markDirty(48, 0, 0);
    expect(store.flush()).toBe(0);
    expect(counter.calls).toEqual([]);
  });

  it("several edits in one chunk before a flush rebuild it once", () => {
    const { store, counter } = setup();
    store.flush();
    counter.reset();
    store.markDirty(20, 19, 20);
    store.markDirty(21, 19, 20);
    store.markDirty(22, 18, 21);
    expect(store.flush()).toBe(1);
  });

  it("a rebuild disposes the chunk's old geometry; dispose() frees the rest", () => {
    const { grid, store } = setup();
    store.flush();
    const before = store.group.children.filter((o) => o instanceof THREE.Mesh);
    const disposed = new Set<THREE.BufferGeometry>();
    for (const m of before) m.geometry.addEventListener("dispose", () => disposed.add(m.geometry));

    grid.set(20, 19, 20, 0);
    store.markDirty(20, 19, 20);
    store.flush();
    expect(disposed.size).toBe(1);
    expect(store.meshCount()).toBe(before.length);

    store.dispose();
    expect(disposed.size).toBe(before.length);
    expect(store.meshCount()).toBe(0);
  });

  it("an edit that empties a chunk removes its meshes", () => {
    const g = new VoxelGrid(32, 16, 16);
    g.set(20, 3, 3, 1);
    const { store } = setup(g);
    store.flush();
    expect(store.meshCount()).toBe(1);
    g.set(20, 3, 3, 0);
    store.markDirty(20, 3, 3);
    store.flush();
    expect(store.meshCount()).toBe(0);
  });

  it("puts glass and lamp faces in their own meshes", () => {
    const g = new VoxelGrid(16, 16, 16);
    g.set(2, 2, 2, 1);
    g.set(6, 2, 2, GLASS);
    g.set(10, 2, 2, LAMP);
    const { store } = setup(g);
    store.flush();
    const names = store.group.children.map((o) => o.name).toSorted();
    expect(names).toEqual(["chunk 0,0,0 glow", "chunk 0,0,0 opaque", "chunk 0,0,0 transparent"]);
    for (const o of store.group.children) {
      if (!(o instanceof THREE.Mesh)) continue;
      const bucket = BUCKETS.find((b) => o.name.endsWith(b));
      expect(bucket).toBeDefined();
      if (bucket) expect(o.material).toBe(materials[bucket]);
      // One isolated block each: 6 quads, 24 vertices, 36 indices.
      expect(o.geometry.getAttribute("position").count).toBe(24);
      expect(o.geometry.getIndex()?.count).toBe(36);
    }
  });

  it("puts water faces in their own mesh, apart from glass (M2-03)", () => {
    const g = new VoxelGrid(16, 16, 16);
    g.set(2, 2, 2, GLASS);
    g.set(3, 2, 2, WATER);
    g.set(4, 2, 2, WATER);
    const { store } = setup(g);
    store.flush();
    const names = store.group.children.map((o) => o.name).toSorted();
    expect(names).toEqual(["chunk 0,0,0 transparent", "chunk 0,0,0 water"]);
    const water = store.group.children.find((o) => o.name.endsWith("water"));
    expect(water instanceof THREE.Mesh && water.material).toBe(materials.water);
  });

  it("setShadows flags opaque meshes as casters and every mesh as a receiver", () => {
    const g = new VoxelGrid(16, 16, 16);
    g.set(2, 2, 2, 1);
    g.set(6, 2, 2, GLASS);
    g.set(10, 2, 2, WATER);
    const { store } = setup(g);
    store.flush();
    store.setShadows(true);
    for (const o of store.group.children) {
      expect(o.receiveShadow).toBe(true);
      expect(o.castShadow).toBe(!o.name.endsWith("transparent") && !o.name.endsWith("water"));
    }
  });
});

const quads = (m: { positions: Float32Array } | undefined): number =>
  m ? m.positions.length / 12 : 0;

describe("splitByBucket", () => {
  it("keeps every quad, with indices rebased onto each part's own vertices", () => {
    const g = new VoxelGrid(8, 8, 8);
    for (let x = 0; x < 6; x++) g.set(x, 1, 1, x % 3 === 0 ? 1 : x % 3 === 1 ? GLASS : LAMP);
    const mesh = meshChunk(g, { x: 0, y: 0, z: 0 }, 8, atlas, { ao: true });
    const parts = splitByBucket(mesh, g, bucketOf);
    expect(quads(parts.opaque) + quads(parts.transparent) + quads(parts.glow)).toBe(quads(mesh));
    for (const part of [parts.opaque, parts.transparent, parts.glow]) {
      if (!part) continue;
      const verts = part.positions.length / 3;
      expect(part.indices.length).toBe((verts / 4) * 6);
      expect(Math.max(...part.indices)).toBe(verts - 1);
      expect(Math.min(...part.indices)).toBe(0);
    }
  });

  it("returns the mesh itself when every quad is in one bucket", () => {
    const g = new VoxelGrid(4, 4, 4);
    g.set(1, 1, 1, 1);
    const mesh = meshChunk(g, { x: 0, y: 0, z: 0 }, 4, atlas, { ao: false });
    expect(splitByBucket(mesh, g, bucketOf)).toEqual({ opaque: mesh });
  });
});

describe("sprigs (M2-FIX-4)", () => {
  const FLOWER = 310;
  const sprigAtlas: AtlasLookup = {
    ...atlas,
    shape: (n) => (n === FLOWER ? "sprig" : "cube"),
  };

  it("every sprig quad, leaf tops included, goes to the sprig's own bucket", () => {
    const g = new VoxelGrid(4, 4, 4);
    g.set(1, 0, 1, GLASS);
    g.set(1, 1, 1, FLOWER);
    g.set(2, 0, 2, WATER);
    g.set(2, 1, 2, FLOWER);
    const mesh = meshChunk(g, { x: 0, y: 0, z: 0 }, 4, sprigAtlas, { ao: true });
    // Put flowers in the glow bucket only to see where their quads land.
    const parts = splitByBucket(mesh, g, (n) => (n === FLOWER ? "glow" : bucketOf(n)));
    expect(quads(parts.glow)).toBe(2 * 20);
    expect(quads(parts.transparent)).toBe(6);
    expect(quads(parts.water)).toBe(6);
  });

  it("a meadow chunk with flowers is still one opaque mesh: no extra draw call", () => {
    const g = floorGrid();
    const store = createChunkStore({ grid: g, atlas: sprigAtlas, materials, bucketOf });
    store.flush();
    const before = store.meshCount();
    for (let i = 0; i < 40; i++) {
      g.set((i * 7) % 48, 20, (i * 13) % 48, FLOWER);
      store.markDirty((i * 7) % 48, 20, (i * 13) % 48);
    }
    store.flush();
    expect(store.meshCount()).toBe(before);
    for (const m of store.group.children) {
      expect(m).toBeInstanceOf(THREE.Mesh);
      if (m instanceof THREE.Mesh) expect(m.material).toBe(materials.opaque);
    }
    store.dispose();
  });
});
