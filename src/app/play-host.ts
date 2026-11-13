/**
 * Play host (task M2-10, docs/impl/contracts.md §7): runs one lesson at a time.
 *
 * Given a lesson, it resolves the mode, builds the {@link ModeContext} on the app's shared scene,
 * forwards typed keys, handles pause (idempotent: blur and hide repeat it), drives `frame`, calls
 * `dispose` on exit, and on `finish` folds the result into the profile exactly once and autosaves.
 *
 * Camera drift is on only during live play. Paused, on the break overlay and between lessons it is
 * off, so the render loop idles.
 */
import type { AudioApi } from "@/audio/types";
import type { Lesson } from "@/content/lessons/types";
import { createRng } from "@/engine/rng";
import type { KeyInput, SessionView } from "@/engine/types";
import type { ModeContext, ModeInstance, ModeModule, ModeResult } from "@/modes/types";
import type { Profile } from "@/save/schema";
import type { AchievementId, BlockId, EpochMs, GameModeId, Ms } from "@/types/core";
import { withUnlocks } from "@/engine/achievements";
import type { AchievementTracker, RunTracker } from "./achievements";
import type { BreakReminder } from "./break-reminder";
import type { Clock } from "./clock";
import { createEmitter } from "./events";
import type { Emitter, GameEvents } from "./events";
import type { HudStore } from "./hud";
import {
  BUILDER_ISLAND_EXTRA,
  BUILDER_SAVE_EVENT,
  isBuilderLesson,
  islandPatchOf,
  withIslandPatch,
} from "@/modes/builder/lesson";
import type { IslandPatch } from "@/modes/builder/lesson";
import { isPlacementLesson } from "@/modes/placement/lesson";
import { applyPlacement, applyResult } from "./progress";
import type { AppScene } from "./scene-host";

/** Where the host is. `break` is the stretch-break overlay, a pause of its own. */
export type PlayStatus =
  | "idle"
  | "loading"
  | "running"
  | "paused"
  | "break"
  | "finished"
  | "failed";

/** Modes may also expose their session's read model, for `__vt.session()`. Optional. */
export interface InspectableMode extends ModeInstance {
  session?(): SessionView | null;
  /**
   * A mode with no end of its own (Builder, M4-07) finishes here: the host calls it when the
   * child leaves, and the mode calls `finish` with what it has, so the visit is saved.
   */
  leave?(): void;
}

/** The bus event a mode receives when the child asks to hear the word again. */
export const HEAR_AGAIN_EVENT = "app:hearAgain";

export interface PlayHostDeps {
  acquireScene(): Promise<AppScene>;
  /** The registry's `resolveMode`. May throw when no mode exists at all yet. */
  resolveMode(id: GameModeId): ModeModule;
  hud: HudStore;
  audio: AudioApi;
  /** The input clock (always real, also under `?freeze`). Modes get it as `ctx.clock`. */
  clock: Clock;
  /** Seed for each lesson's rng. */
  nextSeed(): number;
  /** `?freeze`: never turn drift on. */
  frozen: boolean;
  /**
   * True when the page is hidden or has lost focus. A lesson that finishes loading in that state
   * starts paused: the blur that would have paused it came during `loading` and was dropped.
   */
  away?(): boolean;
  /** `?record`: keep every typed key of the lesson. */
  record: boolean;
  reminder: BreakReminder;
  /** Persists the updated profile. Never rejects. */
  saveProfile(p: Profile): Promise<boolean>;
  /**
   * Saves a change made to the player (M3-FIX-9, two-tab safety). `derive` gets the newest copy
   * the app has, which another tab may have changed since `base`, and returns the profile to
   * save, or null to save nothing. It may run more than once (once per newer copy), so it must
   * not change anything itself. Resolves with what was saved, or null when nothing was (refused,
   * read-only or a storage failure). Never rejects. Default: `derive` on the app's profile, then
   * {@link saveProfile}.
   */
  updateProfile?(base: Profile, derive: (b: Profile) => Profile | null): Promise<Profile | null>;
  /** Every shipped lesson, for the placement test's unlocks (M3-05). Default: none. */
  lessons?: readonly Lesson[];
  /** Achievements (M3-10): told when each lesson starts, finishes or is left. Optional. */
  achievements?: AchievementTracker;
  /**
   * The app's profile as it is now. A lesson left early adds its badges to this one, not to the
   * copy taken when the lesson started, so a change made during the lesson isn't saved over.
   */
  currentProfile?(): Profile | null;
  /** Called on every status change. */
  onStatus(status: PlayStatus): void;
  /** Called once per finished lesson, after the profile is updated and the save attempted. */
  onFinished(result: ModeResult, profile: Profile): void;
}

