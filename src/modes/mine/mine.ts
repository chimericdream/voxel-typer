/**
 * Mine mode (task M2-13, PLAN.md §3.2.1, §3.4, §4.1): the primary loop. A block floats on the
 * stage with a letter or word; each correct key chips it, the last one breaks it, and what was
 * inside flies to the hotbar. A wrong key costs nothing: the block shakes its head, a soft thud
 * plays, and now and then a banner says "Almost! Try that key again".
 *
 * This file is the wiring. The rules live in `logic.ts` (pure), the 3D stage in `view.ts` and the
 * flying loot in `loot-fly.ts`. The mode reaches the outside only through its {@link ModeContext}.
 *
 * Time: everything animated runs on `frame(dt)`, which the render loop holds still during a
 * hit-stop and stops while paused. Input times (`KeyInput.t`, `pause(t)`) are the real clock and
 * are only ever given to the typing session and the wrong-key gate.
 */
import { blocks } from "@/content/blocks";
import type { BlockDef } from "@/content/blocks/types";
import { lessons } from "@/content/lessons";
import type { Lesson } from "@/content/lessons/types";
import { meadowLoot } from "@/content/loot/meadow";
import type { LootTable } from "@/content/loot/types";
import { wordPools } from "@/content/wordlists/pools";
import { dioramaStage, generateDiorama } from "@/content/worldgen/diorama";
import { keyWeights } from "@/engine/adaptive";
import { generateTargets } from "@/engine/generator";
import { rollLoot } from "@/engine/loot";
import { hashString } from "@/engine/rng";
import { createSession } from "@/engine/session";
import { baselineNetWpm, computeStars } from "@/engine/stars";
import type { SessionSummary } from "@/engine/stats";
import type {
  EngineEvent,
  KeyInput,
  SessionConfig,
  SessionView,
  Target,
  TargetView,
} from "@/engine/types";
import { t } from "@/i18n";
import type { MessageKey } from "@/i18n";
import type { Atlas } from "@/render/atlas/build";
import { breakShake } from "@/render/fx/tuning";
import type { CameraRig, SceneHandle, Vec3 } from "@/render/types";
import type { BiomeId, BlockId, GameModeId, Material, Ms } from "@/types/core";
import { HOTBAR_SLICE, reportWrongKey } from "@/ui/hud/bridge";
import type { HotbarItem, HotbarSlice } from "@/ui/hud/bridge";
import type { ModeContext, ModeInstance, ModeResult } from "../types";
import {
  NO_SLOT,
  BANNER_SHOW_MS,
  EST_WPM,
  TARGET_LATENCY,
  allowedKeys,
  biomeOf,
  blockTargets,
  burstCount,
  caseSensitiveFor,
  chimeStep,
  comboOf,
  crackOverlay,
  createVeinSchedule,
  emptyFlyQueue,
  emptyWrongGate,
  enqueueDrops,
  feedWrong,
  flushFlights,
  isStraySpace,
  lengthPlan,
  nextKeyOf,
  stageFrame,
  pickTargetBlock,
  pickVeinBlock,
  policyFor,
  poolsFor,
  progressOf,
  seamLength,
  settleDrops,
  stepFlights,
  veinOnBreak,
  veinOnStreak,
  veinTake,
} from "./logic";
import type { Box, Flight } from "./logic";
import { createLootFly } from "./loot-fly";
import type { LootFly } from "./loot-fly";
import { createStageView } from "./view";
import type { StageView } from "./view";

/** The bus event the app sends when the child asks to hear the word again (M2-10). */
const HEAR_AGAIN_EVENT = "app:hearAgain";
/** Hit-stop on a break (PLAN §3.4). */
const HIT_STOP_MS: Ms = 40;
/** After the last block: time for the burst and the loot to land before Results. */
const OUTRO_MS: Ms = 900;
const OUTRO_REDUCED_MS: Ms = 400;
/** The start hint goes away by itself after this long, or at the first correct key. */
const START_HINT_MS: Ms = 6000;
/** Keys a free-play run uses when there is no lesson. */
const FREE_PLAY_KEYS = ["f", "j", "d", "k", "s", "l", "a", ";"];
const FREE_PLAY_CHARS = 30;

