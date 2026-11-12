/**
 * Night Defense's arena (task M4-04, PLAN.md §3.2.2). Pure: the seed comes in as a parameter, and
 * the same (biome, seed, lanes) always gives the same grid.
 *
 * The camera's `lane` preset sits on the +z side and looks toward −z, so the layout is:
 *
 * ```
 *  z = 0    ┌──────────────────────────────┐  back: a hill the visitors come over, trees
 *           │  trees   ║   ║   ║   trees   │
 *  farZ     │          ║   ║   ║           │  lanes start here
 *           │  flowers ║   ║   ║   rocks   │
 *  waitZ    │ ░░░░░░░░░╬░░░╬░░░╬░░░░░░░░░  │  the waiting line (calm mode): a row of flowers
 *  baseZ    │ tent ▪──▪───▪──▪───▪──▪ fire │  the camp's fence: a lantern post beside every lane
 *           │                              │  open lawn
 *  z = sz   └──────────────────────────────┘  front, toward the camera
 * ```
 *
 * Everything between the lanes' far end and the fence is flat, so a mob walks a straight line at
 * one height. The lanes are paths of the biome's path block. The lantern blocks are `light`
 * blocks: the scene turns the nearest ones into point lights, capped by the quality level.
 */
import { blocks as floraBlocks } from "@/content/blocks/flora";
import { blocks as oreBlocks } from "@/content/blocks/ores";
import { blocks as stoneBlocks } from "@/content/blocks/stone";
import { blocks as terrainBlocks } from "@/content/blocks/terrain";
import { blocks as woodBlocks } from "@/content/blocks/wood";
import { createRng } from "@/engine/rng";
import { VoxelGrid } from "@/render/mesher/voxel-grid";
import type { BiomeId, BlockId } from "@/types/core";
import { recipeFor } from "./diorama";
import { fbm2 } from "./noise";
import { flowerPatch } from "./templates/flowers";
import { rockCluster } from "./templates/rocks";
import { oakTree, TREE_VARIANTS } from "./templates/trees";
import type { Template } from "./templates/types";

/** 3 × 2 × 3 chunks of 16³. */
export const ARENA_SIZE = { sx: 48, sy: 24, sz: 48 } as const;

/** The most lanes an arena has (Builder at high difficulty). */
export const ARENA_MAX_LANES = 5;
/** Blocks between the middles of two neighbouring lanes. */
export const LANE_SPACING = 5;
/** A lane's path is this many blocks wide. */
export const LANE_WIDTH = 3;

const FLOOR_Y = 4;
const FAR_Z = 9;
const BASE_Z = 33;
/** The waiting line, as a share of the way from the far end to the base (the sim's 85 %). */
export const WAIT_SHARE = 0.85;
/** The back hill's extra height at z = 0. */
const HILL_RISE = 5;

/** Where things are in an arena. World units: a block is 1, and y is up. */
export interface ArenaLayout {
  /** How many lanes the arena has, 1 to {@link ARENA_MAX_LANES}. */
  lanes: number;
  /** World y of the ground the mobs walk on (the top face of the floor blocks). */
  groundY: number;
  /** World x of the middle of each lane, left to right. */
  laneX: readonly number[];
  /** World z where a mob appears. */
  farZ: number;
  /** World z of the shield, just in front of the camp's fence. A mob that gets here bonks it. */
  baseZ: number;
  /** World z of the waiting line (calm mode). */
  waitZ: number;
  /** The middle of the field, for the camera. */
  center: { x: number; y: number; z: number };
  /** The field's width in blocks, lanes and their verges together. */
  width: number;
  /** A point just behind the fence's middle: where the shield's bonks and regrowth show. */
  camp: { x: number; y: number; z: number };
}

const clampLanes = (lanes: number): number =>
  Math.min(ARENA_MAX_LANES, Math.max(1, Math.floor(Number.isFinite(lanes) ? lanes : 1)));

