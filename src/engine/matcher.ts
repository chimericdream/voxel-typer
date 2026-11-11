/**
 * Per-target matching: the wrong-key policy, Backspace and completion for ONE target
 * (docs/impl/contracts.md §3.2–3.3). Pure.
 *
 * Every function takes a {@link TargetState} and returns a new one; nothing here mutates. Which
 * target a key goes to (sequential order, lock-on), the streak, pausing and the session clock are
 * `session.ts`'s job.
 */
import type { Ms } from "@/types/core";
import type { EngineEvent, KeyInput, Target, TargetView, WrongKeyPolicy } from "./types";

/** The one non-printable key the engine understands. */
export const BACKSPACE = "Backspace";

/** The state of one char of a target, as shown in `TargetView.marks`. */
export type Mark = TargetView["marks"][number];

/** The events a single target can produce. The session adds the streak and lock events. */
export type TargetEvent = Extract<
  EngineEvent,
  { type: "correct" | "wrong" | "backspace" | "targetComplete" }
>;

/** Everything the engine knows about one target. Immutable. */
export interface TargetState {
  readonly id: string;
  /** The target's own text, without the trailing space. */
  readonly text: string;
  /**
   * What must be typed, one entry per char: the text, plus a final `' '` while the target requires
   * a trailing space ({@link withTrailingSpace}).
   */
  readonly chars: readonly string[];
  /** The index of the next char to type. */
  readonly cursor: number;
  /** One mark per entry of `chars`. */
  readonly marks: readonly Mark[];
  /** Per entry of `chars`: has this position ever taken a wrong key? */
  readonly erred: readonly boolean[];
  readonly complete: boolean;
  /** When the first key reached this target; `null` before that and after {@link releaseTarget}. */
  readonly startedT: Ms | null;
  /** When the previous key reached this target; `null` makes the next latency `null`. */
  readonly lastT: Ms | null;
  /** Paused time since `startedT`, left out of `durationMs`. */
  readonly pausedMs: Ms;
  /** Correct keystrokes on this target so far. */
  readonly correct: number;
  /** Wrong keystrokes on this target so far. */
  readonly wrong: number;
}

/** A transition: the next state and the events it caused, in order. */
export interface MatchResult {
  state: TargetState;
  events: TargetEvent[];
}

/** Splits text into chars by code point, so a surrogate pair is one position. */
function charsOf(text: string): string[] {
  return Array.from(text);
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  const next = [...items];
  next[index] = value;
  return next;
}

/** A fresh, untyped target. It has no trailing space until {@link withTrailingSpace} adds one. */
export function createTargetState(target: Pick<Target, "id" | "text">): TargetState {
  const chars = charsOf(target.text);
  return {
    id: target.id,
    text: target.text,
    chars,
    cursor: 0,
    marks: chars.map(() => "pending"),
    erred: chars.map(() => false),
    complete: false,
    startedT: null,
    lastT: null,
    pausedMs: 0,
    correct: 0,
    wrong: 0,
  };
}

/**
 * Does this target ask for a space after its text? `trailingSpace` wins; the default is `true` for
 * words and `false` for single chars. The session only honors it in `sequential` targeting and only
 * while another target follows.
 */
export function wantsTrailingSpace(target: Pick<Target, "text" | "trailingSpace">): boolean {
  return target.trailingSpace ?? charsOf(target.text).length > 1;
}

/**
 * Is `got` an accepted key for `expected`? With `caseSensitive: false` an upper-case key is accepted
 * for a lower-case char (`'A'` for `'a'`), never the other way round.
 */
export function keyMatches(expected: string, got: string, caseSensitive: boolean): boolean {
  return got === expected || (!caseSensitive && got.toLowerCase() === expected);
}

/**
 * Adds or drops the trailing space of a target that is not complete. Dropping it also drops that
 * position's mark, and pulls the cursor back if it stood past the text. Follow it with
 * {@link settleTarget}: a target whose text is fully typed completes once the space is dropped.
 */
export function withTrailingSpace(state: TargetState, on: boolean): TargetState {
  const textLength = charsOf(state.text).length;
  if (state.complete || state.chars.length > textLength === on) return state;
  if (on) {
    return {
      ...state,
      chars: [...state.chars, " "],
      marks: [...state.marks, "pending"],
      erred: [...state.erred, false],
    };
  }
  return {
    ...state,
    chars: state.chars.slice(0, textLength),
    marks: state.marks.slice(0, textLength),
    erred: state.erred.slice(0, textLength),
    cursor: Math.min(state.cursor, textLength),
  };
}

/**
 * Completes the target if it is fully typed: the cursor is at the end and, under `backspace`, no
 * char is still wrong. Emits `targetComplete` when it does.
 *
 * - `accuracy`: correct keystrokes / all keystrokes on this target (0–1).
 * - `durationMs`: from the target's first key to `t`, minus paused time.
 * - `errors`: positions that took at least one wrong key (each counted once).
 *
 * `pendingPauseMs` is the part of a pause still in progress at `t`. `resumeTarget` has not
 * credited it yet, so it is left out of `durationMs` here.
 */
