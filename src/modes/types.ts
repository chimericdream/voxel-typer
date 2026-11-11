/**
 * Game mode interfaces (docs/impl/contracts.md §7).
 *
 * A mode lives in `src/modes/<mode>/` and exports `mode: ModeModule` from its `index.ts`. The
 * registry (`./registry`) finds it; nobody edits a list.
 */
import type { Clock } from "@/app/clock";
import type { Emitter, GameEvents } from "@/app/events";
import type { AudioApi } from "@/audio/types";
import type { Lesson } from "@/content/lessons/types";
import type { Rng } from "@/engine/rng";
import type { SessionSummary } from "@/engine/stats";
import type { KeyInput } from "@/engine/types";
import type { SceneHandle } from "@/render/types";
import type { Profile } from "@/save/schema";
import type { Settings } from "@/save/settings";
import type { AgeBand, BlockId, GameModeId, Ms } from "@/types/core";
import type { HudBridge } from "@/ui/hud/bridge";

/**
 * The small, always-loaded handle of a mode. Keep `index.ts` light: the mode's real code sits
 * behind `load()`.
 */
export interface ModeModule {
  id: GameModeId;
  /** A dynamic import, so the mode stays out of the initial bundle. */
  load(): Promise<{ create(ctx: ModeContext): ModeInstance }>;
}

/** Everything a mode gets from the app. Modes reach the outside world only through this. */
export interface ModeContext {
  /** `null` for free play (builder, daily, practice) with ad-hoc params. */
  lesson: Lesson | null;
  /** Mode-specific extras, e.g. the daily seed or custom text. */
  params: Record<string, unknown>;
  profile: Readonly<Profile>;
  settings: Readonly<Settings>;
  band: AgeBand;
  /** Seeded. Use it (or a `fork`) for all randomness. */
  rng: Rng;
  /** The only source of time (contracts §13). */
  clock: Clock;
  /** Rendering (contracts §8). */
  scene: SceneHandle;
  /** The HUD (contracts §10). */
  hud: HudBridge;
  /** Sound (contracts §12). */
  audio: AudioApi;
  /** The game events bus (contracts §7.2). Re-emit every engine event on `engine`. */
  bus: Emitter<GameEvents>;
  /** Call exactly once, when the mode is over. The app then shows Results. */
  finish(result: ModeResult): void;
}

/** A running mode. The app drives it. */
export interface ModeInstance {
  start(): void;
  /** Already normalized. Escape and Tab never arrive here; the app handles them. */
  input(k: KeyInput): void;
  /** Called by the render loop while the mode is running. */
  frame(dtMs: Ms, t: Ms): void;
  pause(t: Ms): void;
  resume(t: Ms): void;
  /** Must release all GPU resources and listeners. */
  dispose(): void;
}

/** What a mode hands back through `ModeContext.finish`. */
export interface ModeResult {
  summary: SessionSummary;
  /** Block id → count earned. */
  loot: Record<BlockId, number>;
  /** 0 only for modes without stars (builder). */
  stars: 0 | 1 | 2 | 3;
  extra?: Record<string, unknown>;
}
