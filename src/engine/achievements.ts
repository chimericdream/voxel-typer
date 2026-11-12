/**
 * Achievements framework (task M3-10, PLAN.md §3.3). Pure: no clock, no randomness, no DOM.
 *
 * An achievement is data plus a `check(ctx)` predicate. The context is the profile, the latest
 * result, the curriculum, aggregates of the session's engine events, and when the session started
 * (an epoch time and the device's time-zone offset, both captured by the impure shell). The
 * definitions live in `src/content/achievements/<area>.ts`.
 *
 * Unlocks are stored in `Profile.achievements` (id → unlock time); nothing ever re-locks.
 */
import type { MessageKey } from "@/i18n";
import type { Lesson } from "@/content/lessons/types";
import type { ModeResult } from "@/modes/types";
import type { Profile } from "@/save/schema";
import type { AchievementId, AgeBand, BlockId, EpochMs, Ms } from "@/types/core";
import type { EngineEvent } from "./types";

/** What a badge shows: a block from the registry, or a cosmetic id. */
export type AchievementIcon = { block: BlockId } | { cosmetic: string };

/** The lesson facts achievements need. */
export type AchievementLesson = Pick<Lesson, "id" | "biome">;

/** Aggregates of one session's engine events. */
export interface EventAggregates {
  /** Longest run of right keys in a row. */
  longestStreak: number;
  /** Longest stretch of typing with no slip, in active ms (see {@link CLEAN_GAP_CAP_MS}). */
  bestCleanMs: Ms;
  /** Finished targets with at least {@link WORD_MIN_LETTERS} letters. */
  wordsCompleted: number;
  /** Most such words finished in a row with no slip in any of them. */
  bestCleanWordRun: number;
}

export interface AchievementContext {
  /** The profile, with the session already folded in (live checks: as it was at the start). */
  profile: Readonly<Profile>;
  /** The session's result; null for a live check during play. */
  result: ModeResult | null;
  /** The curriculum lesson just played, or null (placement, free play, live checks). */
  lesson: AchievementLesson | null;
  /** Every shipped curriculum lesson. */
  lessons: readonly AchievementLesson[];
  /** The session's engine events, aggregated. */
  events: EventAggregates;
  /**
   * When the session started, and the device's offset from UTC in minutes
   * (`Date#getTimezoneOffset`: positive west of Greenwich). Null when unknown.
   */
  when: { startedAt: EpochMs; tzOffsetMin: number } | null;
}

export interface AchievementDef {
  id: AchievementId;
  nameKey: MessageKey;
  descKey: MessageKey;
  /** Numbers for the description, when they depend on the age band (`{count}`). */
  descParams?: (band: AgeBand) => Record<string, number>;
  icon: AchievementIcon;
  /** Shown as a surprise until earned. */
  hidden?: boolean;
  /** Its check reads only `ctx.events`, so it may also run during play. */
  live?: boolean;
  check(ctx: AchievementContext): boolean;
}

/** A target with this many letters (spaces not counted) is a word. */
export const WORD_MIN_LETTERS = 3;
/**
 * A pause between two keys counts toward clean time up to this long, so a long think doesn't
 * fill a "clean minute", and a slow, careful typist still gets every key's worth.
 */
export const CLEAN_GAP_CAP_MS = 5000;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function emptyAggregates(): EventAggregates {
  return { longestStreak: 0, bestCleanMs: 0, wordsCompleted: 0, bestCleanWordRun: 0 };
}

export interface EventAggregator {
  add(e: EngineEvent): void;
  /** A copy of the aggregates so far. */
  value(): EventAggregates;
}

/** Folds engine events into {@link EventAggregates}. Feed every event of one session in order. */
export function createEventAggregator(): EventAggregator {
  const agg = emptyAggregates();
  let cleanMs = 0;
  let lastT: Ms | null = null;
  let cleanWords = 0;
  /** Letters typed right so far per target: highest non-space index + 1. */
  const letters = new Map<string, number>();

  return {
    add(e) {
      switch (e.type) {
        case "correct": {
          if (lastT !== null) {
            cleanMs += Math.min(Math.max(0, e.t - lastT), CLEAN_GAP_CAP_MS);
            if (cleanMs > agg.bestCleanMs) agg.bestCleanMs = cleanMs;
          }
          lastT = e.t;
          if (e.char !== " ") {
            letters.set(e.targetId, Math.max(letters.get(e.targetId) ?? 0, e.index + 1));
          }
          break;
        }
        case "wrong":
          cleanMs = 0;
          lastT = e.t;
          break;
        case "streak":
          if (e.length > agg.longestStreak) agg.longestStreak = e.length;
          break;
        case "paused":
          lastT = null;
          break;
        case "resumed":
          lastT = e.t;
          break;
        case "targetComplete": {
          const n = letters.get(e.targetId) ?? 0;
          letters.delete(e.targetId);
          if (n < WORD_MIN_LETTERS) break;
          agg.wordsCompleted += 1;
          cleanWords = e.errors === 0 ? cleanWords + 1 : 0;
          if (cleanWords > agg.bestCleanWordRun) agg.bestCleanWordRun = cleanWords;
          break;
        }
        default:
          break;
      }
    },
    value: () => ({ ...agg }),
  };
}

/** Whole days since the epoch on the device's local calendar. */
export function localDayNumber(at: EpochMs, tzOffsetMin: number): number {
  return Math.floor((at - tzOffsetMin * MINUTE_MS) / DAY_MS);
}

/** The local hour (0–23) of `at`. */
export function localHour(at: EpochMs, tzOffsetMin: number): number {
  const ms = (((at - tzOffsetMin * MINUTE_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return Math.floor(ms / HOUR_MS);
}

/**
 * Ids in `defs` the profile hasn't earned yet whose check passes now, in `defs` order. With
 * `liveOnly`, only definitions marked `live` are checked.
 */
export function newlyUnlocked(
  defs: readonly AchievementDef[],
  ctx: AchievementContext,
  opts: { liveOnly?: boolean } = {},
): AchievementId[] {
  const out: AchievementId[] = [];
  for (const def of defs) {
    if (ctx.profile.achievements[def.id] !== undefined) continue;
    if (opts.liveOnly === true && def.live !== true) continue;
    if (def.check(ctx)) out.push(def.id);
  }
  return out;
}

/**
 * Blocks the player has ever found in play (`Profile.found`). A save from before the field existed
 * reads as a copy of its inventory: until the island editor, only loot ever reached it.
 */
export function foundBlocks(
  profile: Pick<Profile, "found" | "inventory">,
): Record<BlockId, number> {
  return { ...(profile.found ?? profile.inventory) };
}

/** The profile with `unlocks` added. An earlier unlock time always wins; nothing re-locks. */
export function withUnlocks(
  profile: Readonly<Profile>,
  unlocks: Readonly<Record<AchievementId, EpochMs>>,
): Profile {
  const add = Object.entries(unlocks).filter(([id]) => profile.achievements[id] === undefined);
  if (add.length === 0) return { ...profile };
  return { ...profile, achievements: { ...profile.achievements, ...Object.fromEntries(add) } };
}
