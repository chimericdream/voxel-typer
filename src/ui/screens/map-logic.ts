/**
 * What the world map shows, worked out from the profile and the lesson list (task M3-04). No DOM
 * and no 3D here, so the same data can feed the flat lite map later (M6).
 *
 * Unlock rules are the contract's (`docs/impl/contracts.md` §6): a biome is open when it is in
 * `progress.unlockedBiomes`; a lesson is open when it is the first of its biome or the lesson
 * before it has been played. Nothing here changes the profile.
 */
import { biomesUnlockedBy } from "@/app/progress";
import type { Lesson } from "@/content/lessons/types";
import { t } from "@/i18n";
import type { Profile } from "@/save/schema";
import { BIOME_ORDER } from "@/types/core";
import type { BiomeId } from "@/types/core";

export type Stars = 0 | 1 | 2 | 3;

/** One island on the map. */
export interface IslandInfo {
  biome: BiomeId;
  name: string;
  unlocked: boolean;
  /** Lessons shipped for this biome. 0 while its lessons are still being written. */
  total: number;
  /** Lessons played at least once. */
  done: number;
  /** Best stars summed over the biome's lessons. */
  stars: number;
  /** The biome whose mastery lesson opens this one, or null for the first island. */
  opensAfter: BiomeId | null;
  /** The recommended lesson is on this island. */
  next: boolean;
}

/** One lesson on an island's path. */
export interface LessonNode {
  lesson: Lesson;
  /** Its place on the path, from 1. */
  n: number;
  title: string;
  played: boolean;
  stars: Stars;
  /** Playable now. */
  open: boolean;
  /** The recommended lesson: this node pulses. */
  next: boolean;
}

/**
 * A remedial "practice camp" on an island's path. M3-06 decides when one is suggested; until then
 * {@link practiceCamp} returns null and no camp is drawn.
 */
export interface PracticeCamp {
  /** Shown under the tent and read by screen readers. Pass `t()` output. */
  label: string;
  open: () => void;
}

const byCurriculum = (a: Lesson, b: Lesson): number =>
  BIOME_ORDER.indexOf(a.biome) - BIOME_ORDER.indexOf(b.biome) || a.order - b.order;

/** A biome's lessons, in path order. */
export function lessonsOf(lessons: readonly Lesson[], biome: BiomeId): Lesson[] {
  return lessons.filter((l) => l.biome === biome).toSorted(byCurriculum);
}

const starsOf = (profile: Profile, id: string): Stars =>
  profile.progress.lessons[id]?.bestStars ?? 0;

const playedIn = (profile: Profile, id: string): boolean =>
  profile.progress.lessons[id] !== undefined;

/** Every lesson the player may start now, in curriculum order. */
function openLessons(profile: Profile, lessons: readonly Lesson[]): Lesson[] {
  const unlocked = new Set(profile.progress.unlockedBiomes);
  const out: Lesson[] = [];
  for (const biome of BIOME_ORDER) {
    if (!unlocked.has(biome)) continue;
    let prevPlayed = true;
    for (const lesson of lessonsOf(lessons, biome)) {
      if (prevPlayed) out.push(lesson);
      prevPlayed = playedIn(profile, lesson.id);
    }
  }
  return out;
}

/**
 * The lesson the map points the player to: the first open lesson they haven't played, else the
 * open lesson with the fewest stars (below three), else none.
 *
 * This is the one place that decides it. M3-06's `recommendNext(profile)` (due remedial → next
 * unplayed → lowest stars) replaces the body of this function.
 */
export function recommendedLesson(profile: Profile, lessons: readonly Lesson[]): Lesson | null {
  const open = openLessons(profile, lessons);
  const fresh = open.find((l) => !playedIn(profile, l.id));
  if (fresh) return fresh;
  let best: Lesson | null = null;
  for (const lesson of open) {
    const stars = starsOf(profile, lesson.id);
    if (stars < 3 && (best === null || stars < starsOf(profile, best.id))) best = lesson;
  }
  return best;
}

/**
 * The practice camp to show on a biome's path, or null. A hook for M3-06 (remedial lessons): it
 * returns null until that task supplies the suggestion.
 */
export function practiceCamp(_profile: Profile, _biome: BiomeId): PracticeCamp | null {
  return null;
}

/** The biome whose mastery lesson unlocks `biome`. */
export function opensAfter(biome: BiomeId): BiomeId | null {
  return BIOME_ORDER.find((b) => biomesUnlockedBy(b).includes(biome)) ?? null;
}

/** All nine islands, in curriculum order. */
export function islandInfos(profile: Profile, lessons: readonly Lesson[]): IslandInfo[] {
  const unlocked = new Set(profile.progress.unlockedBiomes);
  const next = recommendedLesson(profile, lessons);
  return BIOME_ORDER.map((biome) => {
    const own = lessonsOf(lessons, biome);
    return {
      biome,
      name: t(`map.biome.${biome}`),
      unlocked: unlocked.has(biome),
      total: own.length,
      done: own.filter((l) => playedIn(profile, l.id)).length,
      stars: own.reduce((sum, l) => sum + starsOf(profile, l.id), 0),
      opensAfter: opensAfter(biome),
      next: next?.biome === biome,
    };
  });
}

/** The lesson path of one island. */
export function lessonNodes(
  profile: Profile,
  lessons: readonly Lesson[],
  biome: BiomeId,
): LessonNode[] {
  const next = recommendedLesson(profile, lessons);
  const open = new Set(openLessons(profile, lessons).map((l) => l.id));
  return lessonsOf(lessons, biome).map((lesson, i) => ({
    lesson,
    n: i + 1,
    title: t(lesson.titleKey),
    played: playedIn(profile, lesson.id),
    stars: starsOf(profile, lesson.id),
    open: open.has(lesson.id),
    next: next?.id === lesson.id,
  }));
}

/** What a screen reader says for an island, e.g. "Birch Forest, 4 of 15 lessons done, 9 stars". */
export function islandLabel(info: IslandInfo): string {
  if (!info.unlocked) {
    return info.opensAfter === null
      ? t("map.island.labelLockedFirst", { name: info.name })
      : t("map.island.labelLocked", {
          name: info.name,
          need: t(`map.biome.${info.opensAfter}`),
        });
  }
  if (info.total === 0) return t("map.island.labelEmpty", { name: info.name });
  return t("map.island.label", {
    name: info.name,
    done: info.done,
    total: info.total,
    stars: info.stars,
  });
}

/** What a screen reader says for a lesson node. */
export function nodeLabel(node: LessonNode): string {
  const params = { n: node.n, title: node.title, stars: node.stars };
  if (!node.open) return t("map.path.lessonLocked", { n: node.n, prev: node.n - 1 });
  if (node.next) {
    return node.played ? t("map.path.lessonNextAgain", params) : t("map.path.lessonNext", params);
  }
  return node.played ? t("map.path.lessonDone", params) : t("map.path.lessonNew", params);
}

/** The island to put the cursor on when the map opens: the recommended one, else the first open. */
export function startIsland(infos: readonly IslandInfo[]): BiomeId | null {
  return (
    infos.find((i) => i.unlocked && i.next)?.biome ?? infos.find((i) => i.unlocked)?.biome ?? null
  );
}
