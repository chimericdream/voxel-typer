import { describe, expect, it, vi } from "vitest";
import { createBreakReminder } from "../../../src/app/break-reminder";
import { fixedStepClock } from "../../../src/app/clock";
import { createHudStore } from "../../../src/app/hud";
import { createSilentAudio } from "../../../src/app/audio";
import { HEAR_AGAIN_EVENT, createPlayHost } from "../../../src/app/play-host";
import type { PlayHostDeps, PlayStatus } from "../../../src/app/play-host";
import type { Profile } from "../../../src/save/schema";
import { fakeMode, fakeScene, fixture, flush, key, lesson, result } from "./helpers";

function setup(over: Partial<PlayHostDeps> = {}) {
  const scene = fakeScene();
  const mode = fakeMode();
  const statuses: PlayStatus[] = [];
  const saves: Profile[] = [];
  const finished = vi.fn();
  const reminder = createBreakReminder();
  const host = createPlayHost({
    acquireScene: () => Promise.resolve(scene),
    resolveMode: () => mode.module,
    hud: createHudStore(),
    audio: createSilentAudio(),
    clock: fixedStepClock(1000, 1),
    nextSeed: () => 7,
    frozen: false,
    record: false,
    reminder,
    saveProfile: (p) => {
      saves.push(p);
      return Promise.resolve(true);
    },
    onStatus: (s) => statuses.push(s),
    onFinished: finished,
    ...over,
  });
  return { host, scene, mode, statuses, saves, finished, reminder };
}

const sprout = fixture("fresh-sprout");

