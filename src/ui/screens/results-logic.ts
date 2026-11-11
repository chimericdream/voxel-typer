/**
 * The Results screen's choices, without the DOM (task M2-11): the message, the aim line, the
 * personal best and the next lesson. Every message is warm; none is negative (README.md §4.4).
 */
import type { Lesson } from "@/content/lessons/types";
import type { SessionSummary } from "@/engine/stats";
import { t } from "@/i18n";
import type { MessageKey } from "@/i18n";
import type { Profile } from "@/save/schema";
import type { AgeBand, LessonId } from "@/types/core";

const STAR_WORDS = ["zero", "one", "two", "three"] as const;

/** The warm line for a result. Sprout gets shorter, easier words. */
export function messageText(stars: 0 | 1 | 2 | 3, band: AgeBand): string {
  const word = STAR_WORDS[stars];
  return band === "sprout"
    ? t(`screens.results.sproutMessage.${word}`)
    : t(`screens.results.message.${word}`);
}

/** Accuracy (0–1) as a whole percent. */
export const percent = (accuracy: number): number =>
  Math.max(0, Math.min(100, Math.round((Number.isFinite(accuracy) ? accuracy : 0) * 100)));

/** "Great aim: 94%" style, for Miner and Builder. Sprout sees stars only (returns null). */
export function aimLine(accuracy: number, band: AgeBand): { key: MessageKey; pct: number } | null {
  if (band === "sprout") return null;
  const pct = percent(accuracy);
  if (pct >= 90) return { key: "screens.results.aimGreat", pct };
  if (pct >= 70) return { key: "screens.results.aimGood", pct };
  return { key: "screens.results.aim", pct };
}

/**
 * True when this run beat every earlier run of the lesson on speed or on aim. The first play is
 * never a "best": there is nothing to beat yet. `profile` is the profile after the result was
 * folded in, so its newest history entry for the lesson is this run.
 */
export function isPersonalBest(
  profile: Profile,
  lessonId: LessonId,
  summary: SessionSummary,
): boolean {
  const runs = profile.history.filter((h) => h.lessonId === lessonId);
  const earlier = runs.slice(0, -1);
  if (earlier.length === 0) return false;
  const bestWpm = Math.max(...earlier.map((h) => h.netWpm));
  const bestAcc = Math.max(...earlier.map((h) => h.accuracy));
  return summary.netWpm > bestWpm || summary.accuracy > bestAcc;
}

/** The next lesson in the same biome, or null at the end of the biome. */
export function nextLesson(lessons: readonly Lesson[], lesson: Lesson): Lesson | null {
  return lessons.find((l) => l.biome === lesson.biome && l.order === lesson.order + 1) ?? null;
}

/** Loot to show, largest stacks first (ties by id, so the order is stable). */
export function lootRows(loot: Readonly<Record<string, number>>): [string, number][] {
  return Object.entries(loot)
    .filter(([, n]) => n > 0)
    .toSorted(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
}
