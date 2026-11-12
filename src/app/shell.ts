/**
 * The app shell's state machine (task M2-10, PLAN.md §5.3, §6.5).
 *
 * It owns the route and its history, the active profile and its settings, the play host, input
 * routing, save notices and the `ready()` bookkeeping for test hooks. `App.tsx` draws it; this
 * file has no JSX so it can be unit tested without a renderer.
 */
import { signal } from "@preact/signals";
import type { ReadonlySignal } from "@preact/signals";
import type { AudioApi, Bus } from "@/audio/types";
import type { Lesson } from "@/content/lessons/types";
import { PLACEMENT_LESSON, PLACEMENT_LESSON_ID } from "@/modes/placement/lesson";
import type { ModeModule } from "@/modes/types";
import type { SaveProblem, SaveProblemKind } from "@/save/problems";
import type { Profile } from "@/save/schema";
import { defaultSettings } from "@/save/settings";
import type { Settings } from "@/save/settings";
import { NewerSaveError } from "@/save/store";
import type { SaveStore } from "@/save/store";
import type { AchievementDef } from "@/engine/achievements";
import type { AchievementId, GameModeId } from "@/types/core";
import { createAchievementTracker } from "./achievements";
import { createBreakReminder } from "./break-reminder";
import type { Clock } from "./clock";
import type { HudStore } from "./hud";
import { createInputRouter } from "./input-router";
import type { InputRouter } from "./input-router";
import { createPlayHost } from "./play-host";
import type { PlayHost, PlayStatus } from "./play-host";
import type { Route } from "./routes";
import type { AppScene } from "./scene-host";
import type { AppApi, ScreenInputHandler } from "./types";

/** The synth (M2-06) has `setSpeechEnabled`; the silent stub doesn't. */
export type ShellAudio = AudioApi & { setSpeechEnabled?(on: boolean): void };

export interface ShellDeps {
  store: SaveStore;
  lessons: readonly Lesson[];
  resolveMode(id: GameModeId): ModeModule;
  acquireScene(): Promise<AppScene>;
  hud: HudStore;
  audio: ShellAudio;
  /** The real clock (input timebase), also under `?freeze`. */
  clock: Clock;
  nextSeed(): number;
  frozen: boolean;
  /** True when the page is hidden or blurred (a lesson that loads then starts paused). */
  away?(): boolean;
  record: boolean;
  /** Applies settings to the page (theme, text size, motion, font). */
  applySettings(s: Settings): void;
  /** True when keyboard focus sits on a button, link or field. */
  focusOnControl(): boolean;
  /** Shows or hides the shared canvas. */
  showCanvas(on: boolean): void;
  initial?: Route;
  /** A profile to start with (`?profile=` fixtures). Set before the first route is entered, so a
   * deep link straight into `play` finds it. */
  initialProfile?: Profile | null;
  /** The device's offset from UTC in minutes (`Date#getTimezoneOffset`). Default: the real one. */
  tzOffsetMin?(): number;
}

/** A kind message for the family, shown as a toast. */
export interface Notice {
  id: number;
  kind: SaveProblemKind;
}

export interface Shell {
  readonly api: AppApi;
  readonly route: ReadonlySignal<Route>;
  readonly profile: ReadonlySignal<Profile | null>;
  readonly playStatus: ReadonlySignal<PlayStatus>;
  readonly notices: ReadonlySignal<readonly Notice[]>;
  /** Badges earned and not yet shown, oldest first (M3-10). The toast shows the first. */
  readonly badgeToasts: ReadonlySignal<readonly AchievementId[]>;
  readonly play: PlayHost;
  /** The HUD bridge modes write to; the play view draws it (M2-14). */
  readonly hud: HudStore;
  readonly router: InputRouter;
  /** For `SaveStoreOptions.onProblem`. */
  onSaveProblem(p: SaveProblem): void;
  dismissNotice(id: number): void;
  /** The first badge toast has been shown. */
  nextBadgeToast(): void;
  /** Queues toasts for newly earned badges (the tracker calls this; tests may too). */
  queueBadges(ids: readonly AchievementId[]): void;
  /** Pause → "Back to the map". */
  quitPlay(): void;
  /** Resolves once everything the current screen asked to wait for has settled. */
  ready(): Promise<void>;
}

