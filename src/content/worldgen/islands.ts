/**
 * World-map islands (task M3-04, PLAN.md §3.1). Pure: no clock, no `Math.random()`.
 *
 * The world map shows one small floating island per biome. Each is a 16×12×16 voxel model of its
 * biome: a clump of ground that tapers to a point underneath, with a few landmarks on top (a
 * little house on Meadow Home, birches on Birch Forest, a lagoon on Sandy Shore, and so on).
 *
 * The islands are models, not playable worlds, so they have their own small set of voxel kinds
 * ({@link ISLAND_KINDS}) instead of the block registry: the map can show all nine biomes before
 * their blocks exist. Every kind is painted from the biome's palette with the shared texture
 * recipes (`src/render/atlas/recipes.ts`), so the islands change with the palettes.
 *
 * Every shape here was designed for this game.
 */
import { createRng } from "@/engine/rng";
import type { Rng } from "@/engine/rng";
import type { TextureRecipe } from "@/render/atlas/recipes";
import { VoxelGrid } from "@/render/mesher/voxel-grid";
import { BIOME_ORDER } from "@/types/core";
import type { BiomeId } from "@/types/core";
import { fbm2, hash2 } from "./noise";

/** The size of every island model, in cells. One mesher chunk holds it. */
export const ISLAND_SIZE = { sx: 16, sy: 12, sz: 16 } as const;
/** The y of the ground's top cell. Landmarks stand on it; the underside hangs below it. */
export const ISLAND_GROUND_Y = 5;
/** The seed the app's map uses, so the archipelago looks the same on every visit. */
export const MAP_SEED = 2604;

type Faces = { top: TextureRecipe; side: TextureRecipe; bottom: TextureRecipe };

/** One voxel kind of the island models. `glow` kinds are drawn unlit, like lamps. */
export interface IslandKind {
  id: string;
  /** The number stored in island grids. 0 is air. */
  num: number;
  faces: Faces;
  glow?: boolean;
}

const same = (r: TextureRecipe): Faces => ({ top: r, side: r, bottom: r });
const noise = (
  ramp: Extract<TextureRecipe, { kind: "noise" }>["ramp"],
  scale = 4,
  contrast = 0.8,
) => ({ kind: "noise", ramp, scale, contrast }) satisfies TextureRecipe;
const custom = (paint: string): TextureRecipe => ({ kind: "custom", paint });

const DIRT = noise("dirt", 4, 1);
const STONE = noise("stone");
const MUD = noise("mud", 4, 0.7);

