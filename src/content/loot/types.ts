/**
 * Loot tables (docs/impl/contracts.md §18). Pure.
 *
 * PROVISIONAL: the contracts use `LootTable` in `rollLoot` but never define it ("exact table
 * authored in M2-04"). This is the smallest shape that fits the M2-04 card ("per biome, weighted
 * entries by rarity"). M2-04 owns this file and settles it.
 */
import type { BiomeId, BlockId } from "@/types/core";
import type { Rarity } from "../blocks/types";

/** One block a biome can drop. */
export interface LootEntry {
  block: BlockId;
  rarity: Rarity;
  /** Relative weight among the entries of the same rarity. */
  weight: number;
}

/** What one biome can drop. */
export interface LootTable {
  biome: BiomeId;
  entries: readonly LootEntry[];
}
