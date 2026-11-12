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
import type { Ladder, RungScore } from "./placement";
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

const asTarget = (prefix: string) => (text: string, i: number) => ({
  id: `${prefix}${i}`,
  text,
  trailingSpace: false,
});

/**
 * The next blocks for a rung: letters weighted toward the rung's new keys (the generator still
 * keeps half of them on the easier keys), or words from the rung's pools (the generator falls back to short syllables when a pool
 * is missing). `first` are single keys shown before any random block, in a shuffled order: the
 * driver passes the keys the rung still has to cover, so a rung shows each of its new keys early
 * (M3-FIX-3 N1). Every target has no trailing space, as in Mine. Ids are `"<prefix><n>"`, so the
 * caller keeps them unique. Each call draws from `rng`; pass a fresh fork per batch.
 */
export function tierTargets(
  tier: number,
  ctx: TierContext,
  rng: Rng,
  prefix: string,
  count = TIER_BATCH,
  first: readonly string[] = [],
): Target[] {
  const own = PLACEMENT_TIERS[tier];
  if (own === undefined) return [];
  const allowed = tierKeys(tier);
  const focus = own.newKeys.filter((k) => allowed.includes(k));
  const lead = rng.fork("cover").shuffle(first.filter((k) => allowed.includes(k)));
  const rest = Math.max(0, count - lead.length);
  if (rest === 0) return lead.map(asTarget(prefix));
  const ids = own.pools(ctx.band);
  const pools = ctx.pools.filter(
    (p) => ids.includes(p.id) && (p.band === ctx.band || p.band === "all"),
  );
  const weights = keyWeights({
    allowed,
    focus,
    stats: ctx.stats,
    sessionIndex: ctx.sessionIndex,
    targetLatencyMs: ctx.targetLatencyMs,
  });
  const targets = generateTargets(
    {
      kind: own.kind,
      allowed,
      weights,
      pools,
      length: { targets: rest },
      // Short words: a block shows one word, and a 90-second test has no room for long ones.
      maxLen: 7,
    },
    rng.fork("targets"),
  );
  return [...lead, ...targets.map((t) => t.text)].map(asTarget(prefix));
}

/** Feeds the test its blocks, one at a time, and climbs the ladder as blocks break. */
export interface PlacementDriver {
  /** The first block. */
  first(): Target;
  /**
   * The last block shown broke with `errors` slips at time `t` (on the session's clock, with
   * paused time taken out): records it and returns the next block.
   */
  next(errors: number, t: Ms): Target;
  /** The highest rung opened so far. */
  tierReached(): number;
  /** Blocks broken so far. */
  blocks(): number;
  ladder(): Ladder;
  /**
   * A score for each rung the test has left, timed from `startT` (the session's start): the
   * blocks typed at or below that rung, until the next one opened (M3-FIX-3 N2).
   */
  rungScores(startT: Ms): RungScore[];
}

/**
 * One run of the placement test. Deterministic for the same context and seed: batch `n` draws
 * from `rng.fork("batch-<n>")`. Blocks are made {@link TIER_BATCH} at a time, each batch starting
 * with the keys the rung still has to cover; when a rung opens, what is left of the old rung's
 * batch is dropped, so the very next block is from the new rung.
 */
export function createPlacementDriver(ctx: TierContext, rng: Rng): PlacementDriver {
  let ladder = createLadder(ctx.band);
  let queue: Target[] = [];
  let batches = 0;
  let broken = 0;
  let reached = 0;
  let shown: Target | null = null;
  let keystrokes = 0;
  let correct = 0;
  const left: { tier: number; t: Ms; keystrokes: number; correct: number }[] = [];

  const take = (): Target => {
    if (queue.length === 0) {
      const n = batches++;
      queue = tierTargets(
        ladder.tier,
        ctx,
        rng.fork(`batch-${n}`),
        `p${n}-`,
        TIER_BATCH,
        ladder.pending,
      );
    }
    // A rung always has keys, so the generator always makes letters; this is a guard.
    shown = queue.shift() ?? { id: `p${batches}-x`, text: "f", trailingSpace: false };
    return shown;
  };

  return {
    first: take,
    next(errors, t) {
      broken++;
      const text = shown?.text ?? "";
      const chars = Array.from(text).length;
      // Every wrong-key policy is `stay` in the test: each slip is one extra key on the block.
      keystrokes += chars + errors;
      correct += chars;
      const from = ladder.tier;
      const rec = ladderRecord(ladder, errors === 0, text);
      ladder = rec.ladder;
      if (rec.advanced) {
        left.push({ tier: from, t, keystrokes, correct });
        queue = [];
        reached = Math.max(reached, ladder.tier);
      }
      return take();
    },
    tierReached: () => reached,
    blocks: () => broken,
    ladder: () => ladder,
    rungScores: (startT) =>
      left.map((r) => ({
        tier: r.tier,
        ms: Math.max(0, r.t - startT),
        keystrokes: r.keystrokes,
        correct: r.correct,
      })),
  };
}
