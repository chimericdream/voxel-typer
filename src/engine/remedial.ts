/**
 * Remedial lessons (task M3-06, PLAN.md §4.3, §7.2): "Your left pinky wants practice!". Pure.
 *
 * After each session the adaptive engine's weights are checked. When an allowed key is clearly
 * weak (weight ≥ {@link REMEDIAL_MIN_WEIGHT} over ≥ {@link REMEDIAL_MIN_ATTEMPTS} attempts), a
 * short Mine lesson is suggested that leans on the weakest keys plus the keys due for review. It
 * is made on the fly and never saved into the curriculum: playing it never writes a lesson record,
 * so it can't unlock anything or touch best stars (`applyResult` checks {@link isRemedialId}).
 *
 * Rate limit: at most one remedial in any {@link REMEDIAL_EVERY} sessions in a row. Time and
 * randomness don't come in at all: the id is a hash of the keys and the session index.
 */
import { allowedKeysFor } from "@/content/lessons/types";
import type { Lesson } from "@/content/lessons/types";
import { fingerFor } from "@/content/layouts";
import type { LayoutDef } from "@/content/layouts";
import type { MessageKey } from "@/i18n";
import type { Finger, LessonId, Ms } from "@/types/core";
import { dueReviewKeys, keyWeights, weakKeys } from "./adaptive";
import { hashString } from "./rng";
import type { KeyStat } from "./stats";

/** Every remedial lesson id starts with this; no curriculum id does. */
export const REMEDIAL_PREFIX = "remedial-";
/** A key this heavy (contracts §4 weight, no focus boost) is weak enough to suggest practice. */
export const REMEDIAL_MIN_WEIGHT = 4;
/** ...but only once it has been tried this often, so one bad day is not a trend. */
export const REMEDIAL_MIN_ATTEMPTS = 30;
/** At most one remedial in any this many sessions in a row. */
export const REMEDIAL_EVERY = 3;
/** How many weak keys a remedial focuses on. */
export const REMEDIAL_FOCUS = 2;
/** A remedial is a 60 s Mine run, the same length for every band. */
export const REMEDIAL_SECONDS = 60;

/** The lesson title by the finger of the weakest key (`src/i18n/en/remedial.ts`). */
export const REMEDIAL_TITLE: Readonly<Record<Finger, MessageKey>> = {
  L5: "remedial.title.L5",
  L4: "remedial.title.L4",
  L3: "remedial.title.L3",
  L2: "remedial.title.L2",
  R2: "remedial.title.R2",
  R3: "remedial.title.R3",
  R4: "remedial.title.R4",
  R5: "remedial.title.R5",
  T: "remedial.title.T",
};
/** The title when the layout has no finger for the key. */
export const REMEDIAL_TITLE_ANY: MessageKey = "remedial.title.any";

export const isRemedialId = (id: string | undefined): boolean =>
  id !== undefined && id.startsWith(REMEDIAL_PREFIX);

/** `remedial-<hash of keys + session>`: the same keys in the same session give the same id. */
export function remedialId(keys: readonly string[], sessionIndex: number): LessonId {
  return `${REMEDIAL_PREFIX}${hashString(`${keys.join("\u0000")}@${sessionIndex}`).toString(36)}`;
}

/**
 * Whether a remedial may be suggested now: none of the last `REMEDIAL_EVERY - 1` sessions was one.
 * `recent` is the lesson id of each session, oldest first (the profile's `history`).
 */
export function remedialAllowed(recent: readonly (string | undefined)[]): boolean {
  return !recent.slice(-(REMEDIAL_EVERY - 1)).some(isRemedialId);
}

export interface RemedialInput {
  /** The keys the learner knows (`allowedKeysFor` the furthest lesson reached). */
  allowed: readonly string[];
  stats: Readonly<Record<string, KeyStat>>;
  /** The profile's session counter: sessions finished so far. */
  sessionIndex: number;
  /** The band's target latency (contracts §4). */
  targetLatencyMs: Ms;
  /** The lesson id of each session so far, oldest first (`profile.history`). */
  recent: readonly (string | undefined)[];
}

