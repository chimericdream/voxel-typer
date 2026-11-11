/**
 * Session summary and per-key stats (docs/impl/contracts.md §3.5–3.6). Pure.
 *
 * The session (`./session`) reports one {@link KeystrokeFact} per counted keystroke to the
 * accumulator from {@link createAccumulator}, and asks it for the {@link SessionSummary} once at the
 * end. {@link foldSummaryIntoKeyStats} then folds that summary into the profile's lifetime stats.
 */
import type { GameModeId, LessonId, Ms } from "@/types/core";
import { scheduleSrs } from "./adaptive";
import type { KeystrokeFact, SummaryAccumulator, SummaryContext } from "./session";

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
 * - `consistency = 1 − min(1, stddev(latencies) / mean(latencies))` with the POPULATION standard
 *   deviation, over all non-null latencies of the session; 0 with fewer than 10 samples. Higher is
 *   steadier.
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
  /**
   * Every non-Backspace key fed while unpaused, including `lockOn` misses. Keys fed in
   * `sequential` when no target remains are ignored and not counted.
   */
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

/** Latencies kept per key (and per bigram) in one session. */
export const MAX_SESSION_KEY_LATENCIES = 200;
/** Latencies kept per key across sessions (`KeyStat.recentLatencies`). */
export const LATENCY_RING_SIZE = 30;
/** The EMA weight of one attempt in `KeyStat.recentErrRate`. */
export const ERR_RATE_ALPHA = 0.1;
/** Below this much active time every rate is 0. */
export const MIN_RATED_ACTIVE_MS = 1000;
/** `consistency` is 0 with fewer latency samples than this. */
export const MIN_CONSISTENCY_SAMPLES = 10;

// ── Math ──────────────────────────────────────────────────────────────────────────────────────

/** The median of `values`, or `null` when there are none. An even count averages the middle two. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? 0) + upper) / 2;
}

/**
 * `1 − min(1, stddev / mean)` with the population standard deviation; 0 under 10 samples. When the
 * mean is 0 every sample is 0, which is perfectly steady: 1.
 */
export function consistencyOf(latencies: readonly Ms[]): number {
  if (latencies.length < MIN_CONSISTENCY_SAMPLES) return 0;
  const mean = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
  if (mean === 0) return 1;
  const variance =
    latencies.reduce((sum, value) => sum + (value - mean) ** 2, 0) / latencies.length;
  return 1 - Math.min(1, Math.sqrt(variance) / mean);
}

/** The counts the four rates of a {@link SessionSummary} are computed from. */
export interface RateInput {
  activeMs: Ms;
  keystrokes: number;
  correct: number;
  uncorrected: number;
  /** Every non-null latency of the session. */
  latencies: readonly Ms[];
}

/** The four rates of a {@link SessionSummary}, by the formulas of contracts §3.5. */
export function sessionRates(input: RateInput): {
  grossWpm: number;
  netWpm: number;
  accuracy: number;
  consistency: number;
} {
  const { activeMs, keystrokes, correct, uncorrected, latencies } = input;
  const rated = activeMs >= MIN_RATED_ACTIVE_MS;
  const minutes = activeMs / 60_000;
  const grossWpm = rated ? correct / 5 / minutes : 0;
  return {
    grossWpm,
    netWpm: rated ? Math.max(0, grossWpm - uncorrected / minutes) : 0,
    accuracy: keystrokes === 0 ? 1 : correct / keystrokes,
    consistency: consistencyOf(latencies),
  };
}

// ── Accumulator ───────────────────────────────────────────────────────────────────────────────

/** The counters of one session, as the accumulator collects them. */
export interface SessionTotals {
  keystrokes: number;
  correct: number;
  errors: number;
  longestStreak: number;
  targetsCompleted: number;
  perKey: Record<string, KeyAgg>;
  bigrams: Record<string, KeyAgg>;
  /** Every non-null latency of the session, uncapped (for `consistency`). */
  latencies: Ms[];
}

/** A {@link SummaryAccumulator} whose counters can be read, for {@link summarize}. */
export interface StatsAccumulator extends SummaryAccumulator {
  readonly totals: Readonly<SessionTotals>;
}

function bump(table: Record<string, KeyAgg>, key: string, fact: KeystrokeFact): void {
  const agg = (table[key] ??= { attempts: 0, errors: 0, latencies: [] });
  agg.attempts += 1;
  if (!fact.correct) agg.errors += 1;
  if (fact.latencyMs !== null && agg.latencies.length < MAX_SESSION_KEY_LATENCIES) {
    agg.latencies.push(fact.latencyMs);
  }
}

/**
 * The accumulator every typing session uses (the plug-in point of `./session`).
 *
 * Counting rules:
 * - Every fact is a keystroke; a correct one adds to `correct`, a wrong one to `errors`.
 * - Per key: a fact aimed at an expected char is one attempt for that char, and a wrong one is one
 *   error. A `repeat` (another wrong key at a `stay` position that already took one) only counts
 *   in the session totals, so mashing wrong keys at one position is one error for that key, not
 *   ten. A fact with `expected: null` (a `lockOn` miss, a key past a full target) has no key.
 * - Bigrams: the same attempt, keyed by `previous + expected` when `previous` is not null.
 */
