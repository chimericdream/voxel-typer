/**
 * Session stats (contracts §3.5) and lifetime per-key stats (§3.6).
 *
 * The rates are checked against the hand-computed fixtures in `tests/fixtures/stats/rates.json`
 * (the arithmetic is in each case's `why`), both directly and through the accumulator.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { KeystrokeFact, SummaryContext } from "../../../src/engine/session";
import {
  consistencyOf,
  createAccumulator,
  foldKeyAggs,
  foldSummaryIntoBigramStats,
  foldSummaryIntoKeyStats,
  LATENCY_RING_SIZE,
  MAX_SESSION_KEY_LATENCIES,
  median,
  sessionRates,
  summarize,
} from "../../../src/engine/stats";
import type { KeyAgg, KeyStat, RateInput, SessionSummary } from "../../../src/engine/stats";
import type { SessionConfig } from "../../../src/engine/types";

const SEED = 20261111;

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

interface RateCase {
  name: string;
  why: string[];
  input: RateInput;
  expected: { grossWpm: number; netWpm: number; accuracy: number; consistency: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => typeof v === "number");
}

function isRateCase(value: unknown): value is RateCase {
  if (!isRecord(value)) return false;
  const { name, why, input, expected } = value;
  return (
    typeof name === "string" &&
    Array.isArray(why) &&
    why.length > 0 &&
    why.every((line) => typeof line === "string") &&
    isRecord(input) &&
    ["activeMs", "keystrokes", "correct", "uncorrected"].every(
      (k) => typeof input[k] === "number",
    ) &&
    isNumberArray(input["latencies"]) &&
    isRecord(expected) &&
    ["grossWpm", "netWpm", "accuracy", "consistency"].every((k) => typeof expected[k] === "number")
  );
}

function loadCases(): RateCase[] {
  const path = resolve(import.meta.dirname, "../../fixtures/stats/rates.json");
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed["cases"])) throw new Error("bad fixture file");
  const cases: unknown[] = parsed["cases"];
  return cases.map((c) => {
    if (!isRateCase(c)) throw new Error(`bad fixture case: ${JSON.stringify(c)}`);
    return c;
  });
}

const CASES = loadCases();

function config(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    policy: "stay",
    targeting: "sequential",
    caseSensitive: true,
    end: { kind: "targets" },
    mode: "mine",
    seed: 7,
    ...overrides,
  };
}

function context(overrides: Partial<SummaryContext> = {}): SummaryContext {
  return { config: config(), startedAtT: 0, activeMs: 60_000, uncorrected: 0, ...overrides };
}

function fact(overrides: Partial<KeystrokeFact> = {}): KeystrokeFact {
  return {
    t: 0,
    correct: true,
    expected: "a",
    got: "a",
    previous: null,
    latencyMs: null,
    repeat: false,
    streak: 1,
    ...overrides,
  };
}

/** Facts that add up to a fixture's counts: the latencies ride on the first correct keys. */
function factsFor(input: RateInput): KeystrokeFact[] {
  const facts: KeystrokeFact[] = [];
  for (let i = 0; i < input.correct; i++) {
    facts.push(fact({ latencyMs: input.latencies[i] ?? null, streak: i + 1 }));
  }
  for (let i = input.correct; i < input.keystrokes; i++) {
    facts.push(fact({ correct: false, got: "x", streak: 0 }));
  }
  return facts;
}

