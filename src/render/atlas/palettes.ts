/**
 * Palettes: every color ramp the textures use, and each biome's variant of them (PLAN.md §5.1,
 * docs/impl/contracts.md §8.3). Pure by construction: data plus math, no DOM, no clock, no
 * randomness.
 *
 * Every color here was picked for this game. Ramps run dark to light, 4–6 colors each.
 */
import type { BiomeId } from "@/types/core";
import { parseHex, toHex } from "./painters";
import type { Rgb } from "./painters";
import { PALETTE_RAMP_IDS } from "./recipes";
import type { Palette, PaletteRampId } from "./recipes";

/** The default palette (Meadow, daytime). */
export const BASE_PALETTE: Palette = {
  grass: ["#2f5a1f", "#3f7a2a", "#55962f", "#6fb13a", "#8fcb4f"],
  leaf: ["#1f4a22", "#2c6230", "#3c7c3a", "#52984a", "#6db35c"],
  moss: ["#2e4a26", "#3f6233", "#557b41", "#6d9550", "#88ae64"],
  dirt: ["#4a2f1e", "#63402a", "#7c5336", "#966a46", "#ad8259"],
  mud: ["#2e241c", "#3e3126", "#504032", "#64513f", "#78644f"],
  clay: ["#6b4a44", "#85605a", "#9e7a72", "#b6948b", "#ccaea4"],
  sand: ["#b89a5e", "#ccb06f", "#dcc382", "#e8d49a", "#f2e3b6"],
  gravel: ["#4d4a47", "#64605c", "#7c7772", "#958f89", "#aea8a1"],
  snow: ["#b9c8d6", "#cfdbe6", "#e1eaf2", "#eff5fa", "#ffffff"],
  ice: ["#5f8fb8", "#78a7cc", "#93bfdd", "#b0d5ea", "#d2e9f5"],
  stone: ["#4f5257", "#63676c", "#7a7e83", "#92969a", "#aaaeb1"],
  slate: ["#26282f", "#34373f", "#444852", "#565a66", "#6a6f7c"],
  brick: ["#5e2a22", "#7a372b", "#944536", "#ab5743", "#c06c55"],
  mortar: ["#6e6a62", "#87827a", "#a09b92", "#b8b3aa", "#cdc9c0"],
  metal: ["#3a3d42", "#565a61", "#767b83", "#9aa0a8", "#c0c5cc"],
  glass: ["#6f9aa8", "#8fb7c3", "#b0d1da", "#d3e8ee", "#f1fafc"],
  oak: ["#5a3b20", "#74502c", "#8d6638", "#a67d47", "#bd9658"],
  "oak-bark": ["#2f2015", "#43301f", "#573f29", "#6c5035", "#806244"],
  birch: ["#8f7a52", "#a89263", "#c0ab78", "#d5c391", "#e6d8ac"],
  "birch-bark": ["#2c2a26", "#6e6a62", "#b9b4a8", "#dad6cc", "#f0ede6"],
  water: ["#1d3f7a", "#24529a", "#2f67b5", "#4282cc", "#62a1de"],
  cloud: ["#a9b6c8", "#c3cddb", "#dae2ec", "#edf1f7", "#ffffff"],
  "ore-copper": ["#6b3a1f", "#95532b", "#bf713a", "#d9925a", "#efb98a"],
  "ore-gem": ["#0f4d4a", "#17716b", "#20968c", "#3dbdb0", "#86e3d6"],
  "ore-amber": ["#6b3f05", "#9a5e0a", "#c88412", "#e9a92a", "#fbd46a"],
  "ore-moon": ["#3b4766", "#56658c", "#7a8bb2", "#a5b5d6", "#d6e0f5"],
  crystal: ["#3b1f5e", "#55307f", "#7244a3", "#9466c4", "#bf98e2"],
  mushroom: ["#6b1f2a", "#8f2b36", "#b23a42", "#cf5550", "#e57a66"],
  "mushroom-stem": ["#8a7f6c", "#a89d88", "#c4baa5", "#ddd5c2", "#f1ecdf"],
  spark: ["#8a3c08", "#c25e0c", "#ec8b1a", "#ffbe3d", "#ffe58a"],
  "wool-white": ["#a9a7a2", "#c4c2bc", "#dad8d2", "#ebe9e4", "#f8f7f3"],
  "wool-black": ["#141418", "#1f1f25", "#2b2b33", "#393943", "#484853"],
  "wool-brown": ["#3f2618", "#553422", "#6c442d", "#835739", "#9a6b48"],
  "wool-red": ["#6e1414", "#921c1c", "#b52727", "#d13a35", "#e65a4e"],
  "wool-orange": ["#8a3d0b", "#b4540f", "#d96d17", "#f08a2c", "#fbab55"],
  "wool-yellow": ["#9c7a0b", "#c49c10", "#e1bb1f", "#f2d443", "#fbe877"],
  "wool-lime": ["#4b7a12", "#63991a", "#7db626", "#9bcf3e", "#b9e363"],
  "wool-green": ["#12401e", "#1b5729", "#256f35", "#318843", "#42a154"],
  "wool-cyan": ["#0b5a63", "#127783", "#1b95a2", "#33b2bd", "#5fcdd4"],
  "wool-blue": ["#172a6b", "#20398c", "#2b4bad", "#3f63c8", "#5d82dd"],
  "wool-purple": ["#3d1a63", "#522482", "#6831a0", "#8046bb", "#9b64d1"],
  "wool-pink": ["#8a3458", "#ad456f", "#cc5d88", "#e27ba2", "#f1a0bf"],
};

