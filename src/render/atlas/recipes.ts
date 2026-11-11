/**
 * Texture recipes: how to paint a 16×16 tile (docs/impl/contracts.md §8.3). Pure.
 *
 * Every texture is generated from a recipe, a palette and a seed. Nothing is copied from another
 * game (CLAUDE.md, IP rule).
 */
import type { Rng } from "@/engine/rng";
import {
  TILE_SIZE,
  paintBricks,
  paintCrack,
  paintCustom,
  paintNoise,
  paintOre,
  paintOverlayTop,
  paintPlanks,
} from "./painters";

/**
 * Every ramp name a palette has, in display order. Block recipes may name only these. The colors
 * live in `palettes.ts`.
 */
export const PALETTE_RAMP_IDS = [
  // ground
  "grass",
  "leaf",
  "moss",
  "dirt",
  "mud",
  "clay",
  "sand",
  "gravel",
  "snow",
  "ice",
  // stone and building
  "stone",
  "slate",
  "brick",
  "mortar",
  "metal",
  "glass",
  // wood
  "oak",
  "oak-bark",
  "birch",
  "birch-bark",
  // water and sky
  "water",
  "cloud",
  // ores, crystals and lights
  "ore-copper",
  "ore-gem",
  "ore-amber",
  "ore-moon",
  "crystal",
  "mushroom",
  "mushroom-stem",
  "spark",
  // wool for building (the 12 colors kids can name)
  "wool-white",
  "wool-black",
  "wool-brown",
  "wool-red",
  "wool-orange",
  "wool-yellow",
  "wool-lime",
  "wool-green",
  "wool-cyan",
  "wool-blue",
  "wool-purple",
  "wool-pink",
] as const;

/** The name of a color ramp in a {@link Palette}, e.g. `'grass'`, `'dirt'`, `'stone'`, `'oak'`. */
export type PaletteRampId = (typeof PALETTE_RAMP_IDS)[number];

/**
 * Named ramps of 4–6 colors, dark to light, as CSS hex strings (`'#5a8f3c'`). Each biome gets its
 * own variant (`paletteFor` in `palettes.ts`).
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
  /**
   * `paint` names a painter in `painters.ts`: `'<painter>'` or `'<painter>:<rampId>'`, e.g.
   * `'knit:wool-red'`. See `CUSTOM_PAINTERS` there.
   */
  | { kind: "custom"; paint: string };

/** The bytes of one painted tile: 16 × 16 × 4 RGBA, rows top to bottom. */
export const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4;

/**
 * Paints one tile: 16 × 16 × 4 RGBA bytes, rows top to bottom. Pure: the same inputs give the
 * same pixels.
 *
 * Nested recipes (`ore`, `overlay-top`) paint their `base` from `rng.fork('base')`, so the base
 * pattern doesn't depend on how many draws the outer layer makes.
 *
 * Crack stages are progressive: painted with equally seeded streams, stage `n + 1` contains every
 * pixel of stage `n`. Throws on an unknown ramp or painter.
 */
export function paintTile(recipe: TextureRecipe, palette: Palette, rng: Rng): Uint8ClampedArray {
  switch (recipe.kind) {
    case "noise":
      return paintNoise(palette, rng, recipe.ramp, recipe.scale, recipe.contrast);
    case "planks":
      return paintPlanks(palette, rng, recipe.ramp, recipe.boards);
    case "bricks":
      return paintBricks(palette, rng, recipe.ramp, recipe.mortar);
    case "ore":
      return paintOre(
        paintTile(recipe.base, palette, rng.fork("base")),
        palette,
        rng,
        recipe.ore,
        recipe.density,
      );
    case "overlay-top":
      return paintOverlayTop(
        paintTile(recipe.base, palette, rng.fork("base")),
        palette,
        rng,
        recipe.top,
        recipe.depth,
      );
    case "crack":
      return paintCrack(rng, recipe.stage);
    case "custom":
      return paintCustom(recipe.paint, palette, rng);
    default: {
      // Recipes can come from data files, so check at runtime too.
      const unknown: { kind?: unknown } = recipe;
      throw new Error(`unknown recipe kind: ${String(unknown.kind)}`);
    }
  }
}
