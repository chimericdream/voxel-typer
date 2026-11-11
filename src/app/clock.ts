/**
 * Clocks (docs/impl/contracts.md §13). The one place that reads the time.
 *
 * Pure code never reads a clock: it takes `t: Ms` (or a {@link Clock}) as a parameter.
 */
import type { EpochMs, Ms } from "@/types/core";

/** A source of time. */
export interface Clock {
  /** Monotonic milliseconds, for input timestamps, animation and durations. */
  now(): Ms;
  /** Wall-clock milliseconds since the Unix epoch, for save timestamps only. */
  epoch(): EpochMs;
}

/** The real clock: `performance.now()` and `Date.now()`. */
export const realClock: Clock = {
  now: () => performance.now(),
  epoch: () => Date.now(),
};

/**
 * A deterministic clock for tests and `?freeze`.
 *
 * Every `now()` call advances the clock by `stepMs`: the calls return `startMs`,
 * `startMs + stepMs`, `startMs + 2 × stepMs`, … `epoch()` never advances it. It returns the value
 * of the latest `now()` call (`startMs` before the first one), so the two readings stay in step.
 */
export function fixedStepClock(startMs: Ms, stepMs: Ms): Clock {
  let next = startMs;
  let current = startMs;
  return {
    now() {
      current = next;
      next += stepMs;
      return current;
    },
    epoch: () => current,
  };
}
