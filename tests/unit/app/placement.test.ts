/**
 * The placement test in the app (task M3-05): its result sets the start, unlocks biomes, marks
 * earlier lessons "tested out", and the shell routes it to its own screen.
 */
import { describe, expect, it, vi } from "vitest";
import { createSilentAudio } from "../../../src/app/audio";
import { realClock } from "../../../src/app/clock";
import { createHudStore } from "../../../src/app/hud";
import {
  applyPlacement,
  isTestedOut,
  placementEstimateOf,
  placementRungsOf,
  placementTierOf,
  playableStart,
  settleAtMeadow,
  shouldOfferPlacement,
} from "../../../src/app/progress";
import { createShell } from "../../../src/app/shell";
import { lessons as shippedLessons } from "../../../src/content/lessons";
import type { Lesson } from "../../../src/content/lessons/types";
import { PLACEMENT_GATES } from "../../../src/engine/placement";
import {
  PLACEMENT_LESSON,
  PLACEMENT_LESSON_ID,
  PLACEMENT_RUNGS_EXTRA,
  PLACEMENT_TIER_EXTRA,
} from "../../../src/modes/placement/lesson";
import { isProfile } from "../../../src/save/schema";
import { createMemoryStore } from "../../../src/save/store";
import { outcomeLines } from "../../../src/ui/screens/Placement";
import { fakeMode, fakeScene, fixture, flush, lesson, result, summary } from "./helpers";

const at = 1_800_000_000_000;
const curriculum: Lesson[] = [
  lesson({ id: "meadow-01", order: 1 }),
  lesson({ id: "meadow-02", order: 2, tags: ["mastery"] }),
  lesson({ id: "birch-01", biome: "birch", order: 1 }),
  lesson({ id: "birch-02", biome: "birch", order: 2 }),
  lesson({ id: "shore-01", biome: "shore", order: 1 }),
];

/** A placement result: a 90-second test at `netWpm` that reached rung `tier`. */
const placed = (netWpm: number, tier: number, accuracy = 0.97) =>
  result({
    stars: 0,
    loot: { dirt: 3 },
    extra: { [PLACEMENT_TIER_EXTRA]: tier },
    summary: summary({ mode: "placement", activeMs: 90_000, netWpm, accuracy }),
  });

/** A result's `extra` holding `v` as its rung scores. */
const extra = (v: unknown) => ({ extra: { [PLACEMENT_RUNGS_EXTRA]: v } });

