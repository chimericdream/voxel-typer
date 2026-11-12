/**
 * Achievement tracking in the app (task M3-10): debounced live checks on the bus, evaluation once
 * a session is folded in, unlocks kept when a lesson is left early, and the play host wiring.
 */
import { describe, expect, it, vi } from "vitest";
import { createAchievementTracker, LIVE_CHECK_DEBOUNCE_MS } from "../../../src/app/achievements";
import type { AchievementTrackerDeps } from "../../../src/app/achievements";
import { createSilentAudio } from "../../../src/app/audio";
import { createBreakReminder } from "../../../src/app/break-reminder";
import { fixedStepClock } from "../../../src/app/clock";
import { createEmitter } from "../../../src/app/events";
import type { GameEvents } from "../../../src/app/events";
import { createHudStore } from "../../../src/app/hud";
import { createPlayHost } from "../../../src/app/play-host";
import { applyResult } from "../../../src/app/progress";
import { achievements } from "../../../src/content/achievements";
import type { EngineEvent } from "../../../src/engine/types";
import type { Profile } from "../../../src/save/schema";
import type { AchievementId } from "../../../src/types/core";
import { fakeMode, fakeScene, fixture, flush, lesson, result, summary } from "./helpers";

/** A manual timer queue. */
function timers() {
  let queue: { fn: () => void; at: number }[] = [];
  let now = 0;
  return {
    schedule(fn: () => void, ms: number) {
      const entry = { fn, at: now + ms };
      queue.push(entry);
      return () => {
        queue = queue.filter((q) => q !== entry);
      };
    },
    advance(ms: number) {
      now += ms;
      const due = queue.filter((q) => q.at <= now);
      queue = queue.filter((q) => q.at > now);
      for (const q of due) q.fn();
    },
    pending: () => queue.length,
  };
}

function setup(over: Partial<AchievementTrackerDeps> = {}) {
  const clock = timers();
  const unlocked: AchievementId[][] = [];
  const tracker = createAchievementTracker({
    defs: () => achievements,
    lessons: [lesson(), lesson({ id: "meadow-02", order: 2 })],
    clock: { epoch: () => 5000 },
    tzOffsetMin: () => 0,
    schedule: (fn, ms) => clock.schedule(fn, ms),
    onUnlock: (ids) => unlocked.push([...ids]),
    ...over,
  });
  return { tracker, clock, unlocked };
}

const streakTo = (n: number): EngineEvent[] =>
  Array.from({ length: n }, (_, i) => ({ type: "streak" as const, t: i, length: i + 1 }));

describe("achievement tracker", () => {
  it("runs the live check only after a quiet moment following a target or a broken streak", () => {
    const s = setup();
    const bus = createEmitter<GameEvents>();
    const seen: string[] = [];
    bus.on("achievement", (e) => seen.push(e.id));
    s.tracker.begin({ profile: fixture("fresh-sprout"), lesson: lesson(), bus });
    for (const e of streakTo(30)) bus.emit("engine", e);
    // Streak events alone never schedule a check: they come with every key.
    expect(s.clock.pending()).toBe(0);
    bus.emit("engine", { type: "streakBroken", t: 31, length: 30 });
    bus.emit("engine", { type: "streakBroken", t: 32, length: 0 });
    expect(s.clock.pending()).toBe(1);
    s.clock.advance(LIVE_CHECK_DEBOUNCE_MS - 1);
    expect(s.unlocked).toEqual([]);
    s.clock.advance(1);
    expect(s.unlocked).toEqual([["steady-hands"]]);
    expect(seen).toEqual(["steady-hands"]);
  });

  it("finish adds the live unlocks and the session-end ones, each reported once", () => {
    const s = setup();
    const bus = createEmitter<GameEvents>();
    const start = fixture("fresh-sprout");
    const run = s.tracker.begin({ profile: start, lesson: lesson(), bus });
    for (const e of streakTo(26)) bus.emit("engine", e);
    bus.emit("engine", { type: "paused", t: 30 });
    s.clock.advance(LIVE_CHECK_DEBOUNCE_MS);
    const r = result({ summary: summary({ errors: 0, targetsCompleted: 10 }) });
    const updated = run.finish(applyResult(start, lesson(), r, 9000), r);
    expect(Object.keys(updated.achievements).toSorted()).toEqual([
      "first-lesson",
      "not-one-slip",
      "steady-hands",
    ]);
    expect(s.unlocked).toEqual([["steady-hands"], ["first-lesson", "not-one-slip"]]);
    // Listening stopped: later events do nothing.
    bus.emit("engine", { type: "streakBroken", t: 99, length: 200 });
    expect(s.clock.pending()).toBe(0);
  });

  it("the placement test is not a lesson: lesson badges wait for real lessons", () => {
    const s = setup();
    const placement = lesson({ id: "placement", mode: "placement" });
    const start = fixture("fresh-sprout");
    const run = s.tracker.begin({ profile: start, lesson: placement, bus: createEmitter() });
    const r = result({
      summary: summary({ mode: "placement", errors: 0, targetsCompleted: 10 }),
      stars: 0,
      loot: { "char-ore": 1 },
    });
    const updated = run.finish({ ...start, inventory: { "char-ore": 1 } }, r);
    expect(updated.achievements["not-one-slip"]).toBeUndefined();
    expect(updated.achievements["first-lesson"]).toBeUndefined();
    // Typing and finding still count.
    expect(updated.achievements["first-ore"]).toBe(5000);
  });

  it("abandon hands back live unlocks only", () => {
    const s = setup();
    const bus = createEmitter<GameEvents>();
    const run = s.tracker.begin({ profile: fixture("fresh-sprout"), lesson: lesson(), bus });
    for (const e of streakTo(25)) bus.emit("engine", e);
    bus.emit("engine", { type: "paused", t: 30 });
    s.clock.advance(LIVE_CHECK_DEBOUNCE_MS);
    expect(run.abandon()).toEqual({ "steady-hands": 5000 });
  });

  it("before the definitions load nothing unlocks", () => {
    const s = setup({ defs: () => [] });
    const start = fixture("fresh-sprout");
    const run = s.tracker.begin({ profile: start, lesson: lesson(), bus: createEmitter() });
    expect(run.finish(start, result()).achievements).toEqual({});
    expect(s.unlocked).toEqual([]);
  });

  it("never unlocks a badge already earned", () => {
    const s = setup();
    const start = fixture("veteran-builder");
    const run = s.tracker.begin({ profile: start, lesson: lesson(), bus: createEmitter() });
    const updated = run.finish(start, result());
    expect(updated.achievements["first-lesson"]).toBe(start.achievements["first-lesson"]);
    expect(s.unlocked.flat()).not.toContain("first-lesson");
  });
});

