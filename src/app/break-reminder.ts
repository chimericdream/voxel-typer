/**
 * Break reminder (PLAN.md §4.1, task M2-10): after `settings.breakReminderMin` minutes of active
 * play, a kind "stretch break" shows at the next target boundary, never mid-word.
 *
 * Active time counts only frames of live, unpaused play, and it carries over from one lesson to
 * the next, so a child who plays five short lessons in a row still gets the reminder.
 */
import type { Ms } from "@/types/core";

export interface BreakReminder {
  /** Adds live play time. */
  add(dtMs: Ms): void;
  /** True when a break is due for a reminder every `minutes` minutes (0 = off). */
  due(minutes: number): boolean;
  /** The break was shown: start counting again. */
  reset(): void;
  activeMs(): Ms;
}

export function createBreakReminder(): BreakReminder {
  let active = 0;
  return {
    add(dtMs) {
      if (Number.isFinite(dtMs) && dtMs > 0) active += dtMs;
    },
    due: (minutes) => minutes > 0 && active >= minutes * 60_000,
    reset() {
      active = 0;
    },
    activeMs: () => active,
  };
}
