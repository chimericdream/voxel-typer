/**
 * Typing engine types (docs/impl/contracts.md §3.1–3.4).
 *
 * The engine is a pure library (PLAN.md §6.3): no DOM, no three, no clock. Every timestamp comes in
 * as a parameter. Orchestrator-owned after M1-01.
 */
import type { GameModeId, LessonId, Ms } from "@/types/core";
import type { SessionSummary } from "./stats";

// ── 3.1 Input ────────────────────────────────────────────────────────────────────────────────

/** One keystroke, already normalized by `src/input/` (contracts §9). */
export interface KeyInput {
  /** `KeyboardEvent.key` after normalization: a single printable char, or `'Backspace'`. */
  key: string;
  /** When the key went down, on the monotonic clock. */
  t: Ms;
  shift: boolean;
  /** `KeyboardEvent.code`, for the on-screen keyboard only. The engine ignores it. */
  code?: string;
}

// ── 3.2 Configuration ────────────────────────────────────────────────────────────────────────

/**
 * What happens on a wrong key.
 *
 * - `stay`: the cursor does not move; the learner must hit the right key. Repeated wrong keys at
 *   the same position each count as a keystroke, but the position is only ONE uncorrected position.
 * - `skip`: the cursor advances, the position is marked wrong, and it counts as an uncorrected
 *   error.
 * - `backspace`: the cursor advances and shows the wrong char. The learner must Backspace and fix
 *   it: a target cannot complete while it holds wrong chars. Fixed positions count as corrected
 *   errors.
 *
 * Backspace itself: under `stay` it is ignored (no event), except while a `lockOn` target is
 * locked, where it unlocks and resets that target (see {@link TargetingMode}). Under `skip` it is
 * ignored at index 0; past that it moves back and un-marks the position. Under `backspace` it always
 * works inside the active target.
 */
export type WrongKeyPolicy = "stay" | "skip" | "backspace";

/**
 * How the engine picks the target a keystroke goes to.
 *
 * - `sequential`: targets are typed in array order (Mine, Minecart, practice).
 * - `lockOn`: no target is active until the learner types a char that starts some unlocked target.
 *   Ties go to the lowest `priority` value, then to the target added first. While locked, input
 *   goes to that target only, and a wrong key follows the policy. Backspace with 0 typed chars
 *   unlocks. Under `stay`, Backspace while locked unlocks and resets the target (Defense, Boss).
 */
export type TargetingMode = "sequential" | "lockOn";

/** A thing to type: a letter, a word, a phrase. */
export interface Target {
  id: string;
  /** The exact text to type. No leading or trailing whitespace. */
  text: string;
  /** `lockOn` tie-break; lower is preferred (for example, the mob closest to the base). */
  priority?: number;
  /**
   * `sequential` only: require a space after the text before the next target. Default `true` for
   * words and `false` for single letters. The space is a real char: it produces `correct` with
   * `char: ' '`, attributed to the target it trails.
   */
  trailingSpace?: boolean;
}

/** Fixed settings of one typing session. */
export interface SessionConfig {
  policy: WrongKeyPolicy;
  targeting: TargetingMode;
  /**
   * `false` only for Sprout early lessons: `'A'` is then accepted for `'a'`, never the other way
   * round.
   */
  caseSensitive: boolean;
  /**
   * When the session ends. `targets`: when every target is complete. `time`: on the first `feed` at
   * or after the deadline (paused time doesn't count), or when the mode calls `end`. `manual`: only
   * when the mode calls `end`.
   */
  end: { kind: "targets" } | { kind: "time"; ms: Ms } | { kind: "manual" };
  lessonId?: LessonId;
  mode: GameModeId;
  seed: number;
}

// ── 3.3 Events ───────────────────────────────────────────────────────────────────────────────

