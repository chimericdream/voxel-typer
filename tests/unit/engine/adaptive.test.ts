import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  ADAPTIVE_CONSTANTS,
  dueReviewKeys,
  keyWeights,
  scheduleSrs,
  weakKeys,
} from "../../../src/engine/adaptive";
import type { AdaptiveParams } from "../../../src/engine/adaptive";
import type { KeyStat } from "../../../src/engine/stats";

function stat(patch: Partial<KeyStat> = {}): KeyStat {
  return {
    attempts: 50,
    errors: 0,
    recentErrRate: 0,
    latencyMedian: null,
    recentLatencies: [],
    lastSeenSession: 0,
    srs: { intervalSessions: 1, dueSession: 1 },
    ...patch,
  };
}
function params(
  stats: AdaptiveParams["stats"] = {},
  patch: Partial<AdaptiveParams> = {},
): AdaptiveParams {
  return {
    allowed: ["a", "s", "d", " "],
    focus: [],
    stats,
    sessionIndex: 10,
    targetLatencyMs: 500,
    ...patch,
  };
}

describe("adaptive weights", () => {
  it("pins the smoothed formula, unseen threshold, latency cap and focus floor", () => {
    const weights = keyWeights(
      params({
        a: stat({ attempts: 10, recentErrRate: 0.2, latencyMedian: 750 }),
        s: stat({ attempts: 4, recentErrRate: 1, latencyMedian: 5000 }),
        d: stat({ attempts: 5 }),
      }),
    );
    expect(weights.a).toBeCloseTo(2.65);
    expect(weights.s).toBe(2);
    expect(weights.d).toBeCloseTo(1.15);
    expect(weights[" "]).toBe(2);
    expect(keyWeights(params({ a: stat({ attempts: 500, latencyMedian: 5000 }) })).a).toBeCloseTo(
      1 + (6 * 0.25) / 55 + 3,
    );
    expect(keyWeights(params({}, { focus: ["a", "x"] })).a).toBe(3);
    expect(weights).not.toHaveProperty("x");
    expect(ADAPTIVE_CONSTANTS.focusMinWeight).toBe(3);
  });

  it("never lowers weight for more errors or slower latency; focus always reaches 3", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 0, max: 10000 }),
        (attempts, e1, e2, l1, l2) => {
          const weight = (recentErrRate: number, latencyMedian: number, focus: string[] = []) =>
            keyWeights(params({ a: stat({ attempts, recentErrRate, latencyMedian }) }, { focus }))
              .a ?? 0;
          expect(weight(Math.max(e1, e2), l1)).toBeGreaterThanOrEqual(weight(Math.min(e1, e2), l1));
          expect(weight(e1, Math.max(l1, l2))).toBeGreaterThanOrEqual(weight(e1, Math.min(l1, l2)));
          expect(weight(e1, l1, ["a"])).toBeGreaterThanOrEqual(3);
        },
      ),
      { seed: 1105, numRuns: 2000 },
    );
  });

  it("ranks only allowed non-focus keys and handles ties, duplicates and empty limits", () => {
    const p = params(
      {
        a: stat({ recentErrRate: 1 }),
        s: stat({ latencyMedian: 1500 }),
        x: stat({ recentErrRate: 1 }),
      },
      { focus: ["a"], allowed: ["a", "s", "d", " ", "s"] },
    );
    expect(weakKeys(p, 10)).toEqual(["s", "d", " "]);
    expect(weakKeys(p, 1)).toEqual(["s"]);
    expect(weakKeys(p, 0)).toEqual([]);
    expect(weakKeys(p, -1)).toEqual([]);
    expect(keyWeights(params({}, { allowed: [] }))).toEqual({});
    expect(weakKeys(params({}, { allowed: [] }), 2)).toEqual([]);
    // Ties keep `allowed` order even for integer-like keys (object key order would put "1" first).
    expect(weakKeys(params({}, { allowed: ["a", "2", "1"] }), 3)).toEqual(["a", "2", "1"]);
  });

  it("treats a non-positive target latency as not slow instead of NaN", () => {
    const notSlow = keyWeights(params({ s: stat({ latencyMedian: null }) }))["s"];
    for (const targetLatencyMs of [0, -5]) {
      const w = keyWeights(params({ s: stat({ latencyMedian: 0 }) }, { targetLatencyMs }))["s"];
      expect(w).toBe(notSlow);
    }
  });
});

describe("review and SRS", () => {
  it("returns only known allowed keys due now or overdue, once", () => {
    expect(
      dueReviewKeys(
        params(
          {
            a: stat({ srs: { intervalSessions: 2, dueSession: 10 } }),
            s: stat({ srs: { intervalSessions: 2, dueSession: 9 } }),
            d: stat({ srs: { intervalSessions: 2, dueSession: 11 } }),
            x: stat(),
          },
          { allowed: ["a", "s", "d", " ", "a"], focus: ["a"] },
        ),
      ),
    ).toEqual(["a", "s"]);
    expect(dueReviewKeys(params())).toEqual([]);
  });

  it.each([
    [0.95, 4, 8],
    [1, 32, 32],
    [0.949, 4, 4],
    [0.85, 4, 4],
    [0.849, 4, 1],
    [0, 32, 1],
    [0.95, 1, 2],
    [0.9, 0, 1],
  ])("accuracy %s with interval %s schedules interval %s", (accuracy, interval, expected) => {
    const input = stat({ srs: { intervalSessions: interval, dueSession: 0 } });
    const before = structuredClone(input);
    expect(scheduleSrs(input, 10, accuracy)).toEqual({
      intervalSessions: expected,
      dueSession: 10 + expected,
    });
    expect(input).toEqual(before);
  });

  it("does not mutate parameters and produces repeatable results", () => {
    const p = params({ a: stat() }, { focus: ["s"] });
    const before = structuredClone(p);
    const first = [keyWeights(p), weakKeys(p, 2), dueReviewKeys(p)];
    expect([keyWeights(p), weakKeys(p, 2), dueReviewKeys(p)]).toEqual(first);
    expect(p).toEqual(before);
  });
});
