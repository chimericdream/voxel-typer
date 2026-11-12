/**
 * Home Island data and persistence (task M4-06, PLAN.md §3.1 and §6.6). Pure: the seed comes from
 * the profile id, and save times come in as parameters.
 *
 * **Layout.** The island lives in one fixed {@link ISLAND_MAX} grid (48×32×48, y up). A new island
 * is a {@link PLOT_SIZE} meadow plot (24×16×24) in the middle of it: ground about 4 high, a flat
 * clearing in the middle to build on, a small pond in one corner, two oak trees, flower patches and
 * a rock. Every generated voxel is inside the plot's footprint and below y = 16; the rest of the
 * grid is air. Kids build anywhere above the unlocked footprint, up to the top of the grid.
 *
 * **Expansions.** Each expansion adds a ring {@link RING_WIDTH} cells wide on every side (the
 * footprint grows by 8 each way): 24 → 32 → 40 → 48, so {@link MAX_EXPANSIONS} is 3. A ring gets
 * the starter terrain of the biome passed to {@link IslandEditor.expand}; ground heights come from
 * one noise field over the whole grid, so a ring meets the plot without a step.
 *
 * **Edits** are commands ({@link IslandCommand}): `place`, `remove` and `stamp`. Each one either
 * applies in full or not at all, and the last {@link UNDO_LIMIT} are kept, in memory only, for
 * undo.
 *
 * **Conservation.** For every block id `b`, `inventory[b] + (cells of b on the island)` is the same
 * before and after any `place`, `remove`, `stamp` or `undo`. Placing moves a block from the
 * inventory to the island; removing moves it back. So nothing is ever destroyed, and starter
 * terrain counts as blocks the island was given: digging it up puts it in the inventory. Only
 * {@link createIsland} and {@link IslandEditor.expand} change the totals (they add terrain).
 *
 * **Save** is {@link IslandSave} (`Profile.island`): `VoxelGrid.toJSON()`, the expansion count and
 * the last edit time. `openIsland(s).save(t)` gives back `s` exactly when nothing was edited.
 */
import type { BlockDef } from "@/content/blocks/types";
import { recipeFor } from "@/content/worldgen/diorama";
import type { DioramaRecipe } from "@/content/worldgen/diorama";
import { fbm2 } from "@/content/worldgen/noise";
import { flowerPatch } from "@/content/worldgen/templates/flowers";
import { rockCluster } from "@/content/worldgen/templates/rocks";
import { oakTree, TREE_MAX_REACH, TREE_VARIANTS } from "@/content/worldgen/templates/trees";
import type { Template } from "@/content/worldgen/templates/types";
import { VoxelGrid } from "@/render/mesher/voxel-grid";
import type { Profile } from "@/save/schema";
import type { BiomeId, BlockId, EpochMs } from "@/types/core";
import { createRng, hashString } from "./rng";
import type { Rng } from "./rng";

/** What `Profile.island` holds when the profile has an island. */
export type IslandSave = NonNullable<Profile["island"]>;

/** The whole island grid. It never changes size; expansions unlock more of it. */
export const ISLAND_MAX = { sx: 48, sy: 32, sz: 48 } as const;
/** The starter plot: its footprint, and the height its terrain stays under. */
export const PLOT_SIZE = { sx: 24, sy: 16, sz: 24 } as const;
/** Cells an expansion adds on each side of the footprint. */
export const RING_WIDTH = 4;
/** Expansions until the footprint fills the grid. */
export const MAX_EXPANSIONS = (ISLAND_MAX.sx - PLOT_SIZE.sx) / (2 * RING_WIDTH);
/** Undo steps kept. Never saved. */
export const UNDO_LIMIT = 50;

/** Height of the top block of flat ground (the clearing, the pond's water). */
const BASE = 4;
/** The clearing in the middle of the plot: flat, with nothing generated on it. Local cells. */
const CLEARING = { lo: 7, hi: 17 } as const;

// ---------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------

/** How the island maps between block ids (inventory) and block nums (grid). */
export interface IslandBlocks {
  numOf(id: BlockId): number | undefined;
  idOf(num: number): BlockId | undefined;
}

/** An {@link IslandBlocks} over a block registry. */
export function islandBlocks(defs: readonly BlockDef[]): IslandBlocks {
  const nums = new Map<BlockId, number>();
  const ids = new Map<number, BlockId>();
  for (const b of defs) {
    nums.set(b.id, b.num);
    ids.set(b.num, b.id);
  }
  return { numOf: (id) => nums.get(id), idOf: (num) => ids.get(num) };
}