describe("rates: hand-computed fixtures (tests/fixtures/stats/rates.json)", () => {
  it("has at least 6 cases, including activeMs < 1000 and zero keystrokes", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(6);
    expect(CASES.some((c) => c.input.activeMs < 1000 && c.input.keystrokes > 0)).toBe(true);
    expect(CASES.some((c) => c.input.keystrokes === 0)).toBe(true);
  });

  it.each(CASES.map((c) => [c.name, c] as const))("%s: sessionRates", (_name, c) => {
    const rates = sessionRates(c.input);
    expect(rates.grossWpm).toBeCloseTo(c.expected.grossWpm, 9);
    expect(rates.netWpm).toBeCloseTo(c.expected.netWpm, 9);
    expect(rates.accuracy).toBeCloseTo(c.expected.accuracy, 12);
    expect(rates.consistency).toBeCloseTo(c.expected.consistency, 12);
  });

  it.each(CASES.map((c) => [c.name, c] as const))("%s: through the accumulator", (_name, c) => {
    // Every latency needs a correct key to ride on.
    expect(c.input.latencies.length).toBeLessThanOrEqual(c.input.correct);
    const acc = createAccumulator();
    for (const f of factsFor(c.input)) acc.keystroke(f);
    const summary = acc.summarize(
      context({ activeMs: c.input.activeMs, uncorrected: c.input.uncorrected }),
    );
    expect(summary).toMatchObject({
      activeMs: c.input.activeMs,
      keystrokes: c.input.keystrokes,
      correct: c.input.correct,
      errors: c.input.keystrokes - c.input.correct,
      uncorrected: c.input.uncorrected,
    });
    expect(summary.grossWpm).toBeCloseTo(c.expected.grossWpm, 9);
    expect(summary.netWpm).toBeCloseTo(c.expected.netWpm, 9);
    expect(summary.accuracy).toBeCloseTo(c.expected.accuracy, 12);
    expect(summary.consistency).toBeCloseTo(c.expected.consistency, 12);
  });
});

