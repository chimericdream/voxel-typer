import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HISTORY_CAP, compactHistory, localWeekStart } from "../../../src/save/compact";
import { defaultSettings } from "../../../src/save/settings";
import { profileProblem } from "../../../src/save/schema";
import type { Profile, StoredSummary } from "../../../src/save/schema";

const SEED = 20261111;
const DAY = 86_400_000;
/** 2026-01-05 00:00 UTC, a Monday. */
const MONDAY = Date.UTC(2026, 0, 5);
/** Pinned week function: UTC weeks starting Monday, so the tests don't depend on the time zone. */
const utcWeek = (at: number): string => {
  const day = Math.floor(at / DAY);
  const monday = (day - ((day + 3) % 7)) * DAY; // 1970-01-01 was a Thursday.
  return new Date(monday).toISOString().slice(0, 10);
};

function summary(at: number, activeMs: number, netWpm: number, accuracy: number): StoredSummary {
  return {
    mode: "mine",
    seed: 1,
    startedAtT: 0,
    activeMs,
    keystrokes: 100,
    correct: 95,
    errors: 5,
    uncorrected: 0,
    grossWpm: netWpm,
    netWpm,
    accuracy,
    consistency: 0.5,
    longestStreak: 10,
    targetsCompleted: 5,
    at,
  };
}

function profile(history: StoredSummary[], weekly: Profile["weekly"] = []): Profile {
  return {
    id: "p",
    name: "Pip",
    ageBand: "miner",
    avatar: { skin: "moss" },
    createdAt: 0,
    settings: defaultSettings("miner"),
    progress: { lessons: {}, unlockedBiomes: ["meadow"] },
    sessionCounter: history.length,
    keyStats: {},
    bigramStats: {},
    inventory: {},
    island: null,
    cosmetics: { unlocked: [] },
    achievements: {},
    daily: { streakDates: [] },
    history,
    weekly,
    schemaVersion: 1,
  };
}

function totals(p: Profile): { minutes: number; sessions: number } {
  let minutes = 0;
  for (const s of p.history) minutes += s.activeMs / 60000;
  for (const w of p.weekly) minutes += w.minutes;
  const sessions = p.history.length + p.weekly.reduce((n, w) => n + w.sessions, 0);
  return { minutes, sessions };
}

describe("compactHistory", () => {
  it("does nothing at or below the cap", () => {
    const p = profile(
      Array.from({ length: HISTORY_CAP }, (_, i) => summary(MONDAY + i, 60000, 10, 1)),
    );
    expect(compactHistory(p)).toBe(p);
  });

  it("keeps the newest 500 and folds the oldest into weekly rows", () => {
    const history = Array.from({ length: 503 }, (_, i) =>
      summary(MONDAY + i * 3_600_000, 120_000, 10 + (i % 3), 0.9),
    );
    const p = profile(history);
    const out = compactHistory(p, HISTORY_CAP, utcWeek);
    expect(out.history.length).toBe(500);
    expect(out.history).toEqual(history.slice(3));
    expect(out.weekly).toEqual([
      {
        weekStart: "2026-01-05",
        minutes: 6,
        sessions: 3,
        avgNetWpm: (10 + 11 + 12) / 3,
        avgAccuracy: 0.9,
      },
    ]);
    expect(p.history.length).toBe(503);
    expect(p.weekly).toEqual([]);
  });

  it("merges into an existing row for the same week, weighting averages by sessions", () => {
    const p = profile(
      [summary(MONDAY + DAY, 60000, 20, 1), summary(MONDAY + 8 * DAY, 60000, 30, 1)],
      [{ weekStart: "2026-01-05", minutes: 10, sessions: 3, avgNetWpm: 10, avgAccuracy: 0.8 }],
    );
    const out = compactHistory(p, 1, utcWeek);
    expect(out.history).toEqual([p.history[1]]);
    expect(out.weekly).toEqual([
      {
        weekStart: "2026-01-05",
        minutes: 11,
        sessions: 4,
        avgNetWpm: 12.5,
        avgAccuracy: expect.closeTo(0.85, 10),
      },
    ]);
  });

  it("merges duplicate weekly rows instead of dropping one", () => {
    const row = { weekStart: "2026-01-05", minutes: 5, sessions: 2, avgNetWpm: 10, avgAccuracy: 1 };
    const p = profile([summary(MONDAY + 14 * DAY, 60000, 1, 1)], [row, row]);
    const out = compactHistory(p, 0, utcWeek);
    expect(out.weekly).toEqual([
      { ...row, minutes: 10, sessions: 4 },
      { weekStart: "2026-01-19", minutes: 1, sessions: 1, avgNetWpm: 1, avgAccuracy: 1 },
    ]);
  });

  it("keeps the rows sorted by week", () => {
    const p = profile(
      [summary(MONDAY, 60000, 1, 1)],
      [{ weekStart: "2026-03-02", minutes: 1, sessions: 1, avgNetWpm: 1, avgAccuracy: 1 }],
    );
    expect(compactHistory(p, 0, utcWeek).weekly.map((w) => w.weekStart)).toEqual([
      "2026-01-05",
      "2026-03-02",
    ]);
  });

  it("property: totals (minutes, sessions) are equal before and after, and the result is valid", () => {
    const entry = fc
      .record({
        offset: fc.integer({ min: 0, max: 400 * DAY }),
        activeMs: fc.integer({ min: 0, max: 3_600_000 }),
        netWpm: fc.double({ min: 0, max: 200, noNaN: true }),
        accuracy: fc.double({ min: 0, max: 1, noNaN: true }),
      })
      .map((e) => summary(MONDAY + e.offset, e.activeMs, e.netWpm, e.accuracy));
    const weeklyRow = fc.record({
      weekStart: fc.constantFrom("2025-12-29", "2026-01-05", "2026-01-12"),
      minutes: fc.double({ min: 0, max: 600, noNaN: true }),
      sessions: fc.integer({ min: 0, max: 50 }),
      avgNetWpm: fc.double({ min: 0, max: 200, noNaN: true }),
      avgAccuracy: fc.double({ min: 0, max: 1, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(entry, { maxLength: 120 }),
        fc.array(weeklyRow, { maxLength: 4 }),
        fc.integer({ min: 0, max: 60 }),
        (rawHistory, weekly, cap) => {
          const history = rawHistory.toSorted((a, b) => a.at - b.at);
          const p = profile(history, weekly);
          const before = totals(p);
          const out = compactHistory(p, cap, utcWeek);
          const after = totals(out);
          expect(after.sessions).toBe(before.sessions);
          expect(after.minutes).toBeCloseTo(before.minutes, 6);
          expect(out.history.length).toBe(Math.min(cap, history.length));
          expect(out.history).toEqual(history.slice(history.length - out.history.length));
          expect(profileProblem(out)).toBeNull();
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });
});

describe("localWeekStart", () => {
  it("returns the Monday of the local week as YYYY-MM-DD", () => {
    // Local noon on a Wednesday: far from midnight, so any time zone gives the same week.
    const wed = new Date(2026, 0, 7, 12).getTime();
    expect(localWeekStart(wed)).toBe("2026-01-05");
    expect(localWeekStart(new Date(2026, 0, 5, 0, 0, 1).getTime())).toBe("2026-01-05");
    expect(localWeekStart(new Date(2026, 0, 11, 23, 59).getTime())).toBe("2026-01-05");
    expect(localWeekStart(new Date(2026, 0, 12, 0, 1).getTime())).toBe("2026-01-12");
    // Across a month and year boundary.
    expect(localWeekStart(new Date(2026, 0, 1, 12).getTime())).toBe("2025-12-29");
  });
});
