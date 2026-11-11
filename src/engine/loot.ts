/**
 * Loot rolls (docs/impl/contracts.md §18). Pure.
 *
 * Stub only; M2-04 implements it and authors the tables.
 */
import type { Rarity } from "@/content/blocks/types";
import type { LootTable } from "@/content/loot/types";
import type { AgeBand, BiomeId, BlockId } from "@/types/core";
import type { Rng } from "./rng";

/**
 * Rolls the loot for one completed target.
 *
 * Rarity odds depend on streak and accuracy only, **never on speed** (PLAN.md §3.3). Speed is not
 * even an input.
 */
export function rollLoot(
  ctx: {
    biome: BiomeId;
    wordLen: number;
    streak: number;
    targetAccuracy: number;
    band: AgeBand;
  },
  table: LootTable,
  rng: Rng,
): { block: BlockId; count: number; rarity: Rarity }[] {
  void [ctx, table, rng];
  throw new Error("not implemented: rollLoot");
}
