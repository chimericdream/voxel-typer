/**
 * Night Defense end to end, without a renderer (task M4-04): the real wave director, a real
 * `lockOn` typing session, the real HUD store, on a fake scene whose `three` is null. The mode then
 * runs headless: same rules, sounds, HUD state and loot, no 3D objects and no plates.
 *
 * The last block is the no-failure invariant for Defense (card M4-04, M4-10 style): whatever the
 * child types, nothing in the profile ever goes down.
 */
import * as fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { createSilentAudio } from "../../../../src/app/audio";
import type { Clock } from "../../../../src/app/clock";
import { createEmitter } from "../../../../src/app/events";
import type { GameEvents } from "../../../../src/app/events";
import { createHudStore } from "../../../../src/app/hud";
import { HEAR_AGAIN_EVENT } from "../../../../src/app/play-host";
import { applyResult } from "../../../../src/app/progress";
import type { AudioApi, SfxName } from "../../../../src/audio/types";
import { lessons } from "../../../../src/content/lessons";
import { MOBS } from "../../../../src/content/mobs";
import type { Lesson } from "../../../../src/content/lessons/types";
import { foundBlocks } from "../../../../src/engine/achievements";
import { createRng } from "../../../../src/engine/rng";
import { t } from "../../../../src/i18n";
import type { EngineEvent } from "../../../../src/engine/types";
import { mode } from "../../../../src/modes/defense";
import { DIRECTOR_CONSTANTS } from "../../../../src/modes/defense/director";
import {
  WAVE_END_EVENT,
  WAVE_EVENT,
  create,
  forgetNights,
} from "../../../../src/modes/defense/defense";
import type { DefenseInstance } from "../../../../src/modes/defense/defense";
import {
  DAY_HOLD_MS,
  DAY_MS,
  NIGHT_CAP_MS,
  SHIELD_SEGMENTS,
  nightWaves,
} from "../../../../src/modes/defense/logic";
import type { ModeResult } from "../../../../src/modes/types";
import type { Profile } from "../../../../src/save/schema";
import { handsCaptionOnly } from "../../../../src/ui/hud/bridge";
import { resultLines } from "../../../../src/ui/screens/results-logic";
import { fakeScene, fixture, flush } from "../../app/helpers";

const lessonById = (id: string): Lesson => {
  const l = lessons.find((x) => x.id === id);
  if (!l) throw new Error(`no lesson ${id}`);
  return l;
};

const NIGHT = lessonById("birch-08");

interface WaveEnd {
  index: number;
  accuracy: number;
  reachedBase: number;
  wordsDone: number;
  activeMs: number;
  pulledMs: number;
  difficulty: number;
}
const isWaveEnd = (v: unknown): v is WaveEnd =>
  typeof v === "object" && v !== null && "reachedBase" in v && "wordsDone" in v && "accuracy" in v;
const mobsOf = (v: unknown): number =>
  typeof v === "object" && v !== null && "mobs" in v && typeof v.mobs === "number" ? v.mobs : 0;

interface Rig {
  readonly instance: DefenseInstance;
  hud: ReturnType<typeof createHudStore>;
  sfx: SfxName[];
  spoken: string[];
  fx: string[];
  events: EngineEvent[];
  loot: GameEvents["loot"][];
  results: ModeResult[];
  banners: string[];
  /** Mobs of each wave as it began, and how each ended. */
  waves: number[];
  ends: WaveEnd[];
  bus: ReturnType<typeof createEmitter<GameEvents>>;
  /** The one clock: frames and keys both move it. */
  now: number;
  /** Called after every frame (a test's probe), or null. */
  afterFrame: (() => void) | null;
  /** Runs frames for `ms` of game time. */
  run(ms: number): void;
  /** Types one key `gapMs` after the last thing that happened. */
  type(key: string, gapMs?: number): void;
  /** Types the key the HUD lights. False when there is none. */
  typeNext(gapMs?: number): boolean;
  /** Runs frames until the night reaches `phase` (or gives up). */
  until(phase: string, maxMs?: number): boolean;
  /** Plays the rest of the night with no slips. */
  playOut(maxMs?: number): ModeResult | undefined;
}