describe("math helpers", () => {
  it("consistency is 1 when every latency is 0 (mean 0)", () => {
    expect(consistencyOf(Array.from({ length: 10 }, () => 0))).toBe(1);
  });

  it("consistency uses the population standard deviation", () => {
    // 1, 3 repeated: mean 2, population stddev 1 → 0.5. The sample stddev would be ~1.054.
    expect(consistencyOf([1, 3, 1, 3, 1, 3, 1, 3, 1, 3])).toBe(0.5);
  });

  it.each([
    [[], null],
    [[5], 5],
    [[3, 1, 2], 2],
    [[4, 1, 3, 2], 2.5],
    [[10, 10, 30, 30], 20],
  ] as const)("median(%j) = %s", (values, expected) => {
    expect(median(values)).toBe(expected);
  });

  it("median leaves its input unsorted", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

// ── Accumulator ─────────────────────────────────────────────────────────────────────────────────

describe("createAccumulator", () => {
  it("counts per key and per bigram, skipping repeats and keys with no expected char", () => {
    const acc = createAccumulator();
    acc.keystroke(fact({ expected: "a", got: "a", streak: 1 }));
    acc.keystroke(fact({ expected: "s", got: "s", previous: "a", latencyMs: 120, streak: 2 }));
    // A wrong key at "d", then a repeat at the same stay position, then the right key.
    acc.keystroke(fact({ correct: false, expected: "d", got: "f", previous: "s", streak: 0 }));
    acc.keystroke(
      fact({ correct: false, expected: "d", got: "g", previous: "s", repeat: true, streak: 0 }),
    );
    acc.keystroke(fact({ expected: "d", got: "d", previous: "s", latencyMs: 300, streak: 1 }));
    // A lockOn miss: a keystroke and an error, but no key.
    acc.keystroke(fact({ correct: false, expected: null, got: "q", streak: 0 }));
    acc.targetCompleted();

    const summary = acc.summarize(context({ activeMs: 6000, startedAtT: 50 }));
    expect(summary).toEqual({
      mode: "mine",
      seed: 7,
      startedAtT: 50,
      activeMs: 6000,
      keystrokes: 6,
      correct: 3,
      errors: 3,
      uncorrected: 0,
      // (3 / 5) / 0.1 = 6
      grossWpm: expect.closeTo(6, 12),
      netWpm: expect.closeTo(6, 12),
      accuracy: 0.5,
      consistency: 0,
      perKey: {
        a: { attempts: 1, errors: 0, latencies: [] },
        s: { attempts: 1, errors: 0, latencies: [120] },
        d: { attempts: 2, errors: 1, latencies: [300] },
      },
      bigrams: {
        as: { attempts: 1, errors: 0, latencies: [120] },
        sd: { attempts: 2, errors: 1, latencies: [300] },
      },
      longestStreak: 2,
      targetsCompleted: 1,
    });
  });

  it("carries the lesson id only when the config has one", () => {
    const withLesson = createAccumulator().summarize(
      context({ config: config({ lessonId: "meadow-01", mode: "practice", seed: 3 }) }),
    );
    expect(withLesson).toMatchObject({ lessonId: "meadow-01", mode: "practice", seed: 3 });
    const without = createAccumulator().summarize(context());
    expect("lessonId" in without).toBe(false);
  });

  it(`caps each key's session latencies at ${MAX_SESSION_KEY_LATENCIES}, but not consistency's`, () => {
    const acc = createAccumulator();
    for (let i = 0; i < MAX_SESSION_KEY_LATENCIES + 50; i++) {
      acc.keystroke(fact({ expected: "a", previous: "a", latencyMs: i }));
    }
    const summary = acc.summarize(context());
    expect(summary.perKey["a"]?.attempts).toBe(MAX_SESSION_KEY_LATENCIES + 50);
    expect(summary.perKey["a"]?.latencies).toHaveLength(MAX_SESSION_KEY_LATENCIES);
    expect(summary.bigrams["aa"]?.latencies).toHaveLength(MAX_SESSION_KEY_LATENCIES);
    expect(acc.totals.latencies).toHaveLength(MAX_SESSION_KEY_LATENCIES + 50);
  });

  it("the summary shares no objects with the accumulator", () => {
    const acc = createAccumulator();
    acc.keystroke(fact({ latencyMs: 10 }));
    const summary = acc.summarize(context());
    acc.keystroke(fact({ latencyMs: 20 }));
    expect(summary.perKey["a"]).toEqual({ attempts: 1, errors: 0, latencies: [10] });
    expect(summarize(acc.totals, context()).perKey["a"]?.attempts).toBe(2);
  });

  it("property: correct + errors === keystrokes, and per-key counts stay within them", () => {
    const factArb = fc.record({
      correct: fc.boolean(),
      expected: fc.option(fc.constantFrom("a", "s", "d", " "), { nil: null }),
      previous: fc.option(fc.constantFrom("a", "s"), { nil: null }),
      latencyMs: fc.option(fc.integer({ min: 0, max: 2000 }), { nil: null }),
      repeat: fc.boolean(),
      streak: fc.nat(50),
    });
    fc.assert(
      fc.property(fc.array(factArb, { maxLength: 80 }), fc.nat(120_000), (raw, activeMs) => {
        const acc = createAccumulator();
        for (const f of raw) acc.keystroke(fact({ ...f, got: "a" }));
        const s = acc.summarize(context({ activeMs }));
        expect(s.correct + s.errors).toBe(s.keystrokes);
        expect(s.keystrokes).toBe(raw.length);
        const keyAttempts = Object.values(s.perKey).reduce((n, agg) => n + agg.attempts, 0);
        expect(keyAttempts).toBeLessThanOrEqual(s.keystrokes);
        for (const agg of [...Object.values(s.perKey), ...Object.values(s.bigrams)]) {
          expect(agg.errors).toBeLessThanOrEqual(agg.attempts);
        }
        expect(s.accuracy).toBeGreaterThanOrEqual(0);
        expect(s.accuracy).toBeLessThanOrEqual(1);
        expect(s.consistency).toBeGreaterThanOrEqual(0);
        expect(s.consistency).toBeLessThanOrEqual(1);
        expect(s.netWpm).toBeLessThanOrEqual(s.grossWpm);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});

// ── Folding into lifetime stats ─────────────────────────────────────────────────────────────────

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function stat(overrides: Partial<KeyStat> = {}): KeyStat {
  return {
    attempts: 10,
    errors: 2,
    recentErrRate: 0.2,
    latencyMedian: 250,
    recentLatencies: [200, 250, 300],
    lastSeenSession: 4,
    srs: { intervalSessions: 2, dueSession: 6 },
    ...overrides,
  };
}

function summaryWith(
  perKey: Record<string, KeyAgg>,
  bigrams: Record<string, KeyAgg> = {},
): SessionSummary {
  const acc = createAccumulator();
  return { ...acc.summarize(context()), perKey, bigrams };
}

describe("foldSummaryIntoKeyStats", () => {
  it("is pure: its inputs deep-equal themselves afterwards, and the result shares no objects", () => {
    const prev = { a: stat(), z: stat({ attempts: 3 }) };
    const summary = summaryWith({ a: { attempts: 4, errors: 1, latencies: [100, 400] } });
    const prevCopy = structuredClone(prev);
    const summaryCopy = structuredClone(summary);
    deepFreeze(prev);
    deepFreeze(summary);

    const next = foldSummaryIntoKeyStats(prev, summary, 5);

    expect(prev).toEqual(prevCopy);
    expect(summary).toEqual(summaryCopy);
    expect(next).not.toBe(prev);
    expect(next["z"]).toEqual(prev.z);
    expect(next["z"]).not.toBe(prev.z);
    expect(next["z"]?.srs).not.toBe(prev.z.srs);
    expect(next["a"]?.recentLatencies).not.toBe(summary.perKey["a"]?.latencies);
  });

  it("folds a practiced key: sums, EMA, latency ring, median, last seen; keeps srs", () => {
    const prev = { a: stat() };
    const summary = summaryWith({ a: { attempts: 4, errors: 1, latencies: [100, 400] } });
    const next = foldSummaryIntoKeyStats(prev, summary, 5);
    // r = 1 / 4 = 0.25; next = 0.25 + (0.2 − 0.25) × 0.9⁴ = 0.25 − 0.05 × 0.6561 = 0.217195
    expect(next["a"]?.recentErrRate).toBeCloseTo(0.217195, 12);
    expect(next["a"]).toMatchObject({
      attempts: 14,
      errors: 3,
      recentLatencies: [200, 250, 300, 100, 400],
      latencyMedian: 250,
      lastSeenSession: 5,
      srs: { intervalSessions: 2, dueSession: 6 },
    });
  });

  it("the EMA step equals α = 0.1 applied once per attempt with the session's error rate", () => {
    // One attempt, wrong: 0.2 + 0.1 × (1 − 0.2) = 0.28.
    const one = foldSummaryIntoKeyStats(
      { a: stat() },
      summaryWith({ a: { attempts: 1, errors: 1, latencies: [] } }),
      5,
    );
    expect(one["a"]?.recentErrRate).toBeCloseTo(0.28, 12);
    // Two attempts, both right: 0.2 × 0.9 × 0.9 = 0.162.
    const two = foldSummaryIntoKeyStats(
      { a: stat() },
      summaryWith({ a: { attempts: 2, errors: 0, latencies: [] } }),
      5,
    );
    expect(two["a"]?.recentErrRate).toBeCloseTo(0.162, 12);
  });

  it("starts a new key from the session's own numbers", () => {
    const next = foldSummaryIntoKeyStats(
      {},
      summaryWith({ k: { attempts: 5, errors: 2, latencies: [300, 100, 200] } }),
      9,
    );
    expect(next).toEqual({
      k: {
        attempts: 5,
        errors: 2,
        recentErrRate: 0.4,
        latencyMedian: 200,
        recentLatencies: [300, 100, 200],
        lastSeenSession: 9,
        srs: { intervalSessions: 1, dueSession: 10 },
      },
    });
  });

  it("a new key with no latencies has a null median", () => {
    const next = foldSummaryIntoKeyStats(
      {},
      summaryWith({ k: { attempts: 1, errors: 0, latencies: [] } }),
      1,
    );
    expect(next["k"]?.latencyMedian).toBeNull();
    expect(next["k"]?.recentLatencies).toEqual([]);
  });

  it(`caps the latency ring at ${LATENCY_RING_SIZE}, keeping the newest`, () => {
    const old = Array.from({ length: 25 }, (_, i) => i);
    const fresh = Array.from({ length: 200 }, (_, i) => 1000 + i);
    const next = foldSummaryIntoKeyStats(
      { a: stat({ recentLatencies: old }) },
      summaryWith({ a: { attempts: 200, errors: 0, latencies: fresh } }),
      5,
    );
    expect(next["a"]?.recentLatencies).toEqual(fresh.slice(-LATENCY_RING_SIZE));
    const few = foldSummaryIntoKeyStats(
      { a: stat({ recentLatencies: old }) },
      summaryWith({
        a: { attempts: 10, errors: 0, latencies: [900, 901, 902, 903, 904, 905, 906] },
      }),
      5,
    );
    expect(few["a"]?.recentLatencies).toEqual([...old.slice(2), 900, 901, 902, 903, 904, 905, 906]);
    expect(few["a"]?.recentLatencies).toHaveLength(LATENCY_RING_SIZE);
  });

  it("a key with no new latencies keeps its ring and median", () => {
    const next = foldSummaryIntoKeyStats(
      { a: stat() },
      summaryWith({ a: { attempts: 1, errors: 0, latencies: [] } }),
      5,
    );
    expect(next["a"]).toMatchObject({ recentLatencies: [200, 250, 300], latencyMedian: 250 });
  });

  it("ignores aggregates with no attempts", () => {
    const next = foldSummaryIntoKeyStats(
      { a: stat() },
      summaryWith({
        a: { attempts: 0, errors: 0, latencies: [] },
        b: { attempts: 0, errors: 0, latencies: [] },
      }),
      5,
    );
    expect(next).toEqual({ a: stat() });
  });

  it("foldSummaryIntoBigramStats folds the bigrams by the same rules", () => {
    const summary = summaryWith(
      { a: { attempts: 9, errors: 9, latencies: [] } },
      { as: { attempts: 2, errors: 1, latencies: [150] } },
    );
    const next = foldSummaryIntoBigramStats({}, summary, 3);
    expect(next).toEqual(foldKeyAggs({}, summary.bigrams, 3));
    expect(Object.keys(next)).toEqual(["as"]);
    expect(next["as"]).toMatchObject({
      attempts: 2,
      errors: 1,
      recentErrRate: 0.5,
      latencyMedian: 150,
    });
  });

  it("property: pure, ring ≤ 30, counts add up, error rate within [0, 1]", () => {
    const aggArb = fc
      .record({
        attempts: fc.integer({ min: 0, max: 300 }),
        latencies: fc.array(fc.integer({ min: 0, max: 3000 }), { maxLength: 200 }),
        errorShare: fc.double({ min: 0, max: 1, noNaN: true }),
      })
      .map(({ attempts, latencies, errorShare }) => ({
        attempts,
        errors: Math.floor(attempts * errorShare),
        latencies,
      }));
    const statArb = fc
      .record({
        attempts: fc.nat(1000),
        errorShare: fc.double({ min: 0, max: 1, noNaN: true }),
        recentErrRate: fc.double({ min: 0, max: 1, noNaN: true }),
        recentLatencies: fc.array(fc.integer({ min: 0, max: 3000 }), { maxLength: 30 }),
        lastSeenSession: fc.nat(100),
      })
      .map((s) =>
        stat({
          attempts: s.attempts,
          errors: Math.floor(s.attempts * s.errorShare),
          recentErrRate: s.recentErrRate,
          recentLatencies: s.recentLatencies,
          latencyMedian: median(s.recentLatencies),
          lastSeenSession: s.lastSeenSession,
        }),
      );
    const keys = fc.constantFrom("a", "s", "d", "f", " ");
    fc.assert(
      fc.property(
        fc.dictionary(keys, statArb),
        fc.dictionary(keys, aggArb),
        fc.integer({ min: 101, max: 200 }),
        (prev, perKey, sessionIndex) => {
          const summary = summaryWith(perKey);
          const prevCopy = structuredClone(prev);
          const summaryCopy = structuredClone(summary);
          const next = foldSummaryIntoKeyStats(prev, summary, sessionIndex);
          expect(prev).toEqual(prevCopy);
          expect(summary).toEqual(summaryCopy);
          for (const [key, s] of Object.entries(next)) {
            expect(s.recentLatencies.length).toBeLessThanOrEqual(LATENCY_RING_SIZE);
            expect(s.recentErrRate).toBeGreaterThanOrEqual(0);
            expect(s.recentErrRate).toBeLessThanOrEqual(1);
            expect(s.latencyMedian).toBe(median(s.recentLatencies));
            const agg = perKey[key];
            const before = prev[key];
            if (agg !== undefined && agg.attempts > 0) {
              expect(s.attempts).toBe((before?.attempts ?? 0) + agg.attempts);
              expect(s.errors).toBe((before?.errors ?? 0) + agg.errors);
              expect(s.lastSeenSession).toBe(sessionIndex);
            } else {
              expect(s).toEqual(before);
            }
          }
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });
});
