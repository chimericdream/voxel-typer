/**
 * Star rules and the speed baseline (contracts §6), tested at each threshold boundary.
 */
import { describe, expect, it } from "vitest";
import { baselineNetWpm, computeStars } from "../../../src/engine/stars";
import type { StarInput } from "../../../src/engine/stars";
import type { GameModeId } from "../../../src/types/core";

function input(overrides: Partial<StarInput> = {}): StarInput {
  return {
    completed: true,
    accuracy: 1,
    netWpm: 20,
    targets: { accuracy: 0.9 },
    baseline: null,
    ...overrides,
  };
}

function history(...entries: [GameModeId, number][]): { mode: GameModeId; netWpm: number }[] {
  return entries.map(([mode, netWpm]) => ({ mode, netWpm }));
}

describe("computeStars: accuracy boundaries", () => {
  it.each([
    [0.5, 1],
    [0.8999, 1],
    [0.9, 2],
    [0.9499, 2],
    [0.95, 3],
    [1, 3],
  ] as const)("accuracy %s → %i stars (no speed goal)", (accuracy, stars) => {
    expect(computeStars(input({ accuracy }))).toBe(stars);
  });

  it("accuracy as the session computes it: 57 / 60 is exactly 0.95", () => {
    expect(computeStars(input({ accuracy: 57 / 60 }))).toBe(3);
    expect(computeStars(input({ accuracy: 9 / 10 }))).toBe(2);
  });

  it("a lesson accuracy goal above 0.90 raises the second star's bar", () => {
    const targets = { accuracy: 0.93 };
    expect(computeStars(input({ accuracy: 0.9299, targets }))).toBe(1);
    expect(computeStars(input({ accuracy: 0.93, targets }))).toBe(2);
  });

  it("a lesson accuracy goal below 0.90 never lowers it", () => {
    const targets = { accuracy: 0.8 };
    expect(computeStars(input({ accuracy: 0.85, targets }))).toBe(1);
    expect(computeStars(input({ accuracy: 0.8999, targets }))).toBe(1);
    expect(computeStars(input({ accuracy: 0.9, targets }))).toBe(2);
  });

  it("stars add up as written: a goal above 0.95 can give the third star without the second", () => {
    // accuracy ≥ 0.95 earns the third star; the second needs ≥ 0.97 → 1 + 0 + 1 = 2.
    const targets = { accuracy: 0.97 };
    expect(computeStars(input({ accuracy: 0.96, targets }))).toBe(2);
    expect(computeStars(input({ accuracy: 0.97, targets }))).toBe(3);
  });

  it("an unfinished lesson gets no stars, however good the play", () => {
    expect(computeStars(input({ completed: false }))).toBe(0);
    expect(computeStars(input({ completed: false, accuracy: 0.5 }))).toBe(0);
  });
});

describe("computeStars: the speed goal", () => {
  const targets = { accuracy: 0.9, wpmRelative: 1.1 };

  it("netWpm exactly at baseline × wpmRelative earns the third star, despite float noise", () => {
    // 20 × 1.1 = 22.000000000000004 in floating point.
    expect(computeStars(input({ targets, baseline: 20, netWpm: 22 }))).toBe(3);
  });

  it("netWpm below baseline × wpmRelative does not", () => {
    expect(computeStars(input({ targets, baseline: 20, netWpm: 21.99 }))).toBe(2);
  });

  it("speed alone never earns the third star", () => {
    expect(computeStars(input({ targets, baseline: 20, netWpm: 99, accuracy: 0.9499 }))).toBe(2);
  });

  it("with no baseline (fewer than 3 summaries) wpmRelative is ignored", () => {
    expect(computeStars(input({ targets, baseline: null, netWpm: 0 }))).toBe(3);
  });

  it("with no wpmRelative the baseline is ignored", () => {
    expect(computeStars(input({ baseline: 50, netWpm: 1 }))).toBe(3);
  });
});

describe("baselineNetWpm", () => {
  it("is null with fewer than 3 matching summaries", () => {
    expect(baselineNetWpm([])).toBeNull();
    expect(baselineNetWpm(history(["mine", 10], ["practice", 12]))).toBeNull();
  });

  it("is the median with exactly 3", () => {
    expect(baselineNetWpm(history(["mine", 10], ["practice", 30], ["minecart", 12]))).toBe(12);
  });

  it("only counts mine, practice and minecart", () => {
    const h = history(
      ["mine", 10],
      ["defense", 99],
      ["boss", 99],
      ["daily", 99],
      ["builder", 99],
      ["placement", 99],
      ["practice", 20],
    );
    expect(baselineNetWpm(h)).toBeNull();
    expect(baselineNetWpm([...h, ...history(["minecart", 30])])).toBe(20);
  });

  it("looks at the newest 10 matching summaries only (history is newest last)", () => {
    // Eleven old summaries at 100, then ten at 1..10: only the ten count → median 5.5.
    const old = Array.from({ length: 11 }, (): [GameModeId, number] => ["mine", 100]);
    const recent = Array.from({ length: 10 }, (_, i): [GameModeId, number] => ["practice", i + 1]);
    expect(baselineNetWpm(history(...old, ...recent))).toBe(5.5);
    // The 10-window counts matching summaries, not all summaries.
    const mixed = history(
      ["mine", 100],
      ...recent.map(([, wpm]): [GameModeId, number] => ["mine", wpm]),
    );
    expect(baselineNetWpm([...mixed, ...history(["defense", 0], ["boss", 0])])).toBe(5.5);
  });
});