function rig(
  profile: Profile,
  over: { seed?: number; lesson?: Lesson | null; calm?: boolean; tts?: boolean } = {},
): Rig {
  const scene = fakeScene();
  const hud = createHudStore();
  const bus = createEmitter<GameEvents>();
  const fx: string[] = [];
  scene.fx = {
    burst: (_at, o) => fx.push(`burst:${o.count}`),
    hitStop: (ms) => fx.push(`hitStop:${ms}`),
    floatText: (_at, text) => fx.push(`text:${text}`),
  };
  const sfx: SfxName[] = [];
  const spoken: string[] = [];
  const audio: AudioApi = {
    ...createSilentAudio(),
    sfx: (name) => sfx.push(name),
    speak: (text) => spoken.push(text),
  };
  const settings = {
    ...profile.settings,
    ...(over.calm !== undefined && { calmMode: over.calm }),
    ...(over.tts !== undefined && { tts: over.tts }),
  };
  const results: ModeResult[] = [];
  const banners: string[] = [];
  let made: DefenseInstance | null = null;
  const r: Rig = {
    get instance(): DefenseInstance {
      if (made === null) throw new Error("the mode isn't made yet");
      return made;
    },
    hud,
    sfx,
    spoken,
    fx,
    events: [],
    loot: [],
    results,
    banners,
    waves: [],
    ends: [],
    bus,
    now: 10_000,
    afterFrame: null,
    run(ms) {
      for (let left = ms; left > 0; left -= 16) {
        r.now += 16;
        r.instance.frame(16, 0);
        r.afterFrame?.();
        const key = hud.get().banner?.key;
        if (key !== undefined && banners.at(-1) !== key) banners.push(key);
      }
    },
    type(key, gapMs = 150) {
      r.run(gapMs);
      r.instance.input({ key, t: r.now, shift: false });
    },
    typeNext(gapMs = 150) {
      const key = hud.get().nextKey;
      if (key === null) return false;
      r.type(key, gapMs);
      return true;
    },
    until(phase, maxMs = 600_000) {
      for (let ran = 0; ran < maxMs && r.instance.phase() !== phase; ran += 160) r.run(160);
      return r.instance.phase() === phase;
    },
    playOut(maxMs = 900_000) {
      const end = r.now + maxMs;
      while (results.length === 0 && r.now < end) if (!r.typeNext()) r.run(160);
      return results[0];
    },
  };
  bus.on("engine", (e) => r.events.push(e));
  bus.on("loot", (e) => r.loot.push(e));
  bus.on(WAVE_EVENT, (e) => r.waves.push(mobsOf(e)));
  bus.on(WAVE_END_EVENT, (e) => {
    if (isWaveEnd(e)) r.ends.push(e);
  });
  const clock: Clock = { now: () => r.now, epoch: () => 0 };
  made = create({
    lesson: over.lesson === undefined ? NIGHT : over.lesson,
    params: {},
    profile: { ...profile, settings },
    settings,
    band: profile.ageBand,
    rng: createRng(over.seed ?? 7),
    clock,
    scene,
    hud,
    audio,
    bus,
    finish: (result) => results.push(result),
  });
  return r;
}

async function started(profile: Profile, over: Parameters<typeof rig>[1] = {}): Promise<Rig> {
  const r = rig(profile, over);
  r.instance.start();
  await flush();
  return r;
}

const sprout = fixture("fresh-sprout");
const miner = fixture("meadow-done-miner");
const builder = fixture("veteran-builder");
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

// Each test is a fresh sitting: no night remembered from the test before.
beforeEach(() => {
  forgetNights();
});

describe("the mode module", () => {
  it("registers as defense and loads lazily", async () => {
    expect(mode.id).toBe("defense");
    const loaded = await mode.load();
    expect(typeof loaded.create).toBe("function");
  });

  it("is what three shipped lessons ask for", () => {
    const nights = lessons.filter((l) => l.mode === "defense");
    expect(nights.map((l) => l.id).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "birch-08",
      "frosty-06",
      "shore-05",
    ]);
    // A night needs single words: its mobs carry one word each.
    for (const l of nights) expect(l.kind).toBe("words");
  });
});

