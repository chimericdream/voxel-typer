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
import {
  campIsland,
  campLabel,
  dueRemedial,
  isOptional,
  nextCurriculumLesson,
  openLessons,
} from "@/app/recommend";
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

/** A remedial "practice camp" on an island's path (M3-06): shown while a remedial is due. */
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

export { isOptional };

/**
 * The lesson the map points the player to: the curriculum half of `recommendNext` (M3-06), the
 * next lesson not played, then the fewest stars. A due remedial never takes this cue: it is an
 * optional practice camp beside the path (M3-06 review B1). A "No Peeking!" challenge the player
 * went past is not pointed at again.
 */
export function recommendedLesson(profile: Profile, lessons: readonly Lesson[]): Lesson | null {
  return nextCurriculumLesson(profile, lessons);
}

/** A practice camp to draw: what it says and the remedial lesson it plays (M3-06). */
export interface CampSuggestion {
  label: string;
  lesson: Lesson;
}

/**
 * The practice camp to show on a biome's path, or null: the due remedial (M3-06), on the island of
 * the next lesson (`campIsland`). The screen turns it into a {@link PracticeCamp} whose `open`
 * plays the lesson, like picking a lesson stone.
 */
export function practiceCamp(
  profile: Profile,
  lessons: readonly Lesson[],
  biome: BiomeId,
): CampSuggestion | null {
  const lesson = dueRemedial(profile, lessons);
  if (lesson === null || campIsland(profile, lessons, lesson) !== biome) return null;
  return { label: campLabel(lesson), lesson };
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
 * neighbours; whatever is still tangled is then settled one label at a time (`settle`), so the
 * promise holds for every pair and for the window's bottom too (M3-FIX-1 review N1).
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

  settle(boxes, size, keepOut, opts);
  return boxes.map((b) => ({ left: Math.round(b.left), top: Math.round(b.top) }));
}

/** A label being placed: its button's top-left corner, size, and what sticks out above it. */
interface Placing {
  left: number;
  top: number;
  w: number;
  h: number;
  above: number;
}

/**
 * The last step of {@link layoutLabels} (M3-FIX-1 review N1): whatever the pushes left tangled is
 * settled one label at a time. A label keeps its spot if that is inside the window and clear of
 * the labels already settled and of the keep-out areas. Otherwise it takes the clear spot nearest
 * to where it was, beside or above or below something in its way. Every pair is checked against
 * the final places, so a moved label can't land on a third one or leave the window.
 *
 * One order can box a late label in, so a few orders are tried (top row first, bottom row first,
 * widest first, curriculum order) and the first that settles every label wins; failing that, the
 * one that leaves the fewest stuck. A stuck label (a window far too small) stays where it was.
 */
function settle(
  boxes: Placing[],
  size: { width: number; height: number },
  keepOut: readonly KeepOut[],
  { margin, gap }: LabelLayout,
): void {
  const slack = 0.5;
  const edges = (b: Placing, at: { left: number; top: number }): KeepOut => ({
    left: at.left,
    top: at.top - b.above,
    right: at.left + b.w,
    bottom: at.top + b.h,
  });
  const apart = (a: KeepOut, o: KeepOut): boolean =>
    a.right + gap <= o.left + slack ||
    o.right + gap <= a.left + slack ||
    a.bottom + gap <= o.top + slack ||
    o.bottom + gap <= a.top + slack;
  const inside = (a: KeepOut): boolean =>
    a.left >= margin - slack &&
    a.top >= margin - slack &&
    a.right <= size.width - margin + slack &&
    a.bottom <= size.height - margin + slack;

  /** Settles the labels in `order` (indexes); returns the places and how many got stuck. */
  const attempt = (
    order: readonly number[],
  ): { at: { left: number; top: number }[]; stuck: number; moved: number } => {
    const at = boxes.map((b) => ({ left: b.left, top: b.top }));
    const settled: KeepOut[] = [];
    let stuck = 0;
    let moved = 0;
    for (const i of order) {
      const b = boxes[i];
      const here = at[i];
      if (b === undefined || here === undefined) continue;
      const obstacles = [...keepOut, ...settled];
      const clear = (p: { left: number; top: number }): boolean => {
        const e = edges(b, p);
        return inside(e) && obstacles.every((o) => apart(e, o));
      };
      if (!clear(here)) {
        const lefts = [b.left, margin, size.width - margin - b.w];
        const tops = [b.top, margin + b.above, size.height - margin - b.h];
        for (const o of obstacles) {
          lefts.push(o.left - gap - b.w, o.right + gap);
          tops.push(o.top - gap - b.h, o.bottom + gap + b.above);
        }
        let bestCost = Infinity;
        for (const left of lefts) {
          for (const top of tops) {
            const cost = (left - b.left) ** 2 + (top - b.top) ** 2;
            if (cost >= bestCost || !clear({ left, top })) continue;
            here.left = left;
            here.top = top;
            bestCost = cost;
          }
        }
        if (bestCost === Infinity) stuck += 1;
        else moved += bestCost;
      }
      settled.push(edges(b, here));
    }
    return { at, stuck, moved };
  };

  const index = boxes.map((_, i) => i);
  const topOf = (i: number): number => (boxes[i]?.top ?? 0) - (boxes[i]?.above ?? 0);
  const widthOf = (i: number): number => boxes[i]?.w ?? 0;
  const orders = [
    index.toSorted((i, j) => topOf(i) - topOf(j) || i - j),
    index.toSorted((i, j) => topOf(j) - topOf(i) || i - j),
    index.toSorted((i, j) => widthOf(j) - widthOf(i) || topOf(i) - topOf(j) || i - j),
    index,
  ];
  let best: ReturnType<typeof attempt> | null = null;
  for (const order of orders) {
    const tried = attempt(order);
    if (
      best === null ||
      tried.stuck < best.stuck ||
      (tried.stuck === best.stuck && tried.moved < best.moved)
    )
      best = tried;
    if (best.stuck === 0) break;
  }
  if (best !== null && best.stuck > 0) {
    const rows = inRows(boxes, size, keepOut, { margin, gap });
    let bad = 0;
    rows.forEach((p, i) => {
      const b = boxes[i];
      if (b === undefined) return;
      const e = edges(b, p);
      const others = rows.flatMap((q, j) => {
        const c = boxes[j];
        return j === i || c === undefined ? [] : [edges(c, q)];
      });
      if (!inside(e) || ![...keepOut, ...others].every((o) => apart(e, o))) bad += 1;
    });
    if (bad < best.stuck) best = { at: rows, stuck: bad, moved: 0 };
  }
  best?.at.forEach((p, i) => {
    const b = boxes[i];
    if (b === undefined) return;
    b.left = p.left;
    b.top = p.top;
  });
}

