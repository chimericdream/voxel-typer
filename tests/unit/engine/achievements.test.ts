/**
 * Achievements (task M3-10): the framework, and for every shipped achievement one context that
 * unlocks it and one that doesn't, built from the profile fixtures. fast-check runs with a fixed
 * seed, so a failure reproduces.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { achievements, achievementById } from "../../../src/content/achievements";
import {
  CLEAN_GAP_CAP_MS,
  createEventAggregator,
  emptyAggregates,
  localDayNumber,
  localHour,
  newlyUnlocked,
  withUnlocks,
} from "../../../src/engine/achievements";
import type {
  AchievementContext,
  AchievementDef,
  AchievementLesson,
  EventAggregates,
} from "../../../src/engine/achievements";
import type { EngineEvent } from "../../../src/engine/types";
import { t } from "../../../src/i18n";
import en from "../../../src/i18n/en";
import { blocks } from "../../../src/content/blocks";
import type { ModeResult } from "../../../src/modes/types";
import type { Profile, StoredSummary } from "../../../src/save/schema";
import type { BiomeId } from "../../../src/types/core";
import { fixture, result, summary } from "../app/helpers";

const SEED = 31;
const RUNS = 200;

/** Central US: 6 h behind UTC (`getTimezoneOffset()` is +360). */
const TZ = 360;
const HOUR = 3_600_000;
/** 2026-11-12 00:00 local time at {@link TZ}. */
const MIDNIGHT = Date.UTC(2026, 10, 12) + TZ * 60_000;

