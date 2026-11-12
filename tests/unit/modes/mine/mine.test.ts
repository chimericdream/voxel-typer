/**
 * Mine mode end to end, without a renderer (task M2-13): a real typing session, the real HUD
 * store and the real play host, on a fake scene whose `three` is null. The mode then runs
 * headless: same rules, sounds, HUD state and loot, no 3D objects.
 */
import { describe, expect, it, vi } from "vitest";
import { createSilentAudio } from "../../../../src/app/audio";
import { createBreakReminder } from "../../../../src/app/break-reminder";
import { fixedStepClock } from "../../../../src/app/clock";
import { createEmitter } from "../../../../src/app/events";
import type { GameEvents } from "../../../../src/app/events";
import { createHudStore } from "../../../../src/app/hud";
import { HEAR_AGAIN_EVENT, createPlayHost } from "../../../../src/app/play-host";
import type { PlayStatus } from "../../../../src/app/play-host";
import type { AudioApi, SfxName } from "../../../../src/audio/types";
import { lessons } from "../../../../src/content/lessons";
import type { Lesson } from "../../../../src/content/lessons/types";
import { meadowLoot } from "../../../../src/content/loot/meadow";
import { createRng } from "../../../../src/engine/rng";
import type { EngineEvent } from "../../../../src/engine/types";
import { mode } from "../../../../src/modes/mine";
import { create } from "../../../../src/modes/mine/mine";
import type { MineHudSlice, MineInstance } from "../../../../src/modes/mine/mine";
import type { ModeContext, ModeResult } from "../../../../src/modes/types";
import type { Profile } from "../../../../src/save/schema";
import { fakeScene, fixture, flush } from "../../app/helpers";

const lessonById = (id: string): Lesson => {
  const l = lessons.find((x) => x.id === id);
  if (!l) throw new Error(`no lesson ${id}`);
  return l;
};

interface Rig {
  instance: MineInstance;
  hud: ReturnType<typeof createHudStore>;
  scene: ReturnType<typeof fakeScene>;
  sfx: { name: SfxName; opts: Parameters<AudioApi["sfx"]>[1] }[];
  spoken: string[];
  fx: string[];
  shakes: number[];
  events: EngineEvent[];
  lootEvents: GameEvents["loot"][];
  results: ModeResult[];
  bus: ModeContext["bus"];
  /** Real-clock time for the next key. */
  now: number;
  /** Types one key `gapMs` after the last one. */
  type(key: string, gapMs?: number): void;
  /** Types whatever the session asks for next. Returns false when nothing is left. */
  typeNext(gapMs?: number): boolean;
  /** Runs frames for `ms` of game time. */
  run(ms: number): void;
  /** Resolves the world load, so the first block appears. */
  loadWorld(): Promise<void>;
}

function rig(
  lessonId: string,
  profile: Profile,
  over: { params?: Record<string, unknown>; seed?: number } = {},
): Rig {
  const scene = fakeScene();
  const hud = createHudStore();
  const bus = createEmitter<GameEvents>();
  const sfx: Rig["sfx"] = [];
  const spoken: string[] = [];
  const fx: string[] = [];
  const shakes: number[] = [];
  const events: EngineEvent[] = [];
  const lootEvents: GameEvents["loot"][] = [];
  const results: ModeResult[] = [];
  let loaded: (() => void) | null = null;
  scene.loadDiorama = () =>
    new Promise<void>((resolve) => {
      loaded = resolve;
    });
  scene.fx = {
    burst: (_at, o) => fx.push(`burst:${o.count}`),
    hitStop: (ms) => fx.push(`hitStop:${ms}`),
    floatText: (_at, text) => fx.push(`text:${text}`),
  };
  scene.camera.shake = (i) => shakes.push(i);
  const audio: AudioApi = {
    ...createSilentAudio(),
    sfx: (name, opts) => sfx.push({ name, opts }),
    speak: (text) => spoken.push(text),
  };
  bus.on("engine", (e) => events.push(e));
  bus.on("loot", (e) => lootEvents.push(e));
  const instance = create({
    lesson: lessonById(lessonId),
    params: over.params ?? {},
    profile,
    settings: profile.settings,
    band: profile.ageBand,
    rng: createRng(over.seed ?? 7),
    clock: fixedStepClock(5000, 1),
    scene,
    hud,
    audio,
    bus,
    finish: (r) => results.push(r),
  });
  const r: Rig = {
    instance,
    hud,
    scene,
    sfx,
    spoken,
    fx,
    shakes,
    events,
    lootEvents,
    results,
    bus,
    now: 10_000,
    type(key, gapMs = 400) {
      r.now += gapMs;
      instance.input({ key, t: r.now, shift: false });
    },
    typeNext(gapMs = 400) {
      const key = hud.get().nextKey;
      if (key === null) return false;
      r.type(key, gapMs);
      return true;
    },
    run(ms) {
      for (let left = ms; left > 0; left -= 16) instance.frame(16, 0);
    },
    async loadWorld() {
      loaded?.();
      await flush();
    },
  };
  return r;
}