function host() {
  const scene = fakeScene();
  const mode = fakeMode();
  const saves: Profile[] = [];
  const t = timers();
  const unlocked: AchievementId[][] = [];
  const finished = vi.fn();
  const h = createPlayHost({
    acquireScene: () => Promise.resolve(scene),
    resolveMode: () => mode.module,
    hud: createHudStore(),
    audio: createSilentAudio(),
    clock: fixedStepClock(1000, 1),
    nextSeed: () => 7,
    frozen: false,
    record: false,
    reminder: createBreakReminder(),
    achievements: createAchievementTracker({
      defs: () => achievements,
      lessons: [lesson()],
      clock: { epoch: () => 4242 },
      tzOffsetMin: () => 0,
      schedule: (fn, ms) => t.schedule(fn, ms),
      onUnlock: (ids) => unlocked.push([...ids]),
    }),
    saveProfile: (p) => {
      saves.push(p);
      return Promise.resolve(true);
    },
    onStatus: () => undefined,
    onFinished: finished,
  });
  return { h, mode, saves, t, unlocked, finished };
}

describe("play host with achievements", () => {
  it("saves the unlocks with the finished lesson", async () => {
    const s = host();
    await s.h.start({ lesson: lesson(), profile: fixture("fresh-sprout") });
    s.mode.ctx().finish(result());
    await flush();
    expect(s.saves).toHaveLength(1);
    expect(s.saves[0]?.achievements["first-lesson"]).toBe(4242);
    expect(s.finished.mock.calls[0]?.[1]).toBe(s.saves[0]);
  });

  it("a lesson left early keeps the badges it already earned, and saves once", async () => {
    const s = host();
    await s.h.start({ lesson: lesson(), profile: fixture("fresh-sprout") });
    const bus = s.mode.ctx().bus;
    for (const e of streakTo(25)) bus.emit("engine", e);
    bus.emit("engine", { type: "paused", t: 40 });
    s.t.advance(LIVE_CHECK_DEBOUNCE_MS);
    s.h.quit();
    expect(s.saves).toHaveLength(1);
    expect(s.saves[0]?.achievements).toEqual({ "steady-hands": 4242 });
    // Nothing else about the profile changed: the lesson wasn't finished.
    expect(s.saves[0]?.sessionCounter).toBe(fixture("fresh-sprout").sessionCounter);
  });

  it("leaving with nothing earned saves nothing", async () => {
    const s = host();
    await s.h.start({ lesson: lesson(), profile: fixture("fresh-sprout") });
    s.h.quit();
    expect(s.saves).toEqual([]);
  });
});