const KIND_FACES = {
  grass: {
    top: noise("grass", 3, 0.9),
    side: { kind: "overlay-top", base: DIRT, top: "grass", depth: 3 },
    bottom: DIRT,
  },
  dirt: same(DIRT),
  stone: same(STONE),
  sand: same(noise("sand", 3, 0.6)),
  water: same(custom("ripple:water")),
  "oak-log": {
    top: custom("rings:oak"),
    side: custom("bark:oak-bark"),
    bottom: custom("rings:oak"),
  },
  "birch-log": {
    top: custom("rings:birch"),
    side: custom("dashed-bark:birch-bark"),
    bottom: custom("rings:birch"),
  },
  leaves: same(custom("leaves:leaf")),
  planks: same({ kind: "planks", ramp: "oak", boards: 4 }),
  brick: same({ kind: "bricks", ramp: "brick", mortar: "mortar" }),
  snow: {
    top: noise("snow", 3, 0.5),
    side: { kind: "overlay-top", base: STONE, top: "snow", depth: 5 },
    bottom: STONE,
  },
  ice: same(noise("ice", 5, 0.6)),
  pine: same(custom("leaves:moss")),
  gravel: same(custom("pebbles:gravel")),
  slate: same(noise("slate", 4, 0.7)),
  "copper-ore": same({ kind: "ore", base: STONE, ore: "ore-copper", density: 0.5 }),
  "gem-ore": same({ kind: "ore", base: STONE, ore: "ore-gem", density: 0.4 }),
  lantern: same(custom("lamp:ore-amber")),
  moss: {
    top: noise("moss", 3, 0.9),
    side: { kind: "overlay-top", base: MUD, top: "moss", depth: 3 },
    bottom: MUD,
  },
  mud: same(MUD),
  "mushroom-cap": {
    top: custom("cap:mushroom"),
    side: custom("cap:mushroom"),
    bottom: noise("mushroom-stem", 4, 0.5),
  },
  "mushroom-stem": same(noise("mushroom-stem", 4, 0.5)),
  crystal: same(custom("facets:crystal")),
  metal: same(noise("metal", 5, 0.6)),
  spark: same(custom("facets:spark")),
  cloud: same(noise("cloud", 5, 0.35)),
  "stone-brick": same({ kind: "bricks", ramp: "stone", mortar: "mortar" }),
  "red-wool": same(custom("knit:wool-red")),
  "blue-wool": same(custom("knit:wool-blue")),
  "white-wool": same(custom("knit:wool-white")),
  "red-flowers": {
    top: custom("flowers-top:wool-red"),
    side: custom("flowers-side:wool-red"),
    bottom: DIRT,
  },
  "yellow-flowers": {
    top: custom("flowers-top:wool-yellow"),
    side: custom("flowers-side:wool-yellow"),
    bottom: DIRT,
  },
  gold: same(noise("ore-amber", 4, 0.7)),
} as const satisfies Record<string, Faces>;

/** The id of an island voxel kind. */
export type IslandKindId = keyof typeof KIND_FACES;

const GLOW: ReadonlySet<IslandKindId> = new Set(["lantern", "crystal", "spark", "gold"]);

function isKindId(id: string): id is IslandKindId {
  return Object.hasOwn(KIND_FACES, id);
}

/** Every island voxel kind. Nums run from 1 in this order. */
export const ISLAND_KINDS: readonly IslandKind[] = Object.keys(KIND_FACES)
  .filter(isKindId)
  .map((id, i) => ({
    id,
    num: i + 1,
    faces: KIND_FACES[id],
    ...(GLOW.has(id) ? { glow: true } : {}),
  }));

const NUM_OF = new Map<string, number>(ISLAND_KINDS.map((k) => [k.id, k.num]));

/** The grid number of a kind. */
export function islandKindNum(id: IslandKindId): number {
  const num = NUM_OF.get(id);
  if (num === undefined) throw new Error(`unknown island kind: ${id}`);
  return num;
}

/** Where an island floats in the archipelago: the center of its ground, in world units. */
export interface IslandPlace {
  x: number;
  y: number;
  z: number;
  /** Turn about the y axis, in degrees, so each island shows a different corner. */
  turn: number;
}

/**
 * The archipelago. The camera looks from +z toward −z, so a larger z is nearer. The path snakes
 * from Meadow Home at the front left, back and forth, up to Sky Citadel, the highest and farthest
 * island. Sparkstone Factory sits off to the side of Crystal Caverns: it is a side branch.
 */
export const ISLAND_LAYOUT: Readonly<Record<BiomeId, IslandPlace>> = {
  meadow: { x: -34, y: 0, z: 22, turn: 32 },
  birch: { x: -2, y: 1.5, z: 27, turn: -24 },
  shore: { x: 31, y: 0.5, z: 22, turn: 38 },
  frosty: { x: 40, y: 6, z: -12, turn: -30 },
  mines: { x: 2, y: 7.5, z: -9, turn: 28 },
  marsh: { x: -38, y: 6.5, z: -14, turn: -36 },
  caverns: { x: -20, y: 14, z: -50, turn: 30 },
  sparkstone: { x: -64, y: 15.5, z: -54, turn: -28 },
  citadel: { x: 30, y: 18, z: -56, turn: 35 },
};

