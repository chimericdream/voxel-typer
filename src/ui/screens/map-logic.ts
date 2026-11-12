/**
 * What the world map shows, worked out from the profile and the lesson list (task M3-04). No DOM
 * and no 3D here, so the same data can feed the flat lite map later (M6).
 *
 * Unlock rules are the contract's (`docs/impl/contracts.md` §6): a biome is open when it is in
 * `progress.unlockedBiomes`; a lesson is open when it is the first of its biome or the lesson
 * before it has been played. A "No Peeking!" challenge (`challenge-hide-keyboard`) is optional
 * (M3-FIX-7): it never gates the lesson after it, which opens with the challenge itself. Nothing
 * here changes the profile.
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
  /** The path number of the lesson that opens this one (0 for the first lesson). */
  after: number;
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

/** An optional lesson: the "No Peeking!" challenge. It never gates the next lesson (M3-FIX-7). */
export const isOptional = (lesson: Lesson): boolean =>
  lesson.tags?.includes("challenge-hide-keyboard") === true;

/**
 * An optional lesson the player went past: a later lesson of its biome has been played. The map
 * stops pointing at it, so skipping it never nags.
 */
function skipped(profile: Profile, lessons: readonly Lesson[], lesson: Lesson): boolean {
  return (
    isOptional(lesson) &&
    lessonsOf(lessons, lesson.biome).some((l) => l.order > lesson.order && playedIn(profile, l.id))
  );
}

/** Every lesson the player may start now, in curriculum order. */
function openLessons(profile: Profile, lessons: readonly Lesson[]): Lesson[] {
  const unlocked = new Set(profile.progress.unlockedBiomes);
  const out: Lesson[] = [];
  for (const biome of BIOME_ORDER) {
    if (!unlocked.has(biome)) continue;
    let gatePlayed = true;
    for (const lesson of lessonsOf(lessons, biome)) {
      if (gatePlayed) out.push(lesson);
      if (!isOptional(lesson)) gatePlayed = playedIn(profile, lesson.id);
    }
  }
  return out;
}

/**
 * The lesson the map points the player to: the first open lesson they haven't played, else the
 * open lesson with the fewest stars (below three), else none. A "No Peeking!" challenge the player
 * went past is not pointed at again.
 *
 * This is the one place that decides it. M3-06's `recommendNext(profile)` (due remedial → next
 * unplayed → lowest stars) replaces the body of this function.
 */
export function recommendedLesson(profile: Profile, lessons: readonly Lesson[]): Lesson | null {
  const open = openLessons(profile, lessons);
  const fresh = open.find((l) => !playedIn(profile, l.id) && !skipped(profile, lessons, l));
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
  let after = 0;
  return lessonsOf(lessons, biome).map((lesson, i) => {
    const node: LessonNode = {
      lesson,
      n: i + 1,
      title: t(lesson.titleKey),
      played: playedIn(profile, lesson.id),
      stars: starsOf(profile, lesson.id),
      open: open.has(lesson.id),
      after,
      next: next?.id === lesson.id,
    };
    if (!isOptional(lesson)) after = i + 1;
    return node;
  });
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
  const params = { name: info.name, done: info.done, total: info.total, stars: info.stars };
  // The "Go here next!" tag is part of the name too, so a screen reader hears it.
  return info.next ? t("map.island.labelNext", params) : t("map.island.label", params);
}

/** What a screen reader says for a lesson node. */
export function nodeLabel(node: LessonNode): string {
  const params = { n: node.n, title: node.title, stars: node.stars };
  if (!node.open) return t("map.path.lessonLocked", { n: node.n, prev: node.after });
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

/** The kind line shown after clicking an island that is still in the clouds. */
export function notYetLine(info: IslandInfo): string {
  return info.opensAfter === null
    ? t("map.island.notYetFirst")
    : t("map.island.notYet", { need: t(`map.biome.${info.opensAfter}`) });
}

/** One island label to place: where its island wants it, and how big it is. */
export interface LabelBox {
  /** The island's anchor: the label's top center wants to be here. */
  x: number;
  y: number;
  /** The button's size. */
  w: number;
  h: number;
  /** How far something (the "Go here next!" tag) sticks out above the button. */
  above: number;
}

/** An area labels keep out of (the heading, the corner buttons), in the same pixels. */
export interface KeepOut {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LabelLayout {
  /** Room kept between a label and the window's edge; the focus ring needs about 7 px. */
  margin: number;
  /** Room kept between two labels, or a label and a keep-out area. */
  gap: number;
}

export const LABEL_LAYOUT: LabelLayout = { margin: 10, gap: 12 };

/**
 * Where each label's button goes (its top-left corner), so that every label stays inside the
 * window and no two labels overlap (M3-04 review N2). A label starts centered under its island,
 * then is pushed only as far as it must: down out of the heading, then sideways away from its
 * neighbours; if a row has no room left, the later label moves below the earlier one.
 *
 * Plain numbers in and out, so it is tested without a browser.
 */
export function layoutLabels(
  labels: readonly LabelBox[],
  size: { width: number; height: number },
  keepOut: readonly KeepOut[] = [],
  opts: LabelLayout = LABEL_LAYOUT,
): { left: number; top: number }[] {
  const { margin, gap } = opts;
  const boxes = labels.map((l) => ({
    left: l.x - l.w / 2,
    top: l.y,
    w: l.w,
    h: l.h,
    above: l.above,
  }));
  const clampX = (b: (typeof boxes)[number]): void => {
    b.left = Math.max(margin, Math.min(size.width - margin - b.w, b.left));
  };
  const clampY = (b: (typeof boxes)[number]): void => {
    b.top = Math.max(margin + b.above, Math.min(size.height - margin - b.h, b.top));
  };
  const crossesY = (a: (typeof boxes)[number], b: { top: number; bottom: number }): boolean =>
    a.top - a.above < b.bottom + gap && b.top < a.top + a.h + gap;

  for (const b of boxes) {
    clampX(b);
    clampY(b);
    for (const k of keepOut) {
      const crossesX = b.left < k.right + gap && k.left < b.left + b.w + gap;
      if (crossesX && crossesY(b, k)) b.top = k.bottom + gap + b.above;
    }
    clampY(b);
  }

  /** How far two labels overlap sideways (with the gap), or 0 when they are clear. */
  const overlap = (a: (typeof boxes)[number], b: (typeof boxes)[number]): number => {
    if (!crossesY(a, { top: b.top - b.above, bottom: b.top + b.h })) return 0;
    const [l, r] = a.left + a.w / 2 <= b.left + b.w / 2 ? [a, b] : [b, a];
    return Math.max(0, l.left + l.w + gap - r.left);
  };

  // Push overlapping neighbours apart, half each; a label at the window's edge stays and the
  // other one takes the rest on the next pass.
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a === undefined || b === undefined) continue;
        const o = overlap(a, b);
        if (o <= 0.5) continue;
        const [l, r] = a.left + a.w / 2 <= b.left + b.w / 2 ? [a, b] : [b, a];
        l.left -= o / 2;
        r.left += o / 2;
        clampX(l);
        clampX(r);
        moved = true;
      }
    }
    if (!moved) break;
  }

  // No room left in a row: the later label goes below the earlier one.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a === undefined || b === undefined || overlap(a, b) <= 0.5) continue;
      b.top = a.top + a.h + gap + b.above;
    }
  }

  return boxes.map((b) => ({ left: Math.round(b.left), top: Math.round(b.top) }));
}