export interface StartRequest {
  lesson: Lesson;
  profile: Profile;
  params?: Record<string, unknown>;
}

export interface PlayHost {
  /** Loads and starts a lesson. Resolves once the mode runs (or the start failed). */
  start(req: StartRequest): Promise<void>;
  /** A typed key. Dropped unless play is live. */
  input(k: KeyInput): void;
  /** Pause. Safe to call again while already paused. */
  pause(t: Ms): void;
  /** Resume from pause or from the break overlay. Safe to call when not paused. */
  resume(t: Ms): void;
  hearAgain(t: Ms): void;
  /** Leaves the lesson without a result (Pause → map). Disposes the mode. */
  quit(): void;
  status(): PlayStatus;
  modeId(): GameModeId | null;
  session(): SessionView | null;
  lastResult(): ModeResult | null;
  recording(): KeyInput[] | null;
  /** Rolling average frames per second of live play. */
  fps(): number;
}

const FPS_WINDOW = 60;

interface Run {
  instance: InspectableMode | null;
  lesson: Lesson;
  profile: Profile;
  modeId: GameModeId;
  scene: AppScene | null;
  finished: boolean;
  disposed: boolean;
  unFrame: (() => void) | null;
  unBus: (() => void) | null;
  bus: Emitter<GameEvents> | null;
  ach: RunTracker | null;
  log: KeyInput[];
  /**
   * Builder: every island this visit started with or handed out to save (as JSON), with the
   * inventory that went with it. A stored island on this list is this visit's own; any other one
   * was changed by another tab.
   */
  islands: Map<string, Readonly<Record<BlockId, number>>>;
}

/** Same counts, key by key (a missing key is 0). */
function sameCounts(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  }
  return true;
}

/**
 * `now` plus what this tab's Builder changed (`to - from`), never below 0. Blocks another tab added
 * to `now` in the meantime (a lesson's loot) are kept. Keys at 0 stay, like the editor's.
 */
export function rebaseCounts(
  now: Readonly<Record<BlockId, number>>,
  from: Readonly<Record<BlockId, number>>,
  to: Readonly<Record<BlockId, number>>,
): Record<BlockId, number> {
  const out: Record<BlockId, number> = { ...now };
  for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const d = (to[k] ?? 0) - (from[k] ?? 0);
    if (d !== 0 || !Object.hasOwn(out, k)) out[k] = Math.max(0, (now[k] ?? 0) + d);
  }
  return out;
}

/** Badges in `after` that `before` doesn't have. */
function addedBadges(after: Profile, before: Profile): Record<AchievementId, EpochMs> {
  return Object.fromEntries(
    Object.entries(after.achievements).filter(([id]) => before.achievements[id] === undefined),
  );
}

