/**
 * Lessons and curriculum (docs/impl/contracts.md §6). Pure.
 *
 * Unlocks: completing a lesson (any stars) unlocks the next one in its biome. A biome's `mastery`
 * lesson with ≥ 2 stars unlocks the next biome in `BIOME_ORDER` (`caverns` unlocks both
 * `sparkstone` and `citadel`). The placement test can unlock up to the biome it estimates. Nothing
 * ever re-locks.
 */
import type { ContentKind } from "@/engine/generator";
import type { WrongKeyPolicy } from "@/engine/types";
import type { MessageKey } from "@/i18n";
import { BIOME_ORDER } from "@/types/core";
import type { AgeBand, BiomeId, GameModeId, LessonId } from "@/types/core";

/** One lesson of the curriculum. Lesson files export `lessons: Lesson[]`, one file per biome. */
export interface Lesson {
  id: LessonId;
  biome: BiomeId;
  /** Order within the biome, 1-based. */
  order: number;
  /** i18n key of the title. */
  titleKey: MessageKey;
  /** The keys this lesson introduces. */
  newKeys: string[];
  /**
   * Earlier keys this lesson emphasizes. The allowed set is wider: all keys up to this lesson
   * ({@link allowedKeysFor}).
   */
  reviewKeys: string[];
  kind: ContentKind;
  /** `WordPool` ids. Default: the pools tagged with the biome. */
  pools?: string[];
  length: { chars: number } | { targets: number } | { seconds: number };
  /**
   * The preferred mode. If that mode doesn't exist yet, `resolveMode` falls back to `mine`
   * (contracts §7.3).
   */
  mode: GameModeId;
  /** `wpmRelative` is a multiple of the learner's own baseline net WPM (see `engine/stars`). */
  targets: { accuracy: number; wpmRelative?: number };
  /** Default: sprout and miner `'stay'`, builder `'skip'`; sentences `'backspace'`. */
  policy?: Partial<Record<AgeBand, WrongKeyPolicy>>;
  /** Length multiplier. Default: sprout 0.6, miner 1, builder 1.3. */
  bandScale?: Partial<Record<AgeBand, number>>;
  tags?: ("mastery" | "boss" | "challenge-hide-keyboard" | "intro")[];
  /** Default: `['sprout']` for lessons before `'mines'`. */
  caseInsensitiveFor?: AgeBand[];
}

/**
 * The keys a learner may be asked to type in a lesson: the cumulative `newKeys` of all earlier
 * lessons in `BIOME_ORDER`, plus this lesson's own `newKeys`, each key once, in curriculum order.
 * Sparkstone is a side branch (README §8.5): its keys count for Sparkstone lessons, and for lessons
 * after it in `BIOME_ORDER` only when `opts.sparkstoneUnlocked`. Pure: callers pass the lesson
 * list (the app passes the glob aggregator's list, tools pass `lessonsFromModules` from `load.ts`).
 *
 * Throws when `lessonId` is not in `lessons`.
 */
export function allowedKeysFor(
  lessons: readonly Lesson[],
  lessonId: LessonId,
  opts?: { sparkstoneUnlocked?: boolean },
): string[] {
  const lesson = lessons.find((l) => l.id === lessonId);
  if (lesson === undefined) throw new Error(`allowedKeysFor: no lesson "${lessonId}"`);
  const rank = (l: Lesson): number => BIOME_ORDER.indexOf(l.biome) * 1000 + l.order;
  const upTo = rank(lesson);
  const sparkstone = BIOME_ORDER.indexOf("sparkstone");
  const at = BIOME_ORDER.indexOf(lesson.biome);
  const withSparkstone =
    at === sparkstone || (at > sparkstone && opts?.sparkstoneUnlocked === true);
  const keys: string[] = [];
  const add = (l: Lesson): void => {
    for (const k of l.newKeys) if (!keys.includes(k)) keys.push(k);
  };
  for (const l of lessons.toSorted((a, b) => rank(a) - rank(b))) {
    if (l.id === lesson.id || rank(l) > upTo) continue;
    if (l.biome === "sparkstone" && !withSparkstone) continue;
    add(l);
  }
  add(lesson);
  return keys;
}