describe("applyPlacement", () => {
  const p = fixture("fresh-builder");

  it("starts a slow typist at the Meadow and changes no lessons", () => {
    const next = applyPlacement(p, curriculum, placed(6, 3), at);
    expect(next.progress.placement).toEqual({ doneAt: at, startBiome: "meadow" });
    expect(next.progress.unlockedBiomes).toEqual(["meadow"]);
    expect(next.progress.lessons).toEqual({});
    expect(isProfile(next)).toBe(true);
  });

  it("unlocks up to the start and tests out every lesson before it, with one star", () => {
    const next = applyPlacement(p, curriculum, placed(PLACEMENT_GATES.shore?.netWpm ?? 0, 2), at);
    expect(next.progress.placement?.startBiome).toBe("shore");
    expect(next.progress.unlockedBiomes).toEqual(["meadow", "birch", "shore"]);
    const ids = Object.keys(next.progress.lessons).toSorted();
    expect(ids).toEqual(["birch-01", "birch-02", "meadow-01", "meadow-02"]);
    for (const rec of Object.values(next.progress.lessons)) {
      expect(rec).toEqual({
        bestStars: 1,
        bestNetWpm: 0,
        bestAccuracy: 0,
        plays: 0,
        lastPlayed: at,
      });
      expect(isTestedOut(rec)).toBe(true);
    }
    // The test itself is never a lesson record.
    expect(next.progress.lessons[PLACEMENT_LESSON_ID]).toBeUndefined();
    expect(isProfile(next)).toBe(true);
  });

  it("counts the session, keeps the loot and history, and seeds key stats", () => {
    const next = applyPlacement(p, curriculum, placed(30, 5), at);
    expect(next.sessionCounter).toBe(p.sessionCounter + 1);
    expect(next.inventory["dirt"]).toBe((p.inventory["dirt"] ?? 0) + 3);
    expect(next.history.at(-1)).toMatchObject({ mode: "placement", at });
    expect(next.keyStats["f"]?.attempts).toBe(10);
  });

  it("keeps key stats from real lessons over the test's estimate (N5)", () => {
    const real = {
      attempts: 300,
      errors: 3,
      recentErrRate: 0.01,
      latencyMedian: 180,
      recentLatencies: [180],
      lastSeenSession: 4,
      srs: { intervalSessions: 4, dueSession: 8 },
    };
    const withStats = { ...p, keyStats: { f: real } };
    const next = applyPlacement(withStats, curriculum, placed(30, 5), at);
    // `f` was in the test too (10 attempts, 1 slip), but the lessons' 300 attempts win.
    expect(next.keyStats["f"]).toEqual(real);
    const baseline = placementEstimateOf(withStats, placed(30, 5)).keyBaseline;
    expect(baseline["f"]?.attempts).toBe(10);
  });

  it("keeps lessons already played and never re-locks", () => {
    const played = applyPlacement(p, curriculum, placed(6, 0), at);
    const before = {
      ...played,
      progress: {
        ...played.progress,
        unlockedBiomes: [...played.progress.unlockedBiomes, "marsh" as const],
        lessons: {
          "meadow-01": {
            bestStars: 3 as const,
            bestNetWpm: 20,
            bestAccuracy: 1,
            plays: 2,
            lastPlayed: 1,
          },
        },
      },
    };
    const next = applyPlacement(
      before,
      curriculum,
      placed(PLACEMENT_GATES.birch?.netWpm ?? 0, 1),
      at,
    );
    expect(next.progress.lessons["meadow-01"]?.plays).toBe(2);
    expect(next.progress.lessons["meadow-02"]?.plays).toBe(0);
    expect(next.progress.unlockedBiomes).toContain("marsh");
  });

  it("with no lessons yet past the Meadow, starts at the furthest island that has lessons", () => {
    const meadowOnly = curriculum.filter((l) => l.biome === "meadow");
    const next = applyPlacement(p, meadowOnly, placed(60, 5), at);
    expect(next.progress.placement?.startBiome).toBe("meadow");
    expect(next.progress.lessons).toEqual({});
    expect(playableStart("frosty", curriculum)).toBe("shore");
    expect(playableStart("birch", [])).toBe("meadow");
  });

  it("reads a bad rung in the result as the first rung", () => {
    expect(placementTierOf({ extra: { [PLACEMENT_TIER_EXTRA]: "3" } })).toBe(0);
    expect(placementTierOf({ extra: { [PLACEMENT_TIER_EXTRA]: -1 } })).toBe(0);
    expect(placementTierOf({})).toBe(0);
    expect(placementTierOf({ extra: { [PLACEMENT_TIER_EXTRA]: 2 } })).toBe(2);
  });

  it("reads the rung scores, leaving out anything malformed (N2)", () => {
    const good = { tier: 0, ms: 9000, keystrokes: 70, correct: 66 };
    expect(placementRungsOf(extra([good, { ...good, tier: 1.5 }, { tier: 1 }, null, 3]))).toEqual([
      good,
    ]);
    expect(placementRungsOf(extra({ 0: good }))).toEqual([]);
    expect(placementRungsOf({})).toEqual([]);
  });

  it("judges each gate on its rung's score, not the whole test (N2)", () => {
    // Slow digits made the whole test 20 WPM; up to the bottom row the child typed 30 WPM.
    const r = placed(20, 3);
    const rungs = [0, 1, 2].map((tier) => ({
      tier,
      ms: 12_000 * (tier + 1),
      keystrokes: 31 * (tier + 1),
      correct: 30 * (tier + 1),
    }));
    const scored = { ...r, extra: { ...r.extra, [PLACEMENT_RUNGS_EXTRA]: rungs } };
    expect(placementEstimateOf(p, r).startBiome).toBe("shore");
    expect(placementEstimateOf(p, scored).startBiome).toBe("frosty");
  });
});

