/**
 * The typing session (docs/impl/contracts.md §3.4). Pure.
 *
 * This file is orchestration: which target a key goes to (sequential order or lock-on), the streak,
 * the session clock, pausing, ending, and the input log. What a key does to a target is in
 * `./matcher`. The summary counters sit behind {@link SummaryAccumulator}, at the bottom of the
 * file, until `stats.ts` (M1-04) supplies the real one.
 */
import type { Ms } from "@/types/core";
import {
  applyKey,
  BACKSPACE,
  createTargetState,
  keyMatches,
  releaseTarget,
  resumeTarget,
  settleTarget,
  targetView,
  wantsTrailingSpace,
  withTrailingSpace,
} from "./matcher";
import type { TargetEvent, TargetState } from "./matcher";
import type { KeyAgg, SessionSummary } from "./stats";
import type {
  EngineEvent,
  KeyInput,
  SessionConfig,
  SessionSnapshot,
  SessionView,
  Target,
  TypingSession,
} from "./types";

/** `liveWpm` and `liveAccuracy` look at this much active time… */
const LIVE_WINDOW_MS = 10_000;
/** …and stay 0 until the session has this much. */
const LIVE_MIN_MS = 2000;

interface Slot {
  state: TargetState;
  /** `lockOn` tie-break. A target without a `priority` comes after every target that has one. */
  readonly priority: number;
  readonly wantsSpace: boolean;
}

type LogEntry = SessionSnapshot["log"][number];

/** A key the engine acts on: Backspace, or exactly one char (by code point). */
function isTypingKey(key: string): boolean {
  return key === BACKSPACE || Array.from(key).length === 1;
}

