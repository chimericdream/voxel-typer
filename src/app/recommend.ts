/**
 * What to play next (task M3-06, PLAN.md §4.3): the lesson the map pulses, and the remedial
 * "practice camp" when one is due. No DOM; the world map (`src/ui/screens/map-logic.ts`) and the
 * app shell call it.
 *
 * The camp is an optional side stop (M3-06 review B1): every "go here next" cue on the map (the
 * pulsing stone, its label, the island's tag, the first focus) follows
 * {@link nextCurriculumLesson}, whether or not a remedial is due, and the camp is drawn on that
 * lesson's island ({@link campIsland}). Passing it by costs nothing.
 *
 * {@link recommendNext}: a due remedial, else the next lesson not played yet, else the open lesson
 * with the fewest stars in the current biome (then anywhere). A "No Peeking!" challenge the player
 * went past is never recommended (M3-FIX-7, decision 104). A lesson the placement test skipped has
 * one star but was never played ({@link isTestedOut}), so it is not a "fewest stars" pick.
 *
 * After a failed mastery check (M3-FIX-11): while the current biome's mastery lesson is played
 * with fewer than 2 stars, the next lesson alternates between the mastery check and one
 * fewest-stars replay. Before, the fewest-stars rule sent the child back to lesson 01 (a tie goes
 * to the first lesson), and the whole biome had to get past 1★ before the check came round again.
 *
 * Unlock rules are the contract's (`docs/impl/contracts.md` §6): a biome is open when it is in
 * `progress.unlockedBiomes`; a lesson is open when it is the first of its biome or the lesson
 * before it has been played. A challenge never gates the lesson after it.
 */
import type { Lesson } from "@/content/lessons/types";
import { EN_US, layoutById } from "@/content/layouts";
import {
  REMEDIAL_RULES,
  isRemedialId,
  remedialAllowedKeys,
  remedialLesson,
  suggestRemedial,
} from "@/engine/remedial";
import type { RemedialRules } from "@/engine/remedial";
import { t } from "@/i18n";
import { TARGET_LATENCY } from "@/modes/mine/logic";
import type { Profile } from "@/save/schema";
import { BIOME_ORDER } from "@/types/core";
import type { BiomeId } from "@/types/core";
import { isTestedOut } from "./progress";

const rank = (l: Pick<Lesson, "biome" | "order">): number =>
  BIOME_ORDER.indexOf(l.biome) * 1000 + l.order;

const byCurriculum = (a: Lesson, b: Lesson): number => rank(a) - rank(b);

const recordOf = (profile: Profile, id: string) => profile.progress.lessons[id];

const playedIn = (profile: Profile, id: string): boolean => recordOf(profile, id) !== undefined;

/**
 * Knobs for the progression study (`tools/sim-progression.ts`). The game passes none; the
 * defaults are the shipped rules.
 */
export interface RecommendOptions {
  /**
   * After a failed mastery check: `alternate` (shipped) or `fewest`, the rule before M3-FIX-11
   * (the fewest-stars replay only), kept so the study can compare them.
   */
  masteryRetry?: "alternate" | "fewest";
  /** The remedial rules. Default {@link REMEDIAL_RULES}. */
  remedial?: Readonly<RemedialRules>;
}

/** An optional lesson: the "No Peeking!" challenge. It never gates the next lesson (M3-FIX-7). */
export const isOptional = (lesson: Lesson): boolean =>
  lesson.tags?.includes("challenge-hide-keyboard") === true;

/**
 * An optional lesson the player went past: a later lesson of its biome has been played. It is
 * never recommended again, so skipping it never nags.
 */
export function skippedChallenge(
  profile: Profile,
  lessons: readonly Lesson[],
  lesson: Lesson,
): boolean {
  return (
    isOptional(lesson) &&
    lessons.some(
      (l) => l.biome === lesson.biome && l.order > lesson.order && playedIn(profile, l.id),
    )
  );
}

/** Every lesson the player may start now, in curriculum order. */
export function openLessons(profile: Profile, lessons: readonly Lesson[]): Lesson[] {
  const unlocked = new Set(profile.progress.unlockedBiomes);
  const out: Lesson[] = [];
  for (const biome of BIOME_ORDER) {
    if (!unlocked.has(biome)) continue;
    let gatePlayed = true;
    for (const lesson of lessons.filter((l) => l.biome === biome).toSorted(byCurriculum)) {
      if (gatePlayed) out.push(lesson);
      if (!isOptional(lesson)) gatePlayed = playedIn(profile, lesson.id);
    }
  }
  return out;
}

/**
 * The furthest lesson the player has reached (played or tested out), in curriculum order, or null
 * before any. Its keys are the keys they know, and its biome is the current biome.
 */
export function anchorLesson(profile: Profile, lessons: readonly Lesson[]): Lesson | null {
  let best: Lesson | null = null;
  for (const lesson of lessons) {
    if (!playedIn(profile, lesson.id)) continue;
    if (best === null || rank(lesson) > rank(best)) best = lesson;
  }
  return best;
}

/** The biome the player is working in: the anchor's, else the first open one. */
export function currentBiome(profile: Profile, lessons: readonly Lesson[]): BiomeId | null {
  return (
    anchorLesson(profile, lessons)?.biome ??
    BIOME_ORDER.find((b) => profile.progress.unlockedBiomes.includes(b)) ??
    null
  );
}

/** Remedial lessons handed out this run, so a replay or the Results screen can find them again. */
const handedOut = new Map<string, Lesson>();
const HANDED_OUT_MAX = 8;