/** Loot tables by biome. Biomes without one yet use the Meadow's. */
const LOOT_TABLES: Partial<Record<BiomeId, LootTable>> = { meadow: meadowLoot };

/** What Mine publishes for the HUD in `HudState.custom` (contracts §10). */
export interface MineHudSlice {
  /** Blocks found so far, in the order first found. The first nine fill the hotbar's slots. */
  loot: { block: BlockId; count: number }[];
  /** True while the block on the stage is an ore-vein bonus. */
  vein: boolean;
}

/** Mine also hands out its session's read model, for `__vt.session()` (M2-10). */
export interface MineInstance extends ModeInstance {
  session(): SessionView | null;
}

/**
 * Hooks for a mode built on Mine (M3-05: the placement test). Without them Mine plays the lesson
 * as always. With them the caller picks the blocks, adds more as they break, and builds the
 * result; the stage, the loot, the wrong-key cues and the habit-space rule stay Mine's.
 */
export interface MineOptions {
  /** The summary's mode id. Default `mine`. */
  mode: GameModeId;
  /** The first blocks, how the session ends and its time limit (`null`: no countdown). */
  plan: { targets: Target[]; end: SessionConfig["end"]; limitMs: Ms | null };
  /** After each block breaks: the blocks to add, or `"end"` to finish the session now. */
  onBlock(done: { errors: number; t: Ms }): Target[] | "end";
  /** HUD progress, 0–1, from the blocks broken and the time left (`null` without a limit). */
  progress(done: number, leftMs: Ms | null): number;
  /** Show the countdown (non-Sprout timed lessons do by default). */
  timer: boolean;
  /** Builds the result instead of Mine's stars. */
  result(summary: SessionSummary, loot: Record<BlockId, number>): ModeResult;
}

type AtlasScene = SceneHandle & { atlas(): Atlas | null };
const hasAtlas = (s: SceneHandle): s is AtlasScene => "atlas" in s && typeof s.atlas === "function";

type TargetCamera = CameraRig & { setTarget(at: Vec3): void };
const canTarget = (c: CameraRig): c is TargetCamera =>
  "setTarget" in c && typeof c.setTarget === "function";

interface CurrentBlock {
  id: string;
  len: number;
  blockId: BlockId;
  material: Material;
  vein: boolean;
}

