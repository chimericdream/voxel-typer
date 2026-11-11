/**
 * Diorama worldgen (task M2-03, PLAN.md §6.4). Pure: the seed comes in as a parameter, and the
 * same (biome, seed, size) always gives the same grid.
 *
 * `generateDiorama(biome, seed, size)` builds the static backdrop world a mode shows behind its
 * action. The camera's `mine` preset sits on the +z side looking toward −z (docs/handoffs/M2-01.md),
 * so the layout is:
 *
 * ```
 *  z = 0   ┌──────────────────────────────┐  back: a hill rises, most trees stand here
 *          │   trees     (pond)    trees  │
 *          │        flowers  path  rocks  │
 *          │ fence     ┌──stage──┐        │
 *  z = sz  └───────────┴─camera──┴────────┘  front: the clear stage, flat lawn to the edge
 * ```
 *
 * Steps:
 * 1. A height field from 2-octave value noise, terraced, rising toward the back, and blended to
 *    one flat level around the stage.
 * 2. A shallow pond at the same level as the stage, ringed with sand.
 * 3. Slopes limited to one block per cell (no cliffs, no pits), keeping the stage and the pond
 *    rim exact.
 * 4. Columns filled: top block, `subDepth` sub blocks (dirt), then deep blocks (stone).
 * 5. A dirt path from behind the stage into the meadow, a fence beside the stage, then trees,
 *    flower patches and rocks at Poisson-disk points.
 *
 * The stage volume ({@link DioramaStage.clear}) is always air above a flat floor, so the Mine
 * target block floats in a clear spot with the camera's line of sight open.
 */
import { blocks as floraBlocks } from "@/content/blocks/flora";
import { blocks as oreBlocks } from "@/content/blocks/ores";
import { blocks as stoneBlocks } from "@/content/blocks/stone";
import { blocks as terrainBlocks } from "@/content/blocks/terrain";
import { blocks as woodBlocks } from "@/content/blocks/wood";
import { MEADOW_WORLDGEN } from "@/content/biomes/meadow";
import { createRng } from "@/engine/rng";
import type { Rng } from "@/engine/rng";
import { VoxelGrid } from "@/render/mesher/voxel-grid";
import type { BiomeId, BlockId } from "@/types/core";
import { fbm2, poissonDisk, terrace } from "./noise";
import { fence } from "./templates/fence";
import { flowerPatch } from "./templates/flowers";
import { rockCluster } from "./templates/rocks";
import { oakTree, TREE_MAX_HEIGHT, TREE_MAX_REACH, TREE_VARIANTS } from "./templates/trees";
import type { Template } from "./templates/types";

export interface DioramaSize {
  sx: number;
  sy: number;
  sz: number;
}

/** 4 × 2 × 4 chunks of 16³. The top chunk row only holds tree crowns and the back hill. */
export const DIORAMA_SIZE: DioramaSize = { sx: 64, sy: 24, sz: 64 };

/** The worldgen part of a biome: which blocks, and the shape knobs. Block ids, not nums. */
export interface DioramaRecipe {
  biome: BiomeId;
  blocks: {
    top: BlockId;
    sub: BlockId;
    deep: BlockId;
    shore: BlockId;
    bed: BlockId;
    water: BlockId;
    path: BlockId;
    log: BlockId;
    leaves: BlockId;
    post: BlockId;
    rail: BlockId;
    rock: BlockId;
    mossyRock: BlockId;
    flowers: readonly BlockId[];
  };
  terrain: {
    /** Top-block height of the stage floor and the pond's water level. */
    base: number;
    /** Noise swing above and below `base`, in blocks. */
    amplitude: number;
    /** Noise feature size, in blocks. */
    scale: number;
    octaves: number;
    terraceStep: number;
    /** Extra height at the back edge (z = 0), fading out by the middle. */
    backRise: number;
    /** Sub blocks under the top block. */
    subDepth: number;
  };
  pond: { rx: readonly [number, number]; rz: readonly [number, number] };
  scatter: { spacing: number; maxTrees: number; maxRocks: number; maxFlowers: number };
  fence: { length: readonly [number, number] };
}

const RECIPES: Partial<Record<BiomeId, DioramaRecipe>> = { meadow: MEADOW_WORLDGEN };

/** The recipe for a biome. Biomes without their own (yet) use the Meadow's. */
export function recipeFor(biome: BiomeId): DioramaRecipe {
  return RECIPES[biome] ?? MEADOW_WORLDGEN;
}

