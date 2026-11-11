/**
 * Mesher benchmark (task card M1-13): meshing a 64×32×64 random terrain takes < 50 ms in Node.
 *
 * The terrain is a seeded heightmap of stone, dirt and grass with water in the low spots and
 * scattered trees (log trunks, leaf crowns), so the mesher sees opaque, transparent and mixed
 * faces. The whole grid is meshed as 16³ chunks (4 × 2 × 4 = 32 calls) with AO on, the way the
 * renderer will. The bound is checked on the median of several timed runs after a warm-up.
 *
 * CI runners are shared and noisy, so on CI (`CI` set) the bound is relaxed to 200 ms: the test
 * still catches a gross regression without flaking. Numbers go to the console and the handoff.
 */
import { describe, expect, it } from "vitest";
import { meshChunk, VoxelGrid, type AtlasLookup } from "../../../src/render/mesher/voxel-grid";

const SX = 64;
const SY = 32;
const SZ = 64;
const CHUNK = 16;

const GRASS = 1;
const DIRT = 2;
const STONE = 150;
const LOG = 100;
const LEAVES = 6;
const WATER = 7;
const WATER_LEVEL = 9;
const TRANSPARENT: ReadonlySet<number> = new Set([LEAVES, WATER]);

const ATLAS: AtlasLookup = {
  uv: (blockNum, face) => {
    const u = (blockNum % 16) / 16;
    const v = face === "top" ? 0 : face === "side" ? 0.25 : 0.5;
    return [u, v, u + 1 / 16, v + 0.25];
  },
  transparent: (blockNum) => TRANSPARENT.has(blockNum),
};

/** mulberry32: a small seeded generator, local so the test needs nothing else. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function terrain(seed: number): VoxelGrid {
  const r = rng(seed);
  const g = new VoxelGrid(SX, SY, SZ);
  // A few random sine bumps make rolling hills between y = 4 and y = 20.
  const bumps = Array.from({ length: 6 }, () => ({
    fx: 0.05 + r() * 0.15,
    fz: 0.05 + r() * 0.15,
    px: r() * Math.PI * 2,
    pz: r() * Math.PI * 2,
    a: 1 + r() * 2,
  }));
  for (let z = 0; z < SZ; z++) {
    for (let x = 0; x < SX; x++) {
      let h = 12;
      for (const b of bumps) h += b.a * Math.sin(x * b.fx + b.px) * Math.cos(z * b.fz + b.pz);
      h = Math.max(4, Math.min(20, Math.round(h + (r() - 0.5) * 2)));
      for (let y = 0; y < h; y++) g.set(x, y, z, y < h - 3 ? STONE : DIRT);
      if (h > WATER_LEVEL) g.set(x, h, z, GRASS);
      for (let y = h; y <= WATER_LEVEL; y++) g.set(x, y, z, WATER);
      // Occasional trees on grass.
      if (h > WATER_LEVEL && r() < 0.02 && h + 7 < SY) {
        for (let y = h + 1; y <= h + 4; y++) g.set(x, y, z, LOG);
        for (let dy = 3; dy <= 6; dy++) {
          for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (g.get(x + dx, h + dy, z + dz) === 0) g.set(x + dx, h + dy, z + dz, LEAVES);
            }
          }
        }
      }
    }
  }
  return g;
}

function meshAll(g: VoxelGrid): number {
  let quads = 0;
  for (let y = 0; y < g.sy; y += CHUNK) {
    for (let z = 0; z < g.sz; z += CHUNK) {
      for (let x = 0; x < g.sx; x += CHUNK) {
        quads += meshChunk(g, { x, y, z }, CHUNK, ATLAS, { ao: true }).indices.length / 6;
      }
    }
  }
  return quads;
}

// CI runners are noisy, and coverage instrumentation slows the mesher down; both get the relaxed bound.
const ON_CI = Boolean(process.env.CI) || process.env.VT_COVERAGE === "1";
const BOUND_MS = ON_CI ? 200 : 50;

describe("mesher benchmark", () => {
  it(`meshes a ${SX}×${SY}×${SZ} random terrain in < ${BOUND_MS} ms (median of 7)`, () => {
    const g = terrain(1313);
    const quads = meshAll(g); // warm-up (JIT)
    meshAll(g);
    expect(quads).toBeGreaterThan(SX * SZ); // at least a surface's worth of faces
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      meshAll(g);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[3] ?? Number.POSITIVE_INFINITY;
    console.info(
      `[M1-13] mesh ${SX}×${SY}×${SZ} (${quads} quads, 32 chunks, AO on): ` +
        `median ${median.toFixed(1)} ms, min ${(times[0] ?? 0).toFixed(1)} ms, ` +
        `max ${(times[6] ?? 0).toFixed(1)} ms${ON_CI ? " (CI bound)" : ""}`,
    );
    expect(median).toBeLessThan(BOUND_MS);
  });
});