function needNum(blocks: IslandBlocks, id: BlockId): number {
  const n = blocks.numOf(id);
  if (n === undefined) throw new Error(`island: unknown block "${id}"`);
  return n;
}

// ---------------------------------------------------------------------------------------------
// Footprint
// ---------------------------------------------------------------------------------------------

/** Unlocked columns, half-open: `x0 <= x < x1`, `z0 <= z < z1`. */
export interface Footprint {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const clampExpansions = (e: number): number => Math.max(0, Math.min(MAX_EXPANSIONS, Math.floor(e)));

/** The unlocked columns after `expansions` expansions (clamped to 0–{@link MAX_EXPANSIONS}). */
export function footprint(expansions: number): Footprint {
  const half = PLOT_SIZE.sx / 2 + RING_WIDTH * clampExpansions(expansions);
  const cx = ISLAND_MAX.sx / 2;
  const cz = ISLAND_MAX.sz / 2;
  return { x0: cx - half, x1: cx + half, z0: cz - half, z1: cz + half };
}

/** True when a kid may build in cell (x, y, z): over an unlocked column, inside the grid. */
export function inBuildArea(expansions: number, x: number, y: number, z: number): boolean {
  const f = footprint(expansions);
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    Number.isInteger(z) &&
    x >= f.x0 &&
    x < f.x1 &&
    z >= f.z0 &&
    z < f.z1 &&
    y >= 0 &&
    y < ISLAND_MAX.sy
  );
}

const inFootprint = (f: Footprint, x: number, z: number): boolean =>
  x >= f.x0 && x < f.x1 && z >= f.z0 && z < f.z1;

// ---------------------------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------------------------

/** The island's seed: a stable hash of the profile id. */
export function islandSeed(profileId: string): number {
  return hashString(`island:${profileId}`);
}

/** Top-block height of the natural ground at grid column (x, z): BASE − 1 to BASE + 1. */
function groundHeight(x: number, z: number, seed: number): number {
  const n = fbm2(x / 14, z / 14, seed, 2);
  return BASE + Math.max(-1, Math.min(1, Math.round((n - 0.5) * 2.4)));
}

/** Fills column (x, z) from y = 0 to `h`: `deep`, then `subDepth` of `sub`, then `top`. */
function fillColumn(
  g: VoxelGrid,
  x: number,
  z: number,
  h: number,
  b: { top: number; sub: number; deep: number },
  subDepth: number,
): void {
  for (let y = 0; y <= h; y++) g.set(x, y, z, y === h ? b.top : y >= h - subDepth ? b.sub : b.deep);
}

/**
 * Writes a template anchored at column (ax, az). A voxel goes only into air, inside the grid,
 * below `maxY`, over a column `allowed` accepts; column-following voxels also need `onLand`.
 */
function placeTemplate(
  g: VoxelGrid,
  tpl: Template,
  ax: number,
  az: number,
  ground: (x: number, z: number) => number,
  allowed: (x: number, z: number) => boolean,
  onLand: (x: number, z: number) => boolean,
  maxY: number,
): void {
  const anchor = ground(ax, az);
  for (const v of tpl.voxels) {
    const x = ax + v.dx;
    const z = az + v.dz;
    if (!allowed(x, z)) continue;
    if (tpl.follow === "column" && !onLand(x, z)) continue;
    const y = (tpl.follow === "column" ? ground(x, z) : anchor) + 1 + v.dy;
    if (y >= maxY || g.get(x, y, z) !== 0) continue;
    g.set(x, y, z, v.block);
  }
}

/** Plot column kinds. */
const LAND = 0;
const CLEAR = 1;
const SHORE = 2;
const POND = 3;

/**
 * Writes the starter plot into `g` (all air in the plot's footprint). Uses the Meadow worldgen
 * recipe's blocks and sub depth, at a plot-sized layout of its own: `generateDiorama` needs at
 * least 32×21×40 and lays out a Mine stage, which the island doesn't want.
 */