describe("play host", () => {
  it("builds the mode context from the profile and starts the mode", async () => {
    const s = setup();
    await s.host.start({ lesson: lesson(), profile: sprout });
    const ctx = s.mode.ctx();
    expect(ctx.band).toBe("sprout");
    expect(ctx.settings).toBe(sprout.settings);
    expect(ctx.lesson?.id).toBe("meadow-01");
    expect(ctx.rng.seed).toBe(7);
    expect(ctx.scene).toBe(s.scene);
    expect(s.mode.calls).toEqual(["start"]);
    expect(s.host.status()).toBe("running");
    expect(s.statuses).toEqual(["loading", "running"]);
  });

  it("forwards typed keys only while running", async () => {
    const s = setup();
    await s.host.start({ lesson: lesson(), profile: sprout });
    s.host.input(key("f"));
    s.host.pause(1);
    s.host.input(key("j"));
    s.host.resume(2);
    s.host.input(key("k"));
    expect(s.mode.inputs.map((k) => k.key)).toEqual(["f", "k"]);
  });

  it("drives frame while running; drift on only in live play; idle when paused", async () => {
    const s = setup();
    await s.host.start({ lesson: lesson(), profile: sprout });
    expect(s.scene.subscribers()).toBe(1);
    expect(s.scene.drift).toBe(true);
    s.scene.tick(16, 16);
    s.host.pause(20);
    s.host.pause(21); // a second blur: ignored
    expect(s.scene.subscribers()).toBe(0);
    expect(s.scene.drift).toBe(false);
    s.scene.tick(16, 32);
    s.host.resume(40);
    s.scene.tick(16, 48);
    expect(s.mode.calls).toEqual(["start", "frame", "pause", "resume", "frame"]);
    expect(s.host.fps()).toBeCloseTo(62.5);
  });

  it("never turns drift on under ?freeze", async () => {
    const s = setup({ frozen: true });
    await s.host.start({ lesson: lesson(), profile: sprout });
    expect(s.scene.drift).toBe(false);
  });

  it("acceptance: a finished lesson updates and saves the profile exactly once", async () => {
    const s = setup();
    await s.host.start({ lesson: lesson(), profile: sprout });
    const ctx = s.mode.ctx();
    ctx.finish(result({ stars: 3 }));
    ctx.finish(result({ stars: 1 })); // rapid repeat: ignored
    await flush();
    ctx.finish(result());
    await flush();
    expect(s.saves).toHaveLength(1);
    expect(s.finished).toHaveBeenCalledTimes(1);
    const saved = s.saves[0];
    expect(saved?.sessionCounter).toBe(sprout.sessionCounter + 1);
    expect(saved?.progress.lessons["meadow-01"]).toMatchObject({ bestStars: 3, plays: 1 });
    expect(saved?.history).toHaveLength(sprout.history.length + 1);
    expect(s.host.lastResult()?.stars).toBe(3);
    expect(s.mode.calls.at(-1)).toBe("dispose");
    expect(s.mode.calls.filter((c) => c === "dispose")).toHaveLength(1);
    expect(s.scene.subscribers()).toBe(0);
    expect(s.scene.disposed).toBe(0); // the shared scene outlives the lesson
  });

  it("quitting disposes the mode and a later finish saves nothing", async () => {
    const s = setup();
    await s.host.start({ lesson: lesson(), profile: sprout });
    const ctx = s.mode.ctx();
    s.host.quit();
    ctx.finish(result());
    await flush();
    expect(s.saves).toHaveLength(0);
    expect(s.mode.calls).toEqual(["start", "dispose"]);
    expect(s.host.status()).toBe("idle");
  });

  it("reports a failed start without throwing", async () => {
    const s = setup({
      resolveMode: () => {
        throw new Error("no modes yet");
      },
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await s.host.start({ lesson: lesson(), profile: sprout });
    expect(s.host.status()).toBe("failed");
    err.mockRestore();
  });

  it("sends hearAgain to the mode on the bus", async () => {
    const s = setup();
    await s.host.start({ lesson: lesson(), profile: sprout });
    const heard = vi.fn();
    s.mode.ctx().bus.on(HEAR_AGAIN_EVENT, heard);
    s.host.hearAgain(12);
    expect(heard).toHaveBeenCalledWith({ t: 12 });
  });

  it("records typed keys under ?record", async () => {
    const s = setup({ record: true });
    await s.host.start({ lesson: lesson(), profile: sprout });
    s.host.input(key("f", 3));
    s.mode.ctx().finish(result());
    await flush();
    expect(s.host.recording()).toEqual([key("f", 3)]);
  });

  describe("break reminder", () => {
    const tenMin = { ...sprout, settings: { ...sprout.settings, breakReminderMin: 10 } };
    const complete = {
      type: "targetComplete",
      t: 0,
      targetId: "a",
      accuracy: 1,
      durationMs: 100,
      errors: 0,
    } as const;

    it("waits for a target boundary after enough live play, then resets on resume", async () => {
      const s = setup();
      await s.host.start({ lesson: lesson(), profile: tenMin });
      const { bus } = s.mode.ctx();
      bus.emit("engine", complete);
      expect(s.host.status()).toBe("running"); // not due yet
      s.reminder.add(10 * 60_000 - 1);
      s.scene.tick(1, 1); // crosses the threshold mid-word: nothing happens yet
      expect(s.host.status()).toBe("running");
      bus.emit("engine", complete);
      expect(s.host.status()).toBe("break");
      expect(s.mode.calls.at(-1)).toBe("pause");
      expect(s.scene.drift).toBe(false);
      s.host.resume(5);
      expect(s.host.status()).toBe("running");
      expect(s.reminder.activeMs()).toBe(0);
    });

    it("never shows when breakReminderMin is 0", async () => {
      const s = setup();
      const off = { ...sprout, settings: { ...sprout.settings, breakReminderMin: 0 } };
      await s.host.start({ lesson: lesson(), profile: off });
      s.reminder.add(10 * 3_600_000);
      s.mode.ctx().bus.emit("engine", complete);
      expect(s.host.status()).toBe("running");
    });

    it("counts only live play time", async () => {
      const s = setup();
      await s.host.start({ lesson: lesson(), profile: tenMin });
      s.scene.tick(16, 16);
      s.host.pause(20);
      s.scene.tick(5000, 5016);
      expect(s.reminder.activeMs()).toBe(16);
    });
  });
});