export interface RemedialSuggestion {
  id: LessonId;
  /** The weak keys to practise, weakest first. One or two. */
  keys: string[];
  /** Other keys due for spaced review. */
  review: string[];
}

/**
 * The remedial to suggest now, or null: when the rate limit allows it and at least one allowed key
 * has weight ≥ {@link REMEDIAL_MIN_WEIGHT} with ≥ {@link REMEDIAL_MIN_ATTEMPTS} attempts. It
 * focuses on the {@link REMEDIAL_FOCUS} heaviest such keys.
 */
export function suggestRemedial(input: RemedialInput): RemedialSuggestion | null {
  if (!remedialAllowed(input.recent)) return null;
  const params = {
    allowed: input.allowed,
    focus: [],
    stats: input.stats,
    sessionIndex: input.sessionIndex,
    targetLatencyMs: input.targetLatencyMs,
  };
  const weights = keyWeights(params);
  const weak = (key: string): boolean => {
    const stat = Object.hasOwn(input.stats, key) ? input.stats[key] : undefined;
    return (
      stat !== undefined &&
      stat.attempts >= REMEDIAL_MIN_ATTEMPTS &&
      (weights[key] ?? 0) >= REMEDIAL_MIN_WEIGHT
    );
  };
  // `weakKeys` sorts by weight with ties in `allowed` order; keep only the clearly weak ones.
  const keys = weakKeys({ ...params, allowed: input.allowed.filter(weak) }, REMEDIAL_FOCUS);
  if (keys.length === 0) return null;
  const review = dueReviewKeys(params).filter((k) => !keys.includes(k));
  return { id: remedialId(keys, input.sessionIndex), keys, review };
}

/** The title of a remedial: by the finger of its weakest key. */
export function remedialTitle(keys: readonly string[], layout: LayoutDef): MessageKey {
  const first = keys[0];
  const finger = first === undefined ? null : fingerFor(layout, first);
  return finger === null ? REMEDIAL_TITLE_ANY : REMEDIAL_TITLE[finger];
}

/**
 * The lesson for a suggestion. It sits at `anchor`'s place (the furthest lesson the learner has
 * reached), so it allows the same keys, uses the same content, blocks and wrong-key rules, and its
 * "next lesson" is the one after the anchor, which is always open. Focus: the weak keys as
 * `newKeys`, the due keys as `reviewKeys` (Mine's `focusKeys` takes them when they are a subset).
 */
export function remedialLesson(s: RemedialSuggestion, anchor: Lesson, layout: LayoutDef): Lesson {
  const lesson: Lesson = {
    id: s.id,
    biome: anchor.biome,
    order: anchor.order,
    titleKey: remedialTitle(s.keys, layout),
    newKeys: [...s.keys],
    reviewKeys: [...s.review],
    kind: anchor.kind,
    length: { seconds: REMEDIAL_SECONDS },
    mode: "mine",
    // Practice has no speed goal: only accuracy counts for its stars.
    targets: { accuracy: anchor.targets.accuracy },
    bandScale: { sprout: 1, miner: 1, builder: 1 },
  };
  if (anchor.pools !== undefined) lesson.pools = [...anchor.pools];
  if (anchor.policy !== undefined) lesson.policy = { ...anchor.policy };
  if (anchor.caseInsensitiveFor !== undefined) {
    lesson.caseInsensitiveFor = [...anchor.caseInsensitiveFor];
  }
  return lesson;
}

/** The keys a remedial at `anchor` may use (the anchor's allowed set). */
export const remedialAllowedKeys = (lessons: readonly Lesson[], anchor: Lesson): string[] =>
  allowedKeysFor(lessons, anchor.id);