export function createAccumulator(): StatsAccumulator {
  const totals: SessionTotals = {
    keystrokes: 0,
    correct: 0,
    errors: 0,
    longestStreak: 0,
    targetsCompleted: 0,
    perKey: {},
    bigrams: {},
    latencies: [],
  };
  return {
    totals,
    keystroke(fact) {
      totals.keystrokes += 1;
      if (fact.correct) totals.correct += 1;
      else totals.errors += 1;
      totals.longestStreak = Math.max(totals.longestStreak, fact.streak);
      if (fact.latencyMs !== null) totals.latencies.push(fact.latencyMs);
      if (fact.expected === null || fact.repeat) return;
      bump(totals.perKey, fact.expected, fact);
      if (fact.previous !== null) bump(totals.bigrams, fact.previous + fact.expected, fact);
    },
    targetCompleted() {
      totals.targetsCompleted += 1;
    },
    summarize(context) {
      return summarize(totals, context);
    },
  };
}

/**
 * Turns a session's counters into its {@link SessionSummary}. The context carries what only the
 * session knows: the config, the start time, `activeMs` and `uncorrected`. The summary shares no
 * objects with `totals`.
 */
export function summarize(
  totals: Readonly<SessionTotals>,
  context: SummaryContext,
): SessionSummary {
  const { config, startedAtT, activeMs, uncorrected } = context;
  return {
    ...(config.lessonId === undefined ? {} : { lessonId: config.lessonId }),
    mode: config.mode,
    seed: config.seed,
    startedAtT,
    activeMs,
    keystrokes: totals.keystrokes,
    correct: totals.correct,
    errors: totals.errors,
    uncorrected,
    ...sessionRates({
      activeMs,
      keystrokes: totals.keystrokes,
      correct: totals.correct,
      uncorrected,
      latencies: totals.latencies,
    }),
    perKey: structuredClone(totals.perKey),
    bigrams: structuredClone(totals.bigrams),
    longestStreak: totals.longestStreak,
    targetsCompleted: totals.targetsCompleted,
  };
}

// ── Folding into lifetime stats ───────────────────────────────────────────────────────────────

/**
 * Folds one session's per-key (or per-bigram) aggregates into lifetime stats. Pure: it returns a new
 * object that shares nothing with `prev` or `aggs`.
 *
 * For each key with at least one attempt this session:
 * - `attempts` and `errors` add up.
 * - `recentErrRate` takes `a` EMA steps of α = 0.1. The session only has counts, not the order of
 *   right and wrong attempts, so each step uses the session's error rate `r = errors / attempts`:
 *   `next = r + (prev − r) × 0.9^a`. That is the average result over every order of the attempts.
 *   A key seen for the first time starts at `r`.
 * - `recentLatencies` appends the session's latencies and keeps the last 30; `latencyMedian` is
 *   their median (`null` while empty).
 * - `lastSeenSession` becomes `sessionIndex`.
 * - `srs` is rescheduled by `scheduleSrs` (`./adaptive`) from the session's accuracy on the key,
 *   `1 − r`. A new key starts from `{ intervalSessions: 1 }` before that step.
 *
 * Keys with no attempts this session are copied unchanged.
 */
export function foldKeyAggs(
  prev: Readonly<Record<string, KeyStat>>,
  aggs: Readonly<Record<string, KeyAgg>>,
  sessionIndex: number,
): Record<string, KeyStat> {
  const next: Record<string, KeyStat> = structuredClone(prev);
  for (const [key, agg] of Object.entries(aggs)) {
    if (agg.attempts <= 0) continue;
    const rate = agg.errors / agg.attempts;
    const old = next[key];
    const recentLatencies = [...(old?.recentLatencies ?? []), ...agg.latencies].slice(
      -LATENCY_RING_SIZE,
    );
    const folded: KeyStat = {
      attempts: (old?.attempts ?? 0) + agg.attempts,
      errors: (old?.errors ?? 0) + agg.errors,
      recentErrRate:
        old === undefined
          ? rate
          : rate + (old.recentErrRate - rate) * (1 - ERR_RATE_ALPHA) ** agg.attempts,
      latencyMedian: median(recentLatencies),
      recentLatencies,
      lastSeenSession: sessionIndex,
      srs: old?.srs ?? { intervalSessions: 1, dueSession: sessionIndex + 1 },
    };
    next[key] = { ...folded, srs: scheduleSrs(folded, sessionIndex, 1 - rate) };
  }
  return next;
}

/**
 * Folds a session's `perKey` into the profile's `keyStats` (see {@link foldKeyAggs} for the rules).
 * Pure: it returns a new object and leaves `prev` and `summary` untouched.
 */
export function foldSummaryIntoKeyStats(
  prev: Record<string, KeyStat>,
  summary: SessionSummary,
  sessionIndex: number,
): Record<string, KeyStat> {
  return foldKeyAggs(prev, summary.perKey, sessionIndex);
}

/**
 * Folds a session's `bigrams` into the profile's `bigramStats`, by the same rules as
 * {@link foldSummaryIntoKeyStats}. Pure.
 */
export function foldSummaryIntoBigramStats(
  prev: Record<string, KeyStat>,
  summary: SessionSummary,
  sessionIndex: number,
): Record<string, KeyStat> {
  return foldKeyAggs(prev, summary.bigrams, sessionIndex);
}