/**
 * A change to one ramp. Applied in this order: mix toward `tint` by `tintAmount` (0–1), then add
 * `hue` degrees, multiply saturation by `sat`, and add `light` to lightness (HSL, 0–1).
 */
export interface RampShift {
  hue?: number;
  sat?: number;
  light?: number;
  tint?: string;
  tintAmount?: number;
}

/** How a biome changes the base palette. Ramps not listed keep their base colors. */
export type BiomePaletteVariant = Readonly<Partial<Record<PaletteRampId, RampShift>>>;

/**
 * Each biome's palette as data (PLAN.md §5.1). Wool, ores and lights never shift, so a red block
 * is the same red everywhere.
 */
export const BIOME_VARIANTS: Readonly<Record<BiomeId, BiomePaletteVariant>> = {
  meadow: {},
  birch: {
    grass: { hue: -8, light: 0.02 },
    leaf: { hue: -14, sat: 1.1, light: 0.05 },
    moss: { hue: -8 },
  },
  shore: {
    sand: { sat: 1.05, light: 0.02 },
    grass: { hue: -10, sat: 0.85 },
    water: { hue: -18, light: 0.05 },
  },
  frosty: {
    grass: { hue: 28, sat: 0.55, light: 0.03 },
    leaf: { hue: 32, sat: 0.6 },
    moss: { hue: 28, sat: 0.6 },
    dirt: { sat: 0.7 },
    stone: { tint: "#9fb4cc", tintAmount: 0.15 },
    water: { hue: -10, light: 0.04 },
  },
  mines: {
    stone: { sat: 0.8, light: -0.06 },
    gravel: { light: -0.05 },
    dirt: { sat: 0.85, light: -0.05 },
  },
  marsh: {
    grass: { hue: -22, sat: 0.7, light: -0.06 },
    leaf: { hue: -18, sat: 0.7, light: -0.05 },
    moss: { hue: -15, sat: 0.8, light: -0.04 },
    water: { tint: "#3f5a2c", tintAmount: 0.45, sat: 0.7 },
    dirt: { light: -0.04 },
    mud: { light: -0.03 },
  },
  caverns: {
    stone: { tint: "#5b4a8a", tintAmount: 0.2 },
    slate: { tint: "#3a2c66", tintAmount: 0.25 },
    crystal: { light: 0.04 },
  },
  sparkstone: {
    stone: { tint: "#8a5a3a", tintAmount: 0.16 },
    slate: { tint: "#6a3a2a", tintAmount: 0.14 },
    metal: { tint: "#b07a40", tintAmount: 0.12 },
  },
  citadel: {
    cloud: { tint: "#f0e4ff", tintAmount: 0.12 },
    stone: { tint: "#d9d2f0", tintAmount: 0.15, light: 0.06 },
    grass: { hue: 10, light: 0.04 },
  },
};

/** The palette for a biome: {@link BASE_PALETTE} with that biome's shifts applied. */
export function paletteFor(biome: BiomeId): Palette {
  return applyVariant(BASE_PALETTE, BIOME_VARIANTS[biome]);
}

/** A copy of `palette` with each listed ramp shifted. */
export function applyVariant(palette: Palette, variant: BiomePaletteVariant): Palette {
  const out: Record<PaletteRampId, readonly string[]> = { ...palette };
  for (const id of PALETTE_RAMP_IDS) {
    const shift = variant[id];
    if (shift) out[id] = shiftRamp(palette[id], shift);
  }
  return out;
}

/** Shifts every color of a ramp (see {@link RampShift}). */
export function shiftRamp(ramp: readonly string[], shift: RampShift): string[] {
  const tint = shift.tint === undefined ? undefined : parseHex(shift.tint);
  const amount = shift.tintAmount ?? 0;
  return ramp.map((hex) => {
    let c = parseHex(hex);
    if (tint)
      c = [mix(c[0], tint[0], amount), mix(c[1], tint[1], amount), mix(c[2], tint[2], amount)];
    const [h, s, l] = toHsl(c);
    return toHex(
      fromHsl(
        h + (shift.hue ?? 0),
        Math.min(1, s * (shift.sat ?? 1)),
        Math.min(1, Math.max(0, l + (shift.light ?? 0))),
      ),
    );
  });
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** RGB (0–255) to HSL: hue in degrees, saturation and lightness 0–1. */
function toHsl([r8, g8, b8]: Rgb): [number, number, number] {
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