/** Starts a session. The rules are on `SessionConfig`, `WrongKeyPolicy` and `TargetingMode`. */
export function createSession(config: SessionConfig, initialTargets: Target[]): TypingSession {
  const cfg = structuredClone(config);
  const initial = structuredClone(initialTargets);
  const sequential = cfg.targeting === "sequential";
  const log: LogEntry[] = [];
  const slots: Slot[] = [];
  const stats = newAccumulator();

  let lockedId: string | null = null;
  let streak = 0;
  let startedAtT: Ms | null = null;
  /** The latest time seen, once the session has started. Never goes backwards. */
  let lastT: Ms = 0;
  let activeMs: Ms = 0;
  let paused = false;
  let pausedAt: Ms = 0;
  let ended = false;
  /** Counted keystrokes inside the live window, stamped with the active time they arrived at. */
  let recent: { at: Ms; correct: boolean }[] = [];

  // ── clock ──────────────────────────────────────────────────────────────────────────────────

  /** Moves the session clock to `t`. Only unpaused time after the first key counts as active. */
  function tick(t: Ms): void {
    if (startedAtT === null) return;
    const now = Math.max(t, lastT);
    if (!paused) activeMs += now - lastT;
    lastT = now;
  }

  /** Active time so far. A `time` session never has more than its limit. */
  function elapsed(): Ms {
    return cfg.end.kind === "time" ? Math.min(activeMs, cfg.end.ms) : activeMs;
  }

  // ── targets ────────────────────────────────────────────────────────────────────────────────

  /** `sequential`: the first target not yet complete. `lockOn`: the locked target. */
  function activeSlot(): Slot | undefined {
    if (sequential) return slots.find((slot) => !slot.state.complete);
    return slots.find((slot) => slot.state.id === lockedId);
  }

  /**
   * `sequential` only: the current target requires its trailing space exactly while another target
   * follows it. Called whenever the queue or the current target changes.
   */
  function syncTrailingSpace(): void {
    if (!sequential) return;
    const index = slots.findIndex((slot) => !slot.state.complete);
    const slot = slots[index];
    if (slot === undefined) return;
    slot.state = withTrailingSpace(slot.state, slot.wantsSpace && index < slots.length - 1);
  }

  function insertTargets(targets: readonly Target[]): void {
    const ids = new Set(slots.map((slot) => slot.state.id));
    for (const target of targets) {
      if (target.text === "") throw new Error(`target "${target.id}" has no text`);
      if (ids.has(target.id)) throw new Error(`duplicate target id "${target.id}"`);
      ids.add(target.id);
    }
    for (const target of targets) {
      slots.push({
        state: createTargetState(target),
        priority: target.priority ?? Number.POSITIVE_INFINITY,
        wantsSpace: wantsTrailingSpace(target),
      });
    }
    syncTrailingSpace();
  }

  /** `lockOn`: the unlocked target this key starts. Lowest `priority` wins, then the earliest added. */
  function findLockable(key: string): Slot | undefined {
    let best: Slot | undefined;
    for (const slot of slots) {
      const first = slot.state.chars[0];
      if (slot.state.complete || first === undefined) continue;
      if (!keyMatches(first, key, cfg.caseSensitive)) continue;
      if (best === undefined || slot.priority < best.priority) best = slot;
    }
    return best;
  }

  // ── events ─────────────────────────────────────────────────────────────────────────────────

  function count(fact: KeystrokeFact): void {
    stats.keystroke(fact);
    recent.push({ at: activeMs, correct: fact.correct });
    recent = recent.filter((entry) => entry.at >= activeMs - LIVE_WINDOW_MS);
  }

  function breakStreak(t: Ms, out: EngineEvent[]): void {
    if (streak >= 1) out.push({ type: "streakBroken", t, length: streak });
    streak = 0;
  }

  function finish(t: Ms): EngineEvent[] {
    ended = true;
    let uncorrected = 0;
    if (cfg.policy === "skip") {
      for (const slot of slots) {
        uncorrected += slot.state.marks.filter((mark) => mark === "wrong").length;
      }
    }
    const summary = stats.summarize({
      config: cfg,
      startedAtT: startedAtT ?? t,
      activeMs: elapsed(),
      uncorrected,
    });
    return [{ type: "sessionEnd", t, summary }];
  }

  /**
   * Takes a target's events into the session: the streak, the counters, and what follows a
   * completion (release the lock, move on, maybe end the session). `before` is the target's state
   * before the key.
   */
  function absorb(events: readonly TargetEvent[], before: TargetState, out: EngineEvent[]): void {
    for (const event of events) {
      out.push(event);
      if (event.type === "correct") {
        streak += 1;
        out.push({ type: "streak", t: event.t, length: streak });
        count({
          t: event.t,
          correct: true,
          expected: event.char,
          got: event.char,
          previous: before.chars[event.index - 1] ?? null,
          latencyMs: event.latencyMs,
          repeat: false,
          streak,
        });
      } else if (event.type === "wrong") {
        const index = event.index ?? -1;
        breakStreak(event.t, out);
        count({
          t: event.t,
          correct: false,
          expected: event.expected,
          got: event.got,
          previous: before.chars[index - 1] ?? null,
          latencyMs: null,
          repeat: cfg.policy === "stay" && before.erred[index] === true,
          streak: 0,
        });
      } else if (event.type === "targetComplete") {
        stats.targetCompleted();
        lockedId = null;
        syncTrailingSpace();
        if (cfg.end.kind === "targets" && slots.every((slot) => slot.state.complete)) {
          out.push(...finish(event.t));
        }
      }
    }
  }

  /** A key that no target took: a `lockOn` miss, or a key typed when nothing is left to type. */
  function miss(input: KeyInput, out: EngineEvent[]): void {
    out.push({
      type: "wrong",
      t: input.t,
      targetId: null,
      index: null,
      expected: null,
      got: input.key,
    });
    breakStreak(input.t, out);
    count({
      t: input.t,
      correct: false,
      expected: null,
      got: input.key,
      previous: null,
      latencyMs: null,
      repeat: false,
      streak: 0,
    });
  }

  function strike(slot: Slot, input: KeyInput, out: EngineEvent[]): void {
    const before = slot.state;
    const result = applyKey(before, input, cfg.policy, cfg.caseSensitive);
    slot.state = result.state;
    absorb(result.events, before, out);
  }

  // ── the session ────────────────────────────────────────────────────────────────────────────

  function feed(input: KeyInput): EngineEvent[] {
    if (ended) throw new Error("feed after the session ended");
    log.push({ k: "key", input: { ...input } });
    if (paused || !isTypingKey(input.key)) return [];

    if (startedAtT === null) {
      startedAtT = input.t;
      lastT = input.t;
    }
    tick(input.t);
    if (cfg.end.kind === "time" && activeMs >= cfg.end.ms) return finish(input.t);

    const out: EngineEvent[] = [];
    const active = activeSlot();
    if (active !== undefined) {
      if (!sequential && input.key === BACKSPACE && active.state.cursor === 0) {
        active.state = releaseTarget(active.state);
        lockedId = null;
        out.push({ type: "targetUnlocked", t: input.t, targetId: active.state.id });
      } else {
        strike(active, input, out);
      }
      return out;
    }
    if (input.key === BACKSPACE) return out;

    const lockable = sequential ? undefined : findLockable(input.key);
    if (lockable === undefined) {
      miss(input, out);
      return out;
    }
    lockedId = lockable.state.id;
    out.push({ type: "targetLocked", t: input.t, targetId: lockable.state.id });
    strike(lockable, input, out);
    return out;
  }

  function addTargets(targets: Target[]): void {
    if (ended) return;
    insertTargets(targets);
    log.push({ k: "add", targets: structuredClone(targets) });
  }

  function removeTarget(id: string, t: Ms): EngineEvent[] {
    if (ended) return [];
    log.push({ k: "remove", id, t });
    tick(t);
    const index = slots.findIndex((slot) => slot.state.id === id);
    if (index === -1) return [];
    slots.splice(index, 1);

    const out: EngineEvent[] = [];
    if (lockedId === id) {
      lockedId = null;
      out.push({ type: "targetUnlocked", t, targetId: id });
    }
    // Removing the target after the current one can drop the current one's trailing space, and
    // that completes it if its text was already typed.
    syncTrailingSpace();
    const current = sequential ? activeSlot() : undefined;
    if (current !== undefined) {
      const before = current.state;
      const settled = settleTarget(before, t, cfg.policy);
      current.state = settled.state;
      absorb(settled.events, before, out);
    }
    return out;
  }

  function pause(t: Ms): EngineEvent[] {
    if (ended || paused) return [];
    log.push({ k: "pause", t });
    tick(t);
    paused = true;
    pausedAt = lastT;
    return [{ type: "paused", t }];
  }

  function resume(t: Ms): EngineEvent[] {
    if (ended || !paused) return [];
    log.push({ k: "resume", t });
    tick(t);
    paused = false;
    const active = activeSlot();
    if (active !== undefined) active.state = resumeTarget(active.state, lastT - pausedAt);
    return [{ type: "resumed", t }];
  }

  function end(t: Ms): EngineEvent[] {
    if (ended) return [];
    log.push({ k: "end", t });
    tick(t);
    return finish(t);
  }

  function view(): SessionView {
    const elapsedMs = elapsed();
    let liveWpm = 0;
    let liveAccuracy = 0;
    if (elapsedMs >= LIVE_MIN_MS) {
      const span = Math.min(LIVE_WINDOW_MS, elapsedMs);
      const inWindow = recent.filter((entry) => entry.at >= activeMs - span);
      const correct = inWindow.filter((entry) => entry.correct).length;
      liveWpm = correct / 5 / (span / 60_000);
      liveAccuracy = inWindow.length === 0 ? 1 : correct / inWindow.length;
    }
    const active = activeSlot();
    return {
      active: active === undefined ? null : targetView(active.state, !sequential),
      targets: slots.map((slot) => targetView(slot.state, slot.state.id === lockedId)),
      streak,
      elapsedMs,
      paused,
      ended,
      liveWpm,
      liveAccuracy,
    };
  }

  function snapshot(): SessionSnapshot {
    return structuredClone({ version: 1, config: cfg, initialTargets: initial, log });
  }

  insertTargets(initial);
  return { feed, addTargets, removeTarget, pause, resume, end, view, snapshot };
}

