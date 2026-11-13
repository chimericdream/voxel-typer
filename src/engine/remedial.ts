/**
 * Remedial lessons (task M3-06, PLAN.md §4.3, §7.2): "Your left pinky wants practice!". Pure.
 *
 * After each session the adaptive engine's weights are checked. When an allowed key is clearly
 * weak, a short Mine lesson is suggested that leans on the weakest keys plus the keys due for
 * review. "Clearly weak" ({@link RemedialRules}, M3-FIX-11): weight ≥ `minWeight` over ≥
 * `minAttempts` attempts, **and** ≥ `relative` × the median weight of the allowed keys, so a child
 * who is new to every key isn't flagged all the time. It is made on the fly and never saved into
 * the curriculum: playing it never writes a lesson record, so it can't unlock anything or touch
 * best stars (`applyResult` checks {@link isRemedialId}).
 *
 * Rate limit ({@link remedialAllowed}): a remedial is offered at most once every `every` sessions
 * ({@link REMEDIAL_EVERY}), whether the child plays it or not. A camp they pass by comes back
 * `every` sessions later, never the very next one. Playing it again straight away ("Play again")
 * is the child's choice and always allowed. Time and randomness don't come in at all: the id is a
 * hash of the keys, the session index and the caller's scope (the app passes the profile, anchor
 * and layout), so two children on one device never share a camp.
 *
 * The rules are injectable ({@link RemedialInput.rules}) so the progression study
 * (`tools/sim-progression.ts`) can sweep them. The defaults are {@link REMEDIAL_RULES}.
 */
import { allowedKeysFor } from "@/content/lessons/types";
import type { Lesson } from "@/content/lessons/types";
import { fingerFor } from "@/content/layouts";
import type { LayoutDef } from "@/content/layouts";
import type { MessageKey } from "@/i18n";
import type { Finger, LessonId, Ms } from "@/types/core";
import { dueReviewKeys, keyWeights, weakKeys } from "./adaptive";
import { hashString } from "./rng";
import { median } from "./stats";
import type { KeyStat } from "./stats";

/** Every remedial lesson id starts with this; no curriculum id does. */
export const REMEDIAL_PREFIX = "remedial-";
/** A key this heavy (contracts §4 weight, no focus boost) is weak enough to suggest practice. */
export const REMEDIAL_MIN_WEIGHT = 4;
/** ...but only once it has been tried this often, so one bad day is not a trend. */
export const REMEDIAL_MIN_ATTEMPTS = 30;
/**
 * ...and only when it weighs at least this many times the median allowed key (M3-FIX-11): a slow
 * child is slow on every key, and that alone is not a weak key. docs/sim.md has the sweep.
 */
export const REMEDIAL_RELATIVE = 1.5;
/**
 * A remedial is offered at most once in this many sessions, played or not. 4 since M3-FIX-11 (it
 * was 3, and slow learners got a camp in every slot: a third of their sessions).
 */
export const REMEDIAL_EVERY = 4;

/** When a key is weak enough for a camp, and how often camps may come. */
export interface RemedialRules {
  /** Weight ≥ this (contracts §4, no focus boost). */
  minWeight: number;
  /** Attempts ≥ this. */
  minAttempts: number;
  /** Weight ≥ this × the median weight of the allowed keys. 0 or less: no relative check. */
  relative: number;
  /** Offers at most once in this many sessions (whole, ≥ 1). */
  every: number;
  /** Whether slowness counts towards the trigger's weights. Off: only slips make a key weak. */
  speed: boolean;
}

/** The shipped rules. */
export const REMEDIAL_RULES: Readonly<RemedialRules> = {
  minWeight: REMEDIAL_MIN_WEIGHT,
  minAttempts: REMEDIAL_MIN_ATTEMPTS,
  relative: REMEDIAL_RELATIVE,
  every: REMEDIAL_EVERY,
  speed: true,
};
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

/**
 * `remedial-<hash of keys + session + scope>`: the same keys in the same session and scope give the
 * same id. `scope` says whose camp it is (the app passes the profile, anchor and layout ids), so
 * two profiles on one device, or one child at a new anchor, never get one id (M3-FIX-11).
 */
export function remedialId(keys: readonly string[], sessionIndex: number, scope = ""): LessonId {
  const scoped = scope === "" ? "" : `#${scope}`;
  const text = `${keys.join("\u0000")}@${sessionIndex}${scoped}`;
  return `${REMEDIAL_PREFIX}${hashString(text).toString(36)}`;
}

/**
 * Whether a remedial may be offered in session `sessionIndex` (sessions finished so far). Offers
 * come in slots `every` sessions apart ({@link REMEDIAL_EVERY}), counted from the last remedial
 * played: it is offered again after `every − 1` other sessions, and if those pass it by, after
 * `every` more. With no remedial in `recent`, the slots are the session indexes divisible by
 * `every`. So an offer, taken or not, never comes back within `every` sessions, and the profile
 * needs no record of when one was shown.
 *
 * `recent` is the lesson id of each session, oldest first (the profile's `history`).
 */
export function remedialAllowed(
  recent: readonly (string | undefined)[],
  sessionIndex: number,
  every: number = REMEDIAL_EVERY,
): boolean {
  const n = Math.max(1, Math.floor(every));
  const last = recent.findLastIndex(isRemedialId);
  // Sessions since the last remedial; with none, as if one was played just before session 0.
  const since = last === -1 ? sessionIndex + n - 1 : recent.length - 1 - last;
  return since >= n - 1 && (since - (n - 1)) % n === 0;
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
  /** Whose camp this is, hashed into the id ({@link remedialId}). Default: none. */
  scope?: string;
  /** The rules. Default {@link REMEDIAL_RULES}. */
  rules?: Readonly<RemedialRules>;
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
 * is clearly weak by the {@link RemedialRules} (see the top). It focuses on the
 * {@link REMEDIAL_FOCUS} heaviest such keys.
 */
export function suggestRemedial(input: RemedialInput): RemedialSuggestion | null {
  const rules = input.rules ?? REMEDIAL_RULES;
  if (!remedialAllowed(input.recent, input.sessionIndex, rules.every)) return null;
  const params = {
    allowed: input.allowed,
    focus: [],
    stats: input.stats,
    sessionIndex: input.sessionIndex,
    // `keyWeights` reads a non-positive target as "not slow": no latency term.
    targetLatencyMs: rules.speed ? input.targetLatencyMs : 0,
  };
  const weights = keyWeights(params);
  const typical = median(input.allowed.map((k) => weights[k] ?? 0)) ?? 0;
  const bar = Math.max(rules.minWeight, rules.relative > 0 ? rules.relative * typical : 0);
  const weak = (key: string): boolean => {
    const stat = Object.hasOwn(input.stats, key) ? input.stats[key] : undefined;
    return stat !== undefined && stat.attempts >= rules.minAttempts && (weights[key] ?? 0) >= bar;
  };
  // `weakKeys` sorts by weight with ties in `allowed` order; keep only the clearly weak ones.
  const keys = weakKeys({ ...params, allowed: input.allowed.filter(weak) }, REMEDIAL_FOCUS);
  if (keys.length === 0) return null;
  const review = dueReviewKeys(params).filter((k) => !keys.includes(k));
  return { id: remedialId(keys, input.sessionIndex, input.scope), keys, review };
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
