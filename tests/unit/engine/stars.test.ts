/**
 * Star rules and the speed baseline (contracts §6), tested at each threshold boundary.
 */
import { describe, expect, it } from "vitest";
import { BAND_STAR_RULES, baselineNetWpm, computeStars } from "../../../src/engine/stars";
import type { StarInput } from "../../../src/engine/stars";
import type { AgeBand, GameModeId } from "../../../src/types/core";

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

describe("computeStars: band-aware bars (decision 80)", () => {
  // [band, lesson accuracy target, accuracy, stars], no speed goal. Each bar is tested on it and
  // just under it. The lesson targets cover the floor winning (0.80, 0.85) and the target winning
  // (0.90 for Miner and Builder, 0.95 for everyone).
  const table: [AgeBand, number, number, 1 | 2 | 3][] = [
    // Sprout: 2nd star at max(0.85, target − 0.05), 3rd at 0.90.
    ["sprout", 0.8, 0.8499, 1],
    ["sprout", 0.8, 0.85, 2],
    ["sprout", 0.9, 0.8499, 1],
    ["sprout", 0.9, 0.85, 2],
    ["sprout", 0.9, 0.8999, 2],
    ["sprout", 0.9, 0.9, 3],
    ["sprout", 0.95, 0.8999, 1],
    ["sprout", 0.95, 0.9, 3],
    ["sprout", 0.97, 0.9199, 2],
    ["sprout", 0.97, 0.92, 3],
    ["sprout", 0.9, 1, 3],
    // Miner: 2nd star at max(0.88, target − 0.02), 3rd at 0.93.
    ["miner", 0.85, 0.8799, 1],
    ["miner", 0.85, 0.88, 2],
    ["miner", 0.9, 0.8799, 1],
    ["miner", 0.9, 0.88, 2],
    ["miner", 0.9, 0.9299, 2],
    ["miner", 0.9, 0.93, 3],
    ["miner", 0.95, 0.9299, 1],
    ["miner", 0.95, 0.93, 3],
    ["miner", 0.9, 1, 3],
    // Builder: 2nd star at max(0.90, target), 3rd at 0.95 (the rules with no band).
    ["builder", 0.85, 0.8999, 1],
    ["builder", 0.85, 0.9, 2],
    ["builder", 0.9, 0.8999, 1],
    ["builder", 0.9, 0.9, 2],
    ["builder", 0.9, 0.9499, 2],
    ["builder", 0.9, 0.95, 3],
    ["builder", 0.93, 0.9299, 1],
    ["builder", 0.93, 0.93, 2],
    ["builder", 0.97, 0.96, 2],
    ["builder", 0.97, 0.97, 3],
    ["builder", 0.9, 1, 3],
  ];
  it.each(table)("%s, target %s: accuracy %s → %i stars", (band, target, accuracy, stars) => {
    expect(computeStars(input({ band, accuracy, targets: { accuracy: target } }))).toBe(stars);
  });

  it("a missing band gives the same stars as Builder for every row of the table", () => {
    for (const [, target, accuracy] of table) {
      const base = input({ accuracy, targets: { accuracy: target } });
      expect(computeStars(base)).toBe(computeStars({ ...base, band: "builder" }));
    }
  });

  it("accuracy as the session computes it lands on the bar: 17 / 20, 22 / 25 and 57 / 60", () => {
    const targets = { accuracy: 0.9 };
    expect(computeStars(input({ band: "sprout", accuracy: 17 / 20, targets }))).toBe(2);
    expect(computeStars(input({ band: "sprout", accuracy: 9 / 10, targets }))).toBe(3);
    expect(computeStars(input({ band: "miner", accuracy: 22 / 25, targets }))).toBe(2);
    expect(computeStars(input({ band: "builder", accuracy: 57 / 60, targets }))).toBe(3);
  });

  it("no band ever gives 0 stars to a finished lesson, or any to an unfinished one", () => {
    for (const band of ["sprout", "miner", "builder"] as const) {
      expect(computeStars(input({ band, accuracy: 0 }))).toBe(1);
      expect(computeStars(input({ band, completed: false }))).toBe(0);
    }
  });

  it("Sprout has no speed check: 3 stars however slow, at 0.90 and up", () => {
    const targets = { accuracy: 0.9, wpmRelative: 1.1 };
    expect(computeStars(input({ band: "sprout", targets, baseline: 20, netWpm: 1 }))).toBe(3);
    expect(computeStars(input({ band: "sprout", targets, baseline: 20, netWpm: 0 }))).toBe(3);
    expect(BAND_STAR_RULES.sprout.speedCheck).toBe(false);
  });

  it.each(["miner", "builder"] as const)("%s keeps the speed check on the 3rd star", (band) => {
    const targets = { accuracy: 0.9, wpmRelative: 1.1 };
    expect(computeStars(input({ band, targets, baseline: 20, netWpm: 22 }))).toBe(3);
    expect(computeStars(input({ band, targets, baseline: 20, netWpm: 21.99 }))).toBe(2);
    expect(computeStars(input({ band, targets, baseline: null, netWpm: 0 }))).toBe(3);
  });

  it("the bars never get stricter from Sprout to Miner to Builder", () => {
    for (const target of [0.8, 0.85, 0.9, 0.95, 0.99]) {
      for (let a = 0; a <= 1000; a++) {
        const accuracy = a / 1000;
        const at = (band: AgeBand): number =>
          computeStars(input({ band, accuracy, targets: { accuracy: target } }));
        expect(at("sprout")).toBeGreaterThanOrEqual(at("miner"));
        expect(at("miner")).toBeGreaterThanOrEqual(at("builder"));
      }
    }
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
