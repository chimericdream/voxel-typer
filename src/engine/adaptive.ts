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
 */
import type { Ms } from "@/types/core";
import type { KeyStat } from "./stats";

/** Starting balance from contracts §4; M1-07 can tune these with the simulator. */
export const ADAPTIVE_CONSTANTS = {
  priorErrorRate: 0.05,
  priorAttempts: 5,
  maxSmoothingAttempts: 50,
  baseWeight: 1,
  errorWeight: 6,
  latencyWeight: 1.5,
  maxSlowness: 2,
  focusMinWeight: 3,
  unseenAttempts: 5,
  unseenWeight: 2,
  srsSuccessAccuracy: 0.95,
  srsResetAccuracy: 0.85,
  srsInitialInterval: 1,
  srsIntervalMultiplier: 2,
  srsMaxInterval: 32,
} as const;

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
  const c = ADAPTIVE_CONSTANTS;
  const focus = new Set(p.focus);
  return Object.fromEntries(
    p.allowed.map((key) => {
      const stat = Object.hasOwn(p.stats, key) ? p.stats[key] : undefined;
      let weight: number = c.unseenWeight;
      if (stat && stat.attempts >= c.unseenAttempts) {
        const n = Math.min(stat.attempts, c.maxSmoothingAttempts);
        const err =
          (stat.recentErrRate * n + c.priorErrorRate * c.priorAttempts) / (n + c.priorAttempts);
        const slow =
          stat.latencyMedian === null ? 0 : Math.max(0, stat.latencyMedian / p.targetLatencyMs - 1);
        weight =
          c.baseWeight + c.errorWeight * err + c.latencyWeight * Math.min(slow, c.maxSlowness);
      }
      return [key, focus.has(key) ? Math.max(weight, c.focusMinWeight) : weight];
    }),
  );
}

/** The top `n` keys by weight, excluding the focus keys. */
export function weakKeys(p: AdaptiveParams, n: number): string[] {
  const focus = new Set(p.focus);
  // Stable sort preserves allowed order for ties, without locale-dependent collation.
  return Object.entries(keyWeights(p))
    .filter(([key]) => !focus.has(key))
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, Math.floor(n)))
    .map(([key]) => key);
}

/** The keys due for review: `srs.dueSession ≤ sessionIndex`. */
export function dueReviewKeys(p: AdaptiveParams): string[] {
  return [...new Set(p.allowed)].filter((key) => {
    const stat = Object.hasOwn(p.stats, key) ? p.stats[key] : undefined;
    return stat !== undefined && stat.srs.dueSession <= p.sessionIndex;
  });
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
  const c = ADAPTIVE_CONSTANTS;
  let intervalSessions = Math.max(c.srsInitialInterval, stat.srs.intervalSessions);
  if (sessionAccuracyForKey >= c.srsSuccessAccuracy) {
    intervalSessions *= c.srsIntervalMultiplier;
  } else if (sessionAccuracyForKey < c.srsResetAccuracy) {
    intervalSessions = c.srsInitialInterval;
  }
  intervalSessions = Math.min(intervalSessions, c.srsMaxInterval);
  return { intervalSessions, dueSession: sessionIndex + intervalSessions };
}