/**
 * Which island the stepping stones lead from, for each island but the first. Follows the unlock
 * rules (contracts §6): each biome opens the next, and Crystal Caverns opens both Sparkstone
 * Factory and Sky Citadel.
 */
export const ISLAND_LINKS: Readonly<Partial<Record<BiomeId, BiomeId>>> = {
  birch: "meadow",
  shore: "birch",
  frosty: "shore",
  mines: "frosty",
  marsh: "mines",
  caverns: "marsh",
  sparkstone: "caverns",
  citadel: "caverns",
};

/** The ground of an island: what its columns are made of, and how wide it is. */
interface Ground {
  top: IslandKindId;
  sub: IslandKindId;
  deep: IslandKindId;
  /** Hangs from the lowest points of the underside. */
  tip?: IslandKindId;
  radius: number;
}

interface Build {
  grid: VoxelGrid;
  rng: Rng;
  seed: number;
  /** True for a column that has ground. */
  land(x: number, z: number): boolean;
  /** The y of the highest solid cell in a column, or −1. */
  top(x: number, z: number): number;
  set(x: number, y: number, z: number, kind: IslandKindId): void;
  /** Replaces the ground's top cell. */
  pave(x: number, z: number, kind: IslandKindId): void;
  /** Stacks `kinds` on top of a column, bottom first. */
  stack(x: number, z: number, ...kinds: IslandKindId[]): void;
  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    kind: IslandKindId,
  ): void;
  /** A rounded clump centered on a cell; rim cells may be nibbled away. */
  blob(cx: number, cy: number, cz: number, r: number, kind: IslandKindId, nibble?: number): void;
}

const G = ISLAND_GROUND_Y;
const C = 7.5;

function makeBuild(seed: number, ground: Ground): Build {
  const { sx, sy, sz } = ISLAND_SIZE;
  const grid = new VoxelGrid(sx, sy, sz);
  const rng = createRng(seed);
  const set = (x: number, y: number, z: number, kind: IslandKindId): void =>
    grid.set(x, y, z, islandKindNum(kind));

  // The clump: a wobbly disc of ground whose underside tapers toward the middle.
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const d = Math.hypot(x - C, z - C);
      const edge = ground.radius + (fbm2(x * 0.3, z * 0.3, seed) - 0.5) * 2.2;
      if (d > edge) continue;
      const k = 1 - (d / edge) ** 1.7;
      const jitter = (hash2(x, z, seed) / 4294967296) * 1.6;
      const depth = Math.max(1, Math.min(G + 1, Math.round(1 + k * 4.4 + jitter * k)));
      const bottom = G - depth + 1;
      for (let y = bottom; y <= G; y++) {
        set(x, y, z, y === G ? ground.top : y >= G - 1 ? ground.sub : ground.deep);
      }
      if (ground.tip !== undefined && depth >= 4 && bottom > 0 && hash2(z, x, seed) % 3 === 0) {
        set(x, bottom - 1, z, ground.tip);
      }
    }
  }

  const top = (x: number, z: number): number => {
    for (let y = sy - 1; y >= 0; y--) if (grid.get(x, y, z) !== 0) return y;
    return -1;
  };

  return {
    grid,
    rng,
    seed,
    land: (x, z) => grid.get(x, G, z) !== 0,
    top,
    set,
    pave(x, z, kind) {
      if (grid.get(x, G, z) !== 0) set(x, G, z, kind);
    },
    stack(x, z, ...kinds) {
      const base = top(x, z);
      if (base < 0) return;
      kinds.forEach((kind, i) => set(x, base + 1 + i, z, kind));
    },
    box(x0, y0, z0, x1, y1, z1, kind) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) set(x, y, z, kind);
        }
      }
    },
    blob(cx, cy, cz, r, kind, nibble = 0.2) {
      const n = Math.ceil(r);
      for (let dy = -n; dy <= n; dy++) {
        for (let dz = -n; dz <= n; dz++) {
          for (let dx = -n; dx <= n; dx++) {
            const d = (dx * dx + dy * dy * 1.3 + dz * dz) / (r * r);
            if (d > 1) continue;
            if (d > 0.55 && rng.next() < nibble) continue;
            set(cx + dx, cy + dy, cz + dz, kind);
          }
        }
      }
    },
  };
}

