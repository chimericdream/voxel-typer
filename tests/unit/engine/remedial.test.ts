/**
 * Remedial lessons (task M3-06): when one is suggested, how often, what it practises, that playing
 * it never counts as a curriculum lesson, and what the map recommends next.
 */
import * as fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { applyResult } from "../../../src/app/progress";
import {
  anchorLesson,
  campLabel,
  dueRemedial,
  recommendNext,
  remedialById,
  resetRemedials,
} from "../../../src/app/recommend";
import { lessons as shipped } from "../../../src/content/lessons";
import type { Lesson } from "../../../src/content/lessons/types";
import { EN_US } from "../../../src/content/layouts";
import {
  REMEDIAL_EVERY,
  REMEDIAL_MIN_ATTEMPTS,
  REMEDIAL_SECONDS,
  isRemedialId,
  remedialAllowed,
  remedialId,
  remedialLesson,
  remedialTitle,
  suggestRemedial,
} from "../../../src/engine/remedial";
import type { RemedialInput } from "../../../src/engine/remedial";
import type { KeyStat } from "../../../src/engine/stats";
import { t } from "../../../src/i18n";
import type { Profile } from "../../../src/save/schema";
import { fixture, result, summary } from "../app/helpers";

const SEED = 20261112;

/** A key stat: `attempts` tries with a recent error rate of `err`, due for review at `due`. */
function stat(attempts: number, err: number, due = 99): KeyStat {
  return {
    attempts,
    errors: Math.round(attempts * err),
    recentErrRate: err,
    latencyMedian: 300,
    recentLatencies: [300],
    lastSeenSession: 1,
    srs: { intervalSessions: 1, dueSession: due },
  };
}

const HOME = ["f", "j", "d", "k", "s", "l", "a", ";"];

function input(over: Partial<RemedialInput> = {}): RemedialInput {
  return {
    allowed: HOME,
    stats: Object.fromEntries(HOME.map((k) => [k, stat(60, 0.02)])),
    sessionIndex: 10,
    targetLatencyMs: 900,
    recent: [],
    ...over,
  };
}

/** Comfortable stats for every home key, with some keys weak. */
const withWeak = (weak: Record<string, KeyStat>): RemedialInput["stats"] => ({
  ...input().stats,
  ...weak,
});

describe("suggestRemedial: when", () => {
  it("suggests nothing while every key is comfortable", () => {
    expect(suggestRemedial(input())).toBeNull();
  });

  it("needs weight ≥ 4 and at least 30 attempts on the same key", () => {
    // err 0.5 over 50 attempts: weight ≈ 5.6. err 0.2: weight ≈ 3.1.
    const heavyButNew = withWeak({ a: stat(REMEDIAL_MIN_ATTEMPTS - 1, 0.6) });
    const triedButFine = withWeak({ a: stat(200, 0.2) });
    expect(suggestRemedial(input({ stats: heavyButNew }))).toBeNull();
    expect(suggestRemedial(input({ stats: triedButFine }))).toBeNull();
    expect(
      suggestRemedial(input({ stats: withWeak({ a: stat(REMEDIAL_MIN_ATTEMPTS, 0.6) }) })),
    ).not.toBeNull();
  });

  it("only looks at allowed keys", () => {
    const stats = withWeak({ q: stat(100, 0.9) });
    expect(suggestRemedial(input({ stats }))).toBeNull();
  });

  it("focuses on the two heaviest weak keys, weakest first, plus the keys due for review", () => {
    const stats = withWeak({
      a: stat(80, 0.5),
      s: stat(80, 0.8),
      l: stat(80, 0.4),
      d: stat(80, 0.01, 5),
      f: stat(80, 0.01, 10),
    });
    const s = suggestRemedial(input({ stats }));
    expect(s?.keys).toEqual(["s", "a"]);
    expect(s?.review).toEqual(["f", "d"]);
  });

  it("with one weak key, focuses on that one alone", () => {
    const stats = withWeak({ ";": stat(40, 0.7) });
    expect(suggestRemedial(input({ stats }))?.keys).toEqual([";"]);
  });
});

