/**
 * Night Defense (task M4-04, PLAN.md §3.2.2, §3.4): the speed and target-switching mode. Friendly
 * blocky visitors walk down lanes toward the child's lantern-lit camp, each carrying a word.
 * Typing a word's first letter locks onto that visitor; finishing the word sends it home in a puff
 * of sparkles, and a block flies to the hotbar.
 *
 * **Nothing is ever lost.** A visitor that reaches the camp bonks the shield and poofs. The shield
 * bar drops a segment; at zero the visitors simply bounce off until dawn, under a kind banner.
 * There is no game over, no path that takes loot or progress away, and the shield is whole again
 * at dawn. Every night ends at dawn with at least one star.
 *
 * The night: a short **day** (the camp, "Night is coming!"), **dusk** (the first wave is
 * announced), **night** (the waves, from the pure wave director), **dawn** (the sun rises, the
 * shield grows back), then Results.
 *
 * This file is the wiring. The rules are in `logic.ts` (pure), the waves in `director.ts` (pure),
 * the 3D stage in `view.ts` and the word plates in `plates.ts`. Mine's loot flight and wrong-key
 * gate are reused as they are.
 *
 * Time: everything animated runs on `frame(dt)`, which the render loop holds still during a
 * hit-stop and stops while paused. Input times and `ctx.clock` are the real clock and are only
 * ever given to the typing session and the wrong-key gate. No clock or countdown is ever shown.
 */
import { reducedMotion } from "@/a11y/motion";
import { blocks } from "@/content/blocks";
import type { BlockDef } from "@/content/blocks/types";
import { lessons } from "@/content/lessons";
import { meadowLoot } from "@/content/loot/meadow";
import type { LootTable } from "@/content/loot/types";
import { rosterFor } from "@/content/mobs";
import type { MobId } from "@/content/mobs";
import { wordPools } from "@/content/wordlists/pools";
import { arenaLayout, generateArena } from "@/content/worldgen/defense-arena";
import { keyWeights } from "@/engine/adaptive";
import { rollLoot } from "@/engine/loot";
import { hashString } from "@/engine/rng";
import { createSession } from "@/engine/session";
import { baselineNetWpm, computeStars } from "@/engine/stars";
import type { SessionSummary } from "@/engine/stats";
import type { EngineEvent, KeyInput, SessionView } from "@/engine/types";
import { t } from "@/i18n";
import type { MessageKey } from "@/i18n";
import type { Atlas } from "@/render/atlas/build";
import type { CameraPose } from "@/render/camera";
import { breakShake } from "@/render/fx/tuning";
import type { CameraRig, SceneHandle, Vec3 } from "@/render/types";
import type { BiomeId, BlockId, Ms } from "@/types/core";
import { HANDS_SLICE, HOTBAR_SLICE, reportWrongKey } from "@/ui/hud/bridge";
import type { HotbarItem, HotbarSlice } from "@/ui/hud/bridge";
import {
  BANNER_SHOW_MS,
  NO_SLOT,
  TARGET_LATENCY,
  allowedKeys,
  biomeOf,
  caseSensitiveFor,
  comboOf,
  emptyFlyQueue,
  emptyWrongGate,
  enqueueDrops,
  feedWrong,
  flushFlights,
  isStraySpace,
  poolsFor,
  stepFlights,
} from "../mine/logic";
import type { Flight } from "../mine/logic";
import { createLootFly } from "../mine/loot-fly";
import type { LootFly } from "../mine/loot-fly";
import type { ModeContext, ModeInstance } from "../types";
import { breakMs, createDirector, idlePullMs } from "./director";
import type { WaveSpec } from "./director";
import {
  BAND_LANES,
  DAWN_MS,
  DAWN_REDUCED_MS,
  DAY_HOLD_MS,
  DAY_MS,
  DAY_SKIP_MS,
  DUSK_MS,
  INTERMISSION_MS,
  SHIELD_SEGMENTS,
  baselineAccuracy,
  bonkShield,
  clearOfBanner,
  emptyTally,
  fieldEmpty,
  fitLaneView,
  laneSlot,
  lockedWpm,
  nextKeyFor,
  nightProgress,
  nightStars,
  nightWaves,
  stepMobs,
  waveAnnouncement,
  waveFeedback,
} from "./logic";
import type { Box, FieldMob, Phase, WaveTally } from "./logic";
import { createPlateLayer } from "./plates";
import type { PlateItem, PlateLayer } from "./plates";
import { createDefenseView } from "./view";
import type { DefenseView } from "./view";