export function createPlayHost(deps: PlayHostDeps): PlayHost {
  let status: PlayStatus = "idle";
  let run: Run | null = null;
  let last: ModeResult | null = null;
  let lastLog: KeyInput[] | null = null;
  const frameTimes: number[] = [];

  const setStatus = (s: PlayStatus): void => {
    if (s === status) return;
    status = s;
    deps.onStatus(s);
  };

  const setDrift = (r: Run, on: boolean): void => {
    r.scene?.camera.setDrift(on && !deps.frozen);
  };

  const onFrame = (r: Run) => (dtMs: Ms, t: Ms) => {
    if (r !== run || status !== "running" || r.instance === null) return;
    deps.reminder.add(dtMs);
    if (dtMs > 0) {
      frameTimes.push(dtMs);
      if (frameTimes.length > FPS_WINDOW) frameTimes.shift();
    }
    r.instance.frame(dtMs, t);
  };

  const stopFrames = (r: Run): void => {
    r.unFrame?.();
    r.unFrame = null;
    setDrift(r, false);
  };

  const startFrames = (r: Run): void => {
    if (r.scene === null || r.unFrame !== null) return;
    r.unFrame = r.scene.onFrame(onFrame(r));
    setDrift(r, true);
  };

  /** The app's profile as it is now when it is still this run's player, else the run's own copy. */
  const liveProfile = (r: Run): Profile => {
    const now = deps.currentProfile?.() ?? null;
    return now?.id === r.profile.id ? now : r.profile;
  };

  /** Saves a change through `updateProfile`, or (without one) on the profile as it is now. */
  const update = async (
    base: Profile,
    derive: (b: Profile) => Profile | null,
  ): Promise<Profile | null> => {
    if (deps.updateProfile !== undefined) return deps.updateProfile(base, derive);
    const now = deps.currentProfile?.() ?? null;
    const next = derive(now?.id === base.id ? now : base);
    if (next === null) return null;
    return (await deps.saveProfile(next)) ? next : null;
  };

  /**
   * A Builder save onto `b`, the newest copy of the player. Blocks another tab added since this
   * visit last saved are kept (M3-FIX-9). Null when another tab changed the island itself: two
   * islands can't be merged, and a damaged or stale island is never written over a newer one.
   */
  const patchOnto = (r: Run, b: Profile, patch: IslandPatch): Profile | null => {
    const from = r.islands.get(JSON.stringify(b.island));
    if (from === undefined) return null;
    const inventory = sameCounts(b.inventory, from)
      ? patch.inventory
      : rebaseCounts(b.inventory, from, patch.inventory);
    return withIslandPatch(b, { island: patch.island, inventory });
  };

  /** Notes a Builder patch as this visit's own, before it is saved. */
  const handOut = (r: Run, patch: IslandPatch): void => {
    r.islands.set(JSON.stringify(patch.island), patch.inventory);
  };

  /** Lets a mode that is being left finish first (see {@link InspectableMode.leave}). */
  const leave = (r: Run): void => {
    if (r.finished || r.disposed || r.instance?.leave === undefined) return;
    try {
      r.instance.leave();
    } catch (err) {
      console.error("[play] mode leave failed", err);
    }
  };

  const teardown = (r: Run): void => {
    if (r.disposed) return;
    r.disposed = true;
    // A lesson left early keeps the badges it already earned.
    const ach = r.ach;
    r.ach = null;
    if (ach !== null && !r.finished) {
      const kept = ach.abandon();
      if (Object.keys(kept).length > 0) void update(r.profile, (b) => withUnlocks(b, kept));
    }
    stopFrames(r);
    r.unBus?.();
    r.unBus = null;
    const instance = r.instance;
    r.instance = null;
    try {
      instance?.dispose();
    } catch (err) {
      console.error("[play] mode dispose failed", err);
    }
    r.scene?.clearDiorama();
    deps.hud.reset();
  };

  const finish = (r: Run, result: ModeResult): void => {
    // Exactly once per lesson: a second finish (or one from a lesson already left) is ignored.
    if (r !== run || r.finished || r.disposed) return;
    r.finished = true;
    last = result;
    lastLog = deps.record ? r.log : null;
    setStatus("finished");
    // The mode may be inside its own call stack; dispose it after that unwinds.
    queueMicrotask(() => teardown(r));
    const at = deps.clock.epoch();
    // The placement test is not a curriculum lesson: it sets the start instead (M3-05).
    // The base is the profile as it is now, never the copy from when the lesson started: a
    // change made meanwhile (in Settings, or by another tab, M3-FIX-9) is kept. `derive` can run
    // again on a newer copy, so the result is added to that copy instead of written over it.
    const base = liveProfile(r);
    let updated: Profile;
    let derive: (b: Profile) => Profile | null;
    let changed = true;
    if (isBuilderLesson(r.lesson)) {
      // Builder (M4-07) saved the island while it ran. The island and the practice session go in
      // one save. It is not a lesson: no lesson record, and only the badges earned live count.
      const typed = result.summary.keystrokes > 0;
      const kept = r.ach?.abandon() ?? {};
      r.ach = null;
      const patch = islandPatchOf(result.extra?.[BUILDER_ISLAND_EXTRA]);
      // When another tab changed the island itself (`patchOnto` is null), that tab's island and
      // inventory stay, so every block is still counted once; this visit's practice session and
      // the badges the child already saw are still saved (review B2).
      const visit = (b: Profile): Profile => {
        const built = patch === null ? b : (patchOnto(r, b, patch) ?? b);
        const applied = typed ? applyResult(built, null, result, at) : built;
        return Object.keys(kept).length > 0 ? withUnlocks(applied, kept) : applied;
      };
      const first = visit(base);
      updated = first;
      // A visit that changed nothing writes nothing.
      changed = updated !== base;
      derive = (b) => (b === base ? first : visit(b));
    } else {
      const apply = (b: Profile): Profile =>
        isPlacementLesson(r.lesson)
          ? applyPlacement(b, deps.lessons ?? [], result, at)
          : applyResult(b, r.lesson, result, at);
      const applied = apply(base);
      updated = r.ach?.finish(applied, result) ?? applied;
      const first = updated;
      const badges = addedBadges(updated, applied);
      derive = (b) => (b === base ? first : withUnlocks(apply(b), badges));
    }
    const saved = changed ? update(base, derive) : Promise.resolve(updated);
    void saved.then((shown) => {
      // A newer lesson started (or this one was quit) while the save was in flight: don't let
      // the old finish route the new lesson to results.
      if (run !== r) return;
      run = null;
      deps.onFinished(result, shown ?? updated);
    });
  };

  const enterBreak = (r: Run): void => {
    if (r !== run || status !== "running" || r.instance === null) return;
    const t = deps.clock.now();
    r.instance.pause(t);
    stopFrames(r);
    setStatus("break");
  };

  return {
    async start({ lesson, profile, params = {} }) {
      if (run !== null) {
        leave(run);
        teardown(run);
      }
      frameTimes.length = 0;
      const r: Run = {
        instance: null,
        lesson,
        profile,
        modeId: lesson.mode,
        scene: null,
        finished: false,
        disposed: false,
        unFrame: null,
        unBus: null,
        bus: null,
        ach: null,
        log: [],
        islands: new Map([[JSON.stringify(profile.island), profile.inventory]]),
      };
      run = r;
      setStatus("loading");
      try {
        const mod = deps.resolveMode(lesson.mode);
        r.modeId = mod.id;
        const [factory, scene] = await Promise.all([mod.load(), deps.acquireScene()]);
        if (run !== r) return;
        r.scene = scene;
        const bus = createEmitter<GameEvents>();
        r.bus = bus;
        r.ach = deps.achievements?.begin({ profile, lesson, bus }) ?? null;
        const offEngine = bus.on("engine", (e) => {
          // A break waits for a target boundary, never mid-word.
          if (e.type !== "targetComplete") return;
          if (deps.reminder.due(profile.settings.breakReminderMin)) enterBreak(r);
        });
        // Builder's autosave (M4-07): the island and inventory, onto the profile as it is now.
        const offSave = bus.on(BUILDER_SAVE_EVENT, (e) => {
          const patch = islandPatchOf(e);
          if (patch === null || r !== run || r.finished || r.disposed) return;
          const base = liveProfile(r);
          const derive = (b: Profile): Profile | null => patchOnto(r, b, patch);
          handOut(r, patch);
          void update(base, derive);
        });
        r.unBus = () => {
          offEngine();
          offSave();
        };
        deps.hud.reset();
        const ctx: ModeContext = {
          lesson,
          // Modes hold ambient motion still under `?freeze`, like the camera drift here.
          params: { ...params, frozen: deps.frozen },
          profile,
          settings: profile.settings,
          band: profile.ageBand,
          rng: createRng(deps.nextSeed()),
          clock: deps.clock,
          scene,
          hud: deps.hud,
          audio: deps.audio,
          bus,
          finish: (result) => finish(r, result),
        };
        const instance: InspectableMode = factory.create(ctx);
        r.instance = instance;
        if (run !== r) {
          teardown(r);
          return;
        }
        setStatus("running");
        instance.start();
        startFrames(r);
        scene.requestRender();
        if (deps.away?.() === true && run === r && status === "running") {
          instance.pause(deps.clock.now());
          stopFrames(r);
          setStatus("paused");
        }
      } catch (err) {
        console.error("[play] could not start the lesson", err);
        if (run === r) {
          teardown(r);
          run = null;
          setStatus("failed");
        }
      }
    },

    input(k) {
      if (run === null || status !== "running" || run.instance === null) return;
      if (deps.record) run.log.push(k);
      run.instance.input(k);
    },

    pause(t) {
      if (run === null || status !== "running" || run.instance === null) return;
      run.instance.pause(t);
      stopFrames(run);
      setStatus("paused");
    },

    resume(t) {
      if (run === null || (status !== "paused" && status !== "break") || run.instance === null) {
        return;
      }
      if (status === "break") deps.reminder.reset();
      setStatus("running");
      run.instance.resume(t);
      startFrames(run);
    },

    hearAgain(t) {
      if (run === null || status !== "running") return;
      run.bus?.emit(HEAR_AGAIN_EVENT, { t });
    },

    quit() {
      if (run === null) return;
      leave(run);
      teardown(run);
      run = null;
      setStatus("idle");
    },

    status: () => status,
    modeId: () => run?.modeId ?? null,
    session: () => run?.instance?.session?.() ?? null,
    lastResult: () => last,
    recording: () => lastLog,
    fps() {
      if (frameTimes.length === 0) return 0;
      const mean = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      return mean > 0 ? 1000 / mean : 0;
    },
  };
}
