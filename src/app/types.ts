/**
 * What screens get from the app shell (task M2-10). Screens live in `src/ui/screens/` and receive
 * {@link ScreenProps}. This is app API, not a frozen contract; M2-10's handoff note documents it.
 */
import type { AudioApi } from "@/audio/types";
import type { Lesson } from "@/content/lessons/types";
import type { KeyInput } from "@/engine/types";
import type { ControlInput, TypedInput } from "@/input/keyboard";
import type { ModeResult } from "@/modes/types";
import type { Profile } from "@/save/schema";
import type { SaveStore } from "@/save/store";
import type { Route } from "./routes";
import type { AppScene } from "./scene-host";

/** A screen's key handler. Return true when the screen used the input. */
export type ScreenInputHandler = (i: TypedInput | ControlInput) => boolean;

export interface AppApi {
  /** The current route. */
  route(): Route;
  /** Goes to `to`. `replace` swaps the current history entry instead of pushing one. */
  navigate(to: Route, opts?: { replace?: boolean }): void;
  /** The previous route, or splash when there is none. */
  back(): void;
  canGoBack(): boolean;
  /** Persistence. Prefer {@link AppApi.saveProfile} for saves: it never rejects. */
  readonly store: SaveStore;
  /** The active profile, or null before one is picked. */
  profile(): Profile | null;
  /** Makes `p` the active profile and applies its settings (theme, text size, motion). */
  setProfile(p: Profile | null): void;
  /**
   * Saves `p` and makes it the active profile. Never rejects: problems become a kind notice.
   * Resolves false when nothing was written (for example a newer build owns this save).
   */
  saveProfile(p: Profile): Promise<boolean>;
  /**
   * Ids of profiles a newer build of the game wrote (`NewerSaveError`, or a `newerVersion` load
   * problem). They are read-only for this session: shown, never saved over.
   */
  readOnlyProfiles(): ReadonlySet<string>;
  /**
   * Ids of profiles whose records the store could not read at all (`unreadable` load problem,
   * M3-09). They still take one of the 8 slots until a grown-up removes them.
   */
  damagedProfiles(): ReadonlySet<string>;
  /**
   * Deletes a profile and its `<id>:prev` snapshot (M3-09). Refuses a read-only profile (a newer
   * build owns it). If it was the active profile, no profile is active afterwards. Never rejects:
   * resolves false, with a kind notice, when nothing was removed.
   */
  removeProfile(id: string): Promise<boolean>;
  /** Every shipped lesson. */
  readonly lessons: readonly Lesson[];
  lesson(id: string): Lesson | null;
  /** The result of the last finished lesson, for the Results screen. */
  lastResult(): ModeResult | null;
  /**
   * Keys while this screen is shown (menus only; play input goes to the mode). Unhandled `back`
   * goes to {@link AppApi.back}. Returns the unsubscribe function.
   */
  onInput(fn: ScreenInputHandler): () => void;
  /** Sound. Call `audio.unlock()` on the first key press (splash). */
  readonly audio: AudioApi;
  /** `__vt.ready()` also waits for this promise (screens that load assets). */
  whenReady(p: Promise<unknown>): void;
  /**
   * The app's one shared 3D scene, made on first use (M3-04). The canvas is shown on the `play`
   * and `map` routes. A screen that draws in it adds its own objects and removes them when it
   * unmounts; it never disposes the scene. Rejects when there is no WebGL.
   */
  scene(): Promise<AppScene>;
  /** Keys typed in the last lesson when `?record=1` is on, else null. */
  recording(): KeyInput[] | null;
}

export interface ScreenProps {
  app: AppApi;
  route: Route;
}