describe("the night's flow", () => {
  it("goes day, dusk, night, dawn, and ends with a result", async () => {
    const r = await started(miner);
    expect(r.instance.phase()).toBe("day");
    expect(r.hud.get().banner).toMatchObject({ key: "defense.nightComing" });
    // The day is 10 s when the child just watches.
    r.run(DAY_MS - 200);
    expect(r.instance.phase()).toBe("day");
    r.run(400);
    expect(r.instance.phase()).toBe("dusk");
    // Dusk names the visitors of the first wave.
    const dusk = r.hud.get().banner;
    expect(dusk?.key).toMatch(/^defense\.onTheWay/);
    expect(r.until("night")).toBe(true);
    expect(dusk?.params).toEqual({ count: r.waves[0] });
    const result = r.playOut();
    expect(result).toBeDefined();
    expect(r.banners).toContain("defense.dawn");
    expect(r.instance.phase()).toBe("done");
    expect(r.results).toHaveLength(1);
    expect(result?.summary).toMatchObject({ mode: "defense", lessonId: "birch-08", errors: 0 });
    expect(result?.stars).toBe(3);
  });

  it("lets a key press move the day along, without counting it", async () => {
    const r = await started(miner);
    // A held key at the very start can't skip the day before it is seen.
    r.type("q", 100);
    r.run(DAY_HOLD_MS);
    expect(r.instance.phase()).toBe("day");
    r.type("q", 100);
    r.run(700);
    expect(r.instance.phase()).toBe("dusk");
    // Keys at dusk do nothing either.
    r.type("z", 100);
    r.type(" ", 100);
    const result = r.playOut();
    expect(result?.summary.errors).toBe(0);
    expect(result?.summary.keystrokes).toBe(result?.summary.correct);
  });

  it("never shows a clock or a big word, and lights the next key", async () => {
    const r = await started(miner);
    r.until("night");
    let lit = 0;
    while (r.results.length === 0) {
      expect(r.hud.get().timer).toBeNull();
      expect(r.hud.get().word).toBeNull();
      if (r.typeNext()) lit++;
      else r.run(160);
    }
    expect(lit).toBeGreaterThan(20);
    expect(r.hud.get().progress01).toBe(1);
  });

  it("plays as many waves as the lesson's length asks for, and tells the director once a wave", async () => {
    for (const profile of [miner, builder]) {
      const r = await started(profile);
      const result = r.playOut();
      const waves = nightWaves(NIGHT, profile.ageBand);
      expect(r.waves).toHaveLength(waves);
      // `observe` runs once per wave: one end event each, in order.
      expect(r.ends.map((e) => e.index)).toEqual(Array.from({ length: waves }, (_, i) => i));
      expect(result?.extra).toMatchObject({ waves, reached: 0 });
      // Each wave's feedback is its own: every mob typed, no slips.
      r.ends.forEach((e, i) => {
        expect(e).toMatchObject({ accuracy: 1, reachedBase: 0, wordsDone: r.waves[i] });
        expect(e.activeMs).toBeGreaterThan(2000);
        expect(e.pulledMs).toBeGreaterThanOrEqual(0);
      });
      // A quick typist empties the field, and the mode tells the director how far that brought
      // the wave forward (calm mode's slowness adds it back, M4-FIX-3).
      expect(r.ends.some((e) => e.pulledMs > 0)).toBe(true);
      expect(result?.summary.targetsCompleted).toBe(sum(r.waves));
    }
  });

  it("sends the first visitor while the dusk banner is still up, and it can be typed then", async () => {
    for (const profile of [sprout, miner, builder]) {
      forgetNights();
      const r = await started(profile);
      expect(r.until("dusk")).toBe(true);
      const duskAt = r.now;
      const announcement = r.hud.get().banner?.key;
      expect(announcement).toMatch(/^defense\.onTheWay/);
      let firstAt: number | null = null;
      while (firstAt === null && r.instance.phase() === "dusk") {
        r.run(16);
        if ((r.instance.session()?.targets.length ?? 0) > 0) firstAt = r.now;
      }
      expect(firstAt, profile.ageBand).not.toBeNull();
      expect((firstAt ?? 0) - duskAt).toBeLessThanOrEqual(DIRECTOR_CONSTANTS.maxIdleMs);
      // Still dusk, the announcement still up, and the visitor's first letter is lit and types.
      expect(r.instance.phase()).toBe("dusk");
      expect(r.hud.get().banner?.key).toBe(announcement);
      const key = r.hud.get().nextKey;
      expect(key).not.toBeNull();
      r.type(key ?? "", 50);
      expect(r.instance.session()?.active?.typed).toBe(1);
      expect(r.events.some((e) => e.type === "wrong")).toBe(false);
    }
  });

  it("never leaves the field empty for longer than maxIdleMs, from dusk to dawn", async () => {
    // The owner's playtest: never more than about 2–3 s of empty field.
    expect(DIRECTOR_CONSTANTS.maxIdleMs).toBeLessThanOrEqual(3000);
    // A quick typist, a slow one, a Sprout's calm night, and a child who never types (Miner and
    // Builder: a calm night waits for its words for ever).
    const cases = [
      { profile: miner, gapMs: 150 },
      { profile: miner, gapMs: 1500 },
      { profile: miner, gapMs: null },
      { profile: sprout, gapMs: 1000 },
      { profile: builder, gapMs: 400 },
      { profile: builder, gapMs: null },
    ] as const;
    for (const { profile, gapMs } of cases) {
      forgetNights();
      const r = await started(profile);
      // From the first frame of dusk: that is when the night starts.
      expect(r.until("dusk", 60_000)).toBe(true);
      let empty = 0;
      let longest = 0;
      // Empty: no mob on the field still needs typing (a popping or bonking one doesn't count).
      r.afterFrame = () => {
        const phase = r.instance.phase();
        if (phase !== "dusk" && phase !== "night") return;
        const open = r.instance.session()?.targets.filter((v) => !v.complete).length ?? 0;
        empty = open === 0 ? empty + 16 : 0;
        longest = Math.max(longest, empty);
      };
      const end = r.now + 900_000;
      while (r.results.length === 0 && r.now < end)
        if (gapMs === null || !r.typeNext(gapMs)) r.run(160);
      const label = `${profile.ageBand} ${gapMs ?? "idle"}`;
      expect(r.results, label).toHaveLength(1);
      expect(longest, label).toBeLessThanOrEqual(DIRECTOR_CONSTANTS.maxIdleMs + 250);
      // The pause between waves is still there: the field does empty out.
      expect(longest, label).toBeGreaterThan(1000);
    }
  });

  it("ends a long night at dawn once the band's cap has passed, and the stars still count (M4-FIX-3)", async () => {
    // A 5-wave Miner lesson, calm (the visitors wait for their words), typed at about 3 WPM:
    // five waves would take well over 5 min.
    const long: Lesson = { ...NIGHT, length: { targets: 40 } };
    expect(nightWaves(long, "miner")).toBe(5);
    forgetNights();
    const r = await started(miner, { lesson: long, calm: true });
    expect(r.until("dusk", 60_000)).toBe(true);
    const duskAt = r.now;
    let dawnAt: number | null = null;
    const endsAt: number[] = [];
    r.afterFrame = () => {
      if (dawnAt === null && r.instance.phase() === "dawn") dawnAt = r.now;
      if (r.ends.length > endsAt.length) endsAt.push(r.now - duskAt);
    };
    const end = r.now + 1_800_000;
    while (r.results.length === 0 && r.now < end) if (!r.typeNext(4000)) r.run(160);
    expect(r.results).toHaveLength(1);
    const result = r.results[0];
    // The wave that was on when the cap passed finished; no wave started after it.
    expect(r.waves.length).toBeLessThan(5);
    expect(r.ends).toHaveLength(r.waves.length);
    expect(endsAt.at(-2) ?? 0).toBeLessThan(NIGHT_CAP_MS.miner);
    expect(endsAt.at(-1) ?? 0).toBeGreaterThanOrEqual(NIGHT_CAP_MS.miner);
    expect(dawnAt).not.toBeNull();
    // Stars count the visitors sent home, not the waves: every mob was typed, so the gate passes.
    expect(result?.extra).toMatchObject({ waves: r.waves.length, reached: 0 });
    expect(result?.stars).toBeGreaterThanOrEqual(1);
    expect(result?.summary.targetsCompleted).toBe(sum(r.waves));
    // A short night isn't cut: birch-08's three waves all play at a quick pace.
    forgetNights();
    const quick = await started(miner);
    quick.playOut();
    expect(quick.waves).toHaveLength(nightWaves(NIGHT, "miner"));
  }, 120_000);

  it("resumes a second night at the same pace, even if the profile gained a baseline since (M4-FIX-3)", async () => {
    // A new Builder (no baseline: the reference is the band's 15 WPM guess) plays a slow night.
    forgetNights();
    const fresh = fixture("fresh-builder");
    const first = await started(fresh);
    const end = first.now + 1_800_000;
    first.until("dusk", 60_000);
    while (first.results.length === 0 && first.now < end) if (!first.typeNext(2400)) first.run(160);
    const last = first.ends.at(-1);
    expect(last).toBeDefined();
    const pace = (last?.difficulty ?? 0) * DIRECTOR_CONSTANTS.defaultBaselineWpm.builder;
    // Then three Mine lessons in the same sitting give them a baseline of 4 WPM.
    const template = fixture("meadow-done-miner").history.find((h) => h.mode === "mine");
    if (template === undefined) throw new Error("no mine summary in the fixture");
    const known: Profile = {
      ...fresh,
      history: [1, 2, 3].map(() => ({ ...template, netWpm: 4 })),
    };
    const second = await started(known);
    second.until("dusk", 60_000);
    second.typeNext(2400);
    while (second.ends.length === 0) if (!second.typeNext(2400)) second.run(160);
    // The night resumes in fine mode at the same pace: −15 % at most after its first wave, never
    // `d` carried over against the new 4 WPM reference (which would be a pace of about 1 WPM).
    const resumed = (second.ends[0]?.difficulty ?? 0) * 4;
    expect(resumed).toBeGreaterThanOrEqual(pace * (1 - DIRECTOR_CONSTANTS.maxStep) - 1e-6);
    expect(resumed).toBeLessThanOrEqual(pace * (1 + DIRECTOR_CONSTANTS.fineMaxStepUp) + 1e-6);
    forgetNights();
  }, 120_000);

  it("free play (no lesson) is a three-wave night on the home keys", async () => {
    const r = await started(miner, { lesson: null });
    const result = r.playOut();
    expect(r.waves).toHaveLength(3);
    expect(result?.summary.lessonId).toBeUndefined();
    const typed = r.events.flatMap((e) => (e.type === "correct" ? [e.char] : []));
    for (const c of typed) expect("fjdksla;").toContain(c);
  });
});

