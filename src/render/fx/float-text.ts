/**
 * Float text (task M2-05): short DOM labels ("+1", a letter) pinned to a world point. DOM text
 * stays crisp at any pixel ratio and uses the UI kit's fonts and plate colors (M2-07, M2-08).
 *
 * - The overlay sits over the canvas, ignores the pointer and is `aria-hidden`: float text is
 *   decoration, the HUD carries the information.
 * - A single letter uses `--font-body` (Atkinson Hyperlegible), because Pixelify Sans mirrors
 *   b/d and p/q (M2-08). Longer text uses `--font-pixel`.
 * - Text goes in with `textContent`, never as HTML. Callers pass kid-facing text through `t()`.
 * - Normal: pops in (squash-and-stretch), rises and fades. Reduced motion: fades in and out in
 *   place, no rise and no scaling.
 * - At most {@link MAX_FLOAT_TEXTS} show at once; a new one reuses the oldest element.
 */
import * as THREE from "three";
import type { Ms } from "@/types/core";
import type { Vec3 } from "../types";
import {
  FLOAT_FADE_START,
  FLOAT_LIFE,
  FLOAT_LIFE_REDUCED,
  FLOAT_RISE_PX,
  MAX_FLOAT_TEXTS,
  POP_FROM,
  POP_IN,
  POP_PEAK,
  POP_SETTLE,
  REDUCED_FADE_IN,
} from "./tuning";

export interface FloatTextLayer {
  /** Shows `text` at `at`. Returns false when the canvas has no parent to hold the overlay. */
  add(at: Vec3, text: string, opts: { color?: string; reduced: boolean }): boolean;
  /** Ages and places every label. Returns true while any label is showing. */
  step(dtMs: Ms): boolean;
  readonly active: number;
  /** The overlay element, once created (tests). */
  readonly overlay: HTMLDivElement | null;
  dispose(): void;
}

interface Label {
  el: HTMLSpanElement;
  at: THREE.Vector3;
  age: Ms;
  life: Ms;
  reduced: boolean;
  on: boolean;
  /** Order of creation, to find the oldest. */
  serial: number;
}

let graphemes: Intl.Segmenter | null = null;

/** True when `text` is one letter or digit, which must use the body font (M2-08). */
export function isSingleGlyph(text: string): boolean {
  graphemes ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let n = 0;
  for (const _ of graphemes.segment(text.trim())) if (++n > 1) return false;
  return n === 1;
}

/** Label opacity and scale at `t` (0–1 through its life). Pure, for tests. */
export function labelLook(
  t: number,
  reduced: boolean,
): { opacity: number; scale: number; rise: number } {
  const u = Math.min(1, Math.max(0, t));
  const fadeOut = u <= FLOAT_FADE_START ? 1 : 1 - (u - FLOAT_FADE_START) / (1 - FLOAT_FADE_START);
  if (reduced) {
    const fadeIn = Math.min(1, u / REDUCED_FADE_IN);
    return { opacity: Math.min(fadeIn, fadeOut), scale: 1, rise: 0 };
  }
  let scale = 1;
  if (u < POP_IN) scale = POP_FROM + ((POP_PEAK - POP_FROM) * u) / POP_IN;
  else if (u < POP_SETTLE)
    scale = POP_PEAK + ((1 - POP_PEAK) * (u - POP_IN)) / (POP_SETTLE - POP_IN);
  // Ease-out rise: quick at first, then slowing.
  const rise = FLOAT_RISE_PX * (1 - (1 - u) * (1 - u));
  return { opacity: fadeOut, scale, rise };
}

/** The UI kit font tokens (M2-07), with the same stacks as fallbacks for pages without tokens.css. */
export const FONT_BODY = 'var(--font-body, "Atkinson Hyperlegible", system-ui, sans-serif)';
export const FONT_PIXEL = 'var(--font-pixel, "Pixelify Sans", ui-monospace, monospace)';