/** The bus event the app sends when the child asks to hear the word again (M2-10). */
const HEAR_AGAIN_EVENT = "app:hearAgain";
/** The namespaced bus events of a night (contracts §7.2): a wave began, and how one ended. */
export const WAVE_EVENT = "defense:wave";
export const WAVE_END_EVENT = "defense:waveEnd";
/** A small hit-stop on a pop (PLAN §3.4 gives a block break 40 ms; a pop is lighter). */
const HIT_STOP_MS: Ms = 30;
/** The start hint goes away by itself after this long, or at the first right key. */
const START_HINT_MS: Ms = 7000;
/** How strongly the camp's glow lights the field at each time of day. */
const GLOW = { day: 0, dusk: 0.5, night: 1, dawn: 0.3 } as const;
/** Calm mode: no new mob sets out while this many are already on the field. */
const CALM_MAX_LIVE = 4;
/** Room kept at the top of the stage for the banner, in CSS pixels (times the text scale). */
const BANNER_ROOM = 46;
/** Room kept above the far end of the field for a locked word plate, in CSS pixels (× scale). */
const PLATE_ROOM = 56;
/** Keys a free-play night uses when there is no lesson. */
const FREE_PLAY_KEYS = ["f", "j", "d", "k", "s", "l", "a", ";"];

/**
 * The announcement line of each mob. A new mob must get a line here (the `MobId` type says so);
 * until it has one in a wave of several kinds, the wave says "friends".
 */
const ON_THE_WAY: Readonly<Record<string, MessageKey>> = {
  slimeling: "defense.onTheWay.slimeling",
  "moss-golem": "defense.onTheWay.moss-golem",
  "cave-bat": "defense.onTheWay.cave-bat",
  "frost-pup": "defense.onTheWay.frost-pup",
  "cactus-cat": "defense.onTheWay.cactus-cat",
  "lantern-fish": "defense.onTheWay.lantern-fish",
  "crystal-crab": "defense.onTheWay.crystal-crab",
  "sandstorm-imp": "defense.onTheWay.sandstorm-imp",
} satisfies Record<MobId, MessageKey>;

/** Loot tables by biome. Biomes without one yet use the Meadow's. */
const LOOT_TABLES: Partial<Record<BiomeId, LootTable>> = { meadow: meadowLoot };

/**
 * Where each player's last night ended, so a second night in the same sitting starts near their
 * edge and not at the default. In memory only: there is no save field for it, and none is needed.
 */
const lastDifficulty = new Map<string, number>();

/** Forgets every remembered night (tests; a fresh page starts with none anyway). */
export function forgetNights(): void {
  lastDifficulty.clear();
}

/** What a night adds to `ModeResult.extra`. Results shows the first two (see `resultLines`). */
export interface DefenseExtra {
  /** Visitors sent home. */
  popped: number;
  /** Visitors that reached the camp. */
  reached: number;
  waves: number;
  /** Shield segments left when dawn came (before it grew back). */
  shieldLeft: number;
  /** Lines for the Results screen: i18n keys with their params. */
  resultLines: { key: MessageKey; params: Record<string, number> }[];
}

/** Defense also hands out its session's read model, for `__vt.session()`. */
export interface DefenseInstance extends ModeInstance {
  session(): SessionView | null;
  /** For tests: where the night is. */
  phase(): Phase;
}

type AtlasScene = SceneHandle & { atlas(): Atlas | null };
const hasAtlas = (s: SceneHandle): s is AtlasScene => "atlas" in s && typeof s.atlas === "function";

type TargetCamera = CameraRig & { setTarget(at: Vec3): void };
const canTarget = (c: CameraRig): c is TargetCamera =>
  "setTarget" in c && typeof c.setTarget === "function";

type FreeCamera = CameraRig & { moveTo(to: CameraPose, opts?: { durationMs?: Ms }): void };
const canMoveTo = (c: CameraRig): c is FreeCamera =>
  "moveTo" in c && typeof c.moveTo === "function";

