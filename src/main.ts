/**
 * Entry point (task M2-10): boots the app shell.
 *
 * Order: debug params → save store (fixture profile under `?profile`) → shell → keyboard, Caps
 * Lock watcher and audio unlock → render. Test hooks (`contracts.md` §13) load only when
 * `import.meta.env.MODE !== "production"`; Vite replaces that with a constant, so the production
 * bundle drops the hooks entirely (checked by `tools/check-dist-hooks.ts` after every build).
 */
import "@/ui/theme/tokens.css";
import "@/ui/theme/fonts.css";
import "@/ui/theme/motion.css";
import "@/ui/theme/high-contrast.css";
import { h, render } from "preact";
import { App } from "@/app/App";
import { realClock, fixedStepClock } from "@/app/clock";
import { parseDebugParams } from "@/app/debug";
import { createHudStore } from "@/app/hud";
import { screens } from "@/app/routes";
import { loadScreen } from "@/app/screen-cache";
import type { Route } from "@/app/routes";
import { createSceneHost, renderCoreFactory } from "@/app/scene-host";
import { createShell } from "@/app/shell";
import { createAudio } from "@/audio/engine";
import { lessons } from "@/content/lessons";
import { attachKeyboard, capsLockOn } from "@/input/keyboard";
import { resolveMode } from "@/modes/registry";
import { isProfile } from "@/save/schema";
import type { Profile } from "@/save/schema";
import { createIdbStore, createMemoryStore } from "@/save/store";
import type { SaveStore } from "@/save/store";
import { browserLocks, guardedStore, openTabChannel } from "@/save/tab-sync";
import type { TabSync } from "@/save/tab-sync";
import { newId } from "@/save/id";
import type { SaveProblem } from "@/save/problems";
import type { Settings } from "@/save/settings";
import type { QualityLevel } from "@/types/core";
import { guardHeldActivation } from "@/a11y/key-repeat";
import { appMotion } from "@/a11y/motion";
import { applyPageSettings } from "@/a11y/page";
import { attachRouteAnnouncer } from "@/a11y/route-announcer";
import { browserVoices, watchLocalVoice } from "@/a11y/voice";
import { announce } from "@/ui/kit/announce";

const PRODUCTION = import.meta.env.MODE === "production";
const INTERACTIVE = "button, a[href], input, select, textarea, [role='button'], [tabindex]";