describe("offering the test again (N4)", () => {
  const fresh = fixture("fresh-builder");

  it("offers it to a player who has neither settled a start nor played", () => {
    expect(fresh.progress.placement).toBeUndefined();
    expect(fresh.sessionCounter).toBe(0);
    expect(shouldOfferPlacement(fresh)).toBe(true);
    // After a lesson, never: the child has started playing.
    expect(shouldOfferPlacement({ ...fresh, sessionCounter: 1 })).toBe(false);
    // After a finished test, never.
    expect(shouldOfferPlacement(applyPlacement(fresh, curriculum, placed(6, 0), at))).toBe(false);
  });

  it("settles the start at the Meadow, so the offer comes once more at most", () => {
    const settled = settleAtMeadow(fresh, at);
    expect(settled.progress.placement).toEqual({ doneAt: at, startBiome: "meadow" });
    expect(settled.progress.unlockedBiomes).toEqual(fresh.progress.unlockedBiomes);
    expect(settled.progress.lessons).toEqual(fresh.progress.lessons);
    expect(isProfile(settled)).toBe(true);
    expect(shouldOfferPlacement(settled)).toBe(false);
    // An earlier start is kept.
    const placedAt = applyPlacement(
      fresh,
      curriculum,
      placed(PLACEMENT_GATES.shore?.netWpm ?? 0, 2),
      at,
    );
    expect(settleAtMeadow(placedAt, at + 1).progress.placement).toEqual(
      placedAt.progress.placement,
    );
    // A test finished after the offer replaces the Meadow start.
    const later = applyPlacement(
      settled,
      curriculum,
      placed(PLACEMENT_GATES.shore?.netWpm ?? 0, 2),
      at + 5,
    );
    expect(later.progress.placement).toEqual({ doneAt: at + 5, startBiome: "shore" });
  });
});

function setup() {
  const mode = fakeMode();
  const store = createMemoryStore();
  const shell = createShell({
    store,
    lessons: curriculum,
    resolveMode: () => mode.module,
    acquireScene: () => Promise.resolve(fakeScene()),
    hud: createHudStore(),
    audio: { ...createSilentAudio(), setSpeechEnabled: vi.fn(), setVolume: vi.fn() },
    clock: realClock,
    nextSeed: () => 1,
    frozen: false,
    record: false,
    applySettings: () => undefined,
    focusOnControl: () => false,
    showCanvas: () => undefined,
  });
  return { shell, mode, store };
}

describe("the shell and the placement test", () => {
  it("plays the test as a lesson and shows where the player starts", async () => {
    const s = setup();
    const p = fixture("fresh-sprout");
    await s.store.save(p);
    s.shell.api.setProfile(p);
    s.shell.api.navigate({ id: "placement" }, { replace: true });
    s.shell.api.navigate({ id: "play", lesson: PLACEMENT_LESSON_ID }, { replace: true });
    await s.shell.ready();
    expect(s.shell.playStatus.value).toBe("running");
    expect(s.mode.ctx().lesson).toBe(PLACEMENT_LESSON);
    s.mode.ctx().finish(placed(PLACEMENT_GATES.birch?.netWpm ?? 0, 1));
    await flush();
    expect(s.shell.route.value).toEqual({ id: "placement", lesson: PLACEMENT_LESSON_ID });
    const saved = await s.store.load(p.id);
    expect(saved?.progress.placement?.startBiome).toBe("birch");
    expect(saved?.progress.lessons[PLACEMENT_LESSON_ID]).toBeUndefined();
    expect(saved?.progress.lessons["meadow-01"]?.plays).toBe(0);
  });
});

describe("outcomeLines", () => {
  const p = fixture("fresh-builder");

  it("names the start and never shows a number", () => {
    const meadow = applyPlacement(p, curriculum, placed(5, 0), at);
    const lines = outcomeLines(meadow, placed(5, 0));
    expect(lines).toEqual(["You start at Meadow Home!", "It is a great place to begin."]);
    const shore = applyPlacement(p, curriculum, placed(20, 2), at);
    const more = outcomeLines(shore, placed(20, 2));
    expect(more[0]).toBe("You start at Sandy Shore!");
    expect(more.some((l) => l.includes("star"))).toBe(true);
    for (const line of [...lines, ...more]) expect(line).not.toMatch(/\d/);
  });

  it("says when the player is ready for an island that has no lessons yet", () => {
    const meadowOnly = curriculum.filter((l) => l.biome === "meadow");
    const next = applyPlacement(p, meadowOnly, placed(60, 5), at);
    expect(outcomeLines(next, placed(60, 5))).toEqual([
      "You start at Meadow Home!",
      "You are ready for Mushroom Marsh! Its lessons are coming soon, so you start at Meadow Home.",
    ]);
  });

  it("works with the lessons that ship today", () => {
    const next = applyPlacement(p, shippedLessons, placed(60, 5), at);
    expect(isProfile(next)).toBe(true);
    expect(outcomeLines(next, placed(60, 5))[0]).toMatch(/^You start at /);
  });
});
