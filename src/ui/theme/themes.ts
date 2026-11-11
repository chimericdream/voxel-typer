/**
 * UI themes (PLAN.md §5.1, §4.6; task M2-07): warm day, cool night and high contrast.
 *
 * This file is the single source of every UI color. `applyTheme` writes them onto an element as
 * CSS custom properties (`--c-<token>`), together with the 9-slice bevel images from `bevel.ts`
 * (`--bevel-<surface>`, `--bevel-<surface>-pressed`). `tokens.css` holds everything that doesn't
 * change between themes (spacing, type scale, fonts, focus ring size).
 *
 * Colors come from the texture palette ramps (`BASE_PALETTE`, dark to light), so the UI and the
 * world share one palette. `TEXT_PAIRS` lists every foreground/background pair the kit uses for
 * text; `tests/unit/ui/kit.test.tsx` checks each one is at least 4.5:1 (WCAG AA) in every theme.
 */
import { bevelDataUri } from "@/ui/kit/bevel";
import type { BevelKind } from "@/ui/kit/bevel";
import { parseHex } from "@/render/atlas/painters";
import { BASE_PALETTE } from "@/render/atlas/palettes";
import type { PaletteRampId } from "@/render/atlas/recipes";
import type { TimeOfDay } from "@/types/core";