describe("typing", () => {
  it("locks on the first letter, pops on the last, and drops loot", async () => {
    const r = await started(miner);
    r.until("night");
    while (r.hud.get().nextKey === null) r.run(160);
    const before = r.events.length;
    r.typeNext();
    const locked = r.events.slice(before).find((e) => e.type === "targetLocked");
    expect(locked).toBeDefined();
    while (!r.events.some((e) => e.type === "targetComplete")) r.typeNext();
    // No space was needed: the word's last letter sent its visitor home.
    expect(r.events.some((e) => e.type === "correct" && e.char === " ")).toBe(false);
    expect(r.sfx).toContain("pop");
    expect(r.loot.length).toBeGreaterThan(0);
    expect(r.fx.some((f) => f.startsWith("hitStop"))).toBe(true);
  });

  it("drops a habit space and keys pressed at an empty field: no slip, no broken streak", async () => {
    const r = await started(miner);
    // The start of dusk, before the first visitor is out: nothing to type.
    r.until("dusk");
    r.type("q", 16);
    r.type(" ", 16);
    while (r.hud.get().nextKey === null) r.run(160);
    // A space with nothing locked.
    r.type(" ");
    // A space after a word (the habit from sentences), then on.
    while (!r.events.some((e) => e.type === "targetComplete")) r.typeNext();
    r.type(" ");
    const result = r.playOut();
    expect(r.events.some((e) => e.type === "wrong")).toBe(false);
    expect(result?.summary.errors).toBe(0);
    expect(result?.summary.longestStreak).toBe(result?.summary.correct);
  });

  it("a wrong key costs nothing: same word, same progress, a kind banner at most", async () => {
    const r = await started(miner);
    r.until("night");
    while (r.hud.get().nextKey === null) r.run(160);
    r.typeNext();
    const mid = r.instance.session()?.active;
    expect(mid?.typed).toBe(1);
    r.type("~");
    const after = r.instance.session()?.active;
    expect(after).toMatchObject({ id: mid?.id, typed: 1 });
    expect(r.sfx).toContain("thud");
    expect(r.hud.get().banner).toMatchObject({ key: "defense.almost" });
    // No effect for a slip: no burst, no shake, no hit-stop.
    expect(r.fx).toEqual([]);
    const result = r.playOut();
    expect(result?.summary.errors).toBe(1);
    expect(result?.stars).toBeGreaterThanOrEqual(1);
  });

  it("reads the word aloud for a Sprout with read-aloud on, and on hear-again", async () => {
    const r = await started(sprout, { tts: true });
    r.until("night");
    while (r.hud.get().nextKey === null) r.run(160);
    r.bus.emit(HEAR_AGAIN_EVENT, { t: r.now });
    expect(r.spoken).toHaveLength(1);
    r.typeNext();
    expect(r.spoken).toHaveLength(2);
    expect(r.spoken[1]).toBe(r.instance.session()?.active?.text);
  });
});