function generatePlot(g: VoxelGrid, seed: number, blocks: IslandBlocks): void {
  const recipe = recipeFor("meadow");
  const B = recipe.blocks;
  const f = footprint(0);
  const rng = createRng(seed).fork("island:plot");
  const L = PLOT_SIZE.sx;
  const kind = new Uint8Array(L * L);
  const height = new Int32Array(L * L);
  const li = (x: number, z: number): number => x - f.x0 + L * (z - f.z0);

  // The pond goes in one corner; the trees in two of the others.
  const corners = rng.shuffle([0, 1, 2, 3]);
  const corner = (c: number): { x: number; z: number } => ({
    x: c % 2 === 0 ? TREE_MAX_REACH : L - 1 - TREE_MAX_REACH,
    z: c < 2 ? TREE_MAX_REACH : L - 1 - TREE_MAX_REACH,
  });
  const pond = corner(corners[0] ?? 0);
  const pondR = 2.2;
  for (let z = f.z0; z < f.z1; z++) {
    for (let x = f.x0; x < f.x1; x++) {
      const lx = x - f.x0;
      const lz = z - f.z0;
      const i = li(x, z);
      const d = ((lx - pond.x) ** 2 + (lz - pond.z) ** 2) / pondR ** 2;
      const clear = lx >= CLEARING.lo && lx < CLEARING.hi && lz >= CLEARING.lo && lz < CLEARING.hi;
      if (clear) {
        kind[i] = CLEAR;
        height[i] = BASE;
      } else if (d < 1) {
        kind[i] = POND;
        height[i] = BASE - 1;
      } else if (d < 1.9) {
        kind[i] = SHORE;
        height[i] = BASE;
      } else {
        height[i] = groundHeight(x, z, seed);
      }
    }
  }

  const top = needNum(blocks, B.top);
  const sub = needNum(blocks, B.sub);
  const deep = needNum(blocks, B.deep);
  const sand = needNum(blocks, B.shore);
  const bed = needNum(blocks, B.bed);
  const water = needNum(blocks, B.water);
  const subDepth = recipe.terrain.subDepth;
  for (let z = f.z0; z < f.z1; z++) {
    for (let x = f.x0; x < f.x1; x++) {
      const i = li(x, z);
      const k = kind[i];
      const h = height[i] ?? BASE;
      const wet = k === POND || k === SHORE;
      fillColumn(g, x, z, h, { top: k === POND ? bed : wet ? sand : top, sub, deep }, subDepth);
      if (k === POND) g.set(x, BASE, z, water);
    }
  }

  const ground = (x: number, z: number): number => height[li(x, z)] ?? BASE;
  const allowed = (x: number, z: number): boolean =>
    inFootprint(f, x, z) && kind[li(x, z)] !== CLEAR;
  const onLand = (x: number, z: number): boolean => allowed(x, z) && kind[li(x, z)] === LAND;
  const place = (tpl: Template, lx: number, lz: number): void =>
    placeTemplate(g, tpl, f.x0 + lx, f.z0 + lz, ground, allowed, onLand, PLOT_SIZE.sy);

  // Two trees, then a rock in the last corner, then flower patches around the edge.
  const treeBlocks = { log: needNum(blocks, B.log), leaves: needNum(blocks, B.leaves) };
  for (const c of corners.slice(1, 3)) {
    const at = corner(c);
    const variant = rng.pick(TREE_VARIANTS);
    place(oakTree(variant, treeBlocks, rng.fork(`tree:${c}`)), at.x, at.z);
  }
  const rocks = { stone: needNum(blocks, B.rock), mossy: needNum(blocks, B.mossyRock) };
  const rockAt = corner(corners[3] ?? 3);
  place(rockCluster(rocks, rng.fork("rock")), rockAt.x, rockAt.z);
  const flowers = B.flowers.map((id) => needNum(blocks, id));
  const flowerRng = rng.fork("flowers");
  for (let p = 0; p < 6; p++) {
    const lx = flowerRng.int(1, L - 2);
    const lz = flowerRng.int(1, L - 2);
    if (kind[lx + L * lz] !== LAND) continue;
    place(flowerPatch(flowers, flowerRng.fork(`patch:${p}`)), lx, lz);
  }
}

/** The blocks a ring of starter terrain uses. Block ids. */
export interface RingPalette {
  top: BlockId;
  sub: BlockId;
  deep: BlockId;
  rock: BlockId;
  mossyRock: BlockId;
  /** Sprigs scattered on the ring. May be empty. */
  flowers: readonly BlockId[];
  subDepth: number;
}

/**
 * The ring palette for a biome. A biome without a worldgen recipe yet uses the Meadow's
 * (`recipeFor`), and any block in the biome's recipe that the registry doesn't know falls back to
 * the Meadow's block for that slot, so a ring always generates.
 */
