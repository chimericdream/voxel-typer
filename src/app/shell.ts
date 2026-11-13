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
import { BUILDER_LESSON, BUILDER_LESSON_ID } from "@/modes/builder/lesson";
import { PLACEMENT_LESSON, PLACEMENT_LESSON_ID } from "@/modes/placement/lesson";
import type { ModeModule } from "@/modes/types";
import { compactHistory } from "@/save/compact";
import type { SaveProblem, SaveProblemKind } from "@/save/problems";
import type { Profile } from "@/save/schema";
import { defaultSettings } from "@/save/settings";
import type { Settings } from "@/save/settings";
import { NewerSaveError, StaleSaveError } from "@/save/store";
import type { SaveStore } from "@/save/store";
import type { TabSync } from "@/save/tab-sync";
import type { AchievementDef } from "@/engine/achievements";
import type { AchievementId, GameModeId } from "@/types/core";
import { createAchievementTracker } from "./achievements";
import { createBreakReminder } from "./break-reminder";
import type { Clock } from "./clock";
import type { HudStore } from "./hud";
import { createInputRouter } from "./input-router";
import type { InputRouter } from "./input-router";
import { createPlayHost } from "./play-host";
import { remedialById } from "./recommend";
import type { PlayHost, PlayStatus } from "./play-host";
import type { Route, RouteId } from "./routes";
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
  /**
   * Fetches a screen's code ahead of time (M4-FIX-7). A lesson asks for the screen it ends on as
   * it starts, so that screen draws at once when it comes: fetched only then, a slow server (one
   * stall was 10 s) left the child looking at an empty page. Optional; tests leave it out.
   */
  preloadScreen?(id: RouteId): void;
  initial?: Route;
  /** A profile to start with (`?profile=` fixtures). Set before the first route is entered, so a
   * deep link straight into `play` finds it. */
  initialProfile?: Profile | null;
  /** The device's offset from UTC in minutes (`Date#getTimezoneOffset`). Default: the real one. */
  tzOffsetMin?(): number;
  /**
   * Two-tab safety (M3-FIX-9): the tab channel and locks. Set for the real IndexedDB store only;
   * a memory store belongs to one tab. Without it, saves work as before.
   */
  tabs?: TabSync;
}

/**
 * Why a notice shows: a save problem, or another tab changed this player (M3-FIX-9). `otherTab`:
 * this tab now shows the newest copy. `otherTabRemoved`: a grown-up removed the player there.
 */
export type NoticeKind = SaveProblemKind | "otherTab" | "otherTabRemoved";