describe("no game over", () => {
  it("an idle child still reaches dawn: the shield rests, the mobs bounce off, nothing is lost", async () => {
    const r = await started(miner);
    expect(r.until("done")).toBe(true);
    const result = r.results[0];
    const total = sum(r.waves);
    expect(total).toBeGreaterThan(SHIELD_SEGMENTS);
    // Every mob got to the camp, and the director heard about all of them, also past zero.
    expect(result?.extra).toMatchObject({ popped: 0, reached: total, shieldLeft: 0 });
    expect(sum(r.ends.map((e) => e.reachedBase))).toBe(total);
    expect(r.sfx.filter((s) => s === "shield")).toHaveLength(total);
    // The kind banner showed once, when the shield emptied.
    expect(r.banners.filter((b) => b === "defense.shieldRest")).toHaveLength(1);
    // Each wave was easier than the one before.
    for (let i = 1; i < r.ends.length; i++)
      expect(r.ends[i]?.difficulty).toBeLessThan(r.ends[i - 1]?.difficulty ?? 0);
    // A result like any other: the night is seen through, one star, nothing negative.
    expect(result?.stars).toBe(1);
    expect(result?.loot).toEqual({});
    expect(result?.summary).toMatchObject({ keystrokes: 0, errors: 0, accuracy: 1 });
    expect(r.events.some((e) => e.type === "wrong")).toBe(false);
  });

  it("the accuracy stars ask that most visitors went home", async () => {
    // One word typed perfectly, the rest let through.
    const r = await started(miner);
    r.until("night");
    while (!r.events.some((e) => e.type === "targetComplete")) if (!r.typeNext()) r.run(160);
    r.until("done");
    const result = r.results[0];
    expect(result?.summary.accuracy).toBe(1);
    expect(result?.stars).toBe(1);
    expect(Object.keys(result?.loot ?? {}).length).toBeGreaterThan(0);
    // Results says kindly why: perfect aim, one star, and what would earn another.
    expect(resultLines(result?.extra).map((l) => l.key)).toEqual([
      "defense.resultsPopped",
      "defense.resultsStreak",
      "defense.resultsMoreStar",
    ]);
    expect(t("defense.resultsMoreStar")).toBe("Send more friends home for another star!");
  });

  it("asks the HUD for the hint line without the drawn hands", async () => {
    const r = await started(sprout);
    expect(handsCaptionOnly(r.hud.get().custom)).toBe(true);
    // The loot and wrong-key slices are added beside it, never over it.
    r.until("night");
    while (!r.events.some((e) => e.type === "targetComplete")) if (!r.typeNext()) r.run(160);
    r.type("~");
    r.run(2000);
    expect(handsCaptionOnly(r.hud.get().custom)).toBe(true);
  });

  it("announces one visitor and many with the right verb, for every mob", () => {
    for (const mob of MOBS) {
      const one = t(`defense.onTheWay.${mob.id}`, { count: 1 });
      const many = t(`defense.onTheWay.${mob.id}`, { count: 4 });
      expect(one, mob.id).toMatch(/^1 [a-z ]+ is on the way!$/);
      expect(many, mob.id).toMatch(/^4 [a-z ]+ are on the way!$/);
    }
    expect(t("defense.onTheWay.lantern-fish", { count: 1 })).toBe("1 lantern fish is on the way!");
    expect(t("defense.onTheWayMixed", { count: 1 })).toBe("1 friend is on the way!");
  });

  it("a mob that bonks while its word is half typed lets the child go on", async () => {
    const r = await started(miner);
    r.until("night");
    while (r.hud.get().nextKey === null) r.run(160);
    r.typeNext();
    const half = r.instance.session()?.active?.id;
    expect(half).toBeDefined();
    // Wait until that mob has walked in.
    for (let i = 0; i < 4000 && r.instance.session()?.targets.some((x) => x.id === half); i++)
      r.run(160);
    expect(r.instance.session()?.active).toBeNull();
    expect(r.events.some((e) => e.type === "targetUnlocked" && e.targetId === half)).toBe(true);
    const result = r.playOut();
    expect(result?.summary.errors).toBe(0);
    expect(result?.stars).toBeGreaterThanOrEqual(1);
  });
});

