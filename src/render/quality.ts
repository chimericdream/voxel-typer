/**
 * Quality presets (task M2-01). One row per {@link QualityLevel}. The scene reads this table; it
 * never hard-codes a per-level number elsewhere.
 */
import type { QualityLevel } from "@/types/core";

/** What a quality level turns on. */
export interface QualityPreset {
  /** Upper bound for the renderer's pixel ratio: `min(devicePixelRatio, maxPixelRatio)`. */
  readonly maxPixelRatio: number;
  /** Sun shadow map on or off. */
  readonly shadows: boolean;
  /** Shadow map size in texels per side (used only when `shadows`). */
  readonly shadowMapSize: number;
  /**
   * Most point lights for `light`-tagged blocks. 0 means light blocks only glow (their faces are
   * drawn unlit), with no light cast on their neighbors.
   */
  readonly pointLights: number;
  /** Post-processing allowed. No pass exists yet; later tasks check this flag. */
  readonly post: boolean;
}

/** The quality table (card M2-01). */
export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  low: { maxPixelRatio: 1, shadows: false, shadowMapSize: 1024, pointLights: 0, post: false },
  medium: { maxPixelRatio: 1, shadows: false, shadowMapSize: 1024, pointLights: 4, post: false },
  high: { maxPixelRatio: 2, shadows: true, shadowMapSize: 1024, pointLights: 8, post: true },
};

/** The renderer pixel ratio for a quality level and a device pixel ratio. */
export function pixelRatioFor(quality: QualityLevel, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, QUALITY_PRESETS[quality].maxPixelRatio);
}