export const THEME_IDS = ["day", "night", "contrast"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** Bevelled surfaces. Each gets a face color token and a 9-slice bevel image. */
export const SURFACE_IDS = [
  "panel",
  "button",
  "primary",
  "slot",
  "keycap",
  "toastInfo",
  "toastCheer",
  "track",
] as const;
export type SurfaceId = (typeof SURFACE_IDS)[number];

/** The four colors of a bevel: outer outline, shadow edge, face, highlight edge. */
export interface Surface {
  outline: string;
  shadow: string;
  face: string;
  highlight: string;
}

/** Colors that aren't bevelled surfaces: text, plates, rings and fills. */
export const INK_IDS = [
  /** The page or scene behind everything (dev pages and menus without a 3D scene). */
  "bg",
  "bgText",
  /** Body text and secondary text on panels and slots. */
  "text",
  "textMuted",
  /** The semi-opaque plate under any text drawn over the 3D scene, and its text. */
  "plate",
  "plateText",
  "buttonText",
  "primaryText",
  "keycapText",
  "toastInfoText",
  "toastCheerText",
  /** Slot count badges. */
  "badge",
  "badgeText",
  /** Filled progress blocks, lit hotbar slots and stars. */
  "accent",
  "accentEdge",
  /** Focus ring: a thick `focus` ring around a thin `focusHalo` ring, so it shows on any color. */
  "focus",
  "focusHalo",
  /** The outline of a selected slot or tab. */
  "selected",
  /**
   * On-screen keyboard finger zones (task M2-09), one per finger type: the key faces behind
   * `keycapText`. Each zone also has its own pattern (`src/ui/keyboard/`), drawn in `zonePattern`,
   * a semi-opaque shade laid over the zone color, so color is never the only cue.
   */
  "zonePinky",
  "zoneRing",
  "zoneMiddle",
  "zoneIndex",
  "zoneThumb",
  "zonePattern",
] as const;
export type InkId = (typeof INK_IDS)[number];

export type ColorToken = SurfaceId | InkId;

export interface Theme {
  id: ThemeId;
  colorScheme: "light" | "dark";
  surfaces: Readonly<Record<SurfaceId, Surface>>;
  ink: Readonly<Record<InkId, string>>;
}

/** A color from the texture palette: ramp name and index (0 = darkest). */
function p(ramp: PaletteRampId, index: number): string {
  const c = BASE_PALETTE[ramp]?.[index];
  if (!c) throw new Error(`no palette color ${ramp}[${index}]`);
  return c;
}

const WHITE = "#ffffff";
const BLACK = "#000000";

const DAY: Theme = {
  id: "day",
  colorScheme: "light",
  surfaces: {
    // Parchment-and-oak panels.
    panel: {
      outline: p("oak-bark", 1),
      shadow: p("birch", 1),
      face: p("birch", 4),
      highlight: p("wool-white", 4),
    },
    button: {
      outline: p("oak-bark", 1),
      shadow: p("sand", 0),
      face: p("sand", 3),
      highlight: p("wool-white", 4),
    },
    primary: {
      outline: p("grass", 0),
      shadow: p("leaf", 0),
      face: p("grass", 1),
      highlight: p("grass", 3),
    },
    slot: {
      outline: p("oak-bark", 1),
      shadow: p("slate", 1),
      face: p("stone", 1),
      highlight: p("stone", 3),
    },
    keycap: {
      outline: p("stone", 0),
      shadow: p("mortar", 2),
      face: p("wool-white", 3),
      highlight: WHITE,
    },
    toastInfo: {
      outline: p("oak-bark", 1),
      shadow: p("birch", 1),
      face: p("birch", 4),
      highlight: p("wool-white", 4),
    },
    toastCheer: {
      outline: p("grass", 0),
      shadow: p("leaf", 0),
      face: p("grass", 1),
      highlight: p("grass", 3),
    },
    track: {
      outline: p("oak-bark", 1),
      shadow: p("slate", 0),
      face: p("stone", 0),
      highlight: p("stone", 2),
    },
  },
  ink: {
    bg: p("water", 4),
    bgText: p("wool-black", 0),
    text: p("wool-brown", 0),
    textMuted: p("oak", 0),
    plate: "rgba(20, 20, 24, 0.8)",
    plateText: WHITE,
    buttonText: p("wool-brown", 0),
    primaryText: WHITE,
    keycapText: p("wool-black", 0),
    toastInfoText: p("wool-brown", 0),
    toastCheerText: WHITE,
    badge: p("wool-black", 0),
    badgeText: WHITE,
    accent: p("ore-amber", 3),
    accentEdge: p("ore-amber", 0),
    focus: p("wool-blue", 0),
    focusHalo: WHITE,
    selected: p("ore-amber", 4),
    zonePinky: p("wool-pink", 4),
    zoneRing: p("wool-cyan", 4),
    zoneMiddle: p("wool-lime", 4),
    zoneIndex: p("ore-amber", 4),
    zoneThumb: p("ore-moon", 4),
    zonePattern: "rgba(20, 20, 24, 0.22)",
  },
};

const NIGHT: Theme = {
  id: "night",
  colorScheme: "dark",
  surfaces: {
    // Slate panels, moonlit edges.
    panel: {
      outline: p("wool-black", 0),
      shadow: p("slate", 0),
      face: p("slate", 2),
      highlight: p("slate", 4),
    },
    button: {
      outline: p("wool-black", 0),
      shadow: p("water", 0),
      face: p("water", 1),
      highlight: p("water", 3),
    },
    primary: {
      outline: p("wool-black", 0),
      shadow: p("ore-gem", 0),
      face: p("ore-gem", 1),
      highlight: p("ore-gem", 3),
    },
    slot: {
      outline: p("wool-black", 0),
      shadow: p("wool-black", 1),
      face: p("slate", 1),
      highlight: p("slate", 3),
    },
    keycap: {
      outline: p("wool-black", 0),
      shadow: p("ore-moon", 2),
      face: p("snow", 1),
      highlight: WHITE,
    },
    toastInfo: {
      outline: p("wool-black", 0),
      shadow: p("slate", 0),
      face: p("slate", 2),
      highlight: p("slate", 4),
    },
    toastCheer: {
      outline: p("wool-black", 0),
      shadow: p("ore-gem", 0),
      face: p("ore-gem", 1),
      highlight: p("ore-gem", 3),
    },
    track: {
      outline: p("wool-black", 0),
      shadow: p("wool-black", 1),
      face: p("slate", 0),
      highlight: p("slate", 2),
    },
  },
  ink: {
    bg: p("slate", 0),
    bgText: p("snow", 3),
    text: p("snow", 3),
    textMuted: p("ore-moon", 4),
    plate: "rgba(20, 20, 24, 0.8)",
    plateText: WHITE,
    buttonText: WHITE,
    primaryText: WHITE,
    keycapText: p("wool-black", 0),
    toastInfoText: p("snow", 3),
    toastCheerText: WHITE,
    badge: p("wool-black", 0),
    badgeText: WHITE,
    accent: p("spark", 3),
    accentEdge: p("spark", 0),
    focus: p("spark", 4),
    focusHalo: BLACK,
    selected: p("spark", 4),
    zonePinky: p("wool-pink", 4),
    zoneRing: p("wool-cyan", 4),
    zoneMiddle: p("wool-lime", 3),
    zoneIndex: p("spark", 3),
    zoneThumb: p("ore-moon", 3),
    zonePattern: "rgba(20, 20, 24, 0.24)",
  },
};

const CONTRAST: Theme = {
  id: "contrast",
  colorScheme: "dark",
  surfaces: {
    // Black faces, white edges; the shadow edge is grey so the bevel still reads.
    panel: { outline: WHITE, shadow: "#767676", face: BLACK, highlight: WHITE },
    button: { outline: WHITE, shadow: "#767676", face: BLACK, highlight: WHITE },
    primary: { outline: WHITE, shadow: p("spark", 2), face: p("spark", 4), highlight: WHITE },
    slot: { outline: WHITE, shadow: WHITE, face: BLACK, highlight: "#767676" },
    keycap: { outline: WHITE, shadow: "#767676", face: WHITE, highlight: WHITE },
    toastInfo: { outline: WHITE, shadow: "#767676", face: BLACK, highlight: WHITE },
    toastCheer: { outline: WHITE, shadow: p("spark", 2), face: p("spark", 4), highlight: WHITE },
    track: { outline: WHITE, shadow: WHITE, face: BLACK, highlight: "#767676" },
  },
  ink: {
    bg: BLACK,
    bgText: WHITE,
    text: WHITE,
    textMuted: WHITE,
    plate: "rgba(0, 0, 0, 0.9)",
    plateText: WHITE,
    buttonText: WHITE,
    primaryText: BLACK,
    keycapText: BLACK,
    toastInfoText: WHITE,
    toastCheerText: BLACK,
    badge: WHITE,
    badgeText: BLACK,
    accent: p("wool-cyan", 4),
    accentEdge: WHITE,
    focus: p("spark", 4),
    focusHalo: BLACK,
    selected: p("wool-cyan", 4),
    zonePinky: p("wool-pink", 4),
    zoneRing: p("wool-cyan", 4),
    zoneMiddle: p("wool-lime", 4),
    zoneIndex: p("wool-yellow", 4),
    zoneThumb: WHITE,
    zonePattern: "rgba(0, 0, 0, 0.3)",
  },
};

export const THEMES: Readonly<Record<ThemeId, Theme>> = {
  day: DAY,
  night: NIGHT,
  contrast: CONTRAST,
};

/**
 * Every [text, background] pair the kit draws text with. Text must reach 4.5:1 on each. A `plate`
 * background is semi-opaque, so the test checks it composited over both black and white (any 3D
 * scene lies between them).
 */
export const TEXT_PAIRS: readonly (readonly [fg: InkId, bg: ColorToken])[] = [
  ["bgText", "bg"],
  ["text", "panel"],
  ["textMuted", "panel"],
  ["plateText", "plate"],
  ["buttonText", "button"],
  ["primaryText", "primary"],
  ["keycapText", "keycap"],
  ["toastInfoText", "toastInfo"],
  ["toastCheerText", "toastCheer"],
  ["badgeText", "badge"],
  // On-screen keyboard (M2-09): key glyphs on every finger zone. The zone pattern laid over each
  // zone is checked in tests/unit/ui/keyboard.test.tsx.
  ["keycapText", "zonePinky"],
  ["keycapText", "zoneRing"],
  ["keycapText", "zoneMiddle"],
  ["keycapText", "zoneIndex"],
  ["keycapText", "zoneThumb"],
];

/**
 * Pairs that carry meaning without text (WCAG 1.4.11): they must reach 3:1. The focus ring is
 * checked separately: one of its two rings must reach 3:1 on each surface it can sit on.
 */
export const UI_PAIRS: readonly (readonly [a: ColorToken, b: ColorToken])[] = [
  ["accent", "track"],
  ["selected", "slot"],
  ["focus", "focusHalo"],
  // On-screen keyboard (M2-09): the next-key ring is two-tone, `selected` outside (on the
  // keyboard's text plate) and `keycapText` inside (on the zone faces, checked as TEXT_PAIRS).
  ["selected", "plate"],
  ["selected", "keycapText"],
];

/** Surfaces a focused control can sit on (the focus ring is drawn outside the control). */
export const FOCUS_BACKDROPS: readonly ColorToken[] = ["bg", "panel", "plate", "slot"];

/** The color of a token in a theme. */
export function colorOf(theme: Theme, token: ColorToken): string {
  return isSurface(token) ? theme.surfaces[token].face : theme.ink[token];
}

export function isSurface(token: ColorToken): token is SurfaceId {
  return SURFACE_IDS.some((s) => s === token);
}

// ---- WCAG contrast ----

export type Rgba = readonly [r: number, g: number, b: number, a: number];

const RGBA = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/;

/** Parses `#rgb`, `#rrggbb` or `rgba(r, g, b, a)`. */
export function parseColor(color: string): Rgba {
  const m = RGBA.exec(color);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  const [r, g, b] = parseHex(color);
  return [r, g, b, 1];
}

/** `top` drawn over the opaque color `under`. */
export function composite(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + under[0] * (1 - a),
    top[1] * a + under[1] * (1 - a),
    top[2] * a + under[2] * (1 - a),
    1,
  ];
}

