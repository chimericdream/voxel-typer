/**
 * One run of the placement test (task M3-05): the blocks of each rung and the driver that feeds
 * them as the ladder climbs. Placement mode (`src/modes/placement/`) and the simulator
 * (`tools/sim-placement.ts`) both use it, so the sim measures exactly what the game does.
 *
 * Pure (PLAN.md §6.3): seeds arrive as an `Rng`, word pools as a parameter. It lives apart from
 * `./placement.ts` so that the estimate, which the app shell loads eagerly, doesn't pull in the
 * generator.
 */
import { keyWeights } from "./adaptive";
import { generateTargets } from "./generator";
import type { WordPool } from "./generator";
import { PLACEMENT_TIERS, createLadder, ladderRecord, tierKeys } from "./placement";
import type { Ladder } from "./placement";
import type { Rng } from "./rng";
import type { KeyStat } from "./stats";
import type { Target } from "./types";
import type { AgeBand, Ms } from "../types/core";

/** What {@link tierTargets} needs besides the rung. */
export interface TierContext {
  band: AgeBand;
  /** Every shipped pool; the rung picks its own by id and band. */
  pools: readonly WordPool[];
  stats: Readonly<Record<string, KeyStat>>;
  sessionIndex: number;
  targetLatencyMs: Ms;
}

/** How many blocks are made at a time for a rung. More come when they run out. */
export const TIER_BATCH = 12;

/**
 * The next blocks for a rung: letters weighted toward the rung's new keys, or words from the
 * rung's pools (the generator falls back to short syllables when a pool is missing). Every target
 * has no trailing space, as in Mine. Ids are `"<prefix><n>"`, so the caller keeps them unique.
 * Each call draws from `rng`; pass a fresh fork per batch.
 */
export function tierTargets(
  tier: number,
  ctx: TierContext,
  rng: Rng,
  prefix: string,
  count = TIER_BATCH,
): Target[] {
  const own = PLACEMENT_TIERS[tier];
  if (own === undefined) return [];
  const allowed = tierKeys(tier);
  const ids = own.pools(ctx.band);
  const pools = ctx.pools.filter(
    (p) => ids.includes(p.id) && (p.band === ctx.band || p.band === "all"),
  );
  const targets = generateTargets(
    {
      kind: own.kind,
      allowed,
      weights: keyWeights({
        allowed,
        focus: own.newKeys.filter((k) => allowed.includes(k)),
        stats: ctx.stats,
        sessionIndex: ctx.sessionIndex,
        targetLatencyMs: ctx.targetLatencyMs,
      }),
      pools,
      length: { targets: count },
      // Short words: a block shows one word, and a 90-second test has no room for long ones.
      maxLen: 7,
    },
    rng.fork("targets"),
  );
  return targets.map((t, i) => ({ id: `${prefix}${i}`, text: t.text, trailingSpace: false }));
}

/** Feeds the test its blocks, one at a time, and climbs the ladder as blocks break. */
export interface PlacementDriver {
  /** The first block. */
  first(): Target;
  /** A block broke with `errors` slips: records it and returns the next block. */
  next(errors: number): Target;
  /** The highest rung opened so far. */
  tierReached(): number;
  /** Blocks broken so far. */
  blocks(): number;
  ladder(): Ladder;
}

/**
 * One run of the placement test. Deterministic for the same context and seed: batch `n` draws
 * from `rng.fork("batch-<n>")`. Blocks are made {@link TIER_BATCH} at a time; when a rung opens,
 * what is left of the old rung's batch is dropped, so the very next block is from the new rung.
 */
export function createPlacementDriver(ctx: TierContext, rng: Rng): PlacementDriver {
  let ladder = createLadder(ctx.band);
  let queue: Target[] = [];
  let batches = 0;
  let broken = 0;
  let reached = 0;

  const take = (): Target => {
    if (queue.length === 0) {
      const n = batches++;
      queue = tierTargets(ladder.tier, ctx, rng.fork(`batch-${n}`), `p${n}-`);
    }
    const next = queue.shift();
    // A rung always has keys, so the generator always makes letters; this is a guard.
    return next ?? { id: `p${batches}-x`, text: "f", trailingSpace: false };
  };

  return {
    first: take,
    next(errors) {
      broken++;
      const rec = ladderRecord(ladder, errors === 0);
      ladder = rec.ladder;
      if (rec.advanced) {
        queue = [];
        reached = Math.max(reached, ladder.tier);
      }
      return take();
    },
    tierReached: () => reached,
    blocks: () => broken,
    ladder: () => ladder,
  };
}