describe("calm mode", () => {
  it("is on for a Sprout by default: nobody reaches the camp, however long the child waits", async () => {
    const r = await started(sprout);
    expect(sprout.settings.calmMode).toBe(true);
    r.until("night");
    r.run(180_000);
    expect(r.instance.phase()).toBe("night");
    expect(r.ends).toHaveLength(0);
    expect(r.sfx).not.toContain("shield");
    // A few friends wait at the line; no more set out until one is typed.
    const waiting = r.instance.session()?.targets.length ?? 0;
    expect(waiting).toBeGreaterThan(0);
    expect(waiting).toBeLessThanOrEqual(4);
    expect(r.hud.get().timer).toBeNull();
    const result = r.playOut();
    expect(result?.extra).toMatchObject({ reached: 0, shieldLeft: SHIELD_SEGMENTS });
    expect(sum(r.ends.map((e) => e.reachedBase))).toBe(0);
    expect(result?.stars).toBe(3);
  });

  it("can be turned on for any band", async () => {
    const r = await started(miner, { calm: true });
    r.until("night");
    r.run(120_000);
    expect(r.sfx).not.toContain("shield");
    expect(r.playOut()?.extra).toMatchObject({ reached: 0 });
  });
});

describe("pause, and leaving", () => {
  it("holds everything while paused", async () => {
    const r = await started(miner);
    r.until("night");
    while (r.hud.get().nextKey === null) r.run(160);
    r.instance.pause(r.now);
    r.instance.pause(r.now);
    const key = r.hud.get().nextKey ?? "a";
    r.instance.input({ key, t: r.now, shift: false });
    expect(r.events.some((e) => e.type === "correct")).toBe(false);
    expect(r.instance.session()?.paused).toBe(true);
    r.now += 60_000;
    r.instance.resume(r.now);
    r.instance.resume(r.now);
    const result = r.playOut();
    // The minute away is not typing time.
    expect(result?.summary.activeMs).toBeLessThan(r.now - 10_000 - 60_000);
  });

  it("can be disposed at any moment, twice, and takes no more input", async () => {
    for (const stop of ["day", "dusk", "night"]) {
      const r = await started(miner);
      r.until(stop);
      r.instance.dispose();
      r.instance.dispose();
      r.instance.input({ key: "a", t: r.now, shift: false });
      r.run(500);
      expect(r.results).toHaveLength(0);
    }
  });

  it("plays on if the camp fails to load", async () => {
    const r = rig(miner);
    const scene = fakeScene();
    scene.loadDiorama = () => Promise.reject(new Error("no world"));
    // The rig's own scene loads fine; this checks the mode's own fallback path.
    const hud = createHudStore();
    const results: ModeResult[] = [];
    let now = 0;
    const instance = create({
      lesson: NIGHT,
      params: {},
      profile: miner,
      settings: miner.settings,
      band: miner.ageBand,
      rng: createRng(3),
      clock: { now: () => now, epoch: () => 0 },
      scene,
      hud,
      audio: createSilentAudio(),
      bus: createEmitter<GameEvents>(),
      finish: (x) => results.push(x),
    });
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      instance.start();
      await flush();
    } finally {
      console.warn = warn;
    }
    expect(instance.phase()).toBe("day");
    for (let i = 0; i < 40_000 && results.length === 0; i++) {
      now += 16;
      instance.frame(16, 0);
    }
    expect(results).toHaveLength(1);
    expect(r.results).toHaveLength(0);
  });
});