/** Settings before any profile is picked: Miner defaults, with speech off. */
export function deviceSettings(): Settings {
  return { ...defaultSettings("miner"), tts: false };
}

const BUSES: readonly Bus[] = ["master", "music", "sfx", "voice"];

export function applyAudioSettings(audio: ShellAudio, s: Readonly<Settings>): void {
  // Speech first: the synth starts with speech on, and some bands default to tts off.
  audio.setSpeechEnabled?.(s.tts);
  for (const bus of BUSES) audio.setVolume(bus, s.volume[bus]);
}

export function createShell(deps: ShellDeps): Shell {
  const route = signal<Route>(deps.initial ?? { id: "splash" });
  const history: Route[] = [];
  const profile = signal<Profile | null>(null);
  const playStatus = signal<PlayStatus>("idle");
  const notices = signal<readonly Notice[]>([]);
  const badgeToasts = signal<readonly AchievementId[]>([]);
  const queueBadges = (ids: readonly AchievementId[]): void => {
    if (ids.length > 0) badgeToasts.value = [...badgeToasts.value, ...ids];
  };
  const handlers: ScreenInputHandler[] = [];
  const pending = new Set<Promise<unknown>>();
  /** Profiles a newer build owns: never written again this session. */
  const readOnly = new Set<string>();
  /** Profiles the store could not read at all: they hold a slot until removed (M3-09). */
  const damaged = new Set<string>();
  let noticeId = 0;

  const notify = (kind: SaveProblemKind): void => {
    if (notices.value.some((n) => n.kind === kind)) return;
    noticeId += 1;
    notices.value = [...notices.value, { id: noticeId, kind }];
  };

  const whenReady = (p: Promise<unknown>): void => {
    const tracked = p.then(
      () => undefined,
      () => undefined,
    );
    pending.add(tracked);
    void tracked.then(() => pending.delete(tracked));
  };

  // Loaded on the side: the badge list pulls in the block registry, which the first screen
  // doesn't need. A lesson takes far longer than this load.
  let badgeDefs: readonly AchievementDef[] = [];
  whenReady(
    import("@/content/achievements").then((m) => {
      badgeDefs = m.achievements;
    }),
  );

  const applySettings = (s: Readonly<Settings>): void => {
    deps.applySettings(s);
    applyAudioSettings(deps.audio, s);
  };

  const setProfile = (p: Profile | null): void => {
    const before = profile.value;
    // Badge toasts belong to the player who earned them (M3-10 re-review N3).
    if (before?.id !== p?.id) badgeToasts.value = [];
    profile.value = p;
    if (p === null) applySettings(deviceSettings());
    else if (before?.settings !== p.settings) applySettings(p.settings);
  };

  const saveProfile = async (p: Profile): Promise<boolean> => {
    setProfile(p);
    if (readOnly.has(p.id)) return false;
    try {
      await deps.store.save(p);
      return true;
    } catch (err) {
      // Autosave never crashes the game and never retries in a loop (M1-09 notes).
      if (err instanceof NewerSaveError) {
        readOnly.add(p.id);
        notify("newerVersion");
      } else {
        console.warn("[app] save failed", err);
        notify("storageError");
      }
      return false;
    }
  };

  const removeProfile = async (id: string): Promise<boolean> => {
    if (readOnly.has(id)) return false;
    try {
      await deps.store.remove(id);
    } catch (err) {
      console.warn("[app] remove failed", err);
      notify("storageError");
      return false;
    }
    damaged.delete(id);
    if (profile.value?.id === id) setProfile(null);
    return true;
  };

  const lessonById = (id: string): Lesson | null => deps.lessons.find((l) => l.id === id) ?? null;

  const play = createPlayHost({
    acquireScene: () => deps.acquireScene(),
    resolveMode: (id) => deps.resolveMode(id),
    hud: deps.hud,
    audio: deps.audio,
    clock: deps.clock,
    nextSeed: () => deps.nextSeed(),
    frozen: deps.frozen,
    away: () => deps.away?.() ?? false,
    record: deps.record,
    reminder: createBreakReminder(),
    currentProfile: () => profile.value,
    achievements: createAchievementTracker({
      defs: () => badgeDefs,
      lessons: deps.lessons,
      clock: deps.clock,
      tzOffsetMin: () => deps.tzOffsetMin?.() ?? new Date().getTimezoneOffset(),
      schedule(fn, ms) {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
      onUnlock: (ids) => queueBadges(ids),
    }),
    saveProfile,
    lessons: deps.lessons,
    onStatus(s) {
      playStatus.value = s;
    },
    onFinished(_result, _updated) {
      const current = route.value;
      if (current.id !== "play") return;
      // The placement test shows where the player starts, on its own screen (M3-05).
      if (current.lesson === PLACEMENT_LESSON_ID) {
        go({ id: "placement", lesson: PLACEMENT_LESSON_ID }, true);
        return;
      }
      const next: Route = { id: "results" };
      if (current.lesson !== undefined) next.lesson = current.lesson;
      go(next, true);
    },
  });

  const enter = (to: Route): void => {
    // The world map draws its islands in the shared scene too (M3-04).
    deps.showCanvas(to.id === "play" || to.id === "map");
    if (to.id !== "play") return;
    const lesson =
      to.lesson === PLACEMENT_LESSON_ID
        ? PLACEMENT_LESSON
        : to.lesson === undefined
          ? null
          : lessonById(to.lesson);
    const p = profile.value;
    if (lesson === null || p === null) {
      playStatus.value = "failed";
      return;
    }
    whenReady(play.start({ lesson, profile: p }));
  };

  function go(to: Route, replace: boolean): void {
    const from = route.value;
    if (from.id === "play" && to.id !== "play" && play.status() !== "finished") play.quit();
    if (!replace) history.push(from);
    route.value = { ...to };
    enter(route.value);
  }

  const back = (): void => {
    const prev = history.pop();
    if (route.value.id === "play" && play.status() !== "finished") play.quit();
    // A fresh object, so screens that key on the route (the badge toast's settle wait) see a new
    // arrival even when going back to a route object seen before (M3-10 re-review N1).
    route.value = prev === undefined ? { id: "splash" } : { ...prev };
    enter(route.value);
  };

  const router = createInputRouter({
    onPlayRoute: () => route.value.id === "play",
    play,
    menu: (i) => {
      const top = handlers.at(-1);
      return top === undefined ? false : top(i);
    },
    back,
    focusOnControl: () => deps.focusOnControl(),
    band: () => profile.value?.ageBand ?? null,
  });

  const api: AppApi = {
    route: () => route.value,
    navigate: (to, opts) => go(to, opts?.replace === true),
    back,
    canGoBack: () => history.length > 0,
    store: deps.store,
    profile: () => profile.value,
    setProfile,
    saveProfile,
    readOnlyProfiles: () => readOnly,
    damagedProfiles: () => damaged,
    removeProfile,
    lessons: deps.lessons,
    lesson: lessonById,
    lastResult: () => play.lastResult(),
    onInput(fn) {
      handlers.push(fn);
      return () => {
        const i = handlers.lastIndexOf(fn);
        if (i !== -1) handlers.splice(i, 1);
      };
    },
    audio: deps.audio,
    whenReady,
    scene: () => deps.acquireScene(),
    recording: () => play.recording(),
  };

  if (deps.initialProfile) setProfile(deps.initialProfile);
  else applySettings(deviceSettings());
  enter(route.value);

  return {
    api,
    route,
    profile,
    playStatus,
    notices,
    badgeToasts,
    play,
    hud: deps.hud,
    router,
    onSaveProblem(p) {
      if (p.kind === "newerVersion" && p.profileId !== null) readOnly.add(p.profileId);
      if (p.kind === "unreadable" && p.profileId !== null) damaged.add(p.profileId);
      notify(p.kind);
    },
    queueBadges,
    nextBadgeToast() {
      badgeToasts.value = badgeToasts.value.slice(1);
    },
    dismissNotice(id) {
      notices.value = notices.value.filter((n) => n.id !== id);
    },
    quitPlay() {
      play.quit();
      go({ id: "map" }, true);
    },
    async ready() {
      // A settled promise can start more work (a screen loads, then its assets); wait until quiet.
      while (pending.size > 0) await Promise.all(pending);
    },
  };
}
