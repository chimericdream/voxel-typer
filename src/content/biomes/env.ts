/**
 * Biome environment data (task M2-02, PLAN.md §3.4 and §5.1). Pure: plain numbers and sRGB hex
 * strings, no three.js. `src/render/sky.ts` turns this into a sky dome, fog, lights and clouds.
 *
 * Each biome has one {@link TimeEnv} per time of day. Biomes without data yet fall back to the
 * Meadow ({@link biomeEnv}); M5 adds the rest.
 */
import type { BiomeId, TimeOfDay } from "@/types/core";
import { MEADOW_ENV } from "./meadow";

/** The three stops of the gradient sky dome. */
export interface SkyStops {
  /** Straight up. */
  zenith: string;
  /** At eye level. Fog uses this color too, so far blocks melt into the sky. */
  horizon: string;
  /** Straight down, below the diorama. */
  ground: string;
}

/** A flat square disc in the sky (sun or moon). `opacity` 0 hides it. */
export interface DiscEnv {
  color: string;
  opacity: number;
}

/** Everything the environment shows for one time of day. Colors are sRGB `#rrggbb`. */
export interface TimeEnv {
  sky: SkyStops;
  /** `FogExp2` density, per block. */
  fogDensity: number;
  /** The directional light: the sun by day, moonlight at night. */
  sun: { color: string; intensity: number };
  /** Hemisphere fill light. */
  hemi: { sky: string; ground: string; intensity: number };
  clouds: { color: string; opacity: number };
  sunDisc: DiscEnv;
  moonDisc: DiscEnv;
}

/** A slow ambient particle floating over the diorama. */
export interface AmbientParticle {
  kind: "pollen" | "leaf" | "snow" | "spray" | "ember" | "dust" | "spark";
  color: string;
  /** Particles per 1000 cells of the diorama's footprint area. */
  density: number;
}

export interface BiomeEnv {
  biome: BiomeId;
  times: Readonly<Record<TimeOfDay, TimeEnv>>;
  particle: AmbientParticle | null;
}

export const TIMES_OF_DAY: readonly TimeOfDay[] = ["dawn", "day", "dusk", "night"];

/** Environment data per biome. Missing biomes use the Meadow. */
export const BIOME_ENVS: Readonly<Partial<Record<BiomeId, BiomeEnv>>> = {
  meadow: MEADOW_ENV,
};

/** The environment of `biome`, or the Meadow's while that biome has no data. */
export function biomeEnv(biome: BiomeId): BiomeEnv {
  return BIOME_ENVS[biome] ?? MEADOW_ENV;
}

/** `t01` used when `setEnvironment` leaves it out, and under `?freeze` (contracts.md, URL debug params). */
export const DEFAULT_T01 = 0.3;

/**
 * Where a disc sits in the sky, in degrees. `azimuth` 0 is straight ahead of the camera presets
 * (toward −z, behind the diorama), positive to the right (+x). `elevation` is above the horizon.
 */
export interface SkyPos {
  azimuth: number;
  elevation: number;
}

/**
 * Sun and moon positions for a time of day and `t01`, the progress through that time of day
 * (0 = its start, 1 = its end; clamped). The arcs stay low, under ~12°, and within ±30°, so the discs show above
 * the horizon in the `mine` view. The sun rises on the left at dawn, crosses at day and sets on
 * the right at dusk; the moon follows the same path at night.
 *
 * These are only where the discs are drawn. The directional light keeps its fixed raking angle
 * (`SUN_DIR` in `src/render/lights.ts`) so voxel shading reads the same at every hour.
 */
export function celestialFor(tod: TimeOfDay, t01: number): { sun: SkyPos; moon: SkyPos } {
  const t = Number.isFinite(t01) ? Math.min(1, Math.max(0, t01)) : DEFAULT_T01;
  const arc = Math.sin(Math.PI * t);
  switch (tod) {
    case "dawn":
      return {
        sun: { azimuth: -24 + 8 * t, elevation: 3 + 5 * t },
        moon: { azimuth: 26 + 6 * t, elevation: 9 - 6 * t },
      };
    case "day":
      return {
        sun: { azimuth: -26 + 52 * t, elevation: 8 + 3 * arc },
        moon: { azimuth: 0, elevation: -30 },
      };
    case "dusk":
      return {
        sun: { azimuth: 16 + 8 * t, elevation: 8 - 5 * t },
        moon: { azimuth: -32 + 6 * t, elevation: 3 + 6 * t },
      };
    case "night":
      break;
  }
  return {
    sun: { azimuth: 0, elevation: -30 },
    moon: { azimuth: -24 + 48 * t, elevation: 8 + 3 * arc },
  };
}

/** sRGB hex `#rrggbb` → [r, g, b] in 0–1. Throws on anything else. */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`not a #rrggbb color: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const lin = (c: number): number => (c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance of an sRGB hex color, 0–1. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb01(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