function reducedMotionOf(setting: boolean | "system"): boolean {
  if (setting !== "system") return setting;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function bodyFont(): string {
  const fallback = '"Atkinson Hyperlegible", system-ui, sans-serif';
  if (typeof document === "undefined") return fallback;
  const set = getComputedStyle(document.documentElement).getPropertyValue("--font-body").trim();
  return set === "" ? fallback : set;
}

/** Turns the lesson into targets and a session config. */
function plan(ctx: ModeContext): { targets: Target[]; lesson: Lesson | null; limitMs: Ms | null } {
  const { lesson, band, profile, settings } = ctx;
  const allowed = lesson ? allowedKeys(lessons, lesson) : FREE_PLAY_KEYS;
  const estWpm = baselineNetWpm(profile.history) ?? EST_WPM[band];
  const size = lesson
    ? lengthPlan(lesson, band, { calm: settings.calmMode, estWpm })
    : { length: { chars: FREE_PLAY_CHARS }, end: { kind: "targets" as const }, timeLimitMs: null };
  const targets = generateTargets(
    {
      kind: lesson?.kind ?? "letters",
      allowed,
      weights: keyWeights({
        allowed,
        focus: lesson?.newKeys ?? [],
        stats: profile.keyStats,
        sessionIndex: profile.sessionCounter,
        targetLatencyMs: TARGET_LATENCY[band],
      }),
      pools: lesson ? poolsFor(lesson, band, wordPools) : [],
      length: size.length,
      capitalize: "none",
    },
    ctx.rng.fork("targets"),
  );
  return { targets: blockTargets(targets), lesson, limitMs: size.timeLimitMs };
}

export function create(ctx: ModeContext, opts?: MineOptions): MineInstance {
  const { band, settings, scene, hud, audio, bus } = ctx;
  const biome = biomeOf(ctx.lesson);
  const table = LOOT_TABLES[biome] ?? meadowLoot;
  const blockById = new Map<BlockId, BlockDef>(blocks.map((b) => [b.id, b]));
  const frozen = ctx.params["frozen"] === true;
  const reduced = (): boolean => reducedMotionOf(settings.reducedMotion);

  const { targets, limitMs } = opts?.plan ?? plan(ctx);
  const lesson = ctx.lesson;
  const session = createSession(
    {
      policy: lesson ? policyFor(lesson, band) : "stay",
      targeting: "sequential",
      caseSensitive: lesson ? caseSensitiveFor(lesson, band) : false,
      end:
        opts?.plan.end ?? (limitMs === null ? { kind: "targets" } : { kind: "time", ms: limitMs }),
      mode: opts?.mode ?? "mine",
      seed: ctx.rng.seed,
      ...(lesson && { lessonId: lesson.id }),
    },
    targets,
  );
  const totalTargets = targets.length;
  const blockRng = ctx.rng.fork("blocks");
  const lootRng = ctx.rng.fork("loot");

  const stage = dioramaStage(biome);
  const at: Vec3 = {
    x: stage.target.x + 0.5,
    y: stage.target.y + 0.5,
    z: stage.target.z + 0.5,
  };
  /** Float text spots: above the block without a view, else beside it (`StageView.labelAt`). */
  const labelAt = (i: number): Vec3 => {
    const out: Vec3 = { x: at.x, y: at.y + 0.95 + i * 0.35, z: at.z };
    return view ? view.labelAt(i, out) : out;
  };

  type Phase = "loading" | "playing" | "outro" | "done";
  let phase: Phase = "loading";
  let disposed = false;
  let paused = false;
  let view: StageView | null = null;
  let fly: LootFly | null = null;
  let current: CurrentBlock | null = null;
  let streak = 0;
  let done = 0;
  let veins = createVeinSchedule(band);
  let veinCount = 0;
  /** The kind of block being dug through, and how many more targets show it. */
  let seamBlock: BlockId = "dirt";
  let seamLeft = 0;
  let wrongGate = emptyWrongGate();
  let flights = emptyFlyQueue();
  /** The fly queue's clock: frame time added up, so it stops with the game. */
  let flyNow: Ms = 0;
  const loot: Record<BlockId, number> = {};
  const found: { block: BlockId; count: number }[] = [];
  let summary: SessionSummary | null = null;
  let outroLeft: Ms = 0;
  let bannerLeft: Ms = 0;
  let hintUp = false;
  let typedOnce = false;
  let limitLeft: Ms = limitMs ?? 0;
  let timerShown = -1;
  const showTimer =
    limitMs !== null && !settings.calmMode && (opts ? opts.timer : band !== "sprout");
  /** A hook asked to end the session at this time (see `MineOptions.onBlock`). */
  let endAt: Ms | null = null;
  let progressShown = -1;
  const from = { x: 0, y: 0 };

  // --- HUD ---

  const setBanner = (key: MessageKey | null, tone: "info" | "cheer" = "info"): void => {
    bannerLeft = key === null ? 0 : BANNER_SHOW_MS;
    hintUp = false;
    hud.set({ banner: key === null ? null : { key, tone } });
  };

  /** Hotbar slots: the first nine kinds found, in that order; they never change kind. */
  const slots: (HotbarItem | null)[] = [];
  /**
   * Publishes the loot to the HUD. `custom` slices are compared by identity (M2-14), so this is
   * called only when the loot or the block on the stage really changed.
   */
  const publishCustom = (): void => {
    const mine: MineHudSlice = { loot: found.map((f) => ({ ...f })), vein: current?.vein ?? false };
    const hotbar: HotbarSlice = { slots: [...slots] };
    hud.set({ custom: { ...hud.get().custom, mine, [HOTBAR_SLICE]: hotbar } });
  };

  const progressNow = (a: TargetView | null): number =>
    opts
      ? opts.progress(done, limitMs === null ? null : limitLeft)
      : progressOf(done, a, totalTargets);

  const syncHud = (v: SessionView): void => {
    const a = v.active;
    hud.set({
      word: a ? { text: a.text, marks: a.marks, typed: a.typed } : null,
      combo: comboOf(v.streak),
      progress01: summary ? 1 : progressNow(a),
      nextKey: nextKeyOf(a),
    });
  };

  // --- blocks ---

  const speak = (text: string): void => {
    if (band === "sprout" && settings.tts) audio.speak(text);
  };

  const spawn = (target: TargetView, slide: boolean): void => {
    const len = Array.from(target.text).length;
    const taken = veinTake(veins);
    veins = taken.schedule;
    const veinBlock = taken.vein ? pickVeinBlock(table, blocks, band, streak) : null;
    const vein = veinBlock !== null;
    if (!vein) {
      if (seamLeft <= 0) {
        seamBlock = pickTargetBlock(table, blockRng);
        seamLeft = seamLength(len, blockRng);
      }
      seamLeft--;
    }
    const blockId = veinBlock ?? seamBlock;
    current = {
      id: target.id,
      len,
      blockId,
      material: blockById.get(blockId)?.material ?? "stone",
      vein,
    };
    view?.showBlock({ blockId, glyph: len === 1 ? target.text : null, vein }, slide);
    view?.setCrack(crackOverlay(target.typed, len));
    if (vein) {
      veinCount++;
      audio.sfx("star", { gain: 0.35 });
      setBanner("mine.oreVein", "cheer");
    }
    publishCustom();
    speak(target.text);
  };

  const land = (f: Flight): void => {
    fly?.land(f.id);
    const row = found.find((x) => x.block === f.block);
    if (row) row.count += f.count;
    else found.push({ block: f.block, count: f.count });
    const count = row?.count ?? f.count;
    const def = blockById.get(f.block);
    audio.sfx("pop", { gain: 0.4 });
    if (f.slot === NO_SLOT) {
      // A tenth kind or later: counted in the loot (Results lists it), but no slot is taken over.
      publishCustom();
      return;
    }
    while (slots.length <= f.slot) slots.push(null);
    slots[f.slot] = {
      label: t("mine.slot", { name: def ? t(def.nameKey) : f.block, count }),
      count,
      icon: fly?.icon(f.block) ?? "",
    };
    publishCustom();
  };

  const breakBlock = (e: Extract<EngineEvent, { type: "targetComplete" }>): void => {
    const b = current;
    if (b === null || b.id !== e.targetId) return;
    done++;
    scene.fx.hitStop(HIT_STOP_MS);
    scene.fx.burst(at, { blockId: b.blockId, count: burstCount(b.len) });
    audio.sfx("break", { material: b.material });
    const shake = breakShake(streak);
    scene.camera.shake(shake.intensity01, shake.durationMs);
    view?.hideBlock();

    const drops = settleDrops(
      rollLoot(
        {
          biome: table.biome,
          wordLen: b.len,
          streak,
          targetAccuracy: e.accuracy,
          band,
          oreVein: b.vein,
        },
        table,
        lootRng,
      ),
      b.blockId,
      b.vein,
    );
    drops.forEach((d, i) => {
      loot[d.block] = (loot[d.block] ?? 0) + d.count;
      bus.emit("loot", d);
      // Float text only on a break, never per letter (M2-05 review).
      if (i < 2) scene.fx.floatText(labelAt(i), t("mine.got", { count: d.count }));
    });
    const hasOrigin = view?.project(from) ?? false;
    const queued = enqueueDrops(flights, drops, flyNow, reduced() || !hasOrigin || fly === null);
    for (const f of queued.queue.flights) {
      if (!flights.flights.includes(f)) fly?.launch(f, from);
    }
    flights = queued.queue;
    for (const f of queued.landed) land(f);
    current = null;

    const more = opts?.onBlock({ errors: e.errors, t: e.t });
    if (more === "end") endAt = e.t;
    else if (more !== undefined && more.length > 0) session.addTargets(more);
  };

  // --- engine events ---

  const handle = (events: readonly EngineEvent[]): void => {
    if (events.length === 0) return;
    const completes = events.some((e) => e.type === "targetComplete");
    for (const e of events) {
      // Everyone else (achievements, the break reminder) hears the engine through the bus.
      bus.emit("engine", e);
      switch (e.type) {
        case "streak":
          streak = e.length;
          veins = veinOnStreak(veins, streak);
          break;
        case "streakBroken":
          streak = 0;
          veins = veinOnBreak(veins);
          break;
        case "correct": {
          const b = current;
          if (!typedOnce) {
            typedOnce = true;
            if (hintUp) setBanner(null);
          }
          if (b === null) break;
          view?.swing();
          // The streak event for this key comes right after it.
          audio.sfx("chime", { pitchStep: chimeStep(e.index, b.len, streak + 1), gain: 0.5 });
          if (completes) break;
          const stage9 = crackOverlay(e.index + 1, b.len);
          view?.setCrack(stage9);
          scene.fx.burst(at, { blockId: b.blockId, count: 3, speed: 0.5 });
          audio.sfx("chip", { material: b.material, pitchStep: stage9 ?? 0, gain: 0.8 });
          break;
        }
        case "wrong": {
          // Never any effect for a slip: no burst, no shake, no hit-stop (M2-05).
          const fed = feedWrong(wrongGate, e.got, e.t);
          wrongGate = fed.gate;
          if (fed.cue) {
            audio.sfx("thud");
            view?.wobble();
          }
          if (fed.banner) setBanner("mine.almost");
          // Every press, repeats included: the on-screen keyboard gates them itself (M2-09).
          reportWrongKey(hud, e.got);
          break;
        }
        case "targetComplete":
          breakBlock(e);
          break;
        case "sessionEnd":
          summary = e.summary;
          phase = "outro";
          outroLeft = reduced() ? OUTRO_REDUCED_MS : OUTRO_MS;
          break;
        default:
          break;
      }
    }
    if (endAt !== null && summary === null) {
      const endT = endAt;
      endAt = null;
      handle(session.end(endT));
      return;
    }
    const v = session.view();
    const a = v.active;
    if (a && !a.complete && phase === "playing") {
      if (current === null || current.id !== a.id) spawn(a, true);
      // Under `skip` and `backspace` the cursor also moves without a correct key.
      else view?.setCrack(crackOverlay(a.typed, current.len));
    }
    syncHud(v);
  };

  const finishNow = (): void => {
    if (phase === "done" || summary === null) return;
    phase = "done";
    const flushed = flushFlights(flights);
    flights = flushed.queue;
    for (const f of flushed.landed) land(f);
    if (opts) {
      ctx.finish(opts.result(summary, { ...loot }));
      return;
    }
    const stars = computeStars({
      completed: true,
      accuracy: summary.accuracy,
      netWpm: summary.netWpm,
      targets: lesson?.targets ?? { accuracy: 0.85 },
      baseline: baselineNetWpm(ctx.profile.history),
      band,
    });
    ctx.finish({ summary, loot: { ...loot }, stars, extra: { oreVeins: veinCount } });
  };

  // --- world ---

  // --- screen layout ---

  let stageCanvas: HTMLCanvasElement | null = null;
  let layoutKey = "";
  let layoutW = 0;
  let layoutH = 0;
  let frames = 0;

  /**
   * Puts the block where the HUD leaves room (see `stageFrame`). It measures the page, so it runs
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
    const stageBox = boxOf(doc.querySelector('[data-hud="stage"]'));
    const keys = boxOf(
      // The keyboard's own frame (the dark plate), not the full-width row it sits in.
      doc.querySelector('[data-hud="keyboard"] [role="img"]')?.parentElement,
    );
    const spot = stageFrame({ width: origin.width, height: origin.height }, stageBox, keys);
    const key = spot
      ? `${Math.round(spot.x)},${Math.round(spot.y)},${Math.round(spot.size)},${Math.round(keys?.left ?? -1)}`
      : "";
    layoutW = canvas.clientWidth;
    layoutH = canvas.clientHeight;
    if (key === layoutKey) return;
    layoutKey = key;
    // Beside a keyboard, the arm stands in the same free column as the block.
    const armX = keys ? (keys.left + keys.width + origin.width) / 2 : null;
    view.frameAt(spot, armX);
  };

  const ready = (): void => {
    if (disposed || phase !== "loading") return;
    phase = "playing";
    const three = scene.three;
    if (three && hasAtlas(scene)) {
      const canvas = three.renderer.domElement;
      stageCanvas = canvas;
      view = createStageView({
        scene: three.scene,
        camera: three.camera,
        canvas,
        atlas: () => scene.atlas(),
        at,
        floorY: stage.floorY + 1,
        seed: ctx.rng.seed,
        reducedMotion: reduced,
        frozen,
        fontFamily: bodyFont,
        requestRender: () => scene.requestRender(),
      });
      fly = createLootFly({ canvas, atlas: () => scene.atlas() });
      relayout();
    }
    const v = session.view();
    if (v.active) {
      spawn(v.active, false);
      const single = Array.from(v.active.text).length === 1;
      setBanner(single ? "mine.startLetter" : "mine.startWord");
      bannerLeft = START_HINT_MS;
      hintUp = true;
    }
    syncHud(v);
    if (showTimer) hud.set({ timer: { remainingMs: limitLeft } });
    scene.requestRender();
  };

  const offHear = bus.on(HEAR_AGAIN_EVENT, () => {
    const a = phase === "playing" ? session.view().active : null;
    // The shell applies the TTS setting; `speak` is silent without an on-device voice.
    if (a) audio.speak(a.text);
  });

  return {
    start() {
      scene.setEnvironment({ biome, timeOfDay: "day" });
      if (canTarget(scene.camera)) scene.camera.setTarget(at);
      scene.camera.preset("mine", { durationMs: 0 });
      // The same meadow every time for one player: it is their place.
      const seed = hashString(`${ctx.profile.id}:${biome}`);
      scene
        .loadDiorama(`mine-${biome}`, generateDiorama(biome, seed))
        .then(ready, (err: unknown) => {
          console.warn("[mine] the world did not load; playing without it", err);
          ready();
        });
    },

    input(k: KeyInput) {
      // Nothing to type until the block is on the stage, and nothing after the last one.
      if (phase !== "playing" || paused) return;
      // A habit space between blocks is not a slip (decision 81).
      if (isStraySpace(k.key, session.view().active)) return;
      handle(session.feed(k));
    },

    frame(dtMs: Ms) {
      if (disposed) return;
      if (stageCanvas !== null) {
        frames++;
        const resized = stageCanvas.clientWidth !== layoutW || stageCanvas.clientHeight !== layoutH;
        if (resized || frames === 2 || frames === 10 || frames === 30 || frames === 90) {
          if (resized) layoutKey = "";
          relayout();
        }
      }
      view?.frame(dtMs);
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
      if (phase === "playing" && limitMs !== null && typedOnce) {
        limitLeft = Math.max(0, limitLeft - dtMs);
        if (showTimer) {
          const s = Math.ceil(limitLeft / 1000);
          if (s !== timerShown) {
            timerShown = s;
            hud.set({ timer: { remainingMs: s * 1000 } });
          }
        }
        if (opts && summary === null) {
          // A hook's progress may follow the clock, so it moves between keys too.
          const p = Math.round(progressNow(null) * 100);
          if (p !== progressShown) {
            progressShown = p;
            hud.set({ progress01: p / 100 });
          }
        }
        if (limitLeft <= 0) handle(session.end(ctx.clock.now()));
      }
      if (phase === "outro") {
        outroLeft -= dtMs;
        if (outroLeft <= 0) finishNow();
      }
    },

    pause(now: Ms) {
      if (paused) return;
      paused = true;
      // The break reminder can pause on the very last block, after the session has ended.
      if (summary === null) handle(session.pause(now));
    },

    resume(now: Ms) {
      if (!paused) return;
      paused = false;
      if (summary === null) handle(session.resume(now));
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      offHear();
      view?.dispose();
      view = null;
      fly?.dispose();
      fly = null;
    },

    session: () => (phase === "loading" ? null : session.view()),
  };
}
