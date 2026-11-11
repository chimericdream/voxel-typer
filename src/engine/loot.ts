/**
 * Loot rolls (docs/impl/contracts.md §18, PLAN.md §3.3). Pure.
 *
 * Rarity depends on streak and accuracy only, **never on speed**. Speed is not even an input, so
 * slower kids get the same good loot.
 *
 * How a roll works:
 *
 * 1. The kid's streak, accuracy and band unlock a *level* ({@link lootLevel}): `common` only;
 *    `uncommon` at streak 10 or a perfect target; `rare` at streak 25 (Sprout: 15); `epic` only on
 *    an ore-vein bonus at streak 40 (Sprout: 25).
 * 2. Each level has fixed tier odds ({@link TIER_ODDS}). A higher level only moves odds up, so a
 *    longer streak never lowers the expected rarity.
 * 3. One `rng.next()` picks the tier, then `rng.weightedPick` picks an entry of that tier. A tier
 *    the table has no entries for falls back to the nearest lower tier that has some.
 * 4. Count = 1 + floor(wordLen / 4). An ore-vein bonus drops a second, bonus item.
 */
import type { Rarity } from "@/content/blocks/types";
import type { LootEntry, LootTable } from "@/content/loot/types";
import type { AgeBand, BiomeId, BlockId } from "@/types/core";
import type { Rng } from "./rng";

/** Everything a roll may depend on. There is no speed field, by design (a type test pins this). */
export interface LootContext {
  biome: BiomeId;
  /** Length of the completed target, in characters. */
  wordLen: number;
  /** Correct keystrokes in a row (`SessionState.streak`). */
  streak: number;
  /** Accuracy on this target, 0–1. Exactly 1 means no wrong key. */
  targetAccuracy: number;
  band: AgeBand;
  /** True when this target was an ore-vein bonus block (Mine mode, M2-13). */
  oreVein: boolean;
}

/** One drop. */
export interface LootDrop {
  block: BlockId;
  count: number;
  rarity: Rarity;
}

/** Tiers from lowest to highest. */
export const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "epic"];

/** Streak thresholds per band. `uncommon` also unlocks at a perfect target. */
export const LOOT_THRESHOLDS: Readonly<
  Record<AgeBand, { uncommon: number; rare: number; epic: number }>
> = {
  sprout: { uncommon: 10, rare: 15, epic: 25 },
  miner: { uncommon: 10, rare: 25, epic: 40 },
  builder: { uncommon: 10, rare: 25, epic: 40 },
};

/**
 * Tier odds per level, in {@link RARITIES} order. Each row first-order dominates the one before
 * (its running sums are never larger), which is what keeps rarity monotone in streak.
 */
export const TIER_ODDS: readonly (readonly [number, number, number, number])[] = [
  [1, 0, 0, 0],
  [0.65, 0.35, 0, 0],
  [0.45, 0.35, 0.2, 0],
  [0.2, 0.3, 0.25, 0.25],
];

type LevelInputs = Pick<LootContext, "streak" | "targetAccuracy" | "band" | "oreVein">;

/** The highest tier the context unlocks: 0 = common … 3 = epic. */
export function lootLevel(ctx: LevelInputs): 0 | 1 | 2 | 3 {
  const t = LOOT_THRESHOLDS[ctx.band];
  if (ctx.oreVein && ctx.streak >= t.epic) return 3;
  if (ctx.streak >= t.rare) return 2;
  if (ctx.streak >= t.uncommon || ctx.targetAccuracy >= 1) return 1;
  return 0;
}

/** The chance of each tier for this context, before any fallback for tiers a table lacks. */
export function lootTierOdds(ctx: LevelInputs): Readonly<Record<Rarity, number>> {
  const [common, uncommon, rare, epic] = TIER_ODDS[lootLevel(ctx)] ?? [1, 0, 0, 0];
  return { common, uncommon, rare, epic };
}

/** How many of a block one target drops. */
export function lootCount(wordLen: number): number {
  return 1 + Math.floor(Math.max(0, wordLen) / 4);
}

function pickTier(odds: readonly number[], u: number): number {
  let sum = 0;
  for (let i = 0; i < odds.length; i++) {
    sum += odds[i] ?? 0;
    if (u < sum) return i;
  }
  return 0;
}

function rollOne(ctx: LootContext, byTier: readonly (readonly LootEntry[])[], rng: Rng): LootDrop {
  let tier = pickTier(TIER_ODDS[lootLevel(ctx)] ?? [1], rng.next());
  while (tier > 0 && (byTier[tier]?.length ?? 0) === 0) tier--;
  const pool = byTier[tier] ?? [];
  const entry = rng.weightedPick(
    pool,
    pool.map((e) => e.weight),
  );
  return { block: entry.block, count: lootCount(ctx.wordLen), rarity: entry.rarity };
}

/**
 * Rolls the loot for one completed target: one drop, or two on an ore-vein bonus (the same block
 * twice is merged into one drop). Deterministic for a given `rng` state.
 *
 * Throws when `table` is for another biome or has no `common` entry: both are content bugs that the
 * registry test catches.
 */
export function rollLoot(ctx: LootContext, table: LootTable, rng: Rng): LootDrop[] {
  if (table.biome !== ctx.biome) {
    throw new Error(`rollLoot: table is for ${table.biome}, not ${ctx.biome}`);
  }
  const byTier = RARITIES.map((r) => table.entries.filter((e) => e.rarity === r));
  if ((byTier[0]?.length ?? 0) === 0) {
    throw new Error(`rollLoot: the ${table.biome} table has no common entries`);
  }
  const drops = [rollOne(ctx, byTier, rng)];
  if (ctx.oreVein) {
    const bonus = rollOne(ctx, byTier, rng);
    const same = drops.find((d) => d.block === bonus.block);
    if (same) same.count += bonus.count;
    else drops.push(bonus);
  }
  return drops;
}
