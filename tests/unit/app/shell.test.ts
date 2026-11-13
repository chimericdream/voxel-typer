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

  it("a deep link straight into play finds the starting profile (?profile fixtures)", async () => {
    const s = setup({
      initial: { id: "play", lesson: "meadow-01" },
      initialProfile: fixture("fresh-sprout"),
    });
    await s.shell.ready();
    expect(s.shell.profile.value?.id).toBe(fixture("fresh-sprout").id);
    expect(s.shell.playStatus.value).toBe("running");
  });

  it("an old lesson's slow save never routes a newer lesson to results", async () => {
    const s = setup();
    const p = fixture("fresh-sprout");
    await s.store.save(p);
    s.shell.api.setProfile(p);
    s.shell.api.navigate({ id: "map" });
    s.shell.api.navigate({ id: "play", lesson: "meadow-01" });
    await s.shell.ready();
    const gate: { release?: () => void } = {};
    const slow = new Promise<void>((r) => {
      gate.release = r;
    });
    vi.spyOn(s.store, "save").mockImplementationOnce(() => slow);
    s.mode.ctx().finish(result());
    s.shell.api.back();
    s.shell.api.navigate({ id: "play", lesson: "meadow-02" });
    await s.shell.ready();
    gate.release?.();
    await flush();
    expect(s.shell.route.value).toEqual({ id: "play", lesson: "meadow-02" });
    expect(s.shell.playStatus.value).toBe("running");
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

  it("drops an Escape no screen takes until the route's screen has drawn (M3-FIX-13)", () => {
    const s = setup();
    const escape = (): void => s.shell.router.handle({ kind: "control", action: "back", t: 0 });
    s.shell.api.navigate({ id: "lessonIntro", lesson: "meadow-01" });
    s.shell.screenDrawn(s.shell.route.value);
    // "Back to the map", and Escape before the map has loaded: nothing happens.
    s.shell.api.navigate({ id: "map" });
    escape();
    expect(s.shell.route.value.id).toBe("map");
    // Once the map is up, an Escape it leaves alone goes back as before.
    s.shell.screenDrawn(s.shell.route.value);
    escape();
    expect(s.shell.route.value.id).toBe("lessonIntro");
    // The screen a route drew before doesn't count for the next route with the same id.
    s.shell.api.navigate({ id: "lessonIntro", lesson: "meadow-02" });
    escape();
    expect(s.shell.route.value).toEqual({ id: "lessonIntro", lesson: "meadow-02" });
    // The app's own Back buttons are never held back.
    s.shell.api.back();
    expect(s.shell.route.value.id).toBe("lessonIntro");
    expect(s.shell.route.value.lesson).toBe("meadow-01");
  });

  it("back arrives on a fresh route object, so a settle wait restarts (M3-10 re-review N1)", () => {
    const s = setup();
    s.shell.api.navigate({ id: "map" });
    const first = s.shell.route.value;
    s.shell.api.navigate({ id: "settings" });
    s.shell.api.back();
    expect(s.shell.route.value.id).toBe("map");
    expect(s.shell.route.value).not.toBe(first);
  });

  it("drops queued badge toasts when the player changes (M3-10 re-review N3)", () => {
    const s = setup();
    s.shell.api.setProfile(fixture("fresh-sprout"));
    s.shell.queueBadges(["first-lesson"]);
    expect(s.shell.badgeToasts.value).toEqual(["first-lesson"]);
    s.shell.api.setProfile({ ...fixture("fresh-sprout"), id: "someone-else" });
    expect(s.shell.badgeToasts.value).toEqual([]);
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

  it("the Home Island is Builder on the play route (M4-07): `island` goes there", async () => {
    const s = setup();
    s.shell.api.setProfile(fixture("fresh-sprout"));
    s.shell.api.navigate({ id: "map" });
    s.shell.api.navigate({ id: "island" });
    await s.shell.ready();
    expect(s.shell.route.value).toEqual({ id: "play", lesson: "builder" });
    expect(s.mode.ctx().lesson).toMatchObject({ id: "builder", mode: "builder" });
    expect(s.canvas.at(-1)).toBe(true);
    // Leaving from the pause overlay goes to the map, and back from there is not the island.
    s.shell.play.pause(1);
    s.shell.quitPlay();
    expect(s.shell.route.value.id).toBe("map");
  });

  it("a deep link to `island` opens Builder too", async () => {
    const s = setup({ initial: { id: "island" }, initialProfile: fixture("fresh-sprout") });
    await s.shell.ready();
    expect(s.shell.route.value).toEqual({ id: "play", lesson: "builder" });
    expect(s.shell.playStatus.value).toBe("running");
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

  it("readOnlyProfiles: a NewerSaveError or a newerVersion load problem makes a profile read-only (M2-11)", async () => {
    const s = setup();
    const p = fixture("fresh-sprout");
    expect(s.shell.api.readOnlyProfiles().size).toBe(0);
    s.shell.onSaveProblem({ profileId: "other", kind: "newerVersion", message: "m" });
    s.shell.onSaveProblem({ profileId: null, kind: "newerVersion", message: "m" });
    s.shell.onSaveProblem({ profileId: "third", kind: "unreadable", message: "m" });
    expect([...s.shell.api.readOnlyProfiles()]).toEqual(["other"]);
    const save = vi.spyOn(s.store, "save").mockRejectedValueOnce(new NewerSaveError(p.id, 2));
    expect(await s.shell.api.saveProfile(p)).toBe(false);
    expect(s.shell.api.readOnlyProfiles().has(p.id)).toBe(true);
    expect(await s.shell.api.saveProfile(p)).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("damagedProfiles and removeProfile (M3-09): a damaged profile holds a slot until removed", async () => {
    const s = setup();
    const p = fixture("fresh-sprout");
    await s.store.save(p);
    s.shell.onSaveProblem({ profileId: "lost-1", kind: "unreadable", message: "m" });
    s.shell.onSaveProblem({ profileId: null, kind: "unreadable", message: "m" });
    expect([...s.shell.api.damagedProfiles()]).toEqual(["lost-1"]);
    expect(await s.shell.api.removeProfile("lost-1")).toBe(true);
    expect(s.shell.api.damagedProfiles().size).toBe(0);

    s.shell.api.setProfile(p);
    expect(await s.shell.api.removeProfile(p.id)).toBe(true);
    expect(s.shell.api.profile()).toBeNull();
    expect(await s.store.listProfiles()).toEqual([]);

    // A newer build owns this one: never removed here.
    s.shell.onSaveProblem({ profileId: "newer", kind: "newerVersion", message: "m" });
    const remove = vi.spyOn(s.store, "remove");
    expect(await s.shell.api.removeProfile("newer")).toBe(false);
    expect(remove).not.toHaveBeenCalled();

    // A storage failure is a kind notice, not a crash.
    remove.mockRejectedValueOnce(new Error("disk"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await s.shell.api.removeProfile("x")).toBe(false);
    expect(s.shell.notices.value.map((n) => n.kind)).toContain("storageError");
    warn.mockRestore();
  });
});
