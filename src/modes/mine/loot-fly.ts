/**
 * Loot flying to the hotbar (task M2-13, card: "items fly to the hotbar, DOM animation from the
 * projected point to the slot"). The schedule is the pure fly queue in `logic.ts`; this file only
 * draws it: one small pixel icon per flight, moved with a transform each frame.
 *
 * The layer is decoration: `aria-hidden`, ignores the pointer, and holds at most
 * {@link FLY_MAX} icons, which are reused. It writes styles only while something is in the air.
 * The landing spot is the kit hotbar's slot when a hotbar is on the page (M2-14's HUD), else the
 * middle of the bottom edge.
 */
import type { Atlas } from "@/render/atlas/build";
import { tileRect } from "@/render/atlas/build";
import type { BlockId, Ms } from "@/types/core";
import { FLY_MAX, flightPose } from "./logic";
import type { Flight } from "./logic";

/** Icon edge in CSS pixels, before `--text-scale`. */
const ICON_PX = 40;
const TILE_PX = 16;
/** The kit `Hotbar` root (`src/ui/kit/Hotbar.tsx`): a group that carries `data-lit`. */
export const HOTBAR_SELECTOR = '[role="group"][data-lit]';

export interface LootFlyOptions {
  canvas: HTMLCanvasElement;
  atlas(): Atlas | null;
}

export interface LootFly {
  /** Starts drawing a flight that leaves from `from` (CSS pixels on the page). */
  launch(flight: Flight, from: { x: number; y: number }): void;
  /** Places every icon for `nowMs` (the fly queue's clock). */
  frame(nowMs: Ms): void;
  /** A 16×16 picture of a block's side as a data URI ("" before an atlas exists), cached. */
  icon(block: BlockId): string;
  /** Drops the icon of a flight that landed. */
  land(id: number): void;
  readonly active: number;
  dispose(): void;
}

interface Sprite {
  el: HTMLCanvasElement;
  flight: Flight | null;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  aimed: boolean;
}

export function createLootFly(opts: LootFlyOptions): LootFly {
  const doc = opts.canvas.ownerDocument;
  const parent = opts.canvas.parentElement;
  let layer: HTMLDivElement | null = null;
  const sprites: Sprite[] = [];
  let active = 0;
  const icons = new Map<BlockId, string>();

  const ensureLayer = (): HTMLDivElement | null => {
    if (layer || !parent) return layer;
    const div = doc.createElement("div");
    div.className = "vt-mine-loot";
    div.setAttribute("aria-hidden", "true");
    Object.assign(div.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      overflow: "hidden",
      zIndex: "5",
    });
    parent.append(div);
    layer = div;
    return div;
  };

  const drawIcon = (el: HTMLCanvasElement, block: BlockId): void => {
    const ctx = el.getContext("2d");
    const atlas = opts.atlas();
    if (!ctx) return;
    ctx.clearRect(0, 0, TILE_PX, TILE_PX);
    if (!atlas) {
      ctx.fillStyle = "#9aa0a8";
      ctx.fillRect(0, 0, TILE_PX, TILE_PX);
      return;
    }
    const { x, y } = tileRect(atlas.canvas.width, atlas.tileOf(block, "side"));
    ctx.drawImage(atlas.canvas, x, y, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
  };

  const sprite = (): Sprite | null => {
    const free = sprites.find((s) => s.flight === null);
    if (free) return free;
    const host = ensureLayer();
    if (!host || sprites.length >= FLY_MAX) return null;
    const el = doc.createElement("canvas");
    el.width = TILE_PX;
    el.height = TILE_PX;
    Object.assign(el.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: `calc(${ICON_PX}px * var(--text-scale, 1))`,
      height: `calc(${ICON_PX}px * var(--text-scale, 1))`,
      imageRendering: "pixelated",
      outline: "3px solid rgba(20, 20, 24, 0.8)",
      willChange: "transform",
      display: "none",
    });
    host.append(el);
    const made: Sprite = { el, flight: null, fromX: 0, fromY: 0, toX: 0, toY: 0, aimed: false };
    sprites.push(made);
    return made;
  };

  /** The landing point: the center of the flight's hotbar slot, or the bottom middle. */
  const aim = (s: Sprite, slot: number): void => {
    const view = doc.defaultView;
    const w = view?.innerWidth ?? opts.canvas.clientWidth;
    const h = view?.innerHeight ?? opts.canvas.clientHeight;
    s.toX = w / 2;
    s.toY = h - 48;
    const cell = doc.querySelector(HOTBAR_SELECTOR)?.children.item(slot);
    const box = cell?.getBoundingClientRect();
    if (box && box.width > 0) {
      s.toX = box.left + box.width / 2;
      s.toY = box.top + box.height / 2;
    }
    s.aimed = true;
  };

  return {
    launch(flight, from) {
      const s = sprite();
      if (!s) return;
      s.flight = flight;
      s.fromX = from.x;
      s.fromY = from.y;
      s.aimed = false;
      drawIcon(s.el, flight.block);
      active++;
    },
    frame(nowMs) {
      if (active === 0) return;
      for (const s of sprites) {
        const f = s.flight;
        if (!f) continue;
        const pose = flightPose(f, nowMs);
        if (!pose.visible) continue;
        // Aim when the item leaves, so a hotbar that moved since the break is still hit.
        if (!s.aimed) aim(s, f.slot);
        const dx = s.toX - s.fromX;
        const dy = s.toY - s.fromY;
        const x = s.fromX + dx * pose.k;
        const y = s.fromY + dy * pose.k - Math.hypot(dx, dy) * pose.lift;
        s.el.style.display = "block";
        s.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${pose.scale.toFixed(3)})`;
      }
    },
    icon(block) {
      const cached = icons.get(block);
      if (cached !== undefined) return cached;
      if (!opts.atlas()) return "";
      const el = doc.createElement("canvas");
      el.width = TILE_PX;
      el.height = TILE_PX;
      drawIcon(el, block);
      const uri = el.toDataURL("image/png");
      icons.set(block, uri);
      return uri;
    },
    land(id) {
      const s = sprites.find((x) => x.flight?.id === id);
      if (!s) return;
      s.flight = null;
      s.el.style.display = "none";
      active = Math.max(0, active - 1);
    },
    get active() {
      return active;
    },
    dispose() {
      layer?.remove();
      layer = null;
      sprites.length = 0;
      active = 0;
    },
  };
}
