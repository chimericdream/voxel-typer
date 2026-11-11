import { describe, expect, it, vi } from "vitest";
import { createSilentAudio } from "../../../src/app/audio";
import { realClock } from "../../../src/app/clock";
import { createHudStore } from "../../../src/app/hud";
import { createShell } from "../../../src/app/shell";
import type { ShellDeps } from "../../../src/app/shell";
import type { Settings } from "../../../src/save/settings";
import { NewerSaveError, createMemoryStore } from "../../../src/save/store";
import type { SaveStore } from "../../../src/save/store";
import { fakeMode, fakeScene, fixture, flush, lesson, result } from "./helpers";

function setup(over: Partial<ShellDeps> = {}) {
  const scene = fakeScene();
  const mode = fakeMode();
  const store = createMemoryStore();
  const applied: Settings[] = [];
  const canvas: boolean[] = [];
  const audio = { ...createSilentAudio(), setSpeechEnabled: vi.fn(), setVolume: vi.fn() };
  const shell = createShell({
    store,
    lessons: [lesson(), lesson({ id: "meadow-02", order: 2 })],
    resolveMode: () => mode.module,
    acquireScene: () => Promise.resolve(scene),
    hud: createHudStore(),
    audio,
    clock: realClock,
    nextSeed: () => 1,
    frozen: false,
    record: false,
    applySettings: (s) => applied.push(s),
    focusOnControl: () => false,
    showCanvas: (on) => canvas.push(on),
    ...over,
  });
  return { shell, scene, mode, store, applied, canvas, audio };
}

describe("app shell", () => {
  it("starts on splash with device settings and speech off", () => {
    const s = setup();
    expect(s.shell.route.value).toEqual({ id: "splash" });
    expect(s.applied).toHaveLength(1);
    expect(s.audio.setSpeechEnabled).toHaveBeenCalledWith(false);
    expect(s.canvas).toEqual([false]);
  });

  it("applies a profile's settings, speech first, then every bus volume", () => {
    const s = setup();
    const p = fixture("fresh-sprout");
    s.shell.api.setProfile(p);
    expect(s.applied.at(-1)).toBe(p.settings);
    expect(s.audio.setSpeechEnabled).toHaveBeenLastCalledWith(true);
    expect(s.audio.setVolume).toHaveBeenCalledWith("master", 0.8);
    expect(s.audio.setVolume).toHaveBeenCalledWith("voice", 1);
  });

  it("navigates with history; back pops, and falls back to splash", () => {
    const s = setup();
    s.shell.api.navigate({ id: "profiles" });
    s.shell.api.navigate({ id: "map" });
    s.shell.api.back();
    expect(s.shell.route.value.id).toBe("profiles");
    s.shell.api.back();
    s.shell.api.back();
    expect(s.shell.route.value.id).toBe("splash");
  });

  it("play → finish → results, saving the profile once even on rapid repeats", async () => {
    const s = setup();
    const p = fixture("fresh-sprout");
    await s.store.save(p);
    s.shell.api.setProfile(p);
    s.shell.api.navigate({ id: "map" });
    s.shell.api.navigate({ id: "play", lesson: "meadow-01" });
    await s.shell.ready();
    expect(s.shell.playStatus.value).toBe("running");
    expect(s.canvas.at(-1)).toBe(true);
    const save = vi.spyOn(s.store, "save");
    const ctx = s.mode.ctx();
    ctx.finish(result());
    ctx.finish(result());
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.shell.route.value).toEqual({ id: "results", lesson: "meadow-01" });
    expect(s.canvas.at(-1)).toBe(false);
    expect((await s.store.load(p.id))?.sessionCounter).toBe(p.sessionCounter + 1);
    expect(s.shell.profile.value?.sessionCounter).toBe(p.sessionCounter + 1);
    // Results replaced play in history, so back goes to the map.
    s.shell.api.back();
    expect(s.shell.route.value.id).toBe("map");
  });

  it("play with no profile or an unknown lesson shows the friendly panel", () => {
    const s = setup();
    s.shell.api.navigate({ id: "play", lesson: "meadow-01" });
    expect(s.shell.playStatus.value).toBe("failed");
    s.shell.api.setProfile(fixture("fresh-sprout"));
    s.shell.api.navigate({ id: "play", lesson: "nowhere-99" });
    expect(s.shell.playStatus.value).toBe("failed");
  });

  it("leaving play by back quits the mode", async () => {
    const s = setup();
    s.shell.api.setProfile(fixture("fresh-sprout"));
    s.shell.api.navigate({ id: "play", lesson: "meadow-01" });
    await s.shell.ready();
    s.shell.api.back();
    expect(s.mode.calls).toContain("dispose");
    expect(s.shell.playStatus.value).toBe("idle");
  });

  it("quit from the pause overlay goes to the map", async () => {
    const s = setup();
    s.shell.api.setProfile(fixture("fresh-sprout"));
    s.shell.api.navigate({ id: "play", lesson: "meadow-01" });
    await s.shell.ready();
    s.shell.play.pause(1);
    s.shell.quitPlay();
    expect(s.shell.route.value.id).toBe("map");
    expect(s.mode.calls).toEqual(["start", "pause", "dispose"]);
  });

  describe("autosave", () => {
    it("a newer save is never overwritten: one notice, and no more writes", async () => {
      const store: SaveStore = createMemoryStore();
      const save = vi.spyOn(store, "save").mockRejectedValue(new NewerSaveError("x", 2));
      const s = setup({ store });
      const p = fixture("fresh-sprout");
      expect(await s.shell.api.saveProfile(p)).toBe(false);
      expect(await s.shell.api.saveProfile(p)).toBe(false);
      expect(save).toHaveBeenCalledTimes(1);
      expect(s.shell.notices.value.map((n) => n.kind)).toEqual(["newerVersion"]);
    });

    it("a storage failure gives a calm notice and doesn't throw", async () => {
      const store: SaveStore = createMemoryStore();
      vi.spyOn(store, "save").mockRejectedValue(new Error("quota"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const s = setup({ store });
      await expect(s.shell.api.saveProfile(fixture("fresh-sprout"))).resolves.toBe(false);
      expect(s.shell.notices.value.map((n) => n.kind)).toEqual(["storageError"]);
      warn.mockRestore();
    });
  });

  it("shows store problems as notices, once per kind, and dismisses them", () => {
    const s = setup();
    s.shell.onSaveProblem({ profileId: "a", kind: "restoredPrev", message: "m" });
    s.shell.onSaveProblem({ profileId: "b", kind: "restoredPrev", message: "m" });
    s.shell.onSaveProblem({ profileId: "c", kind: "unreadable", message: "m" });
    const list = s.shell.notices.value;
    expect(list.map((n) => n.kind)).toEqual(["restoredPrev", "unreadable"]);
    s.shell.dismissNotice(list[0]?.id ?? -1);
    expect(s.shell.notices.value.map((n) => n.kind)).toEqual(["unreadable"]);
  });

  it("onInput handlers stack; the newest gets menu keys", () => {
    const s = setup();
    const a = vi.fn(() => true);
    const b = vi.fn(() => true);
    s.shell.api.onInput(a);
    const off = s.shell.api.onInput(b);
    s.shell.router.handle({ kind: "control", action: "confirm", t: 0 });
    expect(b).toHaveBeenCalledTimes(1);
    off();
    s.shell.router.handle({ kind: "control", action: "confirm", t: 0 });
    expect(a).toHaveBeenCalledTimes(1);
  });
});
