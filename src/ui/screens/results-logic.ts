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

/**
 * "Great aim: 94%" style, for Miner and Builder. Sprout sees stars only (returns null). Below 70%
 * there is no aim line at all: kids never see a raw low score (PLAN §4.4); the warm outcome
 * message already covers the run.
 */
export function aimLine(accuracy: number, band: AgeBand): { key: MessageKey; pct: number } | null {
  if (band === "sprout") return null;
  const pct = percent(accuracy);
  if (pct >= 90) return { key: "screens.results.aimGreat", pct };
  if (pct >= 70) return { key: "screens.results.aimGood", pct };
  return null;
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

/** One extra line a mode asks Results to show: an i18n key and its params. */
export interface ResultLine {
  key: MessageKey;
  params: Record<string, string | number>;
}

/** `ModeResult.extra.resultLines`: lines a mode adds under the aim line (M4-04, Night Defense). */
export const RESULT_LINES_EXTRA = "resultLines";
/** Results shows at most this many extra lines. */
export const MAX_RESULT_LINES = 3;

const isLine = (v: unknown): v is ResultLine => {
  if (typeof v !== "object" || v === null) return false;
  const key: unknown = Reflect.get(v, "key");
  const params: unknown = Reflect.get(v, "params");
  if (typeof key !== "string" || !/^[a-zA-Z]+\.\S+$/.test(key)) return false;
  if (typeof params !== "object" || params === null) return false;
  return Object.values(params).every((p) => typeof p === "string" || typeof p === "number");
};

/**
 * The extra lines of a result, for example a night's "12 friends sent home". Anything malformed is
 * left out, so a mode can never break the Results screen.
 */
export function resultLines(extra: Readonly<Record<string, unknown>> | undefined): ResultLine[] {
  const raw = extra?.[RESULT_LINES_EXTRA];
  return Array.isArray(raw) ? raw.filter(isLine).slice(0, MAX_RESULT_LINES) : [];
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