async function started(lessonId: string, profile: Profile, over = {}): Promise<Rig> {
  const r = rig(lessonId, profile, over);
  r.instance.start();
  await r.loadWorld();
  return r;
}

const sprout = fixture("fresh-sprout");
const miner = fixture("meadow-done-miner");
const builder = fixture("fresh-builder");
const names = (r: Rig): SfxName[] => r.sfx.map((s) => s.name);
const isLootRow = (v: unknown): v is MineHudSlice["loot"][number] =>
  typeof v === "object" &&
  v !== null &&
  "block" in v &&
  typeof v.block === "string" &&
  "count" in v &&
  typeof v.count === "number";
const mineSlice = (r: Rig): MineHudSlice | undefined => {
  const v = r.hud.get().custom["mine"];
  if (typeof v !== "object" || v === null || !("loot" in v) || !("vein" in v)) return undefined;
  const rows: unknown[] = Array.isArray(v.loot) ? v.loot : [];
  return { loot: rows.filter(isLootRow), vein: v.vein === true };
};

const playWords = async (): Promise<ModeResult | undefined> => {
  const r = await started("meadow-05", miner, { seed: 99 });
  while (r.typeNext()) r.run(100);
  r.run(1500);
  return r.results[0];
};

function host(over: { breakDue?: boolean; away?: boolean } = {}) {
  const scene = fakeScene();
  const statuses: PlayStatus[] = [];
  const finished: ModeResult[] = [];
  const saves: Profile[] = [];
  const reminder = createBreakReminder();
  const hud = createHudStore();
  const play = createPlayHost({
    acquireScene: () => Promise.resolve(scene),
    resolveMode: () => mode,
    hud,
    audio: createSilentAudio(),
    clock: fixedStepClock(1000, 1),
    nextSeed: () => 7,
    frozen: true,
    record: false,
    reminder,
    away: () => over.away ?? false,
    saveProfile: (p) => {
      saves.push(p);
      return Promise.resolve(true);
    },
    onStatus: (s) => statuses.push(s),
    onFinished: (r) => finished.push(r),
  });
  let now = 50_000;
  const typeNext = (): boolean => {
    const key = hud.get().nextKey;
    if (key === null) return false;
    now += 400;
    play.input({ key, t: now, shift: false });
    return true;
  };
  const run = (ms: number): void => {
    for (let left = ms; left > 0; left -= 16) scene.tick(16, 0);
  };
  return { play, scene, hud, statuses, finished, saves, reminder, typeNext, run };
}

describe("mine mode module", () => {
  it("registers as `mine` and loads lazily", async () => {
    expect(mode.id).toBe("mine");
    const loaded = await mode.load();
    expect(typeof loaded.create).toBe("function");
  });
});

