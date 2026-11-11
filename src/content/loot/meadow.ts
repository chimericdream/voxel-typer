/**
 * The Meadow loot table (docs/impl/contracts.md §18, PLAN.md §3.3). Pure data.
 *
 * Weights compare entries of the same rarity only; the tier odds come from `rollLoot`. Water and
 * the birch log (an M3 placeholder) are left out on purpose.
 */
import type { LootTable } from "./types";

export const meadowLoot: LootTable = {
  biome: "meadow",
  entries: [
    // common: the ground and trees around the stage
    { block: "grass", rarity: "common", weight: 6 },
    { block: "dirt", rarity: "common", weight: 6 },
    { block: "coarse-dirt", rarity: "common", weight: 3 },
    { block: "sand", rarity: "common", weight: 3 },
    { block: "gravel", rarity: "common", weight: 3 },
    { block: "stone", rarity: "common", weight: 5 },
    { block: "cobble", rarity: "common", weight: 4 },
    { block: "oak-log", rarity: "common", weight: 5 },
    { block: "oak-planks", rarity: "common", weight: 4 },
    { block: "oak-leaves", rarity: "common", weight: 4 },
    // uncommon: flowers, wool and the first ore
    { block: "clay", rarity: "uncommon", weight: 3 },
    { block: "mossy-cobble", rarity: "uncommon", weight: 3 },
    { block: "brick", rarity: "uncommon", weight: 2 },
    { block: "char-ore", rarity: "uncommon", weight: 3 },
    { block: "red-blooms", rarity: "uncommon", weight: 3 },
    { block: "sunny-flowers", rarity: "uncommon", weight: 3 },
    { block: "bluebells", rarity: "uncommon", weight: 3 },
    { block: "purple-puffs", rarity: "uncommon", weight: 3 },
    { block: "red-wool", rarity: "uncommon", weight: 2 },
    { block: "yellow-wool", rarity: "uncommon", weight: 2 },
    { block: "green-wool", rarity: "uncommon", weight: 2 },
    { block: "blue-wool", rarity: "uncommon", weight: 2 },
    // rare
    { block: "copper-ore", rarity: "rare", weight: 3 },
    { block: "glass", rarity: "rare", weight: 2 },
    { block: "lantern", rarity: "rare", weight: 2 },
    // epic: only from an ore-vein bonus at a long streak
    { block: "meadowstone", rarity: "epic", weight: 1 },
  ],
};
