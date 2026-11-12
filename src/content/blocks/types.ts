/**
 * Blocks (docs/impl/contracts.md §17). Pure.
 */
import type { MessageKey } from "@/i18n";
import type { TextureRecipe } from "@/render/atlas/recipes";
import type { BlockId, Material } from "@/types/core";

/** How rare a block is as loot. Odds depend on streak and accuracy, never on speed (contracts §18). */
export type Rarity = "common" | "uncommon" | "rare" | "epic";

/**
 * How a block is meshed (decision 82). `cube` fills its cell. `sprig` is a small plant inside its
 * cell (a thin stem, a small bloom and two leaf nubs, built from sub-voxel boxes): it never hides a
 * neighbour's faces and takes and casts no AO.
 */
export type BlockShape = "cube" | "sprig";

/**
 * One block of the world. Block files export `blocks: BlockDef[]`, one file per group.
 *
 * `num` values are allocated in ranges per group file, so files can't collide: terrain 1–99, wood
 * 100–149, stone 150–199, ores 200–249, wool/colors 250–299, deco/light 300–399, biome-specials
 * 400–599. A unit test asserts that `id`, `num` and `typedName` are unique and that `typedName` is
 * typeable.
 */
export interface BlockDef {
  id: BlockId;
  /** The numeric id stored in voxel grids. Stable forever (it is saved). 0 is reserved for air. */
  num: number;
  /** i18n key of the display name. */
  nameKey: MessageKey;
  faces: { top: TextureRecipe; side: TextureRecipe; bottom: TextureRecipe };
  material: Material;
  rarity: Rarity;
  /** For example `'terrain'`, `'ore'`, `'biome:meadow'`, `'placeable'`, `'light'`, `'transparent'`. */
  tags: string[];
  light?: { color: string; intensity: number };
  /** Missing means `cube`. Flowers are `sprig`. */
  shape?: BlockShape;
  /** What kids type in Builder to arm the block, e.g. `'oak'`. Lowercase, a–z only. */
  typedName: string;
}