describe("mine mode: starting", () => {
  it("takes no keys and shows no word until the world is on the stage", async () => {
    const r = rig("meadow-01", sprout);
    r.instance.start();
    expect(r.instance.session()).toBeNull();
    expect(r.hud.get().word).toBeNull();
    r.type("f");
    r.type("j");
    expect(r.events).toEqual([]);

    await r.loadWorld();
    const view = r.instance.session();
    expect(view?.active?.typed).toBe(0);
    expect(view?.targets).toHaveLength(25);
    expect(r.hud.get().word).toEqual({ text: view?.active?.text, marks: ["pending"], typed: 0 });
    expect(r.hud.get().nextKey).toBe(view?.active?.text);
    expect(r.hud.get().progress01).toBe(0);
    expect(r.hud.get().banner).toEqual({ key: "mine.startLetter", tone: "info" });
  });

  it("still starts when the world fails to load", async () => {
    const r = rig("meadow-01", sprout);
    r.scene.loadDiorama = () => Promise.reject(new Error("no atlas"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    r.instance.start();
    await flush();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    expect(r.instance.session()?.active).not.toBeNull();
    expect(r.typeNext()).toBe(true);
    expect(r.events.some((e) => e.type === "correct")).toBe(true);
  });

  it("builds only f and j for meadow-01, and home-row words for meadow-05", async () => {
    const a = await started("meadow-01", sprout);
    for (const t of a.instance.session()?.targets ?? []) expect(["f", "j"]).toContain(t.text);
    const b = await started("meadow-05", miner);
    const words = (b.instance.session()?.targets ?? []).map((t) => t.text);
    expect(words.length).toBeGreaterThan(5);
    for (const w of words) expect(w).toMatch(/^[asdfjkl]+$/);
    expect(b.hud.get().banner).toEqual({ key: "mine.startWord", tone: "info" });
  });

  it("takes the start hint away at the first correct key, or after a while", async () => {
    const a = await started("meadow-01", sprout);
    a.typeNext();
    expect(a.hud.get().banner).toBeNull();
    const b = await started("meadow-01", sprout);
    b.run(5000);
    expect(b.hud.get().banner).not.toBeNull();
    b.run(1200);
    expect(b.hud.get().banner).toBeNull();
  });
});

describe("mine mode: a whole lesson", () => {
  it("plays meadow-01 to the end and finishes once, with 3 stars and loot", async () => {
    const r = await started("meadow-01", sprout);
    let typed = 0;
    while (r.typeNext()) {
      typed++;
      r.run(300);
    }
    expect(typed).toBe(25);
    expect(r.events.at(-1)?.type).toBe("sessionEnd");
    expect(r.hud.get().word).toBeNull();
    expect(r.hud.get().nextKey).toBeNull();
    expect(r.hud.get().progress01).toBe(1);

    // The last burst and the loot get a moment before Results.
    expect(r.results).toHaveLength(0);
    r.run(1200);
    expect(r.results).toHaveLength(1);
    r.run(2000);
    r.type("f");
    expect(r.results).toHaveLength(1);

    const [result] = r.results;
    expect(result?.stars).toBe(3);
    expect(result?.summary).toMatchObject({
      lessonId: "meadow-01",
      mode: "mine",
      seed: 7,
      keystrokes: 25,
      correct: 25,
      errors: 0,
      accuracy: 1,
      targetsCompleted: 25,
      longestStreak: 25,
    });
    // Every loot event is in the result, and every block is a real Meadow block.
    const total: Record<string, number> = {};
    for (const d of r.lootEvents) total[d.block] = (total[d.block] ?? 0) + d.count;
    expect(result?.loot).toEqual(total);
    const meadow = new Set(meadowLoot.entries.map((e) => e.block));
    for (const [block, count] of Object.entries(result?.loot ?? {})) {
      expect(meadow.has(block)).toBe(true);
      expect(count).toBeGreaterThan(0);
    }
    // Sprout earns an ore block every 10 in a row: at 10 and 20 here.
    expect(result?.extra).toEqual({ oreVeins: 2 });
    // The HUD's loot list ends up equal to the result.
    const shown: Record<string, number> = {};
    for (const row of mineSlice(r)?.loot ?? []) shown[row.block] = row.count;
    expect(shown).toEqual(total);
  });

  it("is the same lesson and the same loot for the same seed", async () => {
    const a = await playWords();
    const b = await playWords();
    expect(a?.loot).toEqual(b?.loot);
    expect(a?.summary.targetsCompleted).toBe(b?.summary.targetsCompleted);
    expect(a?.stars).toBe(3);
  });

  it("re-emits every engine event on the bus, in order", async () => {
    const r = await started("meadow-01", sprout);
    r.typeNext();
    expect(r.events.map((e) => e.type)).toEqual(["correct", "streak", "targetComplete"]);
  });
});

describe("mine mode: a correct key", () => {
  it("chips a word: crack sound by stage, a rising chime, a small puff, no float text", async () => {
    const r = await started("meadow-05", miner);
    const word = r.instance.session()?.active?.text ?? "";
    expect(word.length).toBeGreaterThan(1);
    r.sfx.length = 0;
    r.typeNext();
    expect(names(r)).toEqual(["chime", "chip"]);
    expect(r.sfx[0]?.opts).toMatchObject({ pitchStep: 0 });
    expect(r.sfx[1]?.opts).toMatchObject({
      pitchStep: Math.floor(9 / word.length),
      material: expect.any(String),
    });
    expect(r.fx).toEqual(["burst:3"]);
    expect(r.shakes).toEqual([]);
    expect(r.hud.get().word).toMatchObject({ text: word, typed: 1 });
    r.typeNext();
    expect(r.sfx[2]?.opts).toMatchObject({ pitchStep: 1 });
  });

  it("breaks the block on its last letter: hit-stop, burst, break sound, shake, float text", async () => {
    const r = await started("meadow-05", miner);
    const word = r.instance.session()?.active?.text ?? "";
    for (let i = 0; i < word.length - 1; i++) r.typeNext();
    expect(r.events.some((e) => e.type === "targetComplete")).toBe(false);
    r.sfx.length = 0;
    r.fx.length = 0;
    r.typeNext();
    expect(r.events.filter((e) => e.type === "targetComplete")).toHaveLength(1);
    expect(names(r)).toContain("break");
    expect(names(r)).not.toContain("chip");
    expect(r.fx.slice(0, 2)).toEqual(["hitStop:40", `burst:${8 + 2 * word.length}`]);
    expect(r.fx.filter((f) => f.startsWith("text:"))).toHaveLength(1);
    expect(r.fx[2]).toMatch(/^text:\+\d+$/);
    expect(r.shakes).toHaveLength(1);
    expect(r.shakes[0]).toBeLessThanOrEqual(0.3);
    // The next word is up, and no space was asked for.
    expect(r.hud.get().word?.typed).toBe(0);
    expect(r.hud.get().word?.text).toBe(r.instance.session()?.targets[1]?.text);
    expect(r.hud.get().word?.marks).toHaveLength(r.hud.get().word?.text.length ?? -1);
  });

  it.each(["meadow-05", "meadow-06"])(
    "%s: every block finishes on its last char, never on a space after it (decision 81)",
    async (lessonId) => {
      const r = await started(lessonId, miner, { seed: 5 });
      const texts = (r.instance.session()?.targets ?? []).map((x) => x.text);
      expect(texts.length).toBeGreaterThan(1);
      let keys = "";
      while (r.hud.get().nextKey !== null) {
        const key = r.hud.get().nextKey ?? "";
        const before = r.events.filter((e) => e.type === "targetComplete").length;
        r.typeNext();
        keys += key;
        const after = r.events.filter((e) => e.type === "targetComplete").length;
        // A key that breaks a block is never a space.
        if (after > before) expect(key).not.toBe(" ");
        r.run(100);
      }
      r.run(1500);
      // What was typed is the texts back to back: spaces inside a phrase, none between blocks.
      expect(keys).toBe(texts.join(""));
      const summary = r.results[0]?.summary;
      expect(summary?.correct).toBe(Array.from(texts.join("")).length);
      const spaces = texts.join("").split(" ").length - 1;
      expect(summary?.perKey[" "]?.attempts ?? 0).toBe(spaces);
      if (lessonId === "meadow-06") expect(spaces).toBeGreaterThan(0);
    },
  );

  it.each([
    ["sprout", sprout],
    ["miner", miner],
    ["builder", builder],
  ] as const)(
    "%s: a habit space after each block is ignored, not a slip (decision 81)",
    async (_name, who) => {
      const r = await started("meadow-05", who, { seed: 5 });
      const texts = (r.instance.session()?.targets ?? []).map((x) => x.text);
      r.type(" ");
      while (r.hud.get().nextKey !== null) {
        const before = r.events.filter((e) => e.type === "targetComplete").length;
        r.typeNext();
        if (r.events.filter((e) => e.type === "targetComplete").length > before) r.type(" ");
        r.run(100);
      }
      r.run(1500);
      const summary = r.results[0]?.summary;
      expect(summary?.accuracy).toBe(1);
      expect(summary?.correct).toBe(Array.from(texts.join("")).length);
      expect(r.events.some((e) => e.type === "wrong")).toBe(false);
      expect(r.results[0]?.stars).toBeGreaterThanOrEqual(2);
    },
  );

  it("lights the combo hotbar by streak", async () => {
    const r = await started("meadow-01", sprout);
    for (let i = 0; i < 7; i++) r.typeNext();
    expect(r.hud.get().combo).toBe(2);
    expect(r.hud.get().progress01).toBeCloseTo(7 / 25);
  });

  it("brings a glowing ore block after 10 in a row for Sprout, and cheers", async () => {
    const r = await started("meadow-01", sprout);
    for (let i = 0; i < 9; i++) r.typeNext();
    expect(mineSlice(r)?.vein).toBe(false);
    r.sfx.length = 0;
    r.typeNext();
    expect(mineSlice(r)?.vein).toBe(true);
    expect(names(r)).toContain("star");
    expect(r.hud.get().banner).toEqual({ key: "mine.oreVein", tone: "cheer" });
    // Breaking it drops its bonus, then the next block is an ordinary one.
    const before = r.lootEvents.length;
    r.typeNext();
    expect(r.lootEvents.length).toBeGreaterThan(before);
    expect(mineSlice(r)?.vein).toBe(false);
    r.run(3000);
    expect(r.hud.get().banner).toBeNull();
  });

  it("lands loot in the HUD list after its flight, with a pop", async () => {
    const r = await started("meadow-01", sprout);
    r.typeNext();
    // Headless there is nothing to fly from, so the item lands at once.
    expect(mineSlice(r)?.loot).toHaveLength(1);
    expect(names(r)).toContain("pop");
  });
});

describe("mine mode: a wrong key", () => {
  it("costs nothing: a soft thud, the banner, no effects, the same block and progress", async () => {
    const r = await started("meadow-05", miner);
    r.typeNext();
    const before = r.hud.get();
    r.sfx.length = 0;
    r.fx.length = 0;
    r.type("q");
    expect(names(r)).toEqual(["thud"]);
    expect(r.fx).toEqual([]);
    expect(r.shakes).toEqual([]);
    expect(r.hud.get().banner).toEqual({ key: "mine.almost", tone: "info" });
    expect(r.hud.get().word?.typed).toBe(before.word?.typed);
    expect(r.hud.get().word?.text).toBe(before.word?.text);
    expect(r.hud.get().nextKey).toBe(before.nextKey);
    expect(r.hud.get().progress01).toBe(before.progress01);
    expect(r.hud.get().combo).toBe(0);
    expect(r.hud.get().custom["wrongKey"]).toEqual({ got: "q", seq: 1 });
    expect(r.lootEvents).toEqual([]);
    // The right key still works.
    r.typeNext();
    expect(r.hud.get().word?.typed).toBe((before.word?.typed ?? 0) + 1);
  });

  it("does not thud, wobble or show the banner again for a key that repeats", async () => {
    const r = await started("meadow-01", sprout);
    r.sfx.length = 0;
    for (let i = 0; i < 150; i++) r.type("q", 33);
    expect(names(r).filter((n) => n === "thud")).toHaveLength(1);
    expect(r.fx).toEqual([]);
    // Every press still reaches the on-screen keyboard, which gates repeats itself (M2-09).
    expect(r.hud.get().custom["wrongKey"]).toEqual({ got: "q", seq: 150 });
  });

  it("shows the banner at most once in 5 seconds, and takes it down again", async () => {
    const r = await started("meadow-01", sprout);
    r.typeNext();
    r.type("q", 1000);
    expect(r.hud.get().banner?.key).toBe("mine.almost");
    r.run(3000);
    expect(r.hud.get().banner).toBeNull();
    r.type("w", 1000);
    r.type("e", 1000);
    expect(r.hud.get().banner).toBeNull();
    r.type("q", 4000);
    expect(r.hud.get().banner?.key).toBe("mine.almost");
  });

  it("moves on under Builder's skip policy without a reward for the slip", async () => {
    const r = await started("meadow-05", builder);
    r.sfx.length = 0;
    r.fx.length = 0;
    r.type("q");
    expect(names(r)).toEqual(["thud"]);
    expect(r.fx).toEqual([]);
    expect(r.hud.get().word).toMatchObject({ typed: 1 });
    expect(r.hud.get().word?.marks[0]).toBe("wrong");
  });

  it("gives 1 star, never 0, for a finished lesson with many slips", async () => {
    const r = await started("meadow-01", sprout);
    while (r.hud.get().nextKey !== null) {
      r.type("q", 500);
      r.typeNext(500);
      r.run(200);
    }
    r.run(1500);
    expect(r.results[0]?.stars).toBe(1);
    expect(r.results[0]?.summary.accuracy).toBe(0.5);
    expect(Object.keys(r.results[0]?.loot ?? {}).length).toBeGreaterThan(0);
  });
});

describe("mine mode: hear again, pause and leaving", () => {
  it("speaks each new word for Sprout with TTS on, and again on request", async () => {
    const r = await started("meadow-01", sprout);
    const first = r.instance.session()?.active?.text;
    expect(r.spoken).toEqual([first]);
    r.bus.emit(HEAR_AGAIN_EVENT, { t: 1 });
    expect(r.spoken).toEqual([first, first]);
    r.typeNext();
    expect(r.spoken).toHaveLength(3);
  });

  it("does not speak by itself for Miner, but answers hear again", async () => {
    const r = await started("meadow-05", miner);
    expect(r.spoken).toEqual([]);
    r.bus.emit(HEAR_AGAIN_EVENT, { t: 1 });
    expect(r.spoken).toEqual([r.instance.session()?.active?.text]);
  });

  it("pauses and resumes the session, and drops keys while paused", async () => {
    const r = await started("meadow-01", sprout);
    r.typeNext();
    r.instance.pause(r.now + 10);
    r.instance.pause(r.now + 20);
    expect(r.events.filter((e) => e.type === "paused")).toHaveLength(1);
    const typed = r.events.length;
    r.type(r.hud.get().nextKey ?? "f");
    expect(r.events).toHaveLength(typed);
    r.now += 60_000;
    r.instance.resume(r.now);
    expect(r.events.at(-1)?.type).toBe("resumed");
    r.typeNext();
    expect(r.instance.session()?.elapsedMs).toBeLessThan(5000);
  });

  it("stops listening after dispose, and a late world load makes nothing", async () => {
    const r = rig("meadow-01", sprout);
    r.instance.start();
    r.instance.dispose();
    await r.loadWorld();
    expect(r.instance.session()).toBeNull();
    r.bus.emit(HEAR_AGAIN_EVENT, { t: 1 });
    expect(r.spoken).toEqual([]);
    r.instance.dispose();
  });
});

describe("mine mode in the play host", () => {
  it("plays a lesson through the host: one result, one save, the profile updated", async () => {
    const h = host();
    await h.play.start({ lesson: lessonById("meadow-01"), profile: sprout });
    await flush();
    expect(h.play.status()).toBe("running");
    expect(h.play.session()?.active).not.toBeNull();
    while (h.typeNext()) h.run(100);
    h.run(1500);
    await flush();
    expect(h.statuses).toEqual(["loading", "running", "finished"]);
    expect(h.finished).toHaveLength(1);
    expect(h.saves).toHaveLength(1);
    expect(h.saves[0]?.sessionCounter).toBe(sprout.sessionCounter + 1);
    expect(h.saves[0]?.progress.lessons["meadow-01"]?.bestStars).toBe(3);
    const earned = Object.values(h.finished[0]?.loot ?? {}).reduce((a, b) => a + b, 0);
    expect(earned).toBeGreaterThanOrEqual(25);
    // The host cleared the HUD when it disposed the mode.
    expect(h.hud.get().word).toBeNull();
  });

  it("shows a break that falls due on the last block, then goes on to Results", async () => {
    const h = host();
    await h.play.start({ lesson: lessonById("meadow-01"), profile: sprout });
    await flush();
    for (let i = 0; i < 24; i++) {
      h.typeNext();
      h.run(100);
    }
    // 15 minutes of play are up just before the last key.
    h.reminder.add(15 * 60_000);
    h.typeNext();
    expect(h.play.status()).toBe("break");
    h.run(3000);
    await flush();
    // Nothing moves and nothing is lost while the break is up.
    expect(h.finished).toHaveLength(0);
    h.play.resume(60_000);
    expect(h.reminder.activeMs()).toBe(0);
    h.run(1500);
    await flush();
    expect(h.play.status()).toBe("finished");
    expect(h.finished).toHaveLength(1);
    expect(h.finished[0]?.stars).toBe(3);
  });

  it("starts paused when the lesson finishes loading while the page is away", async () => {
    const h = host({ away: true });
    await h.play.start({ lesson: lessonById("meadow-01"), profile: sprout });
    await flush();
    expect(h.statuses).toEqual(["loading", "running", "paused"]);
    expect(h.scene.subscribers()).toBe(0);
    expect(h.scene.drift).toBe(false);
    // Keys are dropped until the child comes back.
    expect(h.typeNext()).toBe(true);
    expect(h.play.session()?.active?.typed).toBe(0);
    h.play.resume(70_000);
    expect(h.play.status()).toBe("running");
    h.typeNext();
    expect(h.play.session()?.targets[0]?.complete).toBe(true);
  });
});