/** A tree: a trunk of `height` cells with a rounded crown on top. */
function tree(
  b: Build,
  x: number,
  z: number,
  height: number,
  log: IslandKindId,
  leaves: IslandKindId,
  crown = 1.9,
): void {
  if (!b.land(x, z)) return;
  const base = b.top(x, z);
  b.blob(x, base + height + 1, z, crown, leaves);
  for (let i = 1; i <= height; i++) b.set(x, base + i, z, log);
}

/** A pointed evergreen with a snowy tip. */
function pine(b: Build, x: number, z: number, height: number): void {
  if (!b.land(x, z)) return;
  const base = b.top(x, z);
  b.set(x, base + 1, z, "oak-log");
  for (let i = 0; i < height; i++) {
    const y = base + 2 + i;
    const r = i < height - 1 && i % 2 === 0 ? 1 : 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r === 1 && dx !== 0 && dz !== 0 && i > 0) continue;
        b.set(x + dx, y, z + dz, "pine");
      }
    }
  }
  b.set(x, base + 2 + height, z, "snow");
}

/** A stepped peak: square tiers that shrink by one cell per `step` layers. */
function peak(
  b: Build,
  cx: number,
  cz: number,
  r: number,
  height: number,
  body: IslandKindId,
  cap: IslandKindId,
): void {
  for (let i = 0; i < height; i++) {
    const rr = Math.max(0, Math.round(r * (1 - i / height)));
    for (let dz = -rr; dz <= rr; dz++) {
      for (let dx = -rr; dx <= rr; dx++) {
        // Knock the corners off the wide tiers so the peak reads as rock, not as a pyramid.
        if (rr >= 2 && Math.abs(dx) === rr && Math.abs(dz) === rr) continue;
        if (!b.land(cx + dx, cz + dz)) continue;
        b.set(cx + dx, G + 1 + i, cz + dz, i >= height - 2 ? cap : body);
      }
    }
  }
}

/** A mushroom taller than a house: a pale stem under a wide spotted cap. */
function mushroom(b: Build, x: number, z: number, height: number, wide: boolean): void {
  if (!b.land(x, z)) return;
  const base = b.top(x, z);
  for (let i = 1; i <= height; i++) b.set(x, base + i, z, "mushroom-stem");
  const y = base + height + 1;
  if (!wide) {
    b.set(x, y, z, "mushroom-cap");
    return;
  }
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) b.set(x + dx, y, z + dz, "mushroom-cap");
  }
  b.set(x, y + 1, z, "mushroom-cap");
  for (const [dx, dz] of [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
  ] as const) {
    b.set(x + dx, y - 1, z + dz, "mushroom-cap");
  }
}

type Builder = (seed: number) => VoxelGrid;

