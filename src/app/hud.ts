/**
 * The app's HUD state store (docs/impl/contracts.md §10), built on `@preact/signals`.
 *
 * M2-14 owns the HUD components and `src/ui/hud/bridge.ts`. Until it lands, the shell uses this
 * store so modes and the Caps Lock watcher have a working {@link HudBridge}. M2-14 can read
 * `state` from here, or swap in its own bridge in `main.ts`.
 */
import { signal } from "@preact/signals";
import type { ReadonlySignal } from "@preact/signals";
import type { HudBridge, HudState } from "@/ui/hud/bridge";

export function emptyHudState(): HudState {
  return {
    word: null,
    combo: 0,
    progress01: 0,
    nextKey: null,
    banner: null,
    capsLock: false,
    timer: null,
    custom: {},
  };
}

export interface HudStore extends HudBridge {
  /** The state as a signal, for components. */
  readonly state: ReadonlySignal<HudState>;
  /** Back to the empty state (between lessons). Keeps `capsLock`, which is about the keyboard. */
  reset(): void;
}

export function createHudStore(): HudStore {
  const state = signal<HudState>(emptyHudState());
  return {
    state,
    get: () => state.value,
    set(patch) {
      state.value = { ...state.value, ...patch };
    },
    reset() {
      state.value = { ...emptyHudState(), capsLock: state.value.capsLock };
    },
  };
}