/** Where the Mine target goes, and the volume that is guaranteed clear. Inclusive bounds. */
export interface DioramaStage {
  /** Height of the stage floor's top block. */
  floorY: number;
  /** The cell the target block floats in (one air cell above the floor). */
  target: { x: number; y: number; z: number };
  /** Every cell in here is air, over a solid floor at `floorY`. Reaches the front edge. */
  clear: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
}

/** Half-width of the clear stage volume, in cells either side of the target. */
const STAGE_HALF_WIDTH = 5;
/** Clear cells behind the target (toward −z). */
const STAGE_BACK = 4;
/** The target sits this far in from the front edge, leaving room for the camera in front. */
const STAGE_FROM_FRONT = 14;
/** Flat ground reaches this far past the clear volume before the terrain starts to blend in. */
const STAGE_FLAT_MARGIN = 2;
/** Width of the blend from the flat stage ground to the noise terrain. */
const STAGE_BLEND = 6;

function checkSize(size: DioramaSize, recipe: DioramaRecipe): void {
  const { sx, sy, sz } = size;
  if (sx < 32 || sz < 40 || sy < recipe.terrain.base + TREE_MAX_HEIGHT + 4) {
    throw new RangeError(`diorama: size ${sx}×${sy}×${sz} too small`);
  }
}

/** The stage of a diorama. Depends on the biome and size only, never the seed. */
export function dioramaStage(biome: BiomeId, size: DioramaSize = DIORAMA_SIZE): DioramaStage {
  const recipe = recipeFor(biome);
  checkSize(size, recipe);
  const floorY = recipe.terrain.base;
  const x = Math.floor(size.sx / 2);
  const z = size.sz - STAGE_FROM_FRONT;
  return {
    floorY,
    target: { x, y: floorY + 2, z },
    clear: {
      x0: x - STAGE_HALF_WIDTH,
      x1: x + STAGE_HALF_WIDTH,
      y0: floorY + 1,
      y1: size.sy - 1,
      z0: z - STAGE_BACK,
      z1: size.sz - 1,
    },
  };
}

const BLOCK_NUMS: ReadonlyMap<BlockId, number> = new Map(
  [...terrainBlocks, ...woodBlocks, ...stoneBlocks, ...oreBlocks, ...floraBlocks].map((b) => [
    b.id,
    b.num,
  ]),
);

function num(id: BlockId): number {
  const n = BLOCK_NUMS.get(id);
  if (n === undefined) throw new Error(`diorama: unknown block "${id}"`);
  return n;
}

const smoothstep = (t: number): number => {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/** Distance from (x, z) to an axis-aligned rectangle (0 inside). */
function rectDistance(x: number, z: number, r: DioramaStage["clear"]): number {
  const dx = Math.max(0, r.x0 - x, x - r.x1);
  const dz = Math.max(0, r.z0 - z, z - r.z1);
  return Math.sqrt(dx * dx + dz * dz);
}

/** Column kinds. */
const LAND = 0;
const STAGE = 1;
const SHORE = 2;
const POND = 3;
const PATH = 4;

/**
 * In-place Manhattan distance transform, min-plus: `v[i] = min_j (v[j] + |i − j|₁)`. Two sweeps
 * are exact for the 4-neighbor metric.
 */
function minPlus(v: Float64Array, sx: number, sz: number, skip: (i: number) => boolean): void {
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const i = x + sx * z;
      if (skip(i)) continue;
      if (x > 0 && !skip(i - 1)) v[i] = Math.min(v[i]!, v[i - 1]! + 1);
      if (z > 0 && !skip(i - sx)) v[i] = Math.min(v[i]!, v[i - sx]! + 1);
    }
  }
  for (let z = sz - 1; z >= 0; z--) {
    for (let x = sx - 1; x >= 0; x--) {
      const i = x + sx * z;
      if (skip(i)) continue;
      if (x < sx - 1 && !skip(i + 1)) v[i] = Math.min(v[i]!, v[i + 1]! + 1);
      if (z < sz - 1 && !skip(i + sx)) v[i] = Math.min(v[i]!, v[i + sx]! + 1);
    }
  }
}

