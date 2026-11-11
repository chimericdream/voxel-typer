/**
 * HUD bridge (docs/impl/contracts.md §10). Modes don't touch Preact: they push state through this
 * typed bridge, and the HUD components read it.
 *
 * The implementation uses `@preact/signals`. Calls are cheap; a mode may call `set` every frame.
 * Types only here; M2-14 implements the bridge.
 */
import type { TargetView } from "@/engine/types";
import type { MessageKey } from "@/i18n";
import type { Ms } from "@/types/core";

/** Everything the HUD shows during play. */
export interface HudState {
  /** The big word display (sequential modes). */
  word: { text: string; marks: TargetView["marks"]; typed: number } | null;
  /** The hotbar combo meter: 0–9 slots lit, `min(9, floor(streak / 3))`. */
  combo: number;
  /** The lesson progress bar, 0–1. */
  progress01: number;
  /** Drives the on-screen keyboard highlight and the hand overlay. */
  nextKey: string | null;
  /** A short message. Its text comes from `t(key, params)`; `cheer` is the celebratory tone. */
  banner: {
    key: MessageKey;
    params?: Record<string, string | number>;
    tone: "info" | "cheer";
  } | null;
  capsLock: boolean;
  /** Hidden for Sprout and in calm mode. */
  timer: { remainingMs: Ms } | null;
  /** Mode-specific widgets read their own slice. */
  custom: Record<string, unknown>;
}

/** How a mode talks to the HUD. */
export interface HudBridge {
  /** Merges `patch` into the state. Keys left out keep their value. */
  set(patch: Partial<HudState>): void;
  get(): Readonly<HudState>;
}
