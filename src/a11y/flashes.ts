/**
 * The app's one shared flash guard (task M3-07, PLAN.md §4.6). Every effect that blinks on asks
 * {@link allowFlash} first, so two effects together still can't flash more than 3 times a second.
 *
 * It reads `performance.now()` (the input timebase). Tests use `createFlashGuard` from
 * `./flash-guard` with their own clock instead.
 */
import { createFlashGuard } from "./flash-guard";
import type { FlashGuard } from "./flash-guard";

export { FLASH_WINDOW_MS, MAX_FLASHES } from "./flash-guard";

const shared: FlashGuard = createFlashGuard();

/** True if a flash may start now (and counts it). False means: don't flash this time. */
export function allowFlash(now: number = performance.now()): boolean {
  return shared.tryFlash(now);
}

/** The shared guard, for code that plans ahead (`nextAllowedAt`). */
export function flashGuard(): FlashGuard {
  return shared;
}