/**
 * Replays a snapshot's log into a new session and returns it with every event the replay produced,
 * in order. `restoreSession` is this without the events. Beyond the contract; the replay harness
 * (M1-07) reads the summary from the `sessionEnd` event here.
 */
export function replaySession(snap: SessionSnapshot): {
  session: TypingSession;
  events: EngineEvent[];
} {
  const version: number = snap.version;
  if (version !== 1) throw new Error(`unsupported session snapshot version: ${version}`);
  const session = createSession(snap.config, snap.initialTargets);
  const events: EngineEvent[] = [];
  for (const entry of snap.log) {
    if (entry.k === "key") events.push(...session.feed(entry.input));
    else if (entry.k === "add") session.addTargets(entry.targets);
    else if (entry.k === "remove") events.push(...session.removeTarget(entry.id, entry.t));
    else if (entry.k === "pause") events.push(...session.pause(entry.t));
    else if (entry.k === "resume") events.push(...session.resume(entry.t));
    else events.push(...session.end(entry.t));
  }
  return { session, events };
}

/**
 * Rebuilds a session by replaying the snapshot's log. The result must equal the original: the same
 * `view()` and the same events for the same future inputs.
 */
export function restoreSession(snap: SessionSnapshot): TypingSession {
  return replaySession(snap).session;
}

// ── Summary accumulator ────────────────────────────────────────────────────────────────────────
//
// The plug-in point for `stats.ts` (M1-04). The session reports facts through this interface and
// never does stats math itself. To plug the real accumulator in, point `newAccumulator` at it and
// delete `createLocalAccumulator`; nothing else in this file changes.