export function ringPalette(biome: BiomeId, blocks: IslandBlocks): RingPalette {
  const meadow = recipeFor("meadow").blocks;
  const r: DioramaRecipe = recipeFor(biome);
  const known = (id: BlockId): boolean => blocks.numOf(id) !== undefined;
  const pick = (id: BlockId, fallback: BlockId): BlockId => (known(id) ? id : fallback);
  const flowers = r.blocks.flowers.filter(known);
  return {
    top: pick(r.blocks.top, meadow.top),
    sub: pick(r.blocks.sub, meadow.sub),
    deep: pick(r.blocks.deep, meadow.deep),
    rock: pick(r.blocks.rock, meadow.rock),
    mossyRock: pick(r.blocks.mossyRock, meadow.mossyRock),
    flowers: flowers.length > 0 ? flowers : meadow.flowers.filter(known),
    subDepth: r.terrain.subDepth,
  };
}

/** Chance a ring column gets a sprig, and a rock. */
const RING_FLOWER_ODDS = 0.08;
const RING_ROCK_ODDS = 0.015;

/**
 * Writes ring `ring` (1-based) of starter terrain: ground from the shared height field in the
 * palette's blocks, with the odd sprig and rock on top. Only columns between footprint(ring − 1)
 * and footprint(ring) are touched, and only below {@link PLOT_SIZE}`.sy`.
 */
function generateRing(
  g: VoxelGrid,
  ring: number,
  biome: BiomeId,
  seed: number,
  blocks: IslandBlocks,
): void {
  const p = ringPalette(biome, blocks);
  const inner = footprint(ring - 1);
  const outer = footprint(ring);
  const layers = {
    top: needNum(blocks, p.top),
    sub: needNum(blocks, p.sub),
    deep: needNum(blocks, p.deep),
  };
  const flowers = p.flowers.map((id) => needNum(blocks, id));
  const rocks = [needNum(blocks, p.rock), needNum(blocks, p.mossyRock)];
  const rng: Rng = createRng(seed).fork(`island:ring:${ring}:${biome}`);
  for (let z = outer.z0; z < outer.z1; z++) {
    for (let x = outer.x0; x < outer.x1; x++) {
      if (inFootprint(inner, x, z)) continue;
      const h = groundHeight(x, z, seed);
      fillColumn(g, x, z, h, layers, p.subDepth);
      const r = rng.next();
      if (r < RING_ROCK_ODDS) g.set(x, h + 1, z, rng.pick(rocks));
      else if (r < RING_ROCK_ODDS + RING_FLOWER_ODDS && flowers.length > 0) {
        g.set(x, h + 1, z, rng.pick(flowers));
      }
    }
  }
}

/**
 * A new island for a profile: the starter plot in an otherwise empty {@link ISLAND_MAX} grid. The
 * same profile id always gives the same island.
 */
export function createIsland(profileId: string, blocks: IslandBlocks, now: EpochMs): IslandSave {
  const g = new VoxelGrid(ISLAND_MAX.sx, ISLAND_MAX.sy, ISLAND_MAX.sz);
  generatePlot(g, islandSeed(profileId), blocks);
  return { grid: g.toJSON(), expansions: 0, lastEdited: now };
}

// ---------------------------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------------------------

/**
 * One edit. Coordinates are grid cells.
 *
 * - `place`: puts one `block` from the inventory into an air cell.
 * - `remove`: takes the block out of a cell and puts it back in the inventory.
 * - `stamp`: writes a blueprint with its (0, 0, 0) at (x, y, z). Only the blueprint's non-air
 *   cells are written; its air leaves the island alone. A cell that already holds the same block
 *   is skipped (no cost). A cell holding a different block is replaced, and that block goes back
 *   to the inventory. Every written cell must be in the build area, or nothing is written. Refunds
 *   from replaced cells count toward the cost.
 */
export type IslandCommand =
  | { kind: "place"; x: number; y: number; z: number; block: BlockId }
  | { kind: "remove"; x: number; y: number; z: number }
  | { kind: "stamp"; x: number; y: number; z: number; blueprint: VoxelGrid };

/** Why an edit didn't happen. The island and inventory are unchanged. */
export type EditRefusal =
  /** A cell is outside the build area. */
  | "out-of-bounds"
  /** `place` into a cell that isn't air. */
  | "occupied"
  /** `remove` from an air cell. */
  | "empty"
  /** A block the registry doesn't know (in the command, the blueprint or the cell). */
  | "unknown-block"
  /** The inventory is short; `missing` says by how much. */
  | "not-enough"
  /** A stamp that would change no cell. */
  | "nothing-to-do";