export function settleTarget(
  state: TargetState,
  t: Ms,
  policy: WrongKeyPolicy,
  pendingPauseMs: Ms = 0,
): MatchResult {
  const typedOut = state.cursor === state.chars.length;
  const blocked = policy === "backspace" && state.marks.includes("wrong");
  if (state.complete || !typedOut || blocked) return { state, events: [] };
  const keystrokes = state.correct + state.wrong;
  return {
    state: { ...state, complete: true },
    events: [
      {
        type: "targetComplete",
        t,
        targetId: state.id,
        accuracy: keystrokes === 0 ? 1 : state.correct / keystrokes,
        durationMs: Math.max(0, t - (state.startedT ?? t) - state.pausedMs - pendingPauseMs),
        errors: state.erred.filter(Boolean).length,
      },
    ],
  };
}

function applyBackspace(state: TargetState, t: Ms, policy: WrongKeyPolicy): MatchResult {
  // `stay` never moves back. At the start there is nothing to take back (the session turns that
  // into an unlock under lockOn). An ignored Backspace leaves the state untouched.
  if (policy === "stay" || state.cursor === 0) return { state, events: [] };
  const index = state.cursor - 1;
  return {
    state: {
      ...state,
      cursor: index,
      marks: replaceAt(state.marks, index, "pending"),
      startedT: state.startedT ?? t,
      lastT: t,
    },
    events: [{ type: "backspace", t, targetId: state.id, index }],
  };
}

/**
 * Applies one key to one target and returns the new state and its events.
 *
 * A right key marks the position `ok` (or `fixed` if it ever took a wrong key) and advances. A
 * wrong key marks it `wrong`; the cursor stays under `stay` and advances under `skip` and
 * `backspace`. Under `backspace` a target that is typed to the end but still holds wrong chars takes
 * every further key as `wrong` with `expected: null`, until the learner backspaces.
 *
 * Backspace does nothing under `stay` and nothing at the start of the target; otherwise it moves
 * back one position and clears its mark.
 *
 * `latencyMs` is the time since the previous key that reached this target, or `null` if there was
 * none (first key, or first key after {@link resumeTarget} / {@link releaseTarget}).
 *
 * A complete target ignores every key.
 */
export function applyKey(
  state: TargetState,
  input: KeyInput,
  policy: WrongKeyPolicy,
  caseSensitive = true,
): MatchResult {
  if (state.complete) return { state, events: [] };
  const { key, t } = input;
  if (key === BACKSPACE) return applyBackspace(state, t, policy);

  const index = state.cursor;
  const expected = state.chars[index];
  const timed = { ...state, startedT: state.startedT ?? t, lastT: t };

  if (expected === undefined) {
    return {
      state: { ...timed, wrong: state.wrong + 1 },
      events: [{ type: "wrong", t, targetId: state.id, index, expected: null, got: key }],
    };
  }

  if (!keyMatches(expected, key, caseSensitive)) {
    const missed: TargetState = {
      ...timed,
      cursor: policy === "stay" ? index : index + 1,
      marks: replaceAt(state.marks, index, "wrong"),
      erred: replaceAt(state.erred, index, true),
      wrong: state.wrong + 1,
    };
    const settled = settleTarget(missed, t, policy);
    return {
      state: settled.state,
      events: [
        { type: "wrong", t, targetId: state.id, index, expected, got: key },
        ...settled.events,
      ],
    };
  }

  const hit: TargetState = {
    ...timed,
    cursor: index + 1,
    marks: replaceAt(state.marks, index, state.erred[index] === true ? "fixed" : "ok"),
    correct: state.correct + 1,
  };
  const latencyMs = state.lastT === null ? null : Math.max(0, t - state.lastT);
  const settled = settleTarget(hit, t, policy);
  return {
    state: settled.state,
    events: [
      { type: "correct", t, targetId: state.id, index, char: expected, latencyMs },
      ...settled.events,
    ],
  };
}

/**
 * The session resumed after `pausedMs` of pause: the next latency is `null`, and the pause is left
 * out of the target's `durationMs`. A target that has not started is unchanged.
 */
export function resumeTarget(state: TargetState, pausedMs: Ms): TargetState {
  if (state.startedT === null) return state;
  return { ...state, lastT: null, pausedMs: state.pausedMs + pausedMs };
}

/** The target lost its lock: its timing starts over when it is locked again. */
export function releaseTarget(state: TargetState): TargetState {
  return { ...state, startedT: null, lastT: null, pausedMs: 0 };
}

/**
 * `lockOn` under `stay`: the learner let go of the target. Its typed progress goes back to 0 and
 * its timing starts over. The keystroke counters and the positions that took a wrong key are kept.
 */
export function resetTarget(state: TargetState): TargetState {
  return { ...releaseTarget(state), cursor: 0, marks: state.marks.map(() => "pending") };
}

/** The read model of one target. */
export function targetView(state: TargetState, locked: boolean): TargetView {
  return {
    id: state.id,
    text: state.text,
    typed: state.cursor,
    marks: [...state.marks],
    locked,
    complete: state.complete,
  };
}
