/**
 * Achievement tracking for the play host (task M3-10). The impure half of
 * `src/engine/achievements.ts`: it captures when a session starts and the device's time zone,
 * listens to the run's bus, runs a debounced live check after engine events, and evaluates every
 * achievement once the session is folded into the profile.
 *
 * Unlocks are reported through `onUnlock`; the shell queues their toasts and shows them only on
 * Results, a pause or another screen, never mid-word.
 */
import type { AchievementContext, AchievementDef, AchievementLesson } from "@/engine/achievements";
import { createEventAggregator, newlyUnlocked, withUnlocks } from "@/engine/achievements";
import type { ModeResult } from "@/modes/types";
import type { Profile } from "@/save/schema";
import type { AchievementId, EpochMs } from "@/types/core";
import type { Clock } from "./clock";
import type { Emitter, GameEvents } from "./events";

/** Quiet time after the last engine event before a live check runs. */
export const LIVE_CHECK_DEBOUNCE_MS = 600;

export interface AchievementTrackerDeps {
  /**
   * The definitions. The shell loads them lazily, to keep the block registry out of the first
   * bundle; until then this is empty and nothing unlocks (the next session catches up).
   */
  defs(): readonly AchievementDef[];
  /** The curriculum. */
  lessons: readonly AchievementLesson[];
  clock: Pick<Clock, "epoch">;
  /** `Date#getTimezoneOffset()` now. */
  tzOffsetMin(): number;
  /** Runs `fn` after `ms`; returns a cancel function. */
  schedule(fn: () => void, ms: number): () => void;
  /** New unlocks, in definition order. Called once per batch. */
  onUnlock(ids: readonly AchievementId[]): void;
}

export interface RunTracker {
  /**
   * Evaluates every achievement against `updated` (the profile with the session folded in) and
   * returns it with this run's unlocks added, live ones included. Stops listening.
   */
  finish(updated: Profile, result: ModeResult): Profile;
  /** Unlocks earned live in a run that was left early. Stops listening. */
  abandon(): Record<AchievementId, EpochMs>;
}

export interface AchievementTracker {
  /** Starts tracking one run. `lesson` is the curriculum lesson, or null (placement, free play). */
  begin(run: {
    profile: Readonly<Profile>;
    lesson: AchievementLesson | null;
    bus: Emitter<GameEvents>;
  }): RunTracker;
}

export function createAchievementTracker(deps: AchievementTrackerDeps): AchievementTracker {
  return {
    begin({ profile, lesson, bus }) {
      // Only a curriculum lesson counts as a lesson (not the placement test or free play).
      const known = lesson !== null && deps.lessons.some((l) => l.id === lesson.id) ? lesson : null;
      const when = { startedAt: deps.clock.epoch(), tzOffsetMin: deps.tzOffsetMin() };
      const agg = createEventAggregator();
      /** Unlocks earned live in this run. */
      const live: Record<AchievementId, EpochMs> = {};
      let cancel: (() => void) | null = null;
      let done = false;

      const ctxFor = (p: Readonly<Profile>, result: ModeResult | null): AchievementContext => ({
        profile: p,
        result,
        lesson: result === null ? null : known,
        lessons: deps.lessons,
        events: agg.value(),
        when,
      });

      const liveCheck = (): void => {
        cancel = null;
        if (done) return;
        const ids = newlyUnlocked(deps.defs(), ctxFor(withUnlocks(profile, live), null), {
          liveOnly: true,
        });
        if (ids.length === 0) return;
        const at = deps.clock.epoch();
        for (const id of ids) {
          live[id] = at;
          bus.emit("achievement", { id });
        }
        deps.onUnlock(ids);
      };

      const off = bus.on("engine", (e) => {
        if (done) return;
        agg.add(e);
        // Checks wait for a quiet moment, never inside a keystroke.
        if (e.type !== "targetComplete" && e.type !== "streakBroken" && e.type !== "paused") {
          return;
        }
        cancel?.();
        cancel = deps.schedule(liveCheck, LIVE_CHECK_DEBOUNCE_MS);
      });

      const stop = (): void => {
        done = true;
        cancel?.();
        cancel = null;
        off();
      };

      return {
        finish(updated, result) {
          stop();
          const base = withUnlocks(updated, live);
          const ids = newlyUnlocked(deps.defs(), ctxFor(base, result));
          if (ids.length === 0) return base;
          const at = deps.clock.epoch();
          deps.onUnlock(ids);
          return withUnlocks(base, Object.fromEntries(ids.map((id) => [id, at])));
        },
        abandon() {
          stop();
          return { ...live };
        },
      };
    },
  };
}