/**
 * The fallback for {@link settle} when every order leaves a label stuck: rows. The labels are
 * taken from the top of the window down and filled into rows as wide as the window; the rows are
 * stacked below the keep-out areas, each as near its labels' height as the others allow, and the
 * labels in a row are spaced the same way from left to right. When the labels fit at all, this
 * fits them, at the cost of moving some farther from their islands.
 */
function inRows(
  boxes: readonly Placing[],
  size: { width: number; height: number },
  keepOut: readonly KeepOut[],
  { margin, gap }: LabelLayout,
): { left: number; top: number }[] {
  const at = boxes.map((b) => ({ left: b.left, top: b.top }));
  const room = size.width - 2 * margin;
  const byTop = boxes
    .map((_, i) => i)
    .toSorted((i, j) => {
      const a = boxes[i];
      const b = boxes[j];
      return a === undefined || b === undefined ? 0 : a.top - a.above - (b.top - b.above);
    });
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  for (const i of byTop) {
    const w = boxes[i]?.w ?? 0;
    const need = row.length === 0 ? w : used + gap + w;
    if (need > room && row.length > 0) {
      rows.push(row);
      row = [i];
      used = w;
    } else {
      row.push(i);
      used = need;
    }
  }
  if (row.length > 0) rows.push(row);

  /** Spaces `want` (each with its size) apart in [lo, hi], keeping their order. */
  const spread = (want: number[], sizes: number[], lo: number, hi: number): number[] => {
    const out = [...want];
    for (let k = 0; k < out.length; k++) {
      const floor = k === 0 ? lo : (out[k - 1] ?? lo) + (sizes[k - 1] ?? 0) + gap;
      out[k] = Math.max(out[k] ?? lo, floor);
    }
    for (let k = out.length - 1; k >= 0; k--) {
      const ceil = k === out.length - 1 ? hi : (out[k + 1] ?? hi) - gap;
      out[k] = Math.min(out[k] ?? lo, ceil - (sizes[k] ?? 0));
    }
    for (let k = 0; k < out.length; k++) {
      const floor = k === 0 ? lo : (out[k - 1] ?? lo) + (sizes[k - 1] ?? 0) + gap;
      out[k] = Math.max(out[k] ?? lo, floor);
    }
    return out;
  };

  const tall = rows.map((r) =>
    Math.max(...r.map((i) => (boxes[i]?.h ?? 0) + (boxes[i]?.above ?? 0))),
  );
  const wantTop = rows.map(
    (r) => r.reduce((sum, i) => sum + (boxes[i]?.top ?? 0) - (boxes[i]?.above ?? 0), 0) / r.length,
  );
  const below = Math.max(margin, ...keepOut.map((k) => k.bottom + gap));
  const tops = spread(wantTop, tall, below, size.height - margin);
  rows.forEach((r, k) => {
    const inRow = r.toSorted((i, j) => {
      const a = boxes[i];
      const b = boxes[j];
      return a === undefined || b === undefined ? 0 : a.left + a.w / 2 - (b.left + b.w / 2);
    });
    const lefts = spread(
      inRow.map((i) => boxes[i]?.left ?? 0),
      inRow.map((i) => boxes[i]?.w ?? 0),
      margin,
      size.width - margin,
    );
    inRow.forEach((i, n) => {
      const p = at[i];
      if (p === undefined) return;
      p.left = lefts[n] ?? p.left;
      p.top = (tops[k] ?? p.top) + (boxes[i]?.above ?? 0);
    });
  });
  return at;
}