/** Net inventory change of an edit, per block id. Positive is a refund, negative is spent. */
export type InventoryDelta = Readonly<Record<BlockId, number>>;

export type EditResult =
  | { ok: true; changed: number; delta: InventoryDelta }
  | { ok: false; reason: EditRefusal; missing?: Readonly<Record<BlockId, number>> };

/** An applied edit, as the undo stack keeps it. */
interface Applied {
  cells: number[];
  before: number[];
  after: number[];
  delta: Record<BlockId, number>;
}

/** A Home Island open for editing. It owns copies of the grid and the inventory. */
export interface IslandEditor {
  /** The live grid. Read it; change it only through {@link apply}. */
  readonly grid: VoxelGrid;
  /** As saved (the footprint clamps it to 0–{@link MAX_EXPANSIONS}). */
  readonly expansions: number;
  /** The unlocked columns. */
  readonly footprint: Footprint;
  /** Undo steps available (0–{@link UNDO_LIMIT}). */
  readonly undoDepth: number;
  /** True once anything changed since opening (or since the last {@link save}). */
  readonly dirty: boolean;
  /**
   * A copy of the inventory. Keys stay at 0 when a kid places their last block of a kind, so the
   * inventory screen still knows they own that kind.
   */
  inventory(): Record<BlockId, number>;
  /** What {@link apply} would do, without doing it. */
  preview(cmd: IslandCommand): EditResult;
  /** Applies an edit in full, or refuses it and changes nothing. */
  apply(cmd: IslandCommand): EditResult;
  /** Reverts the last applied edit, grid and inventory both. False when there is none. */
  undo(): boolean;
  /**
   * Adds the next ring, with `biome`'s starter terrain. False (and nothing changes) once the
   * footprint fills the grid. Not undoable, and it keeps the undo steps (they never touch ring
   * cells, which were outside the build area).
   */
  expand(biome: BiomeId): boolean;
  /** The save. `lastEdited` becomes `now` when anything changed, else stays as loaded. */
  save(now: EpochMs): IslandSave;
}

/**
 * Opens a saved island for editing. `inventory` is copied (pass `profile.inventory`; write
 * `editor.inventory()` back with the island). Throws `RangeError` on a malformed grid or one that
 * isn't {@link ISLAND_MAX} in size.
 */
