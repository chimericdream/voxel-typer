/**
 * The app's one shared flash guard (task M3-07, PLAN.md §4.6). Every effect that blinks on asks
 * {@link allowFlash} first, so two effects together still can't flash more than 3 times a second.
 *
 * It reads `performance.now()` (the input timebase) itself, and only that: callers can't pass a
 * time, so no caller on another clock (a test clock, `?freeze`'s fixed-step clock) can make the
 * window look as if time went back and wipe it for everyone (M3-07 review N4). The guard also
 * refuses, rather than resets on, a backwards time. Tests use `createFlashGuard` from
 * `./flash-guard` with their own clock instead, or stub `performance.now`.
 */
import { createFlashGuard } from "./flash-guard";
import type { FlashGuard } from "./flash-guard";

export { FLASH_WINDOW_MS, MAX_FLASHES } from "./flash-guard";

const shared: FlashGuard = createFlashGuard({ backwards: "refuse" });

/** True if a flash may start now (and counts it). False means: don't flash this time. */
export function allowFlash(): boolean {
  return shared.tryFlash(performance.now());
}

/** The shared guard, for code that plans ahead (`nextAllowedAt`). */
export function flashGuard(): FlashGuard {
  return shared;
}