const BUILDERS: Readonly<Record<BiomeId, Builder>> = {
  // Meadow Home: a little house with a red roof, an oak, a pond and flowers.
  meadow(seed) {
    const b = makeBuild(seed, { top: "grass", sub: "dirt", deep: "stone", radius: 6.7 });
    // The house: plank walls, a doorway facing the front, and a stepped roof.
    b.box(4, G + 1, 4, 7, G + 2, 7, "planks");
    b.box(5, G + 1, 5, 6, G + 2, 6, "planks");
    b.grid.set(5, G + 1, 7, 0);
    b.box(3, G + 3, 3, 8, G + 3, 8, "red-wool");
    b.box(4, G + 4, 4, 7, G + 4, 7, "red-wool");
    b.box(5, G + 5, 5, 6, G + 5, 6, "red-wool");
    b.set(7, G + 4, 4, "brick");
    b.set(7, G + 5, 4, "brick");
    tree(b, 11, 9, 2, "oak-log", "leaves", 2.1);
    for (const [x, z] of [
      [10, 4],
      [11, 4],
      [11, 5],
      [10, 5],
      [12, 5],
    ] as const) {
      b.pave(x, z, "water");
    }
    for (const [x, z, kind] of [
      [4, 10, "red-flowers"],
      [6, 11, "yellow-flowers"],
      [8, 10, "red-flowers"],
      [3, 8, "yellow-flowers"],
      [9, 12, "yellow-flowers"],
    ] as const) {
      if (b.land(x, z)) b.stack(x, z, kind);
    }
    // A path from the door to the edge.
    for (const z of [8, 9, 10]) b.pave(5, z, "sand");
    return b.grid;
  },

  // Birch Forest: pale trunks under light crowns, and a fallen log.
  birch(seed) {
    const b = makeBuild(seed, { top: "grass", sub: "dirt", deep: "stone", radius: 6.6 });
    tree(b, 4, 5, 4, "birch-log", "leaves", 1.5);
    tree(b, 10, 4, 4, "birch-log", "leaves", 1.5);
    tree(b, 7, 9, 4, "birch-log", "leaves", 1.6);
    tree(b, 12, 9, 3, "birch-log", "leaves", 1.3);
    tree(b, 3, 10, 3, "birch-log", "leaves", 1.3);
    for (const x of [8, 9, 10]) if (b.land(x, 12)) b.stack(x, 12, "birch-log");
    if (b.land(5, 12)) b.stack(5, 12, "yellow-flowers");
    return b.grid;
  },

  // Sandy Shore: a lagoon with a small boat, a leaning palm and a tuft of grass.
  shore(seed) {
    const b = makeBuild(seed, { top: "sand", sub: "sand", deep: "stone", radius: 6.9 });
    for (let z = 7; z <= 11; z++) {
      for (let x = 4; x <= 10; x++) {
        const corner = (x === 4 || x === 10) && (z === 7 || z === 11);
        if (!corner) b.pave(x, z, "water");
      }
    }
    // The boat: a plank hull, a mast and a white sail.
    b.box(6, G + 1, 9, 8, G + 1, 9, "planks");
    b.set(7, G + 2, 9, "oak-log");
    b.set(7, G + 3, 9, "oak-log");
    b.set(8, G + 3, 9, "white-wool");
    b.set(8, G + 2, 9, "white-wool");
    // The palm: a trunk that leans one cell, with fronds drooping at the tips.
    const px = 11;
    const pz = 4;
    b.set(px, G + 1, pz, "oak-log");
    b.set(px, G + 2, pz, "oak-log");
    b.set(px - 1, G + 3, pz, "oak-log");
    b.set(px - 1, G + 4, pz, "oak-log");
    const fy = G + 5;
    b.set(px - 1, fy, pz, "leaves");
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      b.set(px - 1 + dx, fy, pz + dz, "leaves");
      b.set(px - 1 + dx * 2, fy, pz + dz * 2, "leaves");
      b.set(px - 1 + dx * 3, fy - 1, pz + dz * 3, "leaves");
    }
    for (const [x, z] of [
      [4, 4],
      [5, 4],
      [4, 5],
      [5, 3],
    ] as const) {
      b.pave(x, z, "grass");
    }
    if (b.land(4, 4)) b.stack(4, 4, "red-flowers");
    return b.grid;
  },

  // Frosty Peaks: two snow-capped peaks, pines and a patch of ice.
  frosty(seed) {
    const b = makeBuild(seed, {
      top: "snow",
      sub: "stone",
      deep: "stone",
      tip: "ice",
      radius: 6.7,
    });
    peak(b, 6, 5, 3, 6, "stone", "snow");
    peak(b, 11, 6, 2, 4, "stone", "snow");
    pine(b, 4, 10, 3);
    pine(b, 11, 11, 2);
    for (const [x, z] of [
      [7, 10],
      [8, 10],
      [7, 11],
      [8, 11],
      [9, 11],
    ] as const) {
      b.pave(x, z, "ice");
    }
    return b.grid;
  },

  // Deep Mines: a rocky mound with ore in it, a timbered mine mouth, a lantern and a cart track.
  mines(seed) {
    const b = makeBuild(seed, { top: "gravel", sub: "stone", deep: "stone", radius: 6.6 });
    for (let z = 3; z <= 7; z++) {
      for (let x = 3; x <= 11; x++) {
        const h = z <= 5 ? (x >= 5 && x <= 9 ? 4 : 3) : x >= 5 && x <= 9 ? 3 : 2;
        for (let i = 1; i <= h; i++) {
          if (!b.land(x, z)) continue;
          const roll = hash2(x * 7 + i, z, b.seed) % 11;
          b.set(x, G + i, z, roll === 0 ? "copper-ore" : roll === 1 ? "gem-ore" : "stone");
        }
      }
    }
    // The mine mouth: a dark opening with timber posts and a lintel.
    b.box(6, G + 1, 7, 8, G + 2, 7, "slate");
    b.box(6, G + 1, 8, 6, G + 2, 8, "oak-log");
    b.box(8, G + 1, 8, 8, G + 2, 8, "oak-log");
    b.box(6, G + 3, 8, 8, G + 3, 8, "planks");
    b.set(10, G + 1, 9, "oak-log");
    b.set(10, G + 2, 9, "lantern");
    // Sleepers of the cart track, leading out of the mouth.
    for (const z of [9, 11, 13]) b.pave(7, z, "planks");
    for (const z of [8, 10, 12]) b.pave(7, z, "stone");
    if (b.land(4, 11)) b.stack(4, 11, "copper-ore");
    if (b.land(5, 11)) b.stack(5, 11, "stone");
    return b.grid;
  },

  // Mushroom Marsh: mossy ground, dark pools and mushrooms as tall as trees.
  marsh(seed) {
    const b = makeBuild(seed, { top: "moss", sub: "mud", deep: "mud", radius: 6.8 });
    for (const [x, z] of [
      [9, 9],
      [10, 9],
      [10, 10],
      [9, 10],
      [11, 10],
      [4, 6],
      [4, 7],
      [5, 7],
      [7, 12],
      [8, 12],
    ] as const) {
      b.pave(x, z, "water");
    }
    mushroom(b, 6, 5, 3, true);
    mushroom(b, 11, 5, 2, true);
    mushroom(b, 5, 11, 1, false);
    mushroom(b, 12, 12, 1, false);
    mushroom(b, 8, 8, 2, false);
    for (const x of [2, 3]) if (b.land(x, 9)) b.stack(x, 9, "oak-log");
    return b.grid;
  },

  // Crystal Caverns: dark rock with glowing crystal spires, and crystals hanging underneath.
  caverns(seed) {
    const b = makeBuild(seed, {
      top: "slate",
      sub: "stone",
      deep: "stone",
      tip: "crystal",
      radius: 6.6,
    });
    for (const [x, z, h] of [
      [7, 6, 5],
      [8, 6, 3],
      [6, 7, 3],
      [8, 7, 2],
      [7, 5, 2],
      [11, 9, 4],
      [12, 9, 2],
      [11, 10, 2],
      [4, 10, 3],
      [4, 11, 1],
      [5, 10, 1],
      [3, 5, 2],
      [12, 4, 1],
    ] as const) {
      if (!b.land(x, z)) continue;
      for (let i = 1; i <= h; i++) b.set(x, G + i, z, "crystal");
    }
    // Boulders and a low arch between the clusters.
    b.box(9, G + 1, 12, 10, G + 1, 12, "stone");
    b.set(2, G + 1, 8, "stone");
    b.set(8, G + 1, 10, "gem-ore");
    for (const [x, z] of [
      [6, 12],
      [10, 6],
      [5, 4],
    ] as const) {
      b.pave(x, z, "gem-ore");
    }
    return b.grid;
  },

  // Sparkstone Factory: a brick works with a tall chimney, a tank and glowing sparkstone.
  sparkstone(seed) {
    const b = makeBuild(seed, { top: "slate", sub: "stone", deep: "slate", radius: 6.6 });
    b.box(3, G + 1, 4, 8, G + 3, 8, "brick");
    b.box(3, G + 4, 4, 8, G + 4, 8, "metal");
    b.box(4, G + 5, 5, 7, G + 5, 7, "metal");
    // Lit windows and a doorway on the front wall.
    b.set(4, G + 2, 8, "spark");
    b.set(7, G + 2, 8, "spark");
    b.grid.set(5, G + 1, 8, 0);
    b.grid.set(6, G + 1, 8, 0);
    b.set(8, G + 2, 6, "spark");
    // The chimney, with a spark at its mouth.
    b.box(10, G + 1, 5, 10, G + 5, 5, "brick");
    b.set(10, G + 6, 5, "spark");
    // A pipe from the works to the tank.
    b.box(9, G + 1, 7, 10, G + 1, 7, "metal");
    b.box(11, G + 1, 9, 12, G + 2, 10, "metal");
    b.box(11, G + 1, 7, 11, G + 1, 8, "metal");
    b.set(11, G + 3, 9, "spark");
    for (const [x, z] of [
      [5, 10],
      [6, 10],
      [5, 11],
      [6, 11],
      [6, 12],
    ] as const) {
      b.pave(x, z, "metal");
    }
    if (b.land(3, 11)) b.stack(3, 11, "spark");
    return b.grid;
  },

  // Sky Citadel: a keep with blue roofs and a golden beacon, standing on a cloud.
  citadel(seed) {
    const b = makeBuild(seed, { top: "cloud", sub: "cloud", deep: "cloud", radius: 7.1 });
    for (let z = 3; z <= 12; z++) {
      for (let x = 3; x <= 12; x++) b.pave(x, z, "stone-brick");
    }
    // The outer wall, with a gate at the front and battlements on top.
    for (let i = 3; i <= 12; i++) {
      for (const [x, z] of [
        [i, 3],
        [i, 12],
        [3, i],
        [12, i],
      ] as const) {
        if (!b.land(x, z)) continue;
        b.set(x, G + 1, z, "stone-brick");
        if (i % 2 === 1) b.set(x, G + 2, z, "stone-brick");
      }
    }
    b.grid.set(7, G + 1, 12, 0);
    b.grid.set(8, G + 1, 12, 0);
    b.grid.set(7, G + 2, 12, 0);
    // The keep.
    b.box(6, G + 1, 6, 9, G + 4, 9, "stone-brick");
    b.box(6, G + 5, 6, 9, G + 5, 9, "blue-wool");
    b.box(7, G + 6, 7, 8, G + 6, 8, "gold");
    // Corner turrets with blue caps.
    for (const [x, z] of [
      [3, 3],
      [12, 3],
      [3, 12],
      [12, 12],
    ] as const) {
      if (!b.land(x, z)) continue;
      b.box(x, G + 1, z, x, G + 3, z, "stone-brick");
      b.set(x, G + 4, z, "blue-wool");
    }
    return b.grid;
  },
};

/** The seed of one biome's island, from the map seed. */
function islandSeed(biome: BiomeId, seed: number): number {
  return (Math.imul(seed | 0, 0x9e3779b1) + BIOME_ORDER.indexOf(biome) * 7919) | 0;
}

/** The island model of a biome. The same biome and seed always give the same grid. */
export function generateIsland(biome: BiomeId, seed: number = MAP_SEED): VoxelGrid {
  return BUILDERS[biome](islandSeed(biome, seed));
}