describe("results", () => {
  it("carries the night's lines for the Results screen", async () => {
    const r = await started(miner);
    const result = r.playOut();
    const lines = resultLines(result?.extra);
    // A night where the visitors went home has no "more stars" line.
    expect(lines.map((l) => l.key)).toEqual(["defense.resultsPopped", "defense.resultsStreak"]);
    expect(lines[0]?.params).toEqual({ count: sum(r.waves) });
    expect(lines[1]?.params).toEqual({ count: result?.summary.longestStreak });
    // Malformed extras never reach the screen.
    expect(resultLines({ resultLines: [{ key: 3 }, "x", { key: "a.b" }] })).toEqual([]);
    expect(resultLines(undefined)).toEqual([]);
  });

  it("loot lands in the inventory and the lifetime finds through applyResult", async () => {
    const r = await started(miner);
    const result = r.playOut();
    if (result === undefined) throw new Error("no result");
    const total = sum(Object.values(result.loot));
    expect(total).toBeGreaterThanOrEqual(sum(r.waves));
    // The loot events on the bus add up to the result's loot.
    expect(sum(r.loot.map((l) => l.count))).toBe(total);
    const after = applyResult(miner, NIGHT, result, 1000);
    for (const [block, count] of Object.entries(result.loot)) {
      expect(after.inventory[block]).toBe((miner.inventory[block] ?? 0) + count);
      expect(foundBlocks(after)[block]).toBe((foundBlocks(miner)[block] ?? 0) + count);
    }
    expect(after.progress.lessons["birch-08"]).toMatchObject({ bestStars: 3, plays: 1 });
  });

  it("a second night in the same sitting starts where the first one ended", async () => {
    const me = { ...miner, id: "night-owl" };
    const first = await started(me);
    first.playOut();
    const reachedD = first.ends.at(-1)?.difficulty ?? 0;
    const second = await started(me, { seed: 8 });
    second.playOut();
    // Perfect waves from the remembered edge: one small fine-mode step up, not a fresh start.
    const next = second.ends[0]?.difficulty ?? 0;
    expect(next).toBeGreaterThan(reachedD);
    expect(next / reachedD - 1).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it("only a Builder with a speed target is asked for speed, on the words themselves", async () => {
    const fast: Lesson = { ...NIGHT, targets: { accuracy: 0.9, wpmRelative: 1000 } };
    // An impossible speed target: Builder loses only the third star, Miner none.
    const b = await started(builder, { lesson: fast });
    expect(b.playOut()?.stars).toBe(2);
    const m = await started(miner, { lesson: fast });
    expect(m.playOut()?.stars).toBe(3);
  });
});

describe("no-failure invariant (M4-10): nothing in the profile ever goes down", () => {
  const KEYS = [..."abcdefghijklmnopqrstuvwxyz;".split(""), " ", "Backspace", "~", "A"];
  const arbStream = fc.array(
    fc.record({
      // Mostly the right key, sometimes any key at all.
      right: fc.boolean(),
      key: fc.constantFrom(...KEYS),
      gap: fc.integer({ min: 20, max: 2500 }),
    }),
    { minLength: 0, maxLength: 120 },
  );

  it("for any key stream, band and calm setting", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbStream,
        fc.constantFrom(sprout, miner, builder),
        fc.boolean(),
        fc.integer({ min: 1, max: 9999 }),
        fc.constantFrom("birch-08", "shore-05", "frosty-06"),
        async (stream, profile, calm, seed, lessonId) => {
          const lesson = lessonById(lessonId);
          // A profile with something to lose: loot, a best score on this lesson, a later biome.
          const before: Profile = {
            ...profile,
            inventory: { ...profile.inventory, dirt: 12, "oak-log": 3 },
            progress: {
              ...profile.progress,
              unlockedBiomes: [...new Set([...profile.progress.unlockedBiomes, "birch" as const])],
              lessons: {
                ...profile.progress.lessons,
                [lesson.id]: {
                  bestStars: 3,
                  bestNetWpm: 31,
                  bestAccuracy: 0.99,
                  plays: 4,
                  lastPlayed: 5,
                },
              },
            },
          };
          const r = await started(before, { calm, seed, lesson });
          r.until("night");
          for (const k of stream) {
            if (r.results.length > 0) break;
            const key = k.right ? (r.hud.get().nextKey ?? k.key) : k.key;
            r.type(key, k.gap);
            // Never a game over, never a negative shield, never a clock.
            expect(r.instance.phase()).not.toBe("loading");
            expect(r.hud.get().timer).toBeNull();
          }
          // Then the night runs out: a calm night needs its words typed, the others end alone.
          const result = calm ? r.playOut() : (r.until("done"), r.results[0]);
          if (result === undefined) throw new Error("the night did not reach dawn");

          expect(result.stars).toBeGreaterThanOrEqual(1);
          for (const count of Object.values(result.loot)) {
            expect(Number.isInteger(count)).toBe(true);
            expect(count).toBeGreaterThan(0);
          }
          const extra = result.extra ?? {};
          expect(extra["shieldLeft"]).toBeGreaterThanOrEqual(0);
          expect(extra["shieldLeft"]).toBeLessThanOrEqual(SHIELD_SEGMENTS);
          expect(extra["popped"]).toBe(result.summary.targetsCompleted);

          const after = applyResult(before, lesson, result, 99);
          for (const [block, count] of Object.entries(before.inventory))
            expect(after.inventory[block]).toBeGreaterThanOrEqual(count);
          for (const [block, count] of Object.entries(foundBlocks(before)))
            expect(foundBlocks(after)[block]).toBeGreaterThanOrEqual(count);
          for (const biome of before.progress.unlockedBiomes)
            expect(after.progress.unlockedBiomes).toContain(biome);
          for (const [id, was] of Object.entries(before.progress.lessons)) {
            const now = after.progress.lessons[id];
            expect(now?.bestStars).toBeGreaterThanOrEqual(was.bestStars);
            expect(now?.bestNetWpm).toBeGreaterThanOrEqual(was.bestNetWpm);
            expect(now?.bestAccuracy).toBeGreaterThanOrEqual(was.bestAccuracy);
            expect(now?.plays).toBeGreaterThanOrEqual(was.plays);
          }
          expect(after.achievements).toEqual(before.achievements);
          expect(after.island).toEqual(before.island);
          expect(after.cosmetics).toEqual(before.cosmetics);
          expect(after.history).toHaveLength(before.history.length + 1);
          expect(after.sessionCounter).toBe(before.sessionCounter + 1);
        },
      ),
      { seed: 4410, numRuns: 40 },
    );
  }, 120_000);
});
