/**
 * Session summary and per-key stats (docs/impl/contracts.md §3.5–3.6). Pure.
 *
 * Stubs only; M1-04 implements them.
 */
import type { GameModeId, LessonId, Ms } from "@/types/core";

/**
 * What happened to one expected char (or one bigram) in a session. `latencies` is capped at 200
 * entries per session.
 */
export interface KeyAgg {
  attempts: number;
  errors: number;
  latencies: Ms[];
}

/**
 * The result of one session.
 *
 * Formulas (pinned; the tests use hand-computed fixtures):
 * - `minutes = activeMs / 60000`. If `activeMs < 1000`, all rates are 0.
 * - `grossWpm = (correct / 5) / minutes`
 * - `netWpm = max(0, grossWpm − uncorrected / minutes)`
 * - `accuracy = keystrokes === 0 ? 1 : correct / keystrokes` (0–1; shown as a percentage)
 * - `consistency = 1 − min(1, stddev(latencies) / mean(latencies))` over all non-null latencies of
 *   the session; 0 with fewer than 10 samples. Higher is steadier.
 *
 * Values are stored unrounded. Round only for display.
 */
export interface SessionSummary {
  lessonId?: LessonId;
  mode: GameModeId;
  seed: number;
  startedAtT: Ms;
  /** Time spent unpaused. */
  activeMs: Ms;
  /** Every non-Backspace key fed while unpaused, including `lockOn` misses. */
  keystrokes: number;
  /** Correct keystrokes (chars, including spaces). */
  correct: number;
  /** Wrong keystrokes. */
  errors: number;
  /** Positions still wrong at the end (`skip` policy). Always 0 for `stay` and `backspace`. */
  uncorrected: number;
  grossWpm: number;
  netWpm: number;
  accuracy: number;
  consistency: number;
  /** Keyed by the expected char. */
  perKey: Record<string, KeyAgg>;
  /** Keyed by the 2-char string. Attributed to the second char's attempt. */
  bigrams: Record<string, KeyAgg>;
  longestStreak: number;
  targetsCompleted: number;
}

/** What a profile remembers about one key (or one bigram) across sessions. */
export interface KeyStat {
  /** Lifetime count. */
  attempts: number;
  /** Lifetime count. */
  errors: number;
  /** Exponential moving average of the error rate, α = 0.1 per attempt. */
  recentErrRate: number;
  /** Median of `recentLatencies`. */
  latencyMedian: Ms | null;
  /** A ring of the last 30 latencies. */
  recentLatencies: Ms[];
  /** The profile's session counter when this key was last practiced. */
  lastSeenSession: number;
  /** Spaced repetition, counted in sessions, not days. */
  srs: { intervalSessions: number; dueSession: number };
}

/**
 * Folds one session into the lifetime per-key stats. Pure: it returns a new object and leaves
 * `prev` and `summary` untouched.
 */
export function foldSummaryIntoKeyStats(
  prev: Record<string, KeyStat>,
  summary: SessionSummary,
  sessionIndex: number,
): Record<string, KeyStat> {
  void [prev, summary, sessionIndex];
  throw new Error("not implemented: foldSummaryIntoKeyStats");
}