export function create(ctx: ModeContext): DefenseInstance {
  const { band, settings, scene, hud, audio, bus, lesson, profile } = ctx;
  const biome = biomeOf(lesson);
  const table = LOOT_TABLES[biome] ?? meadowLoot;
  const blockById = new Map<BlockId, BlockDef>(blocks.map((b) => [b.id, b]));
  const calm = settings.calmMode;
  const reduced = (): boolean => reducedMotion(settings.reducedMotion);
  const roster = rosterFor(biome);
  const builtLanes = BAND_LANES[band];
  const layout = arenaLayout(builtLanes);
  const waveCount = nightWaves(lesson, band);
  const waitP = (layout.waitZ - layout.farZ) / (layout.baseZ - layout.farZ);

  const allowed = lesson ? allowedKeys(lessons, lesson) : FREE_PLAY_KEYS;
  const baseline = baselineNetWpm(profile.history);
  const remembered = lastDifficulty.get(profile.id);
  const director = createDirector({
    band,
    baselineNetWpm: baseline,
    baselineAccuracy: baselineAccuracy(profile.history),
    calm,
    rng: ctx.rng.fork("director"),
    mobs: roster,
    pools: wordPools.filter((p) => p.band === band || p.band === "all"),
    lessonPools: lesson ? poolsFor(lesson, band, wordPools) : [],
    allowed,
    weights: keyWeights({
      allowed,
      focus: lesson?.newKeys ?? [],
      stats: profile.keyStats,
      sessionIndex: profile.sessionCounter,
      targetLatencyMs: TARGET_LATENCY[band],
    }),
    ...(remembered !== undefined && { startDifficulty: remembered }),
  });

  // One engine session for the whole night. `stay` for every band: a slip never moves the cursor,
  // and Backspace lets go of a word (contracts §3.2).
  const session = createSession(
    {
      policy: "stay",
      targeting: "lockOn",
      caseSensitive: lesson ? caseSensitiveFor(lesson, band) : false,
      end: { kind: "manual" },
      mode: "defense",
      seed: ctx.rng.seed,
      ...(lesson && { lessonId: lesson.id }),
    },
    [],
  );
  const lootRng = ctx.rng.fork("loot");

  let phase: Phase = "loading";
  let phaseLeft: Ms = 0;
  let dayRan: Ms = 0;
  let disposed = false;
  let paused = false;
  let view: DefenseView | null = null;
  let plates: PlateLayer | null = null;
  let fly: LootFly | null = null;

  /** The wave being played, the next mob to spawn, and the wave's own clocks. */
  let wave: WaveSpec | null = null;
  let nextWave: WaveSpec | null = null;
  let nextSpawn = 0;
  let spawnClock: Ms = 0;
  let intermissionLeft: Ms = 0;
  /**
   * How long the field has had no mob left to type, in night time (waves and the pauses between
   * them). The next mob never waits for more than `maxIdleMs` of it (M4-FIX-2).
   */
  let emptyMs: Ms = 0;
  let wavesDone = 0;
  let tally: WaveTally = emptyTally();
  /** Mobs of the current wave that are gone (typed or bonked, their anim over). */
  let waveGone = 0;
  const field: FieldMob[] = [];
  /** Spawn order: the `lockOn` tie-break. Mobs reach the base in this order (the director). */
  let spawnSeq = 0;
  const seqOf = new Map<string, number>();

  let shield = SHIELD_SEGMENTS;
  let streak = 0;
  let popped = 0;
  let reached = 0;
  let lockedId: string | null = null;
  const typedWords: { chars: number; durationMs: Ms }[] = [];
  let wrongGate = emptyWrongGate();
  let flights = emptyFlyQueue();
  /** The fly queue's clock: frame time added up, so it stops with the game. */
  let flyNow: Ms = 0;
  const loot: Record<BlockId, number> = {};
  const found: { block: BlockId; count: number }[] = [];
  const slots: (HotbarItem | null)[] = [];
  let summary: SessionSummary | null = null;
  let bannerLeft: Ms = 0;
  let hintUp = false;
  let typedOnce = false;
  /** The latest input time seen: session calls made from a frame never go back before it. */
  let lastT: Ms = 0;
  const nowT = (): Ms => {
    lastT = Math.max(lastT, ctx.clock.now());
    return lastT;
  };
  const from = { x: 0, y: 0 };
  const at: Vec3 = { x: 0, y: 0, z: 0 };

  // --- HUD ---

  const setBanner = (
    key: MessageKey | null,
    tone: "info" | "cheer" = "info",
    params?: Record<string, string | number>,
    ms: Ms = BANNER_SHOW_MS,
  ): void => {
    bannerLeft = key === null ? 0 : ms;
    hintUp = false;
    hud.set({ banner: key === null ? null : { key, tone, ...(params && { params }) } });
  };

  const publishHotbar = (): void => {
    const hotbar: HotbarSlice = { slots: [...slots] };
    hud.set({ custom: { ...hud.get().custom, [HOTBAR_SLICE]: hotbar } });
  };

  const syncHud = (): void => {
    const v = session.view();
    hud.set({
      // The words are on the plates over the mobs, so the big word display stays empty.
      word: null,
      combo: comboOf(v.streak),
      progress01: summary
        ? 1
        : nightProgress(wavesDone, waveCount, waveGone, wave?.mobs.length ?? 0),
      nextKey: phase === "night" || phase === "dusk" ? nextKeyFor(v.active, field) : null,
    });
  };

  const announce = (w: WaveSpec, ms: Ms): void => {
    const { mobId, count } = waveAnnouncement(w);
    const key = mobId === null ? undefined : ON_THE_WAY[mobId];
    setBanner(key ?? "defense.onTheWayMixed", "info", { count }, ms);
  };

  /**
   * The shield bar. Not in calm mode: nothing ever reaches the camp there, so the bar would only
   * hint at a threat that can't happen.
   */
  const showShield = (level: number): void => {
    if (!calm) plates?.setShield(level, SHIELD_SEGMENTS, shieldAt);
  };

  // --- loot ---

  const land = (f: Flight): void => {
    fly?.land(f.id);
    const row = found.find((x) => x.block === f.block);
    if (row) row.count += f.count;
    else found.push({ block: f.block, count: f.count });
    const count = row?.count ?? f.count;
    const def = blockById.get(f.block);
    audio.sfx("chime", { gain: 0.3, pitchStep: 4 });
    // A tenth kind or later: counted in the loot (Results lists it), but no slot is taken over.
    if (f.slot === NO_SLOT) return;
    while (slots.length <= f.slot) slots.push(null);
    slots[f.slot] = {
      label: t("defense.slot", { name: def ? t(def.nameKey) : f.block, count }),
      count,
      icon: fly?.icon(f.block) ?? "",
    };
    publishHotbar();
  };

  // --- mobs ---

  /** A mob's anim is over: it leaves the field, and the wave may be done. */
  const gone = (mob: FieldMob): void => {
    const i = field.indexOf(mob);
    if (i !== -1) field.splice(i, 1);
    seqOf.delete(mob.id);
    waveGone++;
  };

  const spawn = (m: WaveSpec["mobs"][number], w: WaveSpec): void => {
    const mob: FieldMob = {
      id: m.id,
      mobId: m.mobId,
      slot: laneSlot(m.lane, w.lanes, builtLanes),
      word: m.word,
      speed: m.speed,
      p: 0,
      state: "walking",
    };
    field.push(mob);
    emptyMs = 0;
    seqOf.set(mob.id, spawnSeq);
    // Each mob is a lockOn target, added on spawn. No trailing space: its last char sends it home.
    session.addTargets([{ id: mob.id, text: mob.word, trailingSpace: false, priority: spawnSeq }]);
    spawnSeq++;
    view?.spawn(mob);
    if (!typedOnce && !hintUp && bannerLeft <= 0) {
      setBanner("defense.start", "info", undefined, START_HINT_MS);
      hintUp = true;
    }
  };

  const pop = (e: Extract<EngineEvent, { type: "targetComplete" }>): void => {
    const mob = field.find((m) => m.id === e.targetId);
    if (mob === undefined || mob.state === "popping" || mob.state === "bonking") return;
    mob.state = "popping";
    popped++;
    tally.wordsDone++;
    const chars = Array.from(mob.word).length;
    typedWords.push({ chars, durationMs: e.durationMs });
    if (lockedId === mob.id) lockedId = null;

    const where = view ? view.worldOf(mob, at) : at;
    scene.fx.hitStop(HIT_STOP_MS);
    audio.sfx("pop", { pitchStep: Math.min(9, comboOf(streak)) });
    const shake = breakShake(streak);
    scene.camera.shake(shake.intensity01 * 0.6, shake.durationMs);

    // Loot: rarity by streak and accuracy, never by speed (PLAN §3.3).
    const drops = rollLoot(
      {
        biome: table.biome,
        wordLen: chars,
        streak,
        targetAccuracy: e.accuracy,
        band,
        oreVein: false,
      },
      table,
      lootRng,
    );
    // Sparkles: a puff of lantern light, and chips of the block it leaves behind.
    if (view) {
      scene.fx.burst(where, { blockId: "lantern", count: 8, speed: 0.9 });
      const first = drops[0];
      if (first) scene.fx.burst(where, { blockId: first.block, count: 6, speed: 0.6 });
    }
    drops.forEach((d, i) => {
      loot[d.block] = (loot[d.block] ?? 0) + d.count;
      bus.emit("loot", d);
      if (view && i < 2)
        scene.fx.floatText(
          { x: where.x, y: where.y + 0.9 + i * 0.5, z: where.z },
          t("defense.got", { count: d.count }),
        );
    });
    const hasOrigin = view?.headOf(mob, from) ?? false;
    const queued = enqueueDrops(flights, drops, flyNow, reduced() || !hasOrigin || fly === null);
    for (const f of queued.queue.flights) {
      if (!flights.flights.includes(f)) fly?.launch(f, from);
    }
    flights = queued.queue;
    for (const f of queued.landed) land(f);

    // The session is done with this target. Game logic waits on `defeat`'s end (M4-03).
    handle(session.removeTarget(mob.id, nowT()));
    if (view) view.defeat(mob, () => gone(mob));
    else gone(mob);
  };

  /** A mob at the base: it bonks the shield and poofs. Nothing is taken from the child. */
  const bonk = (mob: FieldMob): void => {
    if (mob.state !== "walking") return;
    mob.state = "bonking";
    reached++;
    // Counted while the shield is at zero too: the mob still got through (M4-05 review).
    tally.reachedBase++;
    if (lockedId === mob.id) lockedId = null;
    const hit = bonkShield(shield);
    shield = hit.shield;
    audio.sfx("shield", { gain: shield > 0 ? 0.6 : 0.35 });
    view?.setShield(shield / SHIELD_SEGMENTS, true);
    showShield(shield);
    if (hit.emptied) setBanner("defense.shieldRest", "info", undefined, 5000);
    // Removed on the bonk: unlocks it if it was locked, and no error is counted.
    handle(session.removeTarget(mob.id, nowT()));
    if (view) view.bonk(mob, () => gone(mob));
    else gone(mob);
  };

  // --- waves ---

  const startWave = (): void => {
    const w = nextWave ?? director.nextWave();
    nextWave = null;
    wave = w;
    nextSpawn = 0;
    spawnClock = 0;
    waveGone = 0;
    tally = emptyTally();
    bus.emit(WAVE_EVENT, { index: w.index, mobs: w.mobs.length, lanes: w.lanes, calm: w.calm });
  };

  const endWave = (): void => {
    if (wave === null) return;
    const feedback = waveFeedback(tally);
    // Once per wave, with the wave's own keys and mobs.
    director.observe(feedback);
    // Remembered only from a wave the child typed in: a night they walked away from says nothing
    // about where the next one should start.
    if (feedback.wordsDone > 0) lastDifficulty.set(profile.id, director.difficulty);
    bus.emit(WAVE_END_EVENT, { index: wave.index, ...feedback, difficulty: director.difficulty });
    wave = null;
    wavesDone++;
    if (wavesDone >= waveCount) {
      toDawn();
      return;
    }
    nextWave = director.nextWave();
    // The pause ends so that the next wave's first mob comes `maxIdleMs` after the field emptied.
    intermissionLeft = Math.min(
      INTERMISSION_MS,
      breakMs(emptyMs, nextWave.mobs[0]?.spawnAtMs ?? 0),
    );
    announce(nextWave, INTERMISSION_MS);
  };

  const runWave = (dtMs: Ms): void => {
    const w = wave;
    if (w === null) return;
    tally.activeMs += dtMs;
    // Calm mode: nobody new sets out while a few friends are already waiting.
    if (!w.calm || field.length < CALM_MAX_LIVE) spawnClock += dtMs;
    // An empty field brings the next mob forward, and the rest of the wave with it.
    const upcoming = w.mobs[nextSpawn];
    if (upcoming !== undefined)
      spawnClock += idlePullMs(upcoming.spawnAtMs - spawnClock, fieldEmpty(field) ? emptyMs : null);
    while (nextSpawn < w.mobs.length) {
      const m = w.mobs[nextSpawn];
      if (m === undefined || m.spawnAtMs > spawnClock) break;
      if (w.calm && field.length >= CALM_MAX_LIVE) break;
      nextSpawn++;
      spawn(m, w);
    }
    for (const mob of stepMobs(field, dtMs, { calm: w.calm, waitP })) bonk(mob);
    if (nextSpawn >= w.mobs.length && field.length === 0) endWave();
  };

  // --- phases ---

  const setTime = (timeOfDay: "day" | "dusk" | "night" | "dawn"): void => {
    scene.setEnvironment({ biome, timeOfDay });
    view?.setGlow(GLOW[timeOfDay]);
  };

  /**
   * Dusk starts the night: the first wave starts with it, so its first mob sets out while the
   * announcement is still up and the field is never empty for long (M4-FIX-2). The sky turns to
   * night once the announcement has had its time.
   */
  const toDusk = (): void => {
    phase = "dusk";
    phaseLeft = DUSK_MS;
    setTime("dusk");
    nextWave = director.nextWave();
    announce(nextWave, DUSK_MS);
    audio.sfx("whoosh", { gain: 0.4 });
    emptyMs = 0;
    startWave();
  };

  const toNight = (): void => {
    phase = "night";
    setTime("night");
    // The start hint waits for the dusk announcement to go.
    if (!typedOnce && !hintUp && field.length > 0) {
      setBanner("defense.start", "info", undefined, START_HINT_MS);
      hintUp = true;
    }
  };

  /** One frame of the waves and the pauses between them (dusk and night). */
  const stepNight = (dtMs: Ms): void => {
    emptyMs = fieldEmpty(field) ? emptyMs + dtMs : 0;
    if (wave === null) {
      intermissionLeft -= dtMs;
      if (intermissionLeft <= 0) startWave();
    } else {
      runWave(dtMs);
    }
  };

  function toDawn(): void {
    phase = "dawn";
    phaseLeft = reduced() ? DAWN_REDUCED_MS : DAWN_MS;
    setTime("dawn");
    setBanner("defense.dawn", "cheer", undefined, phaseLeft);
    audio.sfx("levelUp", { gain: 0.5 });
    // The shield grows back at dawn (card). The result remembers how much was left.
    view?.setShield(1, true);
    showShield(SHIELD_SEGMENTS);
    // The night's typing is over: the summary is taken now, so dawn's wait isn't typing time.
    handle(session.end(nowT()));
  }

  const finishNow = (): void => {
    if (phase === "done" || summary === null) return;
    phase = "done";
    const flushed = flushFlights(flights);
    flights = flushed.queue;
    for (const f of flushed.landed) land(f);
    // Stars by accuracy. Only Builder has a speed target, measured on the words themselves: a
    // night's own WPM also counts the time spent waiting for visitors.
    const speed = band === "builder" && lesson?.targets.wpmRelative !== undefined;
    const byAccuracy = computeStars({
      completed: true,
      accuracy: summary.accuracy,
      netWpm: speed ? lockedWpm(typedWords) : summary.netWpm,
      targets: {
        accuracy: lesson?.targets.accuracy ?? 0.85,
        ...(speed && lesson?.targets.wpmRelative !== undefined
          ? { wpmRelative: lesson.targets.wpmRelative }
          : {}),
      },
      baseline,
      band,
    });
    const stars = nightStars(byAccuracy, popped, reached);
    const extra: DefenseExtra = {
      popped,
      reached,
      waves: wavesDone,
      shieldLeft: shield,
      resultLines: [
        { key: "defense.resultsPopped", params: { count: popped } },
        { key: "defense.resultsStreak", params: { count: summary.longestStreak } },
        // The accuracy earned more stars than the night gives: say kindly what would earn them.
        ...(stars < byAccuracy ? [{ key: "defense.resultsMoreStar" as const, params: {} }] : []),
      ],
    };
    ctx.finish({ summary, loot: { ...loot }, stars, extra: { ...extra } });
  };

  // --- engine events ---

  function handle(events: readonly EngineEvent[]): void {
    for (const e of events) {
      // Everyone else (achievements, the break reminder) hears the engine through the bus.
      bus.emit("engine", e);
      switch (e.type) {
        case "streak":
          streak = e.length;
          break;
        case "streakBroken":
          streak = 0;
          break;
        case "targetLocked":
          lockedId = e.targetId;
          if (band === "sprout" && settings.tts) {
            const word = field.find((m) => m.id === e.targetId)?.word;
            if (word !== undefined) audio.speak(word);
          }
          break;
        case "targetUnlocked":
          if (lockedId === e.targetId) lockedId = null;
          break;
        case "correct": {
          tally.keystrokes++;
          tally.correct++;
          if (!typedOnce) {
            typedOnce = true;
            if (hintUp) setBanner(null);
          }
          const mob = field.find((m) => m.id === e.targetId);
          // The chime climbs with the letters of the word.
          audio.sfx("chime", { pitchStep: Math.min(9, e.index), gain: 0.5 });
          if (mob) view?.hit(mob);
          break;
        }
        case "wrong": {
          tally.keystrokes++;
          // Never any effect for a slip: no burst, no shake, no hit-stop (M2-05).
          const fed = feedWrong(wrongGate, e.got, e.t);
          wrongGate = fed.gate;
          if (fed.cue) {
            audio.sfx("thud");
            if (e.targetId !== null) plates?.wobble(e.targetId);
          }
          if (fed.banner) setBanner("defense.almost");
          // Every press, repeats included: the on-screen keyboard gates them itself (M2-09).
          reportWrongKey(hud, e.got);
          break;
        }
        case "targetComplete":
          pop(e);
          break;
        case "sessionEnd":
          summary = e.summary;
          break;
        default:
          break;
      }
    }
    view?.setLocked(lockedId);
  }

  // --- screen layout ---

  let stageCanvas: HTMLCanvasElement | null = null;
  let layoutKey = "";
  let layoutW = 0;
  let layoutH = 0;
  let frames = 0;
  /** Where plates may go, and where the shield bar sits: the open stage, on the page. */
  let bounds = { left: 0, top: 0, right: 0, bottom: 0 };
  let shieldAt = { left: 0, top: 0 };

  /**
   * Frames the field in the space the HUD leaves (`fitLaneView`). It measures the page, so it runs
   * only when something may have moved: at the start, on a few early frames (the HUD mounts and
   * fonts load a moment after the lesson starts) and when the canvas changes size.
   */
  const relayout = (): void => {
    const canvas = stageCanvas;
    if (view === null || canvas === null) return;
    const origin = canvas.getBoundingClientRect();
    const boxOf = (el: Element | null | undefined): Box | null => {
      const r = el?.getBoundingClientRect();
      if (!r || !(r.width > 0) || !(r.height > 0)) return null;
      return {
        left: r.left - origin.left,
        top: r.top - origin.top,
        width: r.width,
        height: r.height,
      };
    };
    const doc = canvas.ownerDocument;
    const stage = boxOf(doc.querySelector('[data-hud="stage"]'));
    const scale =
      Number(getComputedStyle(doc.documentElement).getPropertyValue("--text-scale")) || 1;
    const room = Math.min(BANNER_ROOM * scale, (stage?.height ?? origin.height) * 0.25);
    const free: Box = stage
      ? { left: stage.left, top: stage.top + room, width: stage.width, height: stage.height - room }
      : { left: 0, top: room, width: origin.width, height: origin.height - room };
    layoutW = canvas.clientWidth;
    layoutH = canvas.clientHeight;
    const key = [free.left, free.top, free.width, free.height, layoutW, layoutH]
      .map(Math.round)
      .join(",");
    if (key === layoutKey) return;
    layoutKey = key;
    const fit = fitLaneView(
      layout,
      { width: origin.width, height: origin.height },
      free,
      PLATE_ROOM * scale,
    );
    if (canMoveTo(scene.camera))
      scene.camera.moveTo({
        target: fit.target,
        yaw: 0,
        pitch: fit.pitch,
        distance: fit.distance,
        fov: fit.fov,
      });
    view.applyShift(fit);
    bounds = {
      left: origin.left + free.left + 4,
      top: origin.top + free.top,
      right: origin.left + free.left + free.width - 4,
      bottom: origin.top + free.top + free.height,
    };
    shieldAt = { left: bounds.left + 8, top: bounds.bottom - 34 * scale };
    showShield(shield);
  };

  const head = { x: 0, y: 0 };
  const syncPlates = (): void => {
    if (plates === null || view === null) return;
    const active = session.view().active;
    const items: PlateItem[] = [];
    for (const mob of field) {
      // A mob on its way out has no word to type any more.
      if (mob.state === "popping" || mob.state === "bonking") continue;
      if (!view.headOf(mob, head)) continue;
      const locked = active?.id === mob.id;
      items.push({
        id: mob.id,
        word: mob.word,
        typed: locked ? (active?.typed ?? 0) : 0,
        locked,
        x: head.x,
        y: head.y,
        // The locked word moves least, then the mobs nearest the base.
        order: locked ? -1 : (seqOf.get(mob.id) ?? 0),
      });
    }
    // The HUD's message (the dusk announcement, a banner, the Caps Lock hint) sits over the top
    // of the stage: plates stay below it.
    const message = stageCanvas?.ownerDocument.querySelector('[data-hud="stage"] output');
    const box = message?.getBoundingClientRect();
    plates.sync(items, clearOfBanner(bounds, box && box.height > 0 ? box : null));
  };

  const ready = (): void => {
    if (disposed || phase !== "loading") return;
    const three = scene.three;
    if (canTarget(scene.camera)) scene.camera.setTarget(layout.center);
    scene.camera.preset("lane", { durationMs: 0 });
    if (three && hasAtlas(scene)) {
      const canvas = three.renderer.domElement;
      stageCanvas = canvas;
      view = createDefenseView({
        scene: three.scene,
        camera: three.camera,
        canvas,
        atlas: () => scene.atlas(),
        layout,
        roster,
        reducedMotion: reduced,
        requestRender: () => scene.requestRender(),
      });
      plates = createPlateLayer({ canvas, reducedMotion: reduced });
      fly = createLootFly({ canvas, atlas: () => scene.atlas() });
      view.setShield(1, false);
      relayout();
    }
    // The lanes need the stage's height: keep the keys and the hint line, drop the drawn hands.
    hud.set({ custom: { ...hud.get().custom, [HANDS_SLICE]: "caption" } });
    phase = "day";
    phaseLeft = DAY_MS;
    dayRan = 0;
    setBanner("defense.nightComing", "info", undefined, DAY_MS);
    syncHud();
    scene.requestRender();
  };

  const offHear = bus.on(HEAR_AGAIN_EVENT, () => {
    if (phase !== "night" && phase !== "dusk") return;
    // The locked word, or else the word of the visitor nearest the camp.
    const active = session.view().active;
    const near = field
      .filter((m) => m.state === "walking" || m.state === "waiting")
      .toSorted((a, b) => b.p - a.p)[0];
    const word = active?.text ?? near?.word;
    // The shell applies the TTS setting; `speak` is silent without an on-device voice.
    if (word !== undefined) audio.speak(word);
  });

  return {
    start() {
      setTime("day");
      // Aim the camera before the world loads: the scene lights the lanterns nearest its target.
      if (canTarget(scene.camera)) scene.camera.setTarget(layout.center);
      scene.camera.preset("lane", { durationMs: 0 });
      // The same camp every night for one player: it is their place.
      const seed = hashString(`${profile.id}:${biome}:camp`);
      scene
        .loadDiorama(`defense-${biome}`, generateArena(biome, seed, builtLanes))
        .then(ready, (err: unknown) => {
          console.warn("[defense] the camp did not load; playing without it", err);
          ready();
        });
    },

    input(k: KeyInput) {
      if (paused || disposed) return;
      lastT = Math.max(lastT, k.t);
      if (phase === "day") {
        // Nothing to type yet. A key press after a moment moves the day along; it is never fed
        // to the engine, so it can't count as a slip.
        if (dayRan >= DAY_HOLD_MS) phaseLeft = Math.min(phaseLeft, DAY_SKIP_MS);
        return;
      }
      // Dusk is part of the night: its first mob sets out while the announcement is up.
      if (phase !== "night" && phase !== "dusk") return;
      const v = session.view();
      // With no visitor on the field there is nothing to type: the key is dropped, not a slip.
      if (!field.some((m) => m.state === "walking" || m.state === "waiting")) return;
      // A habit space with nothing locked (or before a word's first char) is dropped too, the way
      // Mine does it (decision 90). Under lockOn it would be a wrong key and break the streak.
      if (isStraySpace(k.key, v.active)) return;
      handle(session.feed(k));
      syncHud();
    },

    frame(dtMs: Ms) {
      if (disposed) return;
      if (stageCanvas !== null) {
        frames++;
        const resized = stageCanvas.clientWidth !== layoutW || stageCanvas.clientHeight !== layoutH;
        if (resized || frames === 2 || frames === 10 || frames === 30 || frames === 90) relayout();
      }
      flyNow += dtMs;
      if (flights.flights.length > 0) {
        fly?.frame(flyNow);
        const stepped = stepFlights(flights, flyNow);
        flights = stepped.queue;
        for (const f of stepped.landed) land(f);
      }
      if (bannerLeft > 0) {
        bannerLeft -= dtMs;
        if (bannerLeft <= 0) setBanner(null);
      }
      if (phase === "day") {
        dayRan += dtMs;
        phaseLeft -= dtMs;
        if (phaseLeft <= 0) toDusk();
      } else if (phase === "dusk") {
        stepNight(dtMs);
        phaseLeft -= dtMs;
        if (phase === "dusk" && phaseLeft <= 0) toNight();
      } else if (phase === "night") {
        stepNight(dtMs);
      } else if (phase === "dawn") {
        phaseLeft -= dtMs;
        if (phaseLeft <= 0) finishNow();
      }
      if (view !== null) {
        for (const mob of field) view.place(mob);
        view.frame(dtMs);
        syncPlates();
      }
      if (phase !== "done") syncHud();
    },

    pause(now: Ms) {
      if (paused) return;
      paused = true;
      lastT = Math.max(lastT, now);
      // The break reminder can pause at dawn, after the session has ended.
      if (summary === null) handle(session.pause(now));
    },

    resume(now: Ms) {
      if (!paused) return;
      paused = false;
      lastT = Math.max(lastT, now);
      if (summary === null) handle(session.resume(now));
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      offHear();
      view?.dispose();
      view = null;
      plates?.dispose();
      plates = null;
      fly?.dispose();
      fly = null;
    },

    // A night's session is live from the first frame of the day; tests wait for `night` to type.
    session: () => (phase === "loading" ? null : session.view()),
    phase: () => phase,
  };
}
