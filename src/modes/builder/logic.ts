/**
 * Builder's rules that need no renderer (task M4-07). Pure: the cursor, where `put` and `dig`
 * land, which way an arrow key points on screen, the camera's pose, the palette, and the list of
 * cells an undo has to redraw.
 *
 * **Compass.** North is −z, south is +z, east is +x, west is −x; up and down are y. The typed
 * directions always mean the island's own compass, whichever way the camera looks. The arrow keys
 * are the other way round: they follow the screen ({@link arrowDirection}), so "left" is always
 * left.
 */
import type { Footprint } from "@/engine/island";
import type { BlockId } from "@/types/core";
import type { Direction } from "./commands";

export interface Cell {
  x: number;
  y: number;
  z: number;
}

/** What the rules need to read from the island grid. */
export interface GridRead {
  readonly sy: number;
  get(x: number, y: number, z: number): number;
}

const STEP: Readonly<Record<Direction, Cell>> = {
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 },
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Moves the cursor up to `steps` cells and stops at the edge of the build area. `moved` is how
 * far it really went (0 at an edge).
 */
export function moveCursor(
  at: Cell,
  dir: Direction,
  steps: number,
  area: Footprint,
  height: number,
): { cell: Cell; moved: number } {
  const d = STEP[dir];
  const n = Math.max(0, Math.floor(steps));
  const cell = {
    x: clamp(at.x + d.x * n, area.x0, area.x1 - 1),
    y: clamp(at.y + d.y * n, 0, height - 1),
    z: clamp(at.z + d.z * n, area.z0, area.z1 - 1),
  };
  const moved = Math.abs(cell.x - at.x) + Math.abs(cell.y - at.y) + Math.abs(cell.z - at.z);
  return { cell, moved };
}

/** Where the cursor starts: the middle of the island, in the first free cell above the ground. */
export function startCursor(grid: GridRead, area: Footprint): Cell {
  const x = Math.floor((area.x0 + area.x1) / 2);
  const z = Math.floor((area.z0 + area.z1) / 2);
  let y = grid.sy - 1;
  while (y > 0 && grid.get(x, y - 1, z) === 0) y--;
  return { x, y, z };
}

/**
 * The cell `put` fills: the cursor's own cell when it is free, else the first free cell above it,
 * so `put put put` builds a tower. Null when the column is full to the top.
 */
export function putCell(grid: GridRead, at: Cell): Cell | null {
  for (let y = at.y; y < grid.sy; y++) {
    if (grid.get(at.x, y, at.z) === 0) return { x: at.x, y, z: at.z };
  }
  return null;
}

/**
 * The cell `dig` empties: the cursor's own cell when it holds a block, else the first block
 * under it, so `dig dig dig` digs a hole. Null when there is nothing in the column to dig.
 */
export function digCell(grid: GridRead, at: Cell): Cell | null {
  for (let y = at.y; y >= 0; y--) {
    if (grid.get(at.x, y, at.z) !== 0) return { x: at.x, y, z: at.z };
  }
  return null;
}

/**
 * True when the cursor's cell has a block somewhere above it: seen from above it is under the
 * ground (or under a roof), so the view draws it stronger to keep it findable.
 */