/** Builds the diorama grid for a biome. */
export function generateDiorama(
  biome: BiomeId,
  seed: number,
  size: DioramaSize = DIORAMA_SIZE,
): VoxelGrid {
  const recipe = recipeFor(biome);
  checkSize(size, recipe);
  const { sx, sy, sz } = size;
  const t = recipe.terrain;
  const stage = dioramaStage(biome, size);
  const rng = createRng(seed).fork(`diorama:${recipe.biome}`);
  const n = sx * sz;
  const idx = (x: number, z: number): number => x + sx * z;
  const height = new Float64Array(n);
  const kind = new Uint8Array(n);

  // 1. Terrain heights.
  const noiseSeed = rng.fork("terrain").seed;
  const flat = {
    x0: stage.clear.x0 - STAGE_FLAT_MARGIN,
    x1: stage.clear.x1 + STAGE_FLAT_MARGIN,
    z0: stage.clear.z0 - STAGE_FLAT_MARGIN,
    z1: stage.clear.z1,
    y0: 0,
    y1: 0,
  };
  const maxGround = sy - TREE_MAX_HEIGHT - 2;
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const nz = fbm2(x / t.scale, z / t.scale, noiseSeed, t.octaves);
      const rise = t.backRise * smoothstep(1 - z / (sz * 0.5));
      const raw = terrace(t.base + (nz - 0.5) * 2 * t.amplitude + rise, t.terraceStep);
      const d = rectDistance(x, z, flat);
      const w = smoothstep(d / STAGE_BLEND);
      const i = idx(x, z);
      height[i] = Math.max(2, Math.min(maxGround, Math.round(t.base + (raw - t.base) * w)));
      if (d === 0) {
        height[i] = t.base;
        kind[i] = STAGE;
      }
    }
  }

  // 2. The pond, off to one side of the back half.
  const pondRng = rng.fork("pond");
  const rx = pondRng.int(recipe.pond.rx[0], recipe.pond.rx[1]);
  const rz = pondRng.int(recipe.pond.rz[0], recipe.pond.rz[1]);
  const side = pondRng.next() < 0.5 ? -1 : 1;
  const px = stage.target.x + side * Math.floor(sx * 0.28) + pondRng.int(-2, 2);
  const pz = Math.floor(sz * 0.3) + pondRng.int(-2, 3);
  const pondD = (x: number, z: number): number => ((x - px) / rx) ** 2 + ((z - pz) / rz) ** 2;
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const i = idx(x, z);
      if (kind[i] === STAGE) continue;
      const d = pondD(x, z);
      if (d < 1) {
        kind[i] = POND;
        height[i] = t.base - (d < 0.35 ? 2 : 1);
      } else if (d < 1.6) {
        kind[i] = SHORE;
        height[i] = t.base;
      }
    }
  }

  // 3. Slopes ≤ 1 block per cell. Stage and shore heights are fixed; pond beds sit inside the
  //    shore ring and take no part. First lift dips next to fixed cells, then cut every peak down
  //    to the largest 1-Lipschitz surface under it. Fixed cells come out unchanged, because the
  //    lift already made every cell at least (fixed height − distance).
  const fixed = (i: number): boolean => kind[i] === STAGE || kind[i] === SHORE;
  const pond = (i: number): boolean => kind[i] === POND;
  const lift = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  for (let i = 0; i < n; i++) if (fixed(i)) lift[i] = -height[i]!;
  minPlus(lift, sx, sz, pond);
  for (let i = 0; i < n; i++) if (!pond(i) && !fixed(i)) height[i] = Math.max(height[i]!, -lift[i]!);
  minPlus(height, sx, sz, pond);

  // 5a. Path: from just behind the target, wandering back toward the pond.
  const pathRng = rng.fork("path");
  let fx = stage.target.x + pathRng.int(-1, 0);
  for (let z = stage.target.z - 2; z > 2; z--) {
    const pull = px - fx;
    const r = pathRng.next();
    if (r < 0.35 && Math.abs(pull) > 1) fx += Math.sign(pull);
    else if (r > 0.85) fx += pathRng.next() < 0.5 ? -1 : 1;
    fx = Math.max(2, Math.min(sx - 4, fx));
    let reached = false;
    for (const x of [fx, fx + 1]) {
      const i = idx(x, z);
      if (kind[i] === SHORE || kind[i] === POND) reached = true;
      else if (kind[i] === LAND || kind[i] === STAGE) kind[i] = PATH;
    }
    if (reached) break;
  }
  // The path's stage cells keep the stage's fixed floor; track them by kind only.

  // 4. Fill the columns.
  const g = new VoxelGrid(sx, sy, sz);
  const B = recipe.blocks;
  const top = num(B.top);
  const sub = num(B.sub);
  const deep = num(B.deep);
  const shore = num(B.shore);
  const bed = num(B.bed);
  const water = num(B.water);
  const path = num(B.path);
  const ground = (x: number, z: number): number => height[idx(x, z)] ?? 0;
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const i = idx(x, z);
      const h = ground(x, z);
      const k = kind[i];
      const surface = k === SHORE ? shore : k === POND ? bed : k === PATH ? path : top;
      for (let y = 0; y <= h; y++) {
        let id = deep;
        if (y === h) id = surface;
        else if (y >= h - t.subDepth) id = (k === SHORE || k === POND) && y === h - 1 ? shore : sub;
        g.set(x, y, z, id);
      }
      if (k === POND) for (let y = h + 1; y <= t.base; y++) g.set(x, y, z, water);
    }
  }

  // Template placement. Never into the stage's clear columns, never over a solid cell, and
  // column-following parts (flowers, rocks, fence) only on the top block.
  const inClear = (x: number, z: number): boolean =>
    x >= stage.clear.x0 && x <= stage.clear.x1 && z >= stage.clear.z0 && z <= stage.clear.z1;
  const place = (tpl: Template, ax: number, az: number): void => {
    const anchorGround = ground(ax, az);
    for (const v of tpl.voxels) {
      const x = ax + v.dx;
      const z = az + v.dz;
      if (x < 0 || z < 0 || x >= sx || z >= sz || inClear(x, z)) continue;
      const k = kind[idx(x, z)];
      let base = anchorGround;
      if (tpl.follow === "column") {
        if (k !== LAND) continue;
        base = ground(x, z);
      }
      const y = base + 1 + v.dy;
      if (y >= sy || g.get(x, y, z) !== 0) continue;
      g.set(x, y, z, v.block);
    }
  };

  // 5b. Fence: beside the stage, parallel to the camera's view, with a gap where the path crosses.
  const fenceRng = rng.fork("fence");
  const fenceLen = fenceRng.int(recipe.fence.length[0], recipe.fence.length[1]);
  const fenceX = stage.target.x + (fenceRng.next() < 0.5 ? -1 : 1) * (STAGE_HALF_WIDTH + 3);
  const fenceZ0 = stage.target.z - 2 - fenceLen;
  place(fence(fenceLen, "z", { post: num(B.post), rail: num(B.rail) }), fenceX, fenceZ0);

  // 5c. Scatter: trees, flower patches and rocks at Poisson-disk points.
  const scatterRng = rng.fork("scatter");
  const nearFence = (x: number, z: number): boolean =>
    Math.abs(x - fenceX) <= 2 && z >= fenceZ0 - 2 && z <= fenceZ0 + fenceLen + 1;
  const points = poissonDisk(sx, sz, recipe.scatter.spacing, scatterRng.fork("points"), (p) => {
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    if (x < 2 || z < 2 || x >= sx - 2 || z >= sz - 2) return false;
    const k = kind[idx(x, z)];
    if (k !== LAND) return false;
    if (rectDistance(x, z, stage.clear) < 3 || nearFence(x, z)) return false;
    return pondD(x, z) >= 2.2;
  });
  const treeOrder = scatterRng.shuffle(TREE_VARIANTS);
  const flowers = B.flowers.map(num);
  const rocks = { stone: num(B.rock), mossy: num(B.mossyRock) };
  const treeBlocks = { log: num(B.log), leaves: num(B.leaves) };
  let trees = 0;
  let patches = 0;
  let stones = 0;
  for (const p of points) {
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    const back = z < sz * 0.45;
    const edge = x < 12 || x >= sx - 12;
    const treeOk =
      trees < recipe.scatter.maxTrees &&
      x >= TREE_MAX_REACH &&
      z >= TREE_MAX_REACH &&
      x < sx - TREE_MAX_REACH &&
      z < sz - TREE_MAX_REACH &&
      rectDistance(x, z, stage.clear) > TREE_MAX_REACH + 1 &&
      !pathNear(kind, sx, sz, x, z, 1);
    const weights = [
      treeOk ? (back ? 0.55 : edge ? 0.4 : 0.1) : 0,
      patches < recipe.scatter.maxFlowers ? 0.35 : 0,
      stones < recipe.scatter.maxRocks ? 0.14 : 0,
      0.2,
    ];
    const choice = scatterRng.weightedPick([0, 1, 2, 3], weights);
    const tplRng = scatterRng.fork(`at:${x},${z}`);
    if (choice === 0) {
      const variant = treeOrder[trees % treeOrder.length] ?? "puff";
      place(oakTree(variant, treeBlocks, tplRng), x, z);
      trees++;
    } else if (choice === 1) {
      place(flowerPatch(flowers, tplRng), x, z);
      patches++;
    } else if (choice === 2) {
      place(rockCluster(rocks, tplRng), x, z);
      stones++;
    }
  }
  return g;
}

/** True if a path cell is within `r` cells (Chebyshev) of (x, z). */
function pathNear(kind: Uint8Array, sx: number, sz: number, x: number, z: number, r: number) {
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const cx = x + dx;
      const cz = z + dz;
      if (cx >= 0 && cz >= 0 && cx < sx && cz < sz && kind[cx + sx * cz] === PATH) return true;
    }
  }
  return false;
}

