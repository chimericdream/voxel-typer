/**
 * Texture recipes: how to paint a 16×16 tile (docs/impl/contracts.md §8.3). Pure.
 *
 * Every texture is generated from a recipe, a palette and a seed. Nothing is copied from another
 * game (CLAUDE.md, IP rule).
 *
 * Stubs only; M1-14 implements them.
 */
import type { Rng } from "@/engine/rng";

/**
 * The name of a color ramp in a {@link Palette}, e.g. `'grass'`, `'dirt'`, `'stone'`, `'oak'`.
 *
 * PROVISIONAL: the contracts use `PaletteRampId` and `Palette` but never define them. M1-14 owns
 * the palettes and settles both.
 */
export type PaletteRampId = string;

/**
 * Named ramps of 4–6 colors, dark to light, as CSS hex strings (`'#5a8f3c'`). Each biome gets its
 * own variant.
 *
 * PROVISIONAL, see {@link PaletteRampId}.
 */
export type Palette = Readonly<Record<PaletteRampId, readonly string[]>>;

/** How to paint one 16×16 tile. */
export type TextureRecipe =
  | { kind: "noise"; ramp: PaletteRampId; scale: number; contrast: number }
  | { kind: "planks"; ramp: PaletteRampId; boards: number }
  | { kind: "bricks"; ramp: PaletteRampId; mortar: PaletteRampId }
  | { kind: "ore"; base: TextureRecipe; ore: PaletteRampId; density: number }
  /** Grass-side style: `top` hangs `depth` pixels down over `base`. */
  | { kind: "overlay-top"; base: TextureRecipe; top: PaletteRampId; depth: number }
  /** Crack overlays, `stage` 0–9. */
  | { kind: "crack"; stage: number }
  /** `paint` is the name of a painter in `painters.ts`. */
  | { kind: "custom"; paint: string };

/** Paints one tile: 16 × 16 × 4 RGBA bytes. Pure: the same inputs give the same pixels. */
export function paintTile(recipe: TextureRecipe, palette: Palette, rng: Rng): Uint8ClampedArray {
  void [recipe, palette, rng];
  throw new Error("not implemented: paintTile");
}
