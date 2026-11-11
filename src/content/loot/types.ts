/**
 * Loot tables (docs/impl/contracts.md §18). Pure.
 *
 * Final shape, settled by M2-04: one table per biome, a flat list of weighted entries. Each entry
 * names a block and its rarity tier. `rollLoot` (`src/engine/loot.ts`) first picks a tier from the
 * kid's streak and accuracy, then picks an entry of that tier by weight. A table file is
 * `src/content/loot/<biome>.ts`.
 */
import type { BiomeId, BlockId } from "@/types/core";
import type { Rarity } from "../blocks/types";

/** One block a biome can drop. */
export interface LootEntry {
  block: BlockId;
  /** The tier this entry drops in. Equals the block's own `rarity` (a unit test checks it). */
  rarity: Rarity;
  /** Relative weight among the entries of the same rarity. A positive integer. */
  weight: number;
}

/** What one biome can drop. Every table has at least one `common` entry. */
export interface LootTable {
  biome: BiomeId;
  entries: readonly LootEntry[];
}
