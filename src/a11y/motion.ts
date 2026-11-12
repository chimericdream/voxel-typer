/**
 * Reduced motion, one flag for the whole app (task M3-07, PLAN.md §4.6).
 *
 * `Settings.reducedMotion` is `true`, `false` or `'system'`; `'system'` follows the OS's
 * `prefers-reduced-motion` and keeps following it while the game runs (the media query is watched,
 * not read once). The shell sets the profile's value with {@link setMotionSetting}; everything that
 * moves asks {@link reducedMotion}, which is cheap enough to call every frame.
 *
 * What reads it:
 * - the scene (`src/main.ts` → `createSceneHost({ reducedMotion })`): camera drift and shake,
 *   hit-stop, glides, water wobble, cloud drift and the sun's glide (`src/render/`);
 * - Mine mode's swing, wobble and slide (`src/modes/mine/`) and the map's lift and camera moves
 *   (`WorldMap.tsx` → `prefersReducedMotion` in `src/ui/screens/nav.ts`, which calls this);
 * - CSS: `data-motion` on `<html>` and `--motion-ok` (`tokens.css`, `motion.css`).
 *
 * A screen with its own wobble (M3-FIX-1's locked islands) uses the same flag: call
 * `reducedMotion()` (or `prefersReducedMotion` from `nav.ts`) and, for CSS, multiply durations by
 * `--motion-ok`.
 */
import type { Settings } from "@/save/settings";

export type MotionSetting = Settings["reducedMotion"];

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** `true`/`false` win; `'system'` (or nothing) follows the OS. */
export function resolveReducedMotion(
  setting: MotionSetting | undefined,
  systemReduces: boolean,
): boolean {
  if (setting === true || setting === false) return setting;
  return systemReduces;
}

/** The subset of `window` the flag needs; tests pass a fake. */
export interface MotionHost {
  matchMedia?(query: string): Pick<MediaQueryList, "matches"> & {
    addEventListener?(type: "change", fn: () => void): void;
    removeEventListener?(type: "change", fn: () => void): void;
  };
}

export interface MotionFlag {
  /** True when motion should be reduced right now. */
  reduced(): boolean;
  /** The profile's setting (`'system'` before any profile). */
  setting(): MotionSetting;
  setSetting(s: MotionSetting): void;
  /** What the OS says, read live. */
  systemReduces(): boolean;
  /** Called when {@link reduced} changes, from either the setting or the OS. Returns unsubscribe. */
  subscribe(fn: (reduced: boolean) => void): () => void;
  dispose(): void;
}

export function createMotionFlag(host: MotionHost | null): MotionFlag {
  const media =
    typeof host?.matchMedia === "function" ? host.matchMedia(REDUCED_MOTION_QUERY) : null;
  let setting: MotionSetting = "system";
  const listeners = new Set<(reduced: boolean) => void>();
  const systemReduces = (): boolean => media?.matches === true;
  const reduced = (): boolean => resolveReducedMotion(setting, systemReduces());
  let last = reduced();

  const check = (): void => {
    const now = reduced();
    if (now === last) return;
    last = now;
    for (const fn of listeners) fn(now);
  };
  media?.addEventListener?.("change", check);

  return {
    reduced,
    setting: () => setting,
    setSetting(s) {
      setting = s;
      check();
    },
    systemReduces,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      media?.removeEventListener?.("change", check);
      listeners.clear();
    },
  };
}

let app: MotionFlag | null = null;

/** The app's flag, made on first use from `window` (no `window`: never reduced unless set). */
export function appMotion(): MotionFlag {
  app ??= createMotionFlag(typeof window === "undefined" ? null : window);
  return app;
}

/** Sets the active profile's `reducedMotion` (the shell does this on every settings change). */
export function setMotionSetting(s: MotionSetting): void {
  appMotion().setSetting(s);
}

/**
 * True when motion should be reduced. With `setting`, resolves that value against the OS (for a
 * caller holding a profile); without it, uses the app's current setting.
 */
export function reducedMotion(setting?: MotionSetting): boolean {
  const flag = appMotion();
  return setting === undefined
    ? flag.reduced()
    : resolveReducedMotion(setting, flag.systemReduces());
}