/** The layout of an arena with `lanes` lanes. It doesn't depend on the biome or the seed. */
export function arenaLayout(lanes: number): ArenaLayout {
  const n = clampLanes(lanes);
  const mid = ARENA_SIZE.sx / 2;
  // Each lane's middle is the middle of a cell, so its path is the same width on both sides.
  const laneX = Array.from(
    { length: n },
    (_, i) => Math.floor(mid + (i - (n - 1) / 2) * LANE_SPACING) + 0.5,
  );
  const cx = ((laneX[0] ?? mid) + (laneX[n - 1] ?? mid)) / 2;
  const groundY = FLOOR_Y + 1;
  const farZ = FAR_Z + 0.5;
  const baseZ = BASE_Z + 0.5;
  return {
    lanes: n,
    groundY,
    laneX,
    farZ,
    baseZ,
    waitZ: farZ + (baseZ - farZ) * WAIT_SHARE,
    center: { x: cx, y: groundY, z: (farZ + baseZ) / 2 },
    width: (n - 1) * LANE_SPACING + LANE_WIDTH + 4,
    camp: { x: cx, y: groundY, z: BASE_Z + 2 },
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
  if (n === undefined) throw new Error(`defense arena: unknown block "${id}"`);
  return n;
}

const smoothstep = (t: number): number => {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/** Builds the arena grid for a biome. Biomes without their own recipe use the Meadow's blocks. */
export function generateArena(biome: BiomeId, seed: number, lanes: number): VoxelGrid {
  const recipe = recipeFor(biome);
  const layout = arenaLayout(lanes);
  const { sx, sy, sz } = ARENA_SIZE;
  const rng = createRng(seed).fork(`arena:${recipe.biome}`);
  const B = recipe.blocks;
  const g = new VoxelGrid(sx, sy, sz);
  const cx = layout.center.x;
  const half = layout.width / 2;
  const noiseSeed = rng.fork("terrain").seed;

  const inField = (x: number): boolean => x + 0.5 > cx - half && x + 0.5 < cx + half;
  const onLane = (x: number): boolean =>
    layout.laneX.some((lx) => Math.abs(x + 0.5 - lx) < LANE_WIDTH / 2);

  // 1. Heights: flat on the field and the camp, a hill at the back, soft bumps at the sides.
  const height = new Int32Array(sx * sz);
  const idx = (x: number, z: number): number => x + sx * z;
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const back = HILL_RISE * smoothstep((FAR_Z - 2 - z) / (FAR_Z - 2));
      const out = Math.max(0, Math.abs(x + 0.5 - cx) - half - 1);
      const bump = smoothstep(out / 6) * (fbm2(x / 7, z / 7, noiseSeed, 2) - 0.35) * 5;
      const h = FLOOR_Y + Math.round(back + Math.max(0, bump));
      height[idx(x, z)] = Math.min(sy - 12, h);
    }
  }
  const ground = (x: number, z: number): number => height[idx(x, z)] ?? FLOOR_Y;

  // 2. Columns: top, sub and deep blocks. Lanes are paths from the hill down to the fence.
  const top = num(B.top);
  const sub = num(B.sub);
  const deep = num(B.deep);
  const path = num(B.path);
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const h = ground(x, z);
      const lane = onLane(x) && z <= BASE_Z;
      for (let y = 0; y <= h; y++) {
        g.set(x, y, z, y === h ? (lane ? path : top) : y >= h - 2 ? sub : deep);
      }
    }
  }

  const placed = new Uint8Array(sx * sz);
  const put = (x: number, y: number, z: number, block: number): void => {
    if (x < 0 || z < 0 || x >= sx || z >= sz || y >= sy || g.get(x, y, z) !== 0) return;
    g.set(x, y, z, block);
    placed[idx(x, z)] = 1;
  };
  const place = (tpl: Template, ax: number, az: number): void => {
    const anchor = ground(ax, az);
    for (const v of tpl.voxels) {
      const x = ax + v.dx;
      const z = az + v.dz;
      if (x < 0 || z < 0 || x >= sx || z >= sz) continue;
      // Nothing may stand on the field or hang over it: mobs and their plates need it clear.
      if (inField(x) && z >= FAR_Z - 1 && z <= BASE_Z) continue;
      put(x, (tpl.follow === "column" ? ground(x, z) : anchor) + 1 + v.dy, z, v.block);
    }
  };

  // 3. The camp's fence along the base line. Rails cross the lanes; the posts stand on the verges
  //    beside each lane, with a lantern on top, so no post hides a mob at the end of its lane.
  const post = num(B.post);
  const rail = num(B.rail);
  const lantern = num("lantern");
  const fenceZ = BASE_Z + 1;
  const x0 = Math.floor(cx - half) - 1;
  const x1 = Math.ceil(cx + half);
  // A post right of every lane, and one left of the first: one more post than lanes.
  const firstPost = Math.floor(layout.laneX[0] ?? cx) - 2;
  for (let x = x0; x <= x1; x++) {
    const isPost = !onLane(x) && (onLane(x - 1) || x === firstPost);
    const y = ground(x, fenceZ) + 1;
    put(x, y, fenceZ, isPost ? post : rail);
    if (isPost) put(x, y + 1, fenceZ, lantern);
  }

  // 4. The camp, beside the fence and clear of the camera's view of the lanes: a small plank
  //    tent with a log ridge on the left, and a campfire ring on the right.
  const campZ = BASE_Z - 1;
  const planks = num("oak-planks");
  const tentX = Math.max(1, x0 - 7);
  for (let dz = 0; dz < 4; dz++) {
    for (let dx = 0; dx < 5; dx++) {
      const rise = 2 - Math.abs(dx - 2);
      const y = ground(tentX + dx, campZ + dz) + 1;
      // An A-frame: the walls step up to a ridge, and the middle is hollow.
      put(tentX + dx, y + rise, campZ + dz, dx === 2 ? post : planks);
      if (rise > 0 && (dz === 0 || dx === 0 || dx === 4)) {
        for (let k = 0; k < rise; k++) put(tentX + dx, y + k, campZ + dz, planks);
      }
    }
  }
  const fireX = Math.min(sx - 3, x1 + 4);
  const cobble = num(B.rock);
  for (const [dx, dz] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    put(fireX + dx, ground(fireX + dx, campZ + 1 + dz) + 1, campZ + 1 + dz, cobble);
  }
  put(fireX, ground(fireX, campZ + 1) + 1, campZ + 1, lantern);

  // 5. The waiting line: a low row of flowers across the verges (not the paths).
  const flowers = B.flowers.map(num);
  const waitRow = Math.floor(layout.waitZ);
  const lineRng = rng.fork("line");
  for (let x = x0 + 1; x < x1; x++) {
    if (onLane(x) || !inField(x)) continue;
    put(x, ground(x, waitRow) + 1, waitRow, lineRng.pick(flowers));
  }

  // 6. Scenery outside the field: trees, rocks and flowers at seeded spots.
  const scatter = rng.fork("scatter");
  const treeBlocks = { log: num(B.log), leaves: num(B.leaves) };
  const rocks = { stone: num(B.rock), mossy: num(B.mossyRock) };
  const free = (x: number, z: number, reach: number): boolean => {
    for (let dz = -reach; dz <= reach; dz++)
      for (let dx = -reach; dx <= reach; dx++) {
        const px = x + dx;
        const pz = z + dz;
        if (px < 0 || pz < 0 || px >= sx || pz >= sz) return false;
        if (placed[idx(px, pz)] === 1) return false;
        if (inField(px) && pz >= FAR_Z - 2) return false;
      }
    return true;
  };
  let trees = 0;
  for (let i = 0; i < 90; i++) {
    const x = scatter.int(2, sx - 3);
    const z = scatter.int(1, sz - 3);
    const tplRng = scatter.fork(`at:${i}`);
    const roll = scatter.next();
    // Trees stand at the sides and on the back hill, never in front of the camp (the camera).
    if (roll < 0.4 && trees < 12 && z < BASE_Z - 2 && free(x, z, 3)) {
      place(
        oakTree(TREE_VARIANTS[trees % TREE_VARIANTS.length] ?? "puff", treeBlocks, tplRng),
        x,
        z,
      );
      trees++;
    } else if (roll < 0.7 && free(x, z, 1)) {
      place(flowerPatch(flowers, tplRng), x, z);
    } else if (roll < 0.82 && free(x, z, 1)) {
      place(rockCluster(rocks, tplRng), x, z);
    }
  }
  return g;
}