describe("suggestRemedial: rate limit", () => {
  const stats = withWeak({ a: stat(80, 0.6) });

  it("waits until neither of the last two sessions was a remedial", () => {
    const r = remedialId(["a"], 3);
    expect(suggestRemedial(input({ stats, recent: ["meadow-01", r] }))).toBeNull();
    expect(suggestRemedial(input({ stats, recent: [r, "meadow-02"] }))).toBeNull();
    expect(suggestRemedial(input({ stats, recent: [r, "meadow-02", "meadow-03"] }))).not.toBeNull();
    expect(remedialAllowed([])).toBe(true);
  });

  it("at most one remedial in any 3 sessions in a row, however often it is taken", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }), (takes) => {
        const recent: string[] = [];
        takes.forEach((take, i) => {
          const s = suggestRemedial(input({ stats, sessionIndex: i, recent }));
          recent.push(take && s !== null ? s.id : "meadow-01");
        });
        for (let i = 0; i + REMEDIAL_EVERY <= recent.length; i++) {
          const window = recent.slice(i, i + REMEDIAL_EVERY);
          expect(window.filter(isRemedialId).length).toBeLessThanOrEqual(1);
        }
      }),
      { seed: SEED, numRuns: 200 },
    );
  });
});

describe("remedial ids and lessons", () => {
  it("ids hash the keys and the session", () => {
    const id = remedialId(["a", "s"], 7);
    expect(id).toMatch(/^remedial-[0-9a-z]+$/);
    expect(remedialId(["a", "s"], 7)).toBe(id);
    expect(remedialId(["a", "s"], 8)).not.toBe(id);
    expect(remedialId(["s", "a"], 7)).not.toBe(id);
    expect(isRemedialId(id)).toBe(true);
    expect(shipped.some((l) => isRemedialId(l.id))).toBe(false);
  });

  it("is a 60 s Mine lesson at the anchor's place, titled by the weakest key's finger", () => {
    const anchor = shipped.find((l) => l.id === "meadow-05");
    if (!anchor) throw new Error("no meadow-05");
    const lesson = remedialLesson(
      { id: "remedial-x", keys: ["a", "l"], review: ["f"] },
      anchor,
      EN_US,
    );
    expect(lesson).toMatchObject({
      id: "remedial-x",
      biome: anchor.biome,
      order: anchor.order,
      mode: "mine",
      kind: anchor.kind,
      length: { seconds: REMEDIAL_SECONDS },
      newKeys: ["a", "l"],
      reviewKeys: ["f"],
      bandScale: { sprout: 1, miner: 1, builder: 1 },
    });
    expect(lesson.targets.wpmRelative).toBeUndefined();
    expect(lesson.tags).toBeUndefined();
    expect(t(lesson.titleKey)).toBe("Your left pinky wants practice!");
    expect(t(remedialTitle(["k"], EN_US))).toBe("Your right middle finger wants practice!");
    expect(t(remedialTitle([" "], EN_US))).toBe("Your thumbs want practice!");
    expect(t(remedialTitle(["€"], EN_US))).toBe("Some keys want practice!");
  });

  it("the camp label names the keys with the right plural", () => {
    const anchor = shipped.find((l) => l.id === "meadow-05");
    if (!anchor) throw new Error("no meadow-05");
    const one = remedialLesson({ id: "remedial-1", keys: [";"], review: [] }, anchor, EN_US);
    const two = remedialLesson({ id: "remedial-2", keys: ["a", "s"], review: [] }, anchor, EN_US);
    expect(campLabel(one)).toBe(
      "Practice camp. Your right pinky wants practice! Practice key: semicolon.",
    );
    expect(campLabel(two)).toBe(
      "Practice camp. Your left pinky wants practice! Practice keys: A and S.",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// With a profile
// ---------------------------------------------------------------------------------------------

const meadow = shipped.filter((l) => l.biome === "meadow").toSorted((a, b) => a.order - b.order);
const play = (p: Profile, lesson: Lesson, stars: 0 | 1 | 2 | 3 = 2, at = 1): Profile =>
  applyResult(p, lesson, result({ stars, summary: summary({ lessonId: lesson.id }) }), at);

/** A Sprout who played Meadow 1–`upTo` and whose `a` is shaky. */
function shakyA(upTo: number): Profile {
  const p = meadow
    .filter((l) => l.order <= upTo)
    .reduce((acc, l) => play(acc, l), fixture("fresh-sprout"));
  return { ...p, keyStats: { ...p.keyStats, a: stat(80, 0.6) } };
}

afterEach(() => resetRemedials());

describe("recommendNext", () => {
  it("1: a due remedial comes first, at the furthest lesson reached", () => {
    const p = shakyA(5);
    const next = recommendNext(p, shipped);
    expect(next && isRemedialId(next.id)).toBe(true);
    expect(next).toMatchObject({ biome: "meadow", order: 5, newKeys: ["a"] });
    expect(anchorLesson(p, shipped)?.id).toBe(meadow[4]?.id);
    // The shell finds it again by id (replay, Results).
    expect(next && remedialById(next.id)).toBe(next);
  });

  it("2: then the next lesson not played yet", () => {
    const p = shakyA(5);
    const remedial = recommendNext(p, shipped);
    if (remedial === null) throw new Error("no remedial");
    const after = applyResult(
      p,
      remedial,
      result({ summary: summary({ lessonId: remedial.id }) }),
      2,
    );
    // Rate-limited now (and the summary helper's stats don't fix `a`): the curriculum is next.
    expect(recommendNext(after, shipped)?.id).toBe(meadow[5]?.id);
  });

  it("3: then the fewest stars in the current biome, before other biomes", () => {
    // Only two biomes, so Birch's mastery check opens nothing new to play.
    const twoBiomes = shipped.filter((l) => l.biome === "meadow" || l.biome === "birch");
    let p = meadow.reduce((acc, l) => play(acc, l, l.order === 3 ? 1 : 3), fixture("fresh-sprout"));
    p = { ...p, progress: { ...p.progress, unlockedBiomes: ["meadow", "birch"] } };
    const birch = shipped.filter((l) => l.biome === "birch").toSorted((a, b) => a.order - b.order);
    p = birch.reduce((acc, l) => play(acc, l, l.order === 4 ? 2 : 3), p);
    // Meadow 3 has 1 star, Birch 4 has 2; the player is in Birch, so Birch 4.
    expect(recommendNext(p, twoBiomes)?.id).toBe(birch[3]?.id);
    // With all of Birch at 3 stars, it falls back to the fewest stars anywhere.
    const allBirch = birch.reduce((acc, l) => play(acc, l, 3), p);
    expect(recommendNext(allBirch, twoBiomes)?.id).toBe(meadow[2]?.id);
  });

  it("never points back at a skipped No Peeking! challenge", () => {
    const challenge = meadow.find((l) => l.tags?.includes("challenge-hide-keyboard") === true);
    if (!challenge) throw new Error("Meadow has no No Peeking! lesson");
    const skipped = meadow
      .filter((l) => l.id !== challenge.id)
      .reduce(
        (acc, l) => play(acc, l, l.tags?.includes("mastery") === true ? 2 : 1),
        fixture("fresh-sprout"),
      );
    // Every other Meadow lesson is played at 1 star: the fewest-stars pick is the first of them.
    const next = recommendNext(skipped, meadow);
    expect(next?.id).not.toBe(challenge.id);
    expect(next?.id).toBe(meadow[0]?.id);
  });

  it("tested-out lessons are not a fewest-stars pick", () => {
    const p = fixture("fresh-sprout");
    const tested: Profile = {
      ...p,
      progress: {
        ...p.progress,
        lessons: Object.fromEntries(
          meadow.map((l) => [
            l.id,
            { bestStars: 1, bestNetWpm: 0, bestAccuracy: 0, plays: 0, lastPlayed: 1 },
          ]),
        ),
      },
    };
    expect(recommendNext(tested, meadow)).toBeNull();
  });

  it("no remedial before any lesson is reached", () => {
    const p = fixture("fresh-sprout");
    expect(dueRemedial({ ...p, keyStats: { a: stat(80, 0.6) } }, shipped)).toBeNull();
  });
});

describe("playing a remedial never counts as a lesson", () => {
  it("writes no lesson record and lowers nothing", () => {
    const base = shakyA(5);
    const before: Profile = {
      ...base,
      inventory: { dirt: 5 },
      found: { dirt: 9 },
    };
    const remedial = dueRemedial(before, shipped);
    if (remedial === null) throw new Error("no remedial");
    const after = applyResult(
      before,
      remedial,
      result({ stars: 0, loot: { stone: 1 }, summary: summary({ lessonId: remedial.id }) }),
      5,
    );
    expect(after.progress).toEqual(before.progress);
    expect(after.progress.lessons[remedial.id]).toBeUndefined();
    expect(after.inventory).toEqual({ dirt: 5, stone: 1 });
    expect(after.found).toEqual({ dirt: 9, stone: 1 });
    expect(after.sessionCounter).toBe(before.sessionCounter + 1);
    expect(after.history.at(-1)?.lessonId).toBe(remedial.id);
  });
});