const LABEL_STYLE: Partial<Record<string, string>> = {
  position: "absolute",
  left: "0",
  top: "0",
  padding: "2px 10px",
  background: "var(--c-plate, rgba(20, 20, 24, 0.8))",
  color: "var(--c-plate-text, #ffffff)",
  fontSize: "calc(var(--fs-lg, 1.625rem) * var(--text-scale, 1))",
  fontWeight: "700",
  lineHeight: "1.2",
  whiteSpace: "nowrap",
  willChange: "transform, opacity",
  display: "none",
};

export function createFloatTextLayer(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
): FloatTextLayer {
  let overlay: HTMLDivElement | null = null;
  const labels: Label[] = [];
  let active = 0;
  let serial = 0;
  const v = new THREE.Vector3();

  const ensureOverlay = (): HTMLDivElement | null => {
    if (overlay) return overlay;
    const parent = canvas.parentElement;
    if (!parent) return null;
    const doc = canvas.ownerDocument;
    const div = doc.createElement("div");
    div.className = "vt-fx-text";
    div.setAttribute("aria-hidden", "true");
    Object.assign(div.style, {
      position: "absolute",
      pointerEvents: "none",
      overflow: "hidden",
      contain: "layout paint",
    });
    canvas.after(div);
    overlay = div;
    return div;
  };

  const place = (div: HTMLDivElement): void => {
    // The overlay shares the canvas's offset parent, so offsetLeft/Top line it up exactly.
    div.style.left = `${canvas.offsetLeft}px`;
    div.style.top = `${canvas.offsetTop}px`;
    div.style.width = `${canvas.clientWidth}px`;
    div.style.height = `${canvas.clientHeight}px`;
  };

  const show = (label: Label): void => {
    const t = label.life > 0 ? label.age / label.life : 1;
    const look = labelLook(t, label.reduced);
    v.copy(label.at).project(camera);
    const { el } = label;
    if (v.z > 1 || v.z < -1) {
      el.style.display = "none";
      return;
    }
    const x = (v.x * 0.5 + 0.5) * canvas.clientWidth;
    const y = (-v.y * 0.5 + 0.5) * canvas.clientHeight - look.rise;
    el.style.display = "block";
    el.style.opacity = look.opacity.toFixed(3);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${look.scale.toFixed(3)})`;
  };

  return {
    add(at, text, opts) {
      const div = ensureOverlay();
      if (!div) return false;
      let label = labels.find((l) => !l.on);
      if (!label && labels.length < MAX_FLOAT_TEXTS) {
        const el = canvas.ownerDocument.createElement("span");
        Object.assign(el.style, LABEL_STYLE);
        div.append(el);
        label = {
          el,
          at: new THREE.Vector3(),
          age: 0,
          life: 0,
          reduced: false,
          on: false,
          serial: 0,
        };
        labels.push(label);
      }
      if (!label) {
        // Full: reuse the oldest.
        label = labels.reduce((a, b) => (b.serial < a.serial ? b : a));
      }
      if (!label.on) active++;
      label.on = true;
      label.serial = serial++;
      label.at.set(at.x, at.y, at.z);
      label.age = 0;
      label.reduced = opts.reduced;
      label.life = opts.reduced ? FLOAT_LIFE_REDUCED : FLOAT_LIFE;
      label.el.textContent = text;
      label.el.style.fontFamily = isSingleGlyph(text) ? FONT_BODY : FONT_PIXEL;
      label.el.style.color = opts.color ?? "var(--c-plate-text, #ffffff)";
      place(div);
      camera.updateMatrixWorld();
      show(label);
      return true;
    },
    step(dtMs) {
      if (active === 0 || !overlay) return false;
      place(overlay);
      // The rig moved the camera this frame; three only refreshes its matrices at render time.
      camera.updateMatrixWorld();
      for (const label of labels) {
        if (!label.on) continue;
        label.age += dtMs;
        if (label.age >= label.life) {
          label.on = false;
          label.el.style.display = "none";
          active--;
          continue;
        }
        show(label);
      }
      return active > 0;
    },
    get active() {
      return active;
    },
    get overlay() {
      return overlay;
    },
    dispose() {
      overlay?.remove();
      overlay = null;
      labels.length = 0;
      active = 0;
    },
  };
}