/** An sRGB channel (0–255) as linear light (0–1). */
function lin(v: number): number {
  const s = v / 255;
  return s <= 0.040_45 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an opaque color. */
export function luminance(c: Rgba): number {
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** WCAG contrast ratio, 1–21. Both colors must be opaque (composite first). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The lowest contrast of `fg` on `bg`. A semi-opaque `bg` is checked over black and over white.
 */
export function worstContrast(fg: string, bg: string): number {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const unders: Rgba[] =
    b[3] < 1 ? [composite(b, [0, 0, 0, 1]), composite(b, [255, 255, 255, 1])] : [b];
  return Math.min(...unders.map((u) => contrastRatio(f[3] < 1 ? composite(f, u) : f, u)));
}

// ---- Applying a theme ----

/** Which surfaces are drawn raised, and which sunk in. */
const SURFACE_KIND: Readonly<Record<SurfaceId, BevelKind>> = {
  panel: "raised",
  button: "raised",
  primary: "raised",
  slot: "inset",
  keycap: "raised",
  toastInfo: "raised",
  toastCheer: "raised",
  track: "inset",
};

/** The pressed look of a surface: raised surfaces press in; inset ones stay inset. */
const PRESSED_KIND: Readonly<Record<BevelKind, BevelKind>> = {
  raised: "pressed",
  pressed: "pressed",
  inset: "inset",
};

/** `--c-<token>` in kebab case: `toastInfoText` → `--c-toast-info-text`. */
export function cssVar(token: ColorToken): string {
  return `--c-${token.replaceAll(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** `--bevel-<surface>` in kebab case. */
export function bevelVar(surface: SurfaceId, pressed = false): string {
  const name = surface.replaceAll(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return `--bevel-${name}${pressed ? "-pressed" : ""}`;
}

/** The custom properties a theme sets, as [name, value] pairs. */
export function themeProperties(theme: Theme): [name: string, value: string][] {
  const out: [string, string][] = [];
  for (const id of SURFACE_IDS) {
    const s = theme.surfaces[id];
    out.push([cssVar(id), s.face], [`${cssVar(id)}-outline`, s.outline]);
    const kind = SURFACE_KIND[id];
    const raised = bevelDataUri({ ...s, kind });
    const pressed = bevelDataUri({ ...s, kind: PRESSED_KIND[kind] });
    // No canvas (tests, very old browsers): leave the vars unset; CSS falls back to flat borders.
    if (raised) out.push([bevelVar(id), `url("${raised}")`]);
    if (pressed) out.push([bevelVar(id, true), `url("${pressed}")`]);
  }
  for (const id of INK_IDS) out.push([cssVar(id), theme.ink[id]]);
  return out;
}

/**
 * Applies a theme to `el` and everything inside it: sets `data-theme`, `color-scheme` and every
 * color and bevel custom property. Bevel images are made once per theme and cached (`bevel.ts`).
 */
export function applyTheme(el: HTMLElement, id: ThemeId): void {
  const theme = THEMES[id];
  el.dataset["theme"] = id;
  el.style.colorScheme = theme.colorScheme;
  for (const [name, value] of themeProperties(theme)) el.style.setProperty(name, value);
}

/**
 * The theme for the current settings and scene time. High contrast wins; otherwise dusk and night
 * use the cool night theme, dawn and day the warm one.
 */
export function themeFor(highContrast: boolean, tod: TimeOfDay): ThemeId {
  if (highContrast) return "contrast";
  return tod === "night" || tod === "dusk" ? "night" : "day";
}

/** Sets `--text-scale` (the settings' 1.0–2.0 letter size) on `el`. Out-of-range values clamp. */
export function applyTextScale(el: HTMLElement, scale: number): void {
  const s = Number.isFinite(scale) ? Math.min(2, Math.max(1, scale)) : 1;
  el.style.setProperty("--text-scale", String(s));
}

/**
 * Reduced motion (PLAN.md §4.6). `true` or `false` overrides the system; `'system'` follows
 * `prefers-reduced-motion` (tokens.css handles the media query). Sets `data-motion` on `el`.
 */
export function applyMotion(el: HTMLElement, reducedMotion: boolean | "system"): void {
  if (reducedMotion === "system") delete el.dataset["motion"];
  else el.dataset["motion"] = reducedMotion ? "reduced" : "full";
}
