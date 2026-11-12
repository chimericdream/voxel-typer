/**
 * The flash guard (task M3-07, PLAN.md §4.6): "never flash more than 3 times a second".
 *
 * A flash is anything that blinks on: a key outline, a tint, a light that pops. Before showing one,
 * code asks the guard. The guard keeps the start times of the flashes it allowed and refuses a new
 * one while 3 already started in the last second (a sliding window, so 3 at the end of one second
 * and 3 at the start of the next can't make 6 in a blink).
 *
 * Pure: time comes in as a parameter (no clock reads here), so tests drive it with any clock.
 * `src/a11y/flashes.ts` holds the app's one shared guard on the real clock.
 */
import type { Ms } from "@/types/core";

/** At most this many flashes may start in any {@link FLASH_WINDOW_MS}. */
export const MAX_FLASHES = 3;
/** The window the limit applies to: one second. */
export const FLASH_WINDOW_MS: Ms = 1000;

export interface FlashGuard {
  /**
   * Asks to start a flash at `now`. Returns true (and counts it) if fewer than the limit started in
   * the window before `now`; otherwise false, and the caller must not flash.
   */
  tryFlash(now: Ms): boolean;
  /** The earliest time at or after `now` when {@link tryFlash} would say yes. Counts nothing. */
  nextAllowedAt(now: Ms): Ms;
  /** Forgets every flash (a new screen or lesson). */
  reset(): void;
}

export interface FlashGuardOptions {
  /** Default {@link MAX_FLASHES}. Clamped to at least 1. */
  max?: number;
  /** Default {@link FLASH_WINDOW_MS}. */
  windowMs?: Ms;
}

export function createFlashGuard(opts: FlashGuardOptions = {}): FlashGuard {
  const max = Math.max(1, Math.floor(opts.max ?? MAX_FLASHES));
  const windowMs = opts.windowMs ?? FLASH_WINDOW_MS;
  /** Start times of allowed flashes, oldest first; never more than `max`. */
  let starts: Ms[] = [];

  /** Drops flashes that left the window ending at `now`. A clock that went back resets the guard. */
  const prune = (now: Ms): void => {
    const last = starts.at(-1);
    if (last !== undefined && now < last) starts = [];
    starts = starts.filter((s) => now - s < windowMs);
  };

  return {
    tryFlash(now) {
      if (!Number.isFinite(now)) return false;
      prune(now);
      if (starts.length >= max) return false;
      starts.push(now);
      return true;
    },
    nextAllowedAt(now) {
      prune(now);
      if (starts.length < max) return now;
      // The oldest of the last `max` flashes must leave the window first.
      const oldest = starts[starts.length - max] ?? now;
      return oldest + windowMs;
    },
    reset() {
      starts = [];
    },
  };
}

/**
 * Plans a run of flashes wanted at `times` (any order): returns the times that may flash, in order,
 * after dropping any that would break the limit. For effects scheduled ahead (stars filling in one
 * by one, a blinking hint).
 */
export function planFlashes(times: readonly Ms[], opts: FlashGuardOptions = {}): Ms[] {
  const guard = createFlashGuard(opts);
  return times.toSorted((a, b) => a - b).filter((t) => guard.tryFlash(t));
}