export function openIsland(opts: {
  island: IslandSave;
  inventory: Readonly<Record<BlockId, number>>;
  blocks: IslandBlocks;
  profileId: string;
}): IslandEditor {
  const { blocks } = opts;
  const grid = VoxelGrid.fromJSON(opts.island.grid);
  if (grid.sx !== ISLAND_MAX.sx || grid.sy !== ISLAND_MAX.sy || grid.sz !== ISLAND_MAX.sz) {
    throw new RangeError(`island: grid is ${grid.sx}×${grid.sy}×${grid.sz}, expected 48×32×48`);
  }
  const seed = islandSeed(opts.profileId);
  const inv: Record<BlockId, number> = { ...opts.inventory };
  const stack: Applied[] = [];
  // Kept exactly as saved, so a save round-trips; the footprint clamps it.
  let expansions = opts.island.expansions;
  let lastEdited = opts.island.lastEdited;
  let dirty = false;
  const { sx, sz, data } = grid;
  const index = (x: number, y: number, z: number): number => x + sx * (z + sz * y);
  const have = (id: BlockId): number => inv[id] ?? 0;

  /** The cell changes and inventory delta of a command, or why it can't happen. */
  const plan = (cmd: IslandCommand): Applied | Exclude<EditResult, { ok: true }> => {
    const cells: number[] = [];
    const before: number[] = [];
    const after: number[] = [];
    const write = (x: number, y: number, z: number, n: number): void => {
      const i = index(x, y, z);
      cells.push(i);
      before.push(data[i] ?? 0);
      after.push(n);
    };
    if (cmd.kind === "place") {
      if (!inBuildArea(expansions, cmd.x, cmd.y, cmd.z))
        return { ok: false, reason: "out-of-bounds" };
      const n = blocks.numOf(cmd.block);
      if (n === undefined || n === 0) return { ok: false, reason: "unknown-block" };
      if (grid.get(cmd.x, cmd.y, cmd.z) !== 0) return { ok: false, reason: "occupied" };
      write(cmd.x, cmd.y, cmd.z, n);
    } else if (cmd.kind === "remove") {
      if (!inBuildArea(expansions, cmd.x, cmd.y, cmd.z))
        return { ok: false, reason: "out-of-bounds" };
      if (grid.get(cmd.x, cmd.y, cmd.z) === 0) return { ok: false, reason: "empty" };
      write(cmd.x, cmd.y, cmd.z, 0);
    } else {
      const bp = cmd.blueprint;
      for (let by = 0; by < bp.sy; by++) {
        for (let bz = 0; bz < bp.sz; bz++) {
          for (let bx = 0; bx < bp.sx; bx++) {
            const n = bp.get(bx, by, bz);
            if (n === 0) continue;
            const x = cmd.x + bx;
            const y = cmd.y + by;
            const z = cmd.z + bz;
            if (!inBuildArea(expansions, x, y, z)) return { ok: false, reason: "out-of-bounds" };
            if (blocks.idOf(n) === undefined) return { ok: false, reason: "unknown-block" };
            if (grid.get(x, y, z) !== n) write(x, y, z, n);
          }
        }
      }
      if (cells.length === 0) return { ok: false, reason: "nothing-to-do" };
    }
    const delta: Record<BlockId, number> = {};
    for (let k = 0; k < cells.length; k++) {
      const was = before[k] ?? 0;
      const now = after[k] ?? 0;
      if (was !== 0) {
        const id = blocks.idOf(was);
        if (id === undefined) return { ok: false, reason: "unknown-block" };
        delta[id] = (delta[id] ?? 0) + 1;
      }
      if (now !== 0) {
        const id = blocks.idOf(now);
        if (id === undefined) return { ok: false, reason: "unknown-block" };
        delta[id] = (delta[id] ?? 0) - 1;
      }
    }
    const missing: Record<BlockId, number> = {};
    let short = false;
    for (const [id, d] of Object.entries(delta)) {
      if (have(id) + d < 0) {
        missing[id] = -(have(id) + d);
        short = true;
      }
    }
    if (short) return { ok: false, reason: "not-enough", missing };
    return { cells, before, after, delta };
  };

  const result = (p: Applied): EditResult => ({
    ok: true,
    changed: p.cells.length,
    delta: { ...p.delta },
  });

  /** Writes `values` into `cells` and adds `sign × delta` to the inventory. */
  const commit = (p: Applied, values: number[], sign: 1 | -1): void => {
    for (let k = 0; k < p.cells.length; k++) data[p.cells[k] ?? 0] = values[k] ?? 0;
    for (const [id, d] of Object.entries(p.delta)) inv[id] = have(id) + sign * d;
    dirty = true;
  };

  return {
    grid,
    get expansions() {
      return expansions;
    },
    get footprint() {
      return footprint(expansions);
    },
    get undoDepth() {
      return stack.length;
    },
    get dirty() {
      return dirty;
    },
    inventory: () => ({ ...inv }),
    preview(cmd) {
      const p = plan(cmd);
      return "cells" in p ? result(p) : p;
    },
    apply(cmd) {
      const p = plan(cmd);
      if (!("cells" in p)) return p;
      commit(p, p.after, 1);
      stack.push(p);
      if (stack.length > UNDO_LIMIT) stack.shift();
      return result(p);
    },
    undo() {
      const p = stack.pop();
      if (!p) return false;
      commit(p, p.before, -1);
      return true;
    },
    expand(biome) {
      const done = clampExpansions(expansions);
      if (done >= MAX_EXPANSIONS) return false;
      expansions = done + 1;
      generateRing(grid, expansions, biome, seed, blocks);
      dirty = true;
      return true;
    },
    save(now) {
      if (dirty) lastEdited = now;
      dirty = false;
      return { grid: grid.toJSON(), expansions, lastEdited };
    },
  };
}

/** How many cells of each block id the grid holds (air left out). */
export function countBlocks(grid: VoxelGrid, blocks: IslandBlocks): Record<BlockId, number> {
  const counts = new Map<number, number>();
  for (const n of grid.data) if (n !== 0) counts.set(n, (counts.get(n) ?? 0) + 1);
  const out: Record<BlockId, number> = {};
  for (const [n, c] of counts) out[blocks.idOf(n) ?? `#${n}`] = c;
  return out;
}
