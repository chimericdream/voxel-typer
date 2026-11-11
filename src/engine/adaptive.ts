/**
 * Adaptive engine: which keys need practice (docs/impl/contracts.md §4). Pure.
 *
 * Weight formula (a starting point; M1-05 may tune the constants with the simulator and must record
 * the final values):
 * ```
 * err   = (stat.recentErrRate * n + 0.05 * 5) / (n + 5),   n = min(attempts, 50)
 * slow  = latencyMedian == null ? 0 : max(0, latencyMedian / targetLatencyMs − 1)
 * w     = 1 + 6 * err + 1.5 * min(slow, 2)
 * focus keys:                            w = max(w, 3)
 * unseen keys (attempts < 5) in allowed: w = 2
 * ```
 *
 * Comfort cap: generators must keep at least 50% of generated chars from keys whose weight is in
 * the bottom half. `keyWeights` only feeds the generator; the generator enforces the cap (§5).
 *
 * Stubs only; M1-05 implements them.
 */
import type { Ms } from "@/types/core";
import type { KeyStat } from "./stats";

/** What the adaptive functions need to know about a learner. */
export interface AdaptiveParams {
  /** The chars the learner knows (plus space). */
  allowed: readonly string[];
  /** This lesson's new keys. Always weighted up. */
  focus: readonly string[];
  stats: Readonly<Record<string, KeyStat>>;
  sessionIndex: number;
  /** Band default: sprout 900, miner 500, builder 300. */
  targetLatencyMs: Ms;
}

/** A weight for every allowed key, by the formula above. Higher means "practice this more". */
export function keyWeights(p: AdaptiveParams): Record<string, number> {
  void p;
  throw new Error("not implemented: keyWeights");
}

/** The top `n` keys by weight, excluding the focus keys. */
export function weakKeys(p: AdaptiveParams, n: number): string[] {
  void [p, n];
  throw new Error("not implemented: weakKeys");
}

/** The keys due for review: `srs.dueSession ≤ sessionIndex`. */
export function dueReviewKeys(p: AdaptiveParams): string[] {
  void p;
  throw new Error("not implemented: dueReviewKeys");
}

/**
 * The next spaced-repetition slot of a key. Accuracy ≥ 0.95 doubles `intervalSessions` (it starts
 * at 1 and stops at 32); accuracy < 0.85 resets it to 1; otherwise it stays.
 * `dueSession = sessionIndex + intervalSessions`.
 */
export function scheduleSrs(
  stat: KeyStat,
  sessionIndex: number,
  sessionAccuracyForKey: number,
): KeyStat["srs"] {
  void [stat, sessionIndex, sessionAccuracyForKey];
  throw new Error("not implemented: scheduleSrs");
}