/** One counted keystroke: a non-Backspace key fed while the session was running. */
export interface KeystrokeFact {
  t: Ms;
  correct: boolean;
  /** The char the target expected. `null`: no target took the key, or the target was already full. */
  expected: string | null;
  /** The key as typed. For a correct key this is the expected char. */
  got: string;
  /** The expected char just before this one in the same target (for bigrams); `null` at index 0. */
  previous: string | null;
  /** As on the `correct` event. Always `null` for a wrong key. */
  latencyMs: Ms | null;
  /** `stay` only: another wrong key at a position that already took one. */
  repeat: boolean;
  /** The streak after this keystroke (0 after a wrong key). */
  streak: number;
}

/** What the session knows and the accumulator doesn't, handed over when the session ends. */
export interface SummaryContext {
  config: SessionConfig;
  startedAtT: Ms;
  /** Time spent unpaused; capped at the limit of a `time` session. */
  activeMs: Ms;
  /** Positions still marked wrong on targets that were not removed (`skip`); 0 otherwise. */
  uncorrected: number;
}

/** Collects one session's counters and turns them into the `SessionSummary`. */
export interface SummaryAccumulator {
  keystroke(fact: KeystrokeFact): void;
  targetCompleted(): void;
  summarize(context: SummaryContext): SessionSummary;
}

const MAX_KEY_LATENCIES = 200;
const MIN_CONSISTENCY_SAMPLES = 10;

function bump(table: Record<string, KeyAgg>, key: string, fact: KeystrokeFact): void {
  const agg = (table[key] ??= { attempts: 0, errors: 0, latencies: [] });
  agg.attempts += 1;
  if (!fact.correct) agg.errors += 1;
  if (fact.latencyMs !== null && agg.latencies.length < MAX_KEY_LATENCIES) {
    agg.latencies.push(fact.latencyMs);
  }
}

/** `1 − min(1, stddev / mean)`, with the population standard deviation; 0 under 10 samples. */
function consistencyOf(latencies: readonly Ms[]): number {
  if (latencies.length < MIN_CONSISTENCY_SAMPLES) return 0;
  const mean = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
  if (mean === 0) return 1;
  const variance =
    latencies.reduce((sum, value) => sum + (value - mean) ** 2, 0) / latencies.length;
  return 1 - Math.min(1, Math.sqrt(variance) / mean);
}

/**
 * The interim accumulator, with the formulas of contracts §3.5.
 *
 * Per-key and bigram counting: every keystroke aimed at an expected char is one attempt, and a wrong
 * one is one error, except a `repeat` (which only counts in the session totals). So mashing wrong
 * keys at one `stay` position is one error for that key, not ten.
 */
function createLocalAccumulator(): SummaryAccumulator {
  let keystrokes = 0;
  let correct = 0;
  let errors = 0;
  let longestStreak = 0;
  let targetsCompleted = 0;
  const perKey: Record<string, KeyAgg> = {};
  const bigrams: Record<string, KeyAgg> = {};
  const latencies: Ms[] = [];

  return {
    keystroke(fact) {
      keystrokes += 1;
      if (fact.correct) correct += 1;
      else errors += 1;
      longestStreak = Math.max(longestStreak, fact.streak);
      if (fact.latencyMs !== null) latencies.push(fact.latencyMs);
      if (fact.expected === null || fact.repeat) return;
      bump(perKey, fact.expected, fact);
      if (fact.previous !== null) bump(bigrams, fact.previous + fact.expected, fact);
    },
    targetCompleted() {
      targetsCompleted += 1;
    },
    summarize({ config, startedAtT, activeMs, uncorrected }) {
      const minutes = activeMs / 60_000;
      const rated = activeMs >= 1000;
      const grossWpm = rated ? correct / 5 / minutes : 0;
      return {
        ...(config.lessonId === undefined ? {} : { lessonId: config.lessonId }),
        mode: config.mode,
        seed: config.seed,
        startedAtT,
        activeMs,
        keystrokes,
        correct,
        errors,
        uncorrected,
        grossWpm,
        netWpm: rated ? Math.max(0, grossWpm - uncorrected / minutes) : 0,
        accuracy: keystrokes === 0 ? 1 : correct / keystrokes,
        consistency: consistencyOf(latencies),
        perKey: structuredClone(perKey),
        bigrams: structuredClone(bigrams),
        longestStreak,
        targetsCompleted,
      };
    },
  };
}

/** The accumulator every session uses. M1-04 points this at `createAccumulator` from `./stats`. */
const newAccumulator: () => SummaryAccumulator = createLocalAccumulator;