export function isBuried(grid: GridRead, at: Cell): boolean {
  for (let y = at.y + 1; y < grid.sy; y++) {
    if (grid.get(at.x, y, at.z) !== 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------------------------

/** The four views: quarter turns around the island. 0 looks north (−z), with east on the right. */
export type Quarter = 0 | 1 | 2 | 3;

export const turn = (q: Quarter, by: 1 | -1): Quarter => {
  const n = (((q + by) % 4) + 4) % 4;
  return n === 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : 0;
};

export type Arrow = "left" | "right" | "away" | "near";

/** Compass directions clockwise from north, as seen from above. */
const CLOCKWISE: readonly Direction[] = ["north", "east", "south", "west"];
const ARROW_TURNS: Readonly<Record<Arrow, number>> = { away: 0, right: 1, near: 2, left: 3 };

/**
 * The compass direction an arrow key moves the cursor in, for a view. In view 0 the camera looks
 * north, so "away" is north and "right" is east; each quarter turn of the camera to the right
 * turns that by one step.
 */
export function arrowDirection(arrow: Arrow, view: Quarter): Direction {
  return CLOCKWISE[(ARROW_TURNS[arrow] + view) % 4] ?? "north";
}

/** The direction at the top of the screen in a view: what "away" means. */
export const facing = (view: Quarter): Direction => arrowDirection("away", view);

export const ZOOM_MIN = 0;
export const ZOOM_MAX = 4;
export const ZOOM_START = 2;
/** Camera distance per zoom step, far to near. */
const DISTANCES = [58, 46, 36, 27, 19] as const;

/** A small offset from the straight-on view, so three faces of every block show. */
const YAW_OFFSET = (25 * Math.PI) / 180;
const PITCH = (38 * Math.PI) / 180;

export interface Pose {
  target: Cell;
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
}

/** The camera pose for a look-at point, a view and a zoom step. Yaw 0 sits on +z looking −z. */
export function cameraPose(target: Cell, view: Quarter, zoom: number): Pose {
  const z = clamp(Math.round(zoom), ZOOM_MIN, ZOOM_MAX);
  return {
    target: { ...target },
    // Turning the camera to the right (clockwise from above) lowers its yaw.
    yaw: YAW_OFFSET - (view * Math.PI) / 2,
    pitch: PITCH,
    distance: DISTANCES[z] ?? 36,
    fov: 35,
  };
}

/** How far the cursor may wander from the look-at point before the camera follows. */
export const FOLLOW_SLACK = { xz: 5, y: 3 } as const;

const pull = (t: number, c: number, slack: number): number =>
  c - t > slack ? c - slack : t - c > slack ? c + slack : t;

/**
 * The camera's look-at point after the cursor moved: unchanged while the cursor is within
 * {@link FOLLOW_SLACK} of it, else pulled just far enough to bring the cursor back inside. So the
 * world holds still for small moves and the cursor never leaves the middle of the screen.
 */
export function followTarget(target: Cell, cursor: Cell): Cell {
  return {
    x: pull(target.x, cursor.x, FOLLOW_SLACK.xz),
    y: pull(target.y, cursor.y, FOLLOW_SLACK.y),
    z: pull(target.z, cursor.z, FOLLOW_SLACK.xz),
  };
}

// ---------------------------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------------------------

export const PALETTE_SIZE = 6;

/**
 * The blocks the palette shows: the {@link PALETTE_SIZE} the player owns most of, most first.
 * Ties keep registry order. Blocks with none are left out.
 */
export function mostOwned(
  inventory: Readonly<Record<BlockId, number>>,
  placeable: readonly BlockId[],
  n: number = PALETTE_SIZE,
): BlockId[] {
  return placeable
    .map((id, i) => ({ id, i, count: inventory[id] ?? 0 }))
    .filter((b) => b.count > 0)
    .toSorted((a, b) => b.count - a.count || a.i - b.i)
    .slice(0, n)
    .map((b) => b.id);
}

/**
 * Keeps the palette steady while a child builds: blocks already shown stay in their slots while
 * they are still owned, and a free slot is filled by the most-owned block not yet shown. Without
 * this every `put` could reshuffle the slots under the child's eyes.
 *
 * Two blocks always get a slot (M4-FIX-1), even in a full palette, where they take the slot of
 * the last shown block that is neither of them:
 * - the block in hand (`held`), even at 0, so the child sees what ran out, and even when it was
 *   armed by name from outside the palette;
 * - the block just dug up (`picked`), so a child who digs a block they had none of sees it land
 *   in the bag. Without this a single grass block never outranks six kinds owned by the dozen.
 */
export function steadyPalette(
  shown: readonly BlockId[],
  inventory: Readonly<Record<BlockId, number>>,
  placeable: readonly BlockId[],
  n: number = PALETTE_SIZE,
  held: BlockId | null = null,
  picked: BlockId | null = null,
): BlockId[] {
  const must = [held, picked].filter(
    (id, i, all): id is BlockId => id !== null && placeable.includes(id) && all.indexOf(id) === i,
  );
  const kept = shown.filter((id) => id === held || (inventory[id] ?? 0) > 0).slice(0, n);
  for (const id of must.slice(0, n)) {
    if (kept.includes(id)) continue;
    if (kept.length < n) {
      kept.push(id);
      continue;
    }
    // Full: it takes the last slot that isn't held or picked, so the others don't move.
    const out = kept.findLastIndex((k) => !must.includes(k));
    if (out !== -1) kept[out] = id;
  }
  const rest = mostOwned(inventory, placeable, placeable.length).filter((id) => !kept.includes(id));
  return [...kept, ...rest].slice(0, n);
}

// ---------------------------------------------------------------------------------------------
// Redraw bookkeeping
// ---------------------------------------------------------------------------------------------

/** A box of cells, both corners included. */
export interface CellBox {
  min: Cell;
  max: Cell;
}

export const boxOfCell = (c: Cell): CellBox => ({ min: { ...c }, max: { ...c } });

/**
 * The boxes of the edits that can still be undone, newest last, kept in step with the island
 * editor's own undo stack (same limit). The editor says only that an undo happened; this says
 * which cells to redraw.
 */
export interface TouchLog {
  push(box: CellBox): void;
  pop(): CellBox | null;
  readonly size: number;
}

export function createTouchLog(limit: number): TouchLog {
  const boxes: CellBox[] = [];
  return {
    push(box) {
      boxes.push(box);
      if (boxes.length > limit) boxes.shift();
    },
    pop: () => boxes.pop() ?? null,
    get size() {
      return boxes.length;
    },
  };
}

/** A blueprint's origin so that it sits centered on the cursor's column, standing on its layer. */
export function stampOrigin(at: Cell, size: { sx: number; sz: number }): Cell {
  return { x: at.x - Math.floor(size.sx / 2), y: at.y, z: at.z - Math.floor(size.sz / 2) };
}