function remember(lesson: Lesson): Lesson {
  const known = handedOut.get(lesson.id);
  if (known !== undefined) return known;
  handedOut.set(lesson.id, lesson);
  for (const id of handedOut.keys()) {
    if (handedOut.size <= HANDED_OUT_MAX) break;
    handedOut.delete(id);
  }
  return lesson;
}

/** A remedial lesson handed out earlier (the shell resolves `remedial-…` ids here), or null. */
export function remedialById(id: string): Lesson | null {
  return isRemedialId(id) ? (handedOut.get(id) ?? null) : null;
}

/** Forgets the remedials handed out (tests). */
export function resetRemedials(): void {
  handedOut.clear();
}

/**
 * The remedial due now, or null (`src/engine/remedial.ts` has the rules). It sits at the anchor
 * lesson, so it uses only keys the player knows. Its id is scoped to the profile, the anchor and
 * the layout (M3-FIX-11): siblings on one device with the same weak keys at the same session
 * count each get their own camp, never the other's with keys they haven't been taught.
 */
export function dueRemedial(
  profile: Profile,
  lessons: readonly Lesson[],
  opts: RecommendOptions = {},
): Lesson | null {
  const anchor = anchorLesson(profile, lessons);
  if (anchor === null) return null;
  const layout = layoutById(profile.settings.layout) ?? EN_US;
  const suggestion = suggestRemedial({
    allowed: remedialAllowedKeys(lessons, anchor),
    stats: profile.keyStats,
    sessionIndex: profile.sessionCounter,
    targetLatencyMs: TARGET_LATENCY[profile.ageBand],
    recent: profile.history.map((h) => h.lessonId),
    scope: `${profile.id}:${anchor.id}:${layout.id}`,
    rules: opts.remedial ?? REMEDIAL_RULES,
  });
  if (suggestion === null) return null;
  return remember(remedialLesson(suggestion, anchor, layout));
}

/** The lesson id of the last curriculum session in the history (not a camp or free play). */
function lastCurriculumPlay(profile: Profile, lessons: readonly Lesson[]): string | null {
  for (let i = profile.history.length - 1; i >= 0; i--) {
    const id = profile.history[i]?.lessonId;
    if (id !== undefined && lessons.some((l) => l.id === id)) return id;
  }
  return null;
}

/** The next curriculum lesson: the next one not played, else a replay (see the top). */
export function nextCurriculumLesson(
  profile: Profile,
  lessons: readonly Lesson[],
  opts: RecommendOptions = {},
): Lesson | null {
  const open = openLessons(profile, lessons).filter((l) => !skippedChallenge(profile, lessons, l));
  const fresh = open.find((l) => !playedIn(profile, l.id));
  if (fresh) return fresh;
  const scored = open.filter((l) => {
    const rec = recordOf(profile, l.id);
    return rec !== undefined && !isTestedOut(rec) && rec.bestStars < 3;
  });
  const fewest = (from: readonly Lesson[]): Lesson | null => {
    let best: Lesson | null = null;
    for (const l of from) {
      const stars = recordOf(profile, l.id)?.bestStars ?? 0;
      if (best === null || stars < (recordOf(profile, best.id)?.bestStars ?? 0)) best = l;
    }
    return best;
  };
  const here = currentBiome(profile, lessons);
  const inBiome = scored.filter((l) => l.biome === here);
  // A failed mastery check (played, not tested out, under 2 stars): the check, then one replay.
  const mastery = inBiome.find((l) => l.tags?.includes("mastery") === true);
  const failed = mastery !== undefined && (recordOf(profile, mastery.id)?.bestStars ?? 0) < 2;
  if (failed && (opts.masteryRetry ?? "alternate") === "alternate") {
    if (lastCurriculumPlay(profile, lessons) !== mastery.id) return mastery;
    return fewest(inBiome.filter((l) => l !== mastery)) ?? mastery;
  }
  return fewest(inBiome) ?? fewest(scored);
}

/**
 * What to play next, all told: a due remedial, else {@link nextCurriculumLesson}. A remedial is
 * not in `lessons`; {@link isRemedialId} tells it apart. The map's cues use the curriculum half
 * only (see the top).
 */
export function recommendNext(
  profile: Profile,
  lessons: readonly Lesson[],
  opts: RecommendOptions = {},
): Lesson | null {
  return dueRemedial(profile, lessons, opts) ?? nextCurriculumLesson(profile, lessons, opts);
}

/**
 * The island a due remedial's camp sits on: the next curriculum lesson's, so the camp, the pulsing
 * stone and "Go here next!" share one island (right after an unlock, the new one). With no next
 * lesson, the remedial's own (its anchor's). The remedial keeps its anchor's keys and content.
 */
export function campIsland(
  profile: Profile,
  lessons: readonly Lesson[],
  remedial: Lesson,
): BiomeId {
  return nextCurriculumLesson(profile, lessons)?.biome ?? remedial.biome;
}

/** How a key is said in a label: letters in capitals, as on the keyboard. */
function keyWord(key: string): string {
  if (key === ";") return t("remedial.key.semicolon");
  if (key === " ") return t("remedial.key.space");
  return /^[a-z]$/.test(key) ? key.toUpperCase() : key;
}

/** What a screen reader says for a practice camp. */
export function campLabel(lesson: Lesson): string {
  const [a = "", b] = lesson.newKeys.map(keyWord);
  return t("remedial.camp", {
    title: t(lesson.titleKey),
    count: lesson.newKeys.length,
    keys: b === undefined ? a : t("remedial.two", { a, b }),
  });
}