/** A kind message for the family, shown as a toast. */
export interface Notice {
  id: number;
  kind: NoticeKind;
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

/** A profile as the store keeps it (JSON, history compacted), to compare with the stored one. */
const recordOf = (p: Profile): string => JSON.stringify(compactHistory(p));

/** The Home Island is Builder mode on the play route (M4-07); `island` is its address. */
const homeIsland = (to: Route): Route =>
  to.id === "island" ? { id: "play", lesson: BUILDER_LESSON_ID } : to;

/**
 * The screen a finished lesson goes to: Results, except Builder (no Results: back to the map,
 * M4-07) and the placement test (its own screen, M3-05).
 */
export function endScreenOf(lesson: string | undefined): RouteId {
  if (lesson === BUILDER_LESSON_ID) return "map";
  if (lesson === PLACEMENT_LESSON_ID) return "placement";
  return "results";
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
  const placementOffered = new Set<string>();
  let noticeId = 0;

  const notify = (kind: NoticeKind): void => {
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

  // Two-tab safety (M3-FIX-9). With `tabs`, every save is `store.saveIfUnchanged`: it writes only
  // if the stored record is still the one this tab last wrote or read, checked inside the write's
  // own transaction. If another tab saved since, this tab takes that newer copy: a lesson result,
  // badges or a Builder save is added to it again (`updateProfile`), and a plain save made from
  // the old copy is refused. A player removed elsewhere is never written back. A damaged record
  // is nobody's save, so the store lets this tab's save repair it. The other tab's message makes
  // the same happen at once, so the screen shows the newest progress too.
  const tabs = deps.tabs ?? null;
  /** Per player: the stored record (JSON) this tab last wrote or read. Tabs mode only. */
  const known = new Map<string, string>();
  /** Players removed in another tab: never written again from this tab (until picked again). */
  const gone = new Set<string>();
  /** Bumped whenever this tab takes another tab's copy: plain saves asked for before are stale. */
  let generation = 0;
  let chain: Promise<unknown> = Promise.resolve();

  /** This tab's saves, one at a time, so `known` always matches the last write. */
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    whenReady(next);
    return next;
  };

  /** True while the Home Island visit is the route. */
  const onIsland = (): boolean => {
    const r = route.value;
    return r.id === "play" && r.lesson === BUILDER_LESSON_ID;
  };

  /** Takes another tab's copy of a player (null: removed there). */
  const adopt = (id: string, fresh: Profile | null, record: string | null): void => {
    generation += 1;
    const active = profile.value?.id === id ? profile.value : null;
    if (fresh === null) {
      gone.add(id);
      known.delete(id);
      if (active === null) return;
      setProfile(null);
      notify("otherTabRemoved");
      go({ id: "profiles" }, true);
      return;
    }
    known.set(id, record ?? recordOf(fresh));
    if (active === null) return;
    setProfile(fresh);
    notify("otherTab");
    // Builder holds its own island, and two islands can't be merged, so this visit ends. Its
    // last save keeps the other tab's island and inventory (`patchOnto` in the play host).
    if (onIsland() && JSON.stringify(active.island) !== JSON.stringify(fresh.island)) {
      go({ id: "map" }, true);
    }
  };

  /** Looks again after another tab's message. */
  const refresh = (id: string): Promise<void> =>
    serial(async () => {
      if (profile.value?.id !== id) return;
      const fresh = await deps.store.load(id);
      if (fresh === null) return; // A removal says so itself; newer and damaged: `save` decides.
      const record = recordOf(fresh);
      if (record !== known.get(id)) adopt(id, fresh, record);
    });

  /** Picks a player from outside (the Players screen, an import, a fixture). */
  const pick = (p: Profile | null): void => {
    if (tabs !== null && p !== null && p !== profile.value) {
      known.set(p.id, recordOf(p));
      gone.delete(p.id);
    }
    setProfile(p);
  };

  type Put = { kind: "saved" } | { kind: "failed" } | { kind: "stale"; fresh: Profile | null };

  /** One write. A stale one is adopted here; a failed one was reported. */
  const put = async (p: Profile): Promise<Put> => {
    if (readOnly.has(p.id)) return { kind: "failed" };
    const expected = tabs === null ? undefined : known.get(p.id);
    try {
      if (expected === undefined) {
        await deps.store.save(p);
        if (tabs !== null) known.set(p.id, recordOf(p));
      } else {
        known.set(p.id, await deps.store.saveIfUnchanged(p, expected));
      }
      return { kind: "saved" };
    } catch (err) {
      if (err instanceof StaleSaveError) {
        adopt(p.id, err.current, err.record);
        return { kind: "stale", fresh: err.current };
      }
      // Autosave never crashes the game and never retries in a loop (M1-09 notes).
      if (err instanceof NewerSaveError) {
        readOnly.add(p.id);
        notify("newerVersion");
      } else {
        console.warn("[app] save failed", err);
        notify("storageError");
      }
      return { kind: "failed" };
    }
  };

  const saveProfile = async (p: Profile): Promise<boolean> => {
    setProfile(p);
    if (tabs === null) return (await put(p)).kind === "saved";
    const asked = generation;
    return serial(async () => {
      // Made from a copy that another tab's newer one has since replaced here: not written.
      if (asked !== generation || gone.has(p.id)) return false;
      return (await put(p)).kind === "saved";
    });
  };

  /**
   * A safety ceiling on adding one change to a newer copy. Each stale try means another tab
   * saved real progress, so the loop always ends in practice; giving up after 5 tries silently
   * lost lessons under contention (M3-FIX-9 re-review B3). If it is ever hit, the change stays
   * on screen and the child is told the save failed, never shown progress that wasn't kept.
   */
  const MAX_TRIES = 1000;

  const updateProfile = async (
    base: Profile,
    derive: (b: Profile) => Profile | null,
  ): Promise<Profile | null> => {
    const id = base.id;
    const now = (): Profile => (profile.value?.id === id ? profile.value : base);
    if (tabs === null) {
      const next = derive(now());
      if (next === null) return null;
      return (await saveProfile(next)) ? next : null;
    }
    return serial(async () => {
      let from = now();
      for (let i = 0; i < MAX_TRIES; i++) {
        if (gone.has(id)) return null;
        const next = derive(from);
        if (next === null) return null;
        const out = await put(next);
        if (out.kind === "stale") {
          if (out.fresh === null) return null;
          from = profile.value?.id === id ? profile.value : out.fresh;
          continue;
        }
        // Saved, or kept on screen after a failed write (the next save tries again). Never switch
        // the tab back to this player if the child picked another one meanwhile (re-review N2).
        if (profile.value === null || profile.value.id === id) setProfile(next);
        return out.kind === "saved" ? next : null;
      }
      console.warn("[app] save gave up after", MAX_TRIES, "tries");
      notify("storageError");
      return null;
    });
  };

  const removeProfile = async (id: string): Promise<boolean> => {
    if (readOnly.has(id)) return false;
    try {
      await deps.store.remove(id);
      known.delete(id);
    } catch (err) {
      console.warn("[app] remove failed", err);
      notify("storageError");
      return false;
    }
    damaged.delete(id);
    if (profile.value?.id === id) setProfile(null);
    return true;
  };

  // A remedial practice lesson (M3-06) is not shipped: the map handed it out, so ask for it there.
  const lessonById = (id: string): Lesson | null =>
    deps.lessons.find((l) => l.id === id) ?? remedialById(id);

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
    updateProfile,
    lessons: deps.lessons,
    onStatus(s) {
      playStatus.value = s;
    },
    onFinished(_result, _updated) {
      const current = route.value;
      if (current.id !== "play") return;
      const next: Route = { id: endScreenOf(current.lesson) };
      if (next.id !== "map" && current.lesson !== undefined) next.lesson = current.lesson;
      go(next, true);
    },
  });

  const enter = (to: Route): void => {
    // The world map draws its islands in the shared scene too (M3-04).
    deps.showCanvas(to.id === "play" || to.id === "map");
    if (to.id !== "play") return;
    deps.preloadScreen?.(endScreenOf(to.lesson));
    const lesson =
      to.lesson === PLACEMENT_LESSON_ID
        ? PLACEMENT_LESSON
        : to.lesson === BUILDER_LESSON_ID
          ? BUILDER_LESSON
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

  function go(target: Route, replace: boolean): void {
    const to = homeIsland(target);
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
    setProfile: pick,
    saveProfile,
    readOnlyProfiles: () => readOnly,
    damagedProfiles: () => damaged,
    placementOffered: () => placementOffered,
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

  tabs?.channel?.listen((m) => {
    if (m.from === tabs.tabId) return;
    const active = profile.value?.id ?? null;
    if (m.type === "changed") {
      // An import there: any player may have changed. Look again at the one on screen.
      for (const id of known.keys()) if (id !== active) known.delete(id);
      if (active !== null) void refresh(active);
      return;
    }
    if (m.type === "removed") {
      if (m.id === active) {
        void serial(() => {
          adopt(m.id, null, null);
          return Promise.resolve();
        });
      } else {
        gone.add(m.id);
        known.delete(m.id);
      }
      return;
    }
    // Saved there. An import can bring back a player removed earlier.
    gone.delete(m.id);
    if (m.id === active) void refresh(m.id);
    else known.delete(m.id);
  });

  if (deps.initialProfile) pick(deps.initialProfile);
  else applySettings(deviceSettings());
  route.value = homeIsland(route.value);
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