const biome = (b: BiomeId, n = 12): AchievementLesson[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${b}-${String(i + 1).padStart(2, "0")}`, biome: b }));

/** A curriculum with every biome these badges care about, 12 lessons each. */
const CURRICULUM: AchievementLesson[] = [
  ...biome("meadow"),
  ...biome("birch"),
  ...biome("shore"),
  ...biome("frosty"),
];

interface Over {
  profile?: Partial<Profile>;
  result?: ModeResult | null;
  lesson?: AchievementLesson | null;
  lessons?: AchievementLesson[];
  events?: Partial<EventAggregates>;
  when?: AchievementContext["when"];
}

function ctx(name: string, over: Over = {}): AchievementContext {
  return {
    profile: { ...fixture(name), ...over.profile },
    result: over.result === undefined ? null : over.result,
    lesson: over.lesson === undefined ? null : over.lesson,
    lessons: over.lessons ?? CURRICULUM,
    events: { ...emptyAggregates(), ...over.events },
    when:
      over.when === undefined ? { startedAt: MIDNIGHT + 12 * HOUR, tzOffsetMin: TZ } : over.when,
  };
}

const MEADOW_01: AchievementLesson = { id: "meadow-01", biome: "meadow" };
const keyStat = (attempts: number, errors: number) => ({
  attempts,
  errors,
  recentErrRate: 0,
  latencyMedian: null,
  recentLatencies: [],
  lastSeenSession: 1,
  srs: { intervalSessions: 1, dueSession: 2 },
});
const homeRow = (skip?: string) =>
  Object.fromEntries(
    ["a", "s", "d", "f", "j", "k", "l", ";"]
      .filter((k) => k !== skip)
      .map((k) => [k, { attempts: 10, errors: 1, latencies: [] }]),
  );

/** Feeds `events` through the real aggregator. */
function aggregate(events: EngineEvent[]): EventAggregates {
  const agg = createEventAggregator();
  for (const e of events) agg.add(e);
  return agg.value();
}

/** A word of `len` letters typed one key every `stepMs`, finished with `errors` slips. */
function word(id: string, t0: number, len: number, errors = 0, stepMs = 300): EngineEvent[] {
  const out: EngineEvent[] = [];
  for (let i = 0; i < len; i++) {
    out.push({
      type: "correct",
      t: t0 + i * stepMs,
      targetId: id,
      index: i,
      char: "a",
      latencyMs: null,
    });
  }
  out.push({
    type: "targetComplete",
    t: t0 + len * stepMs,
    targetId: id,
    accuracy: 1,
    durationMs: len * stepMs,
    errors,
  });
  return out;
}

/** `n` right keys, one every `stepMs`, on one long target. */
function keys(n: number, stepMs: number, t0 = 0): EngineEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    type: "correct" as const,
    t: t0 + i * stepMs,
    targetId: "x",
    index: i,
    char: "a",
    latencyMs: null,
  }));
}

/** One context that unlocks each achievement and one that doesn't. */
const cases: Record<string, { yes: () => AchievementContext; no: () => AchievementContext }> = {
  "first-lesson": { yes: () => ctx("meadow-done-miner"), no: () => ctx("fresh-sprout") },
  "star-catcher": { yes: () => ctx("meadow-done-miner"), no: () => ctx("pinky-weak") },
  "practice-pal": { yes: () => ctx("pinky-weak"), no: () => ctx("meadow-done-miner") },
  "ten-trips": { yes: () => ctx("meadow-done-miner"), no: () => ctx("pinky-weak") },
  "meadow-master": { yes: () => ctx("meadow-done-miner"), no: () => ctx("pinky-weak") },
  "birch-master": { yes: () => ctx("veteran-builder"), no: () => ctx("meadow-done-miner") },
  "shore-master": { yes: () => ctx("veteran-builder"), no: () => ctx("meadow-done-miner") },
  "frosty-master": { yes: () => ctx("veteran-builder"), no: () => ctx("meadow-done-miner") },
  "three-days": { yes: () => ctx("meadow-done-miner"), no: () => ctx("fresh-sprout") },
  "early-bird": {
    yes: () =>
      ctx("fresh-sprout", {
        result: result(),
        when: { startedAt: MIDNIGHT + 7.5 * HOUR, tzOffsetMin: TZ },
      }),
    no: () =>
      ctx("fresh-sprout", {
        result: result(),
        when: { startedAt: MIDNIGHT + 9 * HOUR, tzOffsetMin: TZ },
      }),
  },
  "first-word": {
    yes: () => ctx("fresh-sprout", { events: aggregate(word("w", 0, 3)) }),
    no: () => ctx("fresh-sprout", { events: aggregate(word("w", 0, 2)) }),
  },
  "neat-ten": {
    yes: () =>
      ctx("fresh-sprout", {
        events: aggregate(Array.from({ length: 10 }, (_, i) => word(`w${i}`, i * 2000, 4)).flat()),
      }),
    no: () =>
      ctx("fresh-sprout", {
        events: aggregate(
          Array.from({ length: 10 }, (_, i) => word(`w${i}`, i * 2000, 4, i === 5 ? 1 : 0)).flat(),
        ),
      }),
  },
  "steady-hands": {
    yes: () => ctx("fresh-sprout", { events: { longestStreak: 25 } }),
    no: () => ctx("fresh-sprout", { events: { longestStreak: 24 } }),
  },
  "hundred-hop": {
    yes: () => ctx("fresh-sprout", { events: { longestStreak: 100 } }),
    no: () => ctx("fresh-sprout", { events: { longestStreak: 99 } }),
  },
  "clean-minute": {
    // A slow, steady typist: one key every 2 s for a minute.
    yes: () => ctx("fresh-sprout", { events: aggregate(keys(31, 2000)) }),
    no: () =>
      ctx("fresh-sprout", {
        events: aggregate([
          ...keys(16, 2000),
          { type: "wrong", t: 31_000, targetId: "x", index: 16, expected: "a", got: "s" },
          ...keys(16, 2000, 32_000),
        ]),
      }),
  },
  "not-one-slip": {
    yes: () =>
      ctx("fresh-sprout", {
        lesson: MEADOW_01,
        result: result({ summary: summary({ errors: 0, targetsCompleted: 10 }) }),
      }),
    no: () =>
      ctx("fresh-sprout", {
        lesson: MEADOW_01,
        result: result({ summary: summary({ errors: 1, targetsCompleted: 10 }) }),
      }),
  },
  "home-row-hero": {
    yes: () => ctx("pinky-weak", { result: result({ summary: summary({ perKey: homeRow() }) }) }),
    no: () => ctx("pinky-weak", { result: result({ summary: summary({ perKey: homeRow(";") }) }) }),
  },
  "pinky-power": {
    yes: () =>
      ctx("fresh-sprout", { profile: { keyStats: { a: keyStat(40, 5), ";": keyStat(20, 4) } } }),
    no: () =>
      ctx("fresh-sprout", { profile: { keyStats: { a: keyStat(40, 5), f: keyStat(90, 0) } } }),
  },
  "first-ore": {
    yes: () => ctx("fresh-sprout", { result: result({ loot: { "char-ore": 1 } }) }),
    // The veteran's "ore-gem" isn't a block in the registry, so it doesn't count.
    no: () => ctx("veteran-builder"),
  },
  "lucky-find": {
    yes: () => ctx("fresh-sprout", { result: result({ loot: { lantern: 1 } }) }),
    no: () => ctx("fresh-sprout", { result: result({ loot: { dirt: 3, "char-ore": 1 } }) }),
  },
  "gem-finder": {
    yes: () => ctx("fresh-sprout", { result: result({ loot: { meadowstone: 1 } }) }),
    no: () => ctx("veteran-builder"),
  },
  "flower-friend": {
    yes: () =>
      ctx("fresh-sprout", {
        profile: {
          inventory: { "red-blooms": 1, "sunny-flowers": 2, bluebells: 1, "purple-puffs": 1 },
        },
      }),
    no: () =>
      ctx("fresh-sprout", {
        profile: { inventory: { "red-blooms": 1, "sunny-flowers": 2, bluebells: 1 } },
      }),
  },
  collector: {
    yes: () =>
      ctx("veteran-builder", {
        profile: { inventory: { ...fixture("veteran-builder").inventory, dirt: 1 } },
      }),
    // Four kinds.
    no: () => ctx("veteran-builder"),
  },
  "hundred-blocks": { yes: () => ctx("veteran-builder"), no: () => ctx("meadow-done-miner") },
};

describe("the v1 achievements", () => {
  it("has a test case for every achievement, and no case without one", () => {
    expect(Object.keys(cases).toSorted(byName)).toEqual(
      achievements.map((a) => a.id).toSorted(byName),
    );
  });

  it("has about 20 achievements with unique kebab-case ids", () => {
    const ids = achievements.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("names, describes and draws every one: real i18n keys and registry blocks", () => {
    const blockIds = new Set(blocks.map((b) => b.id));
    for (const a of achievements) {
      expect(t(a.nameKey), a.nameKey).not.toMatch(/^⟦/);
      expect(t(a.descKey), a.descKey).not.toMatch(/^⟦/);
      if ("block" in a.icon) expect(blockIds.has(a.icon.block), a.icon.block).toBe(true);
    }
  });

  it("uses no banned or borrowed names", () => {
    const banned = /creeper|enderman|redstone|nether|steve|minecraft|mojang|fail|wrong|slow/i;
    for (const a of achievements) {
      expect(a.id).not.toMatch(banned);
    }
    expect(JSON.stringify(en.achievements)).not.toMatch(banned);
  });

  for (const def of achievements) {
    describe(def.id, () => {
      const c = caseFor(def.id);
      it("unlocks from its fixture", () => {
        expect(def.check(c.yes())).toBe(true);
        expect(newlyUnlocked([def], c.yes())).toEqual([def.id]);
      });
      it("stays locked when the rule isn't met", () => {
        expect(def.check(c.no())).toBe(false);
      });
    });
  }

  it("live achievements read only the event aggregates", () => {
    for (const def of achievements.filter((a) => a.live === true)) {
      const c = caseFor(def.id).yes();
      // A blank profile, no result and no lesson: still unlocks from the events alone.
      expect(def.check({ ...ctx("fresh-sprout", { when: null }), events: c.events }), def.id).toBe(
        true,
      );
    }
  });
});

const byName = (a: string, b: string): number => a.localeCompare(b);
function byId(id: string): AchievementDef {
  const found = achievementById(id);
  if (found === null) throw new Error(`no achievement ${id}`);
  return found;
}
function caseFor(id: string): { yes: () => AchievementContext; no: () => AchievementContext } {
  const found = cases[id];
  if (found === undefined) throw new Error(`no test case for ${id}`);
  return found;
}
/** A copy of the miner fixture's first session at `at`. */
function sessionAt(at: number): StoredSummary {
  const first = fixture("meadow-done-miner").history[0];
  if (first === undefined) throw new Error("fixture has no history");
  return { ...first, at };
}
const earlyAt = (h: number) =>
  ctx("fresh-sprout", {
    result: result(),
    when: { startedAt: MIDNIGHT + h * HOUR, tzOffsetMin: TZ },
  });

describe("rules in detail", () => {
  it("a lesson the placement test skipped (plays 0) is not a played lesson", () => {
    const testedOut = Object.fromEntries(
      biome("meadow").map((l) => [
        l.id,
        { bestStars: 1 as const, bestNetWpm: 0, bestAccuracy: 0, plays: 0, lastPlayed: 1 },
      ]),
    );
    const c = ctx("fresh-sprout", {
      profile: { progress: { lessons: testedOut, unlockedBiomes: ["meadow", "birch"] } },
    });
    expect(byId("meadow-master").check(c)).toBe(false);
    expect(byId("first-lesson").check(c)).toBe(false);
  });

  it("a biome badge needs the biome to have lessons", () => {
    expect(byId("frosty-master").check(ctx("veteran-builder", { lessons: biome("meadow") }))).toBe(
      false,
    );
  });

  it("Not One Slip needs a curriculum lesson (placement and free play don't count)", () => {
    const r = result({ summary: summary({ errors: 0, targetsCompleted: 10 }) });
    expect(byId("not-one-slip").check(ctx("fresh-sprout", { result: r, lesson: null }))).toBe(
      false,
    );
  });

  it("Early Bird runs from 5 am up to 9 am, local time, and needs a finished session", () => {
    expect([4.99, 5, 8.99, 9, 20].map((h) => byId("early-bird").check(earlyAt(h)))).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
    expect(byId("early-bird").check({ ...earlyAt(6), result: null })).toBe(false);
    expect(byId("early-bird").hidden).toBe(true);
  });

  it("Three Good Days counts days on the local calendar, not in a row", () => {
    const days = [0, 2, 9].map((d) => MIDNIGHT + d * 24 * HOUR + 23 * HOUR);
    const history = days.map(sessionAt);
    expect(byId("three-days").check(ctx("fresh-sprout", { profile: { history } }))).toBe(true);
    // Two sessions on one local day are one day.
    const [d0 = 0, d1 = 0] = days;
    const sameDay = [sessionAt(d0), sessionAt(d0 - 3 * HOUR), sessionAt(d1)];
    expect(byId("three-days").check(ctx("fresh-sprout", { profile: { history: sameDay } }))).toBe(
      false,
    );
    expect(byId("three-days").check(ctx("meadow-done-miner", { when: null }))).toBe(false);
  });

  it("Calm Minute gives a slow typist every key, up to the gap cap", () => {
    // One key every 10 s: each gap counts CLEAN_GAP_CAP_MS (5 s), so 13 keys make a minute.
    expect(aggregate(keys(13, 10_000)).bestCleanMs).toBe(12 * CLEAN_GAP_CAP_MS);
    // Time paused never counts.
    const paused = aggregate([
      ...keys(2, 1000),
      { type: "paused", t: 1500 },
      { type: "resumed", t: 90_000 },
      ...keys(2, 1000, 90_500),
    ]);
    expect(paused.bestCleanMs).toBe(1000 + 500 + 1000);
  });

  it("a slip in a word ends the clean-word run; single letters neither count nor break it", () => {
    const a = aggregate([
      ...word("a", 0, 3),
      ...word("b", 1000, 1),
      ...word("c", 2000, 3),
      ...word("d", 3000, 3, 2),
      ...word("e", 4000, 3),
    ]);
    expect(a.wordsCompleted).toBe(4);
    expect(a.bestCleanWordRun).toBe(2);
  });
});

describe("framework", () => {
  it("withUnlocks adds new ids and keeps the earlier time of ones already earned", () => {
    const p = fixture("veteran-builder");
    const next = withUnlocks(p, { "first-lesson": 9, "first-ore": 10 });
    expect(next.achievements["first-lesson"]).toBe(p.achievements["first-lesson"]);
    expect(next.achievements["first-ore"]).toBe(10);
    expect(p.achievements["first-ore"]).toBeUndefined();
  });

  it("newlyUnlocked skips earned ones and, with liveOnly, the session-end ones", () => {
    const c = ctx("meadow-done-miner", { events: { longestStreak: 30 } });
    const all = newlyUnlocked(achievements, c);
    expect(all).toContain("first-lesson");
    expect(all).toContain("steady-hands");
    expect(newlyUnlocked(achievements, c, { liveOnly: true })).toEqual(["steady-hands"]);
    const earned = { ...c, profile: withUnlocks(c.profile, { "first-lesson": 1 }) };
    expect(newlyUnlocked(achievements, earned)).not.toContain("first-lesson");
  });

  it("localHour and localDayNumber agree with the offset", () => {
    expect(localHour(MIDNIGHT + 7.5 * HOUR, TZ)).toBe(7);
    expect(localHour(MIDNIGHT - 1, TZ)).toBe(23);
    expect(localDayNumber(MIDNIGHT, TZ) - localDayNumber(MIDNIGHT - 1, TZ)).toBe(1);
  });

  it("(property) local hour and day rebuild the local time", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        fc.integer({ min: -840, max: 720 }),
        (at, tz) => {
          const h = localHour(at, tz);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThan(24);
          const local = at - tz * 60_000;
          const day = localDayNumber(at, tz);
          expect(local - day * 24 * HOUR).toBeGreaterThanOrEqual(h * HOUR);
          expect(local - day * 24 * HOUR).toBeLessThan((h + 1) * HOUR);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  const eventArb: fc.Arbitrary<EngineEvent[]> = fc
    .array(
      fc.record({
        kind: fc.constantFrom("correct", "wrong", "pause", "word"),
        gap: fc.integer({ min: 0, max: 8000 }),
      }),
      { maxLength: 120 },
    )
    .map((steps) => {
      const out: EngineEvent[] = [];
      let now = 0;
      let streak = 0;
      let paused = false;
      steps.forEach((s, i) => {
        now += s.gap;
        if (paused) {
          out.push({ type: "resumed", t: now });
          paused = false;
        }
        if (s.kind === "correct") {
          streak += 1;
          out.push({
            type: "correct",
            t: now,
            targetId: `t${i}`,
            index: 0,
            char: "a",
            latencyMs: null,
          });
          out.push({ type: "streak", t: now, length: streak });
        } else if (s.kind === "wrong") {
          if (streak > 0) out.push({ type: "streakBroken", t: now, length: streak });
          streak = 0;
          out.push({
            type: "wrong",
            t: now,
            targetId: null,
            index: null,
            expected: null,
            got: "x",
          });
        } else if (s.kind === "pause") {
          out.push({ type: "paused", t: now });
          paused = true;
        } else {
          out.push(...word(`w${i}`, now, 3, s.gap % 3 === 0 ? 1 : 0, 0));
        }
      });
      return out;
    });

  it("(property) aggregates are bounded by the events, and checks never re-unlock", () => {
    fc.assert(
      fc.property(eventArb, fc.subarray(achievements.map((a) => a.id)), (events, earned) => {
        const agg = aggregate(events);
        const streaks = events.flatMap((e) => (e.type === "streak" ? [e.length] : []));
        expect(agg.longestStreak).toBe(Math.max(0, ...streaks));
        const last = events.at(-1)?.t ?? 0;
        expect(agg.bestCleanMs).toBeGreaterThanOrEqual(0);
        expect(agg.bestCleanMs).toBeLessThanOrEqual(last);
        expect(agg.bestCleanWordRun).toBeLessThanOrEqual(agg.wordsCompleted);
        // The same events always give the same aggregates.
        expect(aggregate(events)).toEqual(agg);

        const base = ctx("meadow-done-miner", { events: agg });
        const profile = withUnlocks(base.profile, Object.fromEntries(earned.map((id) => [id, 1])));
        const fresh = newlyUnlocked(achievements, { ...base, profile });
        for (const id of fresh) expect(earned).not.toContain(id);
        const after = withUnlocks(profile, Object.fromEntries(fresh.map((id) => [id, 2])));
        expect(newlyUnlocked(achievements, { ...base, profile: after })).toEqual([]);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
