/**
 * Night Defense's word plates and shield bar (task M4-04): DOM over the canvas.
 *
 * Each mob carries its word on a plate above its head. The plates are DOM, so they are never
 * hidden by the scene, and their text is real text in `--font-body` (decision 68: typing targets
 * are never the pixel font). Where they go is decided by the pure `layoutPlates` pass, so no two
 * ever overlap; a thin stem ties a plate that was nudged away back to its mob.
 *
 * - Typed chars step back to a muted ink; the next char of the locked word has a thick bar under
 *   it, the only underline on the plate.
 * - The locked plate is bigger and has a bright double frame (the theme's focus ring), so the lock
 *   never relies on colour alone.
 * - A wrong key on the locked word makes its plate shake its head: a short transform animation,
 *   skipped under reduced motion. Nothing here blinks.
 *
 * The layer ignores the pointer and never takes focus. It measures a plate once when its word is
 * set (never per frame) and writes only transforms while mobs move.
 */
import { t } from "@/i18n";
import { PLATE_GAP, layoutPlates } from "./logic";
import type { PlateBounds, PlateWish } from "./logic";

/** How much bigger the locked plate is drawn. */
export const LOCKED_SCALE = 1.2;
/** The space kept between a mob's head and its plate, CSS pixels. */
const HEAD_GAP = 6;

/** One mob's plate for this frame. */
export interface PlateItem {
  id: string;
  word: string;
  /** Chars typed so far (the locked mob only). */
  typed: number;
  locked: boolean;
  /** Where the mob's head is on the page, CSS pixels. */
  x: number;
  y: number;
  /** Placement order: lower moves least (see `PlateWish.order`). */
  order: number;
}

export interface PlateLayerOptions {
  canvas: HTMLCanvasElement;
  reducedMotion(): boolean;
}

export interface PlateLayer {
  /** Shows exactly these plates, laid out inside `bounds`. Call once a frame. */
  sync(items: readonly PlateItem[], bounds: PlateBounds): void;
  /** A wrong key on this mob's word. */
  wobble(id: string): void;
  /** The shield bar: `level` of `max` segments full. */
  setShield(level: number, max: number, at: { left: number; top: number }): void;
  /** Plates on the page (for tests). */
  readonly count: number;
  dispose(): void;
}

interface Plate {
  el: HTMLDivElement;
  stem: HTMLDivElement;
  chars: HTMLSpanElement[];
  word: string;
  typed: number;
  locked: boolean;
  width: number;
  height: number;
  seen: boolean;
}

const FONT_SIZE = "min(calc(22px * var(--text-scale, 1)), 5.4dvh)";