/**
 * Everything the engine reports. Narrow on `type`.
 *
 * - `correct`: `latencyMs` is the time since the previous keystroke **within the same target**. It
 *   is `null` for the first char of a target and for the first keystroke after `resumed`. The space
 *   between sequential targets arrives as `correct` with `char: ' '`, attributed to the target it
 *   trails.
 * - `wrong`: with `targetId: null` it is a `lockOn` keystroke that matched no target. That one
 *   counts toward accuracy (it is a keystroke) but toward no target's errors, and it breaks the
 *   streak.
 * - `backspace`: see {@link WrongKeyPolicy} for when Backspace does anything at all.
 * - `streak`: emitted on every correct char (`length` ≥ 1). The streak counts consecutive correct
 *   keystrokes across targets; any `wrong` resets it.
 * - `streakBroken`: `length` is the streak before the break; only emitted if it was ≥ 1.
 * - `sessionEnd`: ends the session. Feeding it afterwards throws.
 *
 * In `sequential`, a key fed when no target remains is ignored: no event, and it is not a keystroke.
 */
export type EngineEvent =
  | {
      type: "correct";
      t: Ms;
      targetId: string;
      index: number;
      char: string;
      latencyMs: Ms | null;
    }
  | {
      type: "wrong";
      t: Ms;
      targetId: string | null;
      index: number | null;
      expected: string | null;
      got: string;
    }
  | { type: "backspace"; t: Ms; targetId: string; index: number }
  | { type: "targetLocked"; t: Ms; targetId: string }
  | { type: "targetUnlocked"; t: Ms; targetId: string }
  | {
      type: "targetComplete";
      t: Ms;
      targetId: string;
      accuracy: number;
      durationMs: Ms;
      errors: number;
    }
  | { type: "streak"; t: Ms; length: number }
  | { type: "streakBroken"; t: Ms; length: number }
  | { type: "paused"; t: Ms }
  | { type: "resumed"; t: Ms }
  | { type: "sessionEnd"; t: Ms; summary: SessionSummary };

// ── 3.4 Session ──────────────────────────────────────────────────────────────────────────────

/**
 * A running typing session: a state machine that turns keystrokes into {@link EngineEvent}s.
 * Create one with `createSession` (`./session`).
 *
 * Time while paused does not count toward `elapsedMs`, WPM, or an `end: time` deadline. The engine
 * never reads a clock; every method that needs the time takes `t`.
 */
export interface TypingSession {
  /** Feeds one keystroke and returns the events it caused, in order. Throws after `end`. */
  feed(input: KeyInput): EngineEvent[];
  /** `lockOn`: may be called mid-session (new mobs). `sequential`: appends to the queue. */
  addTargets(targets: Target[]): void;
  /** Removes a target (a mob despawned, say). Unlocks it if it was locked. No errors are counted. */
  removeTarget(id: string, t: Ms): EngineEvent[];
  pause(t: Ms): EngineEvent[];
  resume(t: Ms): EngineEvent[];
  /** Ends the session and emits `sessionEnd`. Further feeds throw. */
  end(t: Ms): EngineEvent[];
  /** A cheap read model for rendering. */
  view(): SessionView;
  /** JSON-serializable. Includes the full input log, so the session can be replayed. */
  snapshot(): SessionSnapshot;
}

/** What the renderer needs to draw one target. */
export interface TargetView {
  id: string;
  text: string;
  /** The cursor position. */
  typed: number;
  /**
   * One mark per char: not typed yet, typed right, typed wrong then fixed, or still wrong. While a
   * trailing space is required there are `text.length + 1` entries; the last one is the space.
   */
  marks: ("pending" | "ok" | "fixed" | "wrong")[];
  locked: boolean;
  complete: boolean;
}

/** What the renderer needs to draw the session. */
export interface SessionView {
  /** `sequential`: the current target. `lockOn`: the locked target, or `null`. */
  active: TargetView | null;
  /** Every target that has not been removed. */
  targets: TargetView[];
  streak: number;
  /** Active time: paused time is not counted. */
  elapsedMs: Ms;
  paused: boolean;
  ended: boolean;
  /** Over the last 10 s of active time. 0 before 2 s of activity. */
  liveWpm: number;
  /** Over the last 10 s of active time. 0 before 2 s of activity. */
  liveAccuracy: number;
}

/** A session as data. `restoreSession` replays `log` and must arrive at the same state. */
export interface SessionSnapshot {
  version: 1;
  config: SessionConfig;
  initialTargets: Target[];
  log: (
    | { k: "key"; input: KeyInput }
    | { k: "add"; targets: Target[] }
    | { k: "remove"; id: string; t: Ms }
    | { k: "pause"; t: Ms }
    | { k: "resume"; t: Ms }
    | { k: "end"; t: Ms }
  )[];
}