/** The scene camera's world position and rotation, for e2e checks (shake, drift). */
function cameraPose(
  cam: {
    position: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
  } | null,
): { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number } | null {
  if (cam === null) return null;
  const { position: p, quaternion: q } = cam;
  return { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
}

/** `exactOptionalPropertyTypes`: no `locks` key at all when the browser has none. */
const withLocks = (locks: TabSync["locks"] | null): Pick<TabSync, "locks"> =>
  locks === null || locks === undefined ? {} : { locks };

/** `?profile=<fixture>`: a test fixture in a throwaway store. Not in production builds. */
async function fixtureProfile(name: string): Promise<unknown> {
  if (PRODUCTION) return null;
  const files = import.meta.glob<{ default: unknown }>("/tests/fixtures/profiles/*.json");
  const load = files[`/tests/fixtures/profiles/${name}.json`];
  return load ? (await load()).default : null;
}

async function boot(host: HTMLElement): Promise<void> {
  const debug = parseDebugParams(window.location.search, PRODUCTION);
  const root = document.documentElement;

  let onProblem: ((p: SaveProblem) => void) | null = null;
  const storeOptions = { onProblem: (p: SaveProblem) => onProblem?.(p) };
  const memory = debug.nosave || debug.profile !== null;
  // Two-tab safety (M3-FIX-9): only the shared IndexedDB store; a memory store is this tab's own.
  // Messages and locks stay inside this browser. Nothing is sent off the device.
  const tabs: TabSync | undefined = memory
    ? undefined
    : { tabId: newId(), channel: openTabChannel(), ...withLocks(browserLocks()) };
  const store: SaveStore =
    tabs === undefined
      ? createMemoryStore(storeOptions)
      : guardedStore(createIdbStore(undefined, storeOptions), tabs);

  let firstProfile: Profile | null = null;
  if (debug.profile !== null) {
    const raw = await fixtureProfile(debug.profile);
    if (isProfile(raw)) {
      await store.save(raw);
      firstProfile = await store.load(raw.id);
    } else {
      console.warn(`[app] no fixture profile "${debug.profile}"`);
    }
  }

  // One canvas for the whole app, outside Preact so screen changes never remount it.
  const canvas = document.createElement("canvas");
  canvas.className = "vt-stage";
  canvas.hidden = true;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%" });
  const ui = document.createElement("div");
  ui.className = "vt-ui";
  host.replaceChildren(canvas, ui);

  const hud = createHudStore();
  const audio = createAudio();
  // One reduced-motion flag for the app; 'system' keeps following the OS while the game runs.
  const motion = appMotion();

  const scenes = createSceneHost(canvas, renderCoreFactory, {
    seed: debug.seed ?? 1,
    quality: debug.quality ?? "medium",
    reducedMotion: () => motion.reduced(),
    // Under ?freeze only the frame loop reads this clock; input keeps the real one.
    clock: debug.freeze ? fixedStepClock(0, 16) : realClock,
    frozen: debug.freeze,
  });

  // Picture quality (Settings → Look, M3-08): `?quality` wins; 'auto' is medium until M6 measures.
  const qualityFor = (s: Readonly<Settings>): QualityLevel =>
    debug.quality ?? (s.quality === "auto" ? "medium" : s.quality);
  let quality: QualityLevel = debug.quality ?? "medium";
  let sceneQuality: QualityLevel = quality;
  const syncQuality = (): void => {
    const scene = scenes.current();
    if (scene === null || sceneQuality === quality) return;
    sceneQuality = quality;
    scene.setQuality(quality);
  };

  const initial: Route = { id: debug.screen ?? "splash" };
  if (debug.lesson !== null) initial.lesson = debug.lesson;

  const shell = createShell({
    store,
    lessons,
    resolveMode,
    acquireScene: () =>
      scenes.acquire().then((scene) => {
        syncQuality();
        return scene;
      }),
    hud,
    audio,
    clock: realClock,
    nextSeed: () => debug.seed ?? Math.floor(Math.random() * 2 ** 32),
    frozen: debug.freeze,
    away: () => document.hidden || !document.hasFocus(),
    record: debug.record,
    applySettings(s) {
      // Theme, letter size, motion (CSS and the shared flag) and font (src/a11y/page.ts).
      applyPageSettings(root, s);
      quality = qualityFor(s);
      syncQuality();
    },
    focusOnControl: () => document.activeElement?.matches(INTERACTIVE) === true,
    showCanvas(on) {
      canvas.hidden = !on;
    },
    preloadScreen(id) {
      // A failed fetch here is tried again when the screen is shown.
      const loader = screens[id];
      if (loader !== undefined) loadScreen(loader).catch(() => undefined);
    },
    initial,
    initialProfile: firstProfile,
    ...(tabs && { tabs }),
  });
  onProblem = (p) => shell.onSaveProblem(p);

  // A motion change (the setting, or the OS mid-game) redraws, so drift stops or starts at once.
  const offMotion = motion.subscribe(() => scenes.current()?.requestRender());
  // A held Enter presses a control once (PLAN.md §4.6).
  const offRepeat = guardHeldActivation(window);
  // Screen names and lesson results for screen readers; never per keystroke.
  const offAnnounce = attachRouteAnnouncer({
    route: shell.route,
    hasScreen: (id) => screens[id] !== undefined,
    lesson: (id) => shell.api.lesson(id),
    lastResult: () => shell.play.lastResult(),
    band: () => shell.profile.value?.ageBand ?? null,
    say: (text) => {
      announce(document, text);
    },
  });
  // "Hear it again" shows only with an English voice on the device (decision 69).
  const voice = watchLocalVoice(browserVoices());

  // Input: always the real clock, also under ?freeze (contracts §13).
  const detachKeys = attachKeyboard(
    window,
    realClock,
    (i) => shell.router.handle(i),
    () => shell.router.ctx(),
  );
  const onGesture = (e: Event): void => {
    // Audio unlocks only from a real gesture; calling it on every gesture is safe.
    void audio.unlock();
    if (e instanceof KeyboardEvent) {
      const caps = capsLockOn(e);
      if (hud.get().capsLock !== caps) hud.set({ capsLock: caps });
    }
  };
  window.addEventListener("keydown", onGesture, { capture: true });
  window.addEventListener("pointerdown", onGesture, { capture: true });
  window.addEventListener("pagehide", (e) => {
    if (e.persisted) return;
    detachKeys();
    offMotion();
    offRepeat();
    offAnnounce();
    voice.dispose();
    window.removeEventListener("keydown", onGesture, { capture: true });
    window.removeEventListener("pointerdown", onGesture, { capture: true });
    scenes.dispose();
  });

  render(h(App, { shell, localVoice: voice.available }), ui);

  if (!PRODUCTION) {
    const hooks = await import("@/app/test-hooks");
    hooks.installTestHooks(window, {
      screen: () => shell.route.value.id,
      session: () => shell.play.session(),
      lastResult: () => shell.play.lastResult(),
      profile: () => shell.profile.value,
      fps: () => shell.play.fps(),
      ready: () => shell.ready(),
      drawCalls: () => scenes.current()?.renderStats().calls ?? null,
      camera: () => cameraPose(scenes.current()?.three?.camera ?? null),
    });
  }
  host.dataset["ready"] = "1";
}

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  boot(app).catch((err: unknown) => {
    console.error("[app] boot failed", err);
  });
}