export function createPlateLayer(opts: PlateLayerOptions): PlateLayer {
  const doc = opts.canvas.ownerDocument;
  const layer = doc.createElement("div");
  layer.className = "vt-defense-plates";
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    overflow: "hidden",
    zIndex: "4",
    fontFamily: "var(--font-body)",
    fontSize: FONT_SIZE,
    fontWeight: "700",
    lineHeight: "1.15",
  });
  opts.canvas.parentElement?.append(layer);

  const plates = new Map<string, Plate>();

  const paint = (p: Plate): void => {
    p.chars.forEach((span, i) => {
      const done = i < p.typed;
      const next = p.locked && i === p.typed;
      span.style.opacity = done ? "0.55" : "1";
      span.style.boxShadow = next ? "inset 0 -0.16em 0 currentColor" : "none";
    });
    p.el.style.boxShadow = p.locked
      ? "0 0 0 3px var(--c-focus), 0 0 0 6px var(--c-focus-halo)"
      : "0 0 0 2px rgb(0 0 0 / 0.45)";
    p.el.style.zIndex = p.locked ? "2" : "1";
    p.el.dataset["locked"] = p.locked ? "1" : "0";
    p.el.dataset["typed"] = String(p.typed);
  };

  const make = (item: PlateItem): Plate => {
    const el = doc.createElement("div");
    el.className = "vt-defense-plate";
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", t("defense.plate", { word: item.word }));
    el.dataset["word"] = item.word;
    Object.assign(el.style, {
      position: "absolute",
      left: "0",
      top: "0",
      padding: "0.12em 0.42em 0.2em",
      background: "var(--c-plate)",
      color: "var(--c-plate-text)",
      whiteSpace: "pre",
      letterSpacing: "0.04em",
      transformOrigin: "50% 50%",
      willChange: "transform",
    });
    const chars = Array.from(item.word).map((c) => {
      const span = doc.createElement("span");
      span.textContent = c;
      span.setAttribute("aria-hidden", "true");
      span.style.display = "inline-block";
      span.style.padding = "0 0.02em";
      el.append(span);
      return span;
    });
    const stem = doc.createElement("div");
    stem.setAttribute("aria-hidden", "true");
    Object.assign(stem.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "2px",
      background: "var(--c-plate)",
      transformOrigin: "50% 0",
      display: "none",
    });
    layer.append(stem, el);
    // Measured once. A page that can't lay out yet (hidden, or a test's DOM) gives 0: then a
    // size guessed from the word keeps the plate placed and apart from the others.
    const box = el.getBoundingClientRect();
    const p: Plate = {
      el,
      stem,
      chars,
      word: item.word,
      typed: -1,
      locked: false,
      width: box.width > 0 ? box.width : 20 + 14 * chars.length,
      height: box.height > 0 ? box.height : 32,
      seen: true,
    };
    return p;
  };

  // --- the shield bar ---
  const bar = doc.createElement("div");
  bar.className = "vt-defense-shield";
  bar.setAttribute("role", "img");
  Object.assign(bar.style, {
    position: "absolute",
    left: "0",
    top: "0",
    display: "none",
    alignItems: "center",
    gap: "0.4em",
    padding: "0.2em 0.5em",
    background: "var(--c-plate)",
    color: "var(--c-plate-text)",
    fontSize: "0.8em",
    boxShadow: "0 0 0 2px rgb(0 0 0 / 0.45)",
  });
  const barLabel = doc.createElement("span");
  barLabel.setAttribute("aria-hidden", "true");
  const barCells = doc.createElement("span");
  barCells.setAttribute("aria-hidden", "true");
  barCells.style.display = "inline-flex";
  barCells.style.gap = "0.18em";
  bar.append(barLabel, barCells);
  layer.append(bar);
  let barKey = "";

  return {
    sync(items, bounds) {
      for (const p of plates.values()) p.seen = false;
      const wishes: PlateWish[] = [];
      for (const item of items) {
        let p = plates.get(item.id);
        if (p === undefined || p.word !== item.word) {
          p?.el.remove();
          p?.stem.remove();
          p = make(item);
          plates.set(item.id, p);
        }
        p.seen = true;
        if (p.typed !== item.typed || p.locked !== item.locked) {
          p.typed = item.typed;
          p.locked = item.locked;
          paint(p);
        }
        const scale = p.locked ? LOCKED_SCALE : 1;
        wishes.push({
          id: item.id,
          x: item.x,
          y: item.y - HEAD_GAP,
          width: p.width * scale,
          height: p.height * scale,
          order: item.order,
        });
      }
      for (const [id, p] of plates) {
        if (p.seen) continue;
        p.el.remove();
        p.stem.remove();
        plates.delete(id);
      }
      const head = new Map(items.map((i) => [i.id, i]));
      for (const place of layoutPlates(wishes, bounds, PLATE_GAP)) {
        const p = plates.get(place.id);
        const at = head.get(place.id);
        if (p === undefined || at === undefined) continue;
        const scale = p.locked ? LOCKED_SCALE : 1;
        // The element keeps its own size; the scale grows it about its middle.
        const cx = place.left + place.width / 2;
        const cy = place.top + place.height / 2;
        p.el.style.transform = `translate3d(${(cx - p.width / 2).toFixed(1)}px, ${(cy - p.height / 2).toFixed(1)}px, 0) scale(${scale})`;
        // A stem from the plate's bottom middle to the mob, when the plate was moved away.
        const bottom = place.top + place.height;
        const dx = at.x - cx;
        const dy = at.y - bottom;
        const far = Math.hypot(dx, dy);
        if (dy > HEAD_GAP + 4 && far < 400) {
          p.stem.style.display = "block";
          p.stem.style.height = `${far.toFixed(1)}px`;
          p.stem.style.transform = `translate3d(${(cx - 1).toFixed(1)}px, ${bottom.toFixed(1)}px, 0) rotate(${(-Math.atan2(dx, dy)).toFixed(3)}rad)`;
        } else {
          p.stem.style.display = "none";
        }
      }
    },
    wobble(id) {
      const el = plates.get(id)?.el;
      if (el === undefined || opts.reducedMotion() || typeof el.animate !== "function") return;
      // `translate` is its own property, so it adds to the plate's transform.
      el.animate(
        [
          { translate: "0 0" },
          { translate: "-5px 0" },
          { translate: "5px 0" },
          { translate: "-3px 0" },
          { translate: "0 0" },
        ],
        { duration: 260, easing: "ease-out" },
      );
    },
    setShield(level, max, at) {
      const key = `${level}/${max}`;
      if (key !== barKey) {
        barKey = key;
        bar.setAttribute("aria-label", t("defense.shieldLabel", { count: level, max }));
        barLabel.textContent = t("defense.shield");
        barCells.replaceChildren(
          ...Array.from({ length: max }, (_, i) => {
            const cell = doc.createElement("span");
            const full = i < level;
            Object.assign(cell.style, {
              display: "inline-block",
              width: "0.7em",
              height: "0.9em",
              boxSizing: "border-box",
              // Full and empty differ by shape, not only colour: a solid block or a dashed outline.
              background: full ? "var(--c-accent)" : "transparent",
              border: full ? "2px solid var(--c-accent-edge)" : "2px dashed currentColor",
              opacity: full ? "1" : "0.6",
            });
            return cell;
          }),
        );
      }
      bar.style.display = "flex";
      bar.style.transform = `translate3d(${Math.round(at.left)}px, ${Math.round(at.top)}px, 0)`;
    },
    get count() {
      return plates.size;
    },
    dispose() {
      layer.remove();
      plates.clear();
    },
  };
}
