/**
 * The policy and targeting rules of docs/impl/contracts.md §3.2–3.3, one table row per rule.
 *
 * Each row is a script (keys and session calls) and the exact events it must produce, written in
 * the short form of `brief()` below.
 */
import { describe, expect, it } from "vitest";
import { createSession } from "../../../src/engine/session";
import type { EngineEvent, SessionConfig, Target, TypingSession } from "../../../src/engine/types";

type Step =
  | { key: string; t: number }
  | { pause: number }
  | { resume: number }
  | { remove: string; t: number }
  | { add: Target[] }
  | { end: number };

function config(over: Partial<SessionConfig> = {}): SessionConfig {
  return {
    policy: "stay",
    targeting: "sequential",
    caseSensitive: true,
    end: { kind: "manual" },
    mode: "mine",
    seed: 1,
    ...over,
  };
}

/** Keys 100 ms apart, starting at t = 0. */
function keys(...list: string[]): Step[] {
  return list.map((key, i) => ({ key, t: i * 100 }));
}

function brief(event: EngineEvent): string {
  switch (event.type) {
    case "correct":
      return `ok ${event.targetId}[${event.index}] '${event.char}' ~${event.latencyMs}`;
    case "wrong":
      return `no ${event.targetId}[${event.index}] want=${event.expected} got=${event.got}`;
    case "backspace":
      return `bs ${event.targetId}[${event.index}]`;
    case "targetLocked":
      return `lock ${event.targetId}`;
    case "targetUnlocked":
      return `unlock ${event.targetId}`;
    case "targetComplete":
      return `done ${event.targetId} acc=${event.accuracy} ms=${event.durationMs} err=${event.errors}`;
    case "streak":
      return `streak ${event.length}`;
    case "streakBroken":
      return `broke ${event.length}`;
    case "paused":
      return "paused";
    case "resumed":
      return "resumed";
    default:
      return "end";
  }
}

function run(session: TypingSession, steps: readonly Step[]): string[][] {
  return steps.map((step) => {
    if ("key" in step) return session.feed({ key: step.key, t: step.t, shift: false }).map(brief);
    if ("pause" in step) return session.pause(step.pause).map(brief);
    if ("resume" in step) return session.resume(step.resume).map(brief);
    if ("remove" in step) return session.removeTarget(step.remove, step.t).map(brief);
    if ("add" in step) {
      session.addTargets(step.add);
      return [];
    }
    return session.end(step.end).map(brief);
  });
}

interface Row {
  rule: string;
  config?: Partial<SessionConfig>;
  targets: Target[];
  steps: Step[];
  /** The events of each step, in order. */
  events: string[][];
  /** Marks of every remaining target after the script, joined: o = ok, f = fixed, x = wrong, . = pending. */
  marks?: Record<string, string>;
}

const MARK = { pending: ".", ok: "o", fixed: "f", wrong: "x" } as const;

const word = (id: string, text: string, more: Partial<Target> = {}): Target => ({
  id,
  text,
  ...more,
});

const ROWS: Row[] = [
  // ── stay ───────────────────────────────────────────────────────────────────────────────────
  {
    rule: "stay: a wrong key does not move the cursor, and repeated wrong keys are one error position",
    targets: [word("a", "as")],
    steps: keys("x", "y", "a", "s"),
    events: [
      ["no a[0] want=a got=x"],
      ["no a[0] want=a got=y"],
      ["ok a[0] 'a' ~100", "streak 1"],
      ["ok a[1] 's' ~100", "streak 2", "done a acc=0.5 ms=300 err=1"],
    ],
    marks: { a: "fo" },
  },
  {
    rule: "stay: Backspace is ignored and makes no event",
    targets: [word("a", "as")],
    steps: keys("a", "Backspace", "s"),
    events: [
      ["ok a[0] 'a' ~null", "streak 1"],
      [],
      ["ok a[1] 's' ~200", "streak 2", "done a acc=1 ms=200 err=0"],
    ],
  },
  {
    rule: "stay: the position shows as wrong until the right key lands",
    targets: [word("a", "as")],
    steps: keys("a", "x"),
    events: [
      ["ok a[0] 'a' ~null", "streak 1"],
      ["no a[1] want=s got=x", "broke 1"],
    ],
    marks: { a: "ox" },
  },
  // ── skip ───────────────────────────────────────────────────────────────────────────────────
  {
    rule: "skip: a wrong key advances and the target completes with the position still wrong",
    config: { policy: "skip" },
    targets: [word("a", "cat")],
    steps: keys("c", "x", "t"),
    events: [
      ["ok a[0] 'c' ~null", "streak 1"],
      ["no a[1] want=a got=x", "broke 1"],
      ["ok a[2] 't' ~100", "streak 1", `done a acc=${2 / 3} ms=200 err=1`],
    ],
    marks: { a: "oxo" },
  },
  {
    rule: "skip: Backspace past index 0 moves back and un-marks the position",
    config: { policy: "skip" },
    targets: [word("a", "cat")],
    steps: keys("c", "x", "Backspace", "a", "t"),
    events: [
      ["ok a[0] 'c' ~null", "streak 1"],
      ["no a[1] want=a got=x", "broke 1"],
      ["bs a[1]"],
      ["ok a[1] 'a' ~100", "streak 1"],
      ["ok a[2] 't' ~100", "streak 2", "done a acc=0.75 ms=400 err=1"],
    ],
    marks: { a: "ofo" },
  },
  {
    rule: "skip: Backspace at index 0 is ignored",
    config: { policy: "skip" },
    targets: [word("a", "cat")],
    steps: keys("Backspace", "c"),
    events: [[], ["ok a[0] 'c' ~null", "streak 1"]],
  },
  {
    rule: "skip: a wrong last key still completes the target",
    config: { policy: "skip" },
    targets: [word("a", "as")],
    steps: keys("a", "x"),
    events: [
      ["ok a[0] 'a' ~null", "streak 1"],
      ["no a[1] want=s got=x", "broke 1", "done a acc=0.5 ms=100 err=1"],
    ],
    marks: { a: "ox" },
  },
  // ── backspace ──────────────────────────────────────────────────────────────────────────────
  {
    rule: "backspace: a target can't complete while it holds a wrong char; keys past the end are wrong",
    config: { policy: "backspace" },
    targets: [word("a", "ab")],
    steps: keys("a", "x", "b", "Backspace", "b"),
    events: [
      ["ok a[0] 'a' ~null", "streak 1"],
      ["no a[1] want=b got=x", "broke 1"],
      ["no a[2] want=null got=b"],
      ["bs a[1]"],
      ["ok a[1] 'b' ~100", "streak 1", "done a acc=0.5 ms=400 err=1"],
    ],
    marks: { a: "of" },
  },
  {
    rule: "backspace: backspacing past a wrong char to fix it",
    config: { policy: "backspace" },
    targets: [word("a", "abc")],
    steps: keys("a", "x", "c", "Backspace", "Backspace", "b", "c"),
    events: [
      ["ok a[0] 'a' ~null", "streak 1"],
      ["no a[1] want=b got=x", "broke 1"],
      ["ok a[2] 'c' ~100", "streak 1"],
      ["bs a[2]"],
      ["bs a[1]"],
      ["ok a[1] 'b' ~100", "streak 2"],
      ["ok a[2] 'c' ~100", "streak 3", "done a acc=0.8 ms=600 err=1"],
    ],
    marks: { a: "ofo" },
  },
  {
    rule: "backspace: Backspace at the start of a sequential target is ignored",
    config: { policy: "backspace" },
    targets: [word("a", "hi"), word("b", "yo")],
    steps: keys("h", "i", " ", "Backspace", "y"),
    events: [
      ["ok a[0] 'h' ~null", "streak 1"],
      ["ok a[1] 'i' ~100", "streak 2"],
      ["ok a[2] ' ' ~100", "streak 3", "done a acc=1 ms=200 err=0"],
      [],
      ["ok b[0] 'y' ~null", "streak 4"],
    ],
  },
  {
    rule: "backspace: Backspace also takes back a correct char",
    config: { policy: "backspace" },
    targets: [word("a", "ab")],
    steps: keys("a", "Backspace", "a", "b"),
    events: [
      ["ok a[0] 'a' ~null", "streak 1"],
      ["bs a[0]"],
      ["ok a[0] 'a' ~100", "streak 2"],
      ["ok a[1] 'b' ~100", "streak 3", "done a acc=1 ms=300 err=0"],
    ],
    marks: { a: "oo" },
  },
  // ── sequential: the space between targets ──────────────────────────────────────────────────
  {
    rule: "sequential: the space between words is a real char of the target it trails",
    targets: [word("a", "hi"), word("b", "yo")],
    steps: keys("h", "i", " ", "y", "o"),
    events: [
      ["ok a[0] 'h' ~null", "streak 1"],
      ["ok a[1] 'i' ~100", "streak 2"],
      ["ok a[2] ' ' ~100", "streak 3", "done a acc=1 ms=200 err=0"],
      ["ok b[0] 'y' ~null", "streak 4"],
      ["ok b[1] 'o' ~100", "streak 5", "done b acc=1 ms=100 err=0"],
    ],
    marks: { a: "ooo", b: "oo" },
  },
  {
    rule: "sequential: a wrong key at the space follows the policy",
    targets: [word("a", "hi"), word("b", "yo")],
    steps: keys("h", "i", "y", " "),
    events: [
      ["ok a[0] 'h' ~null", "streak 1"],
      ["ok a[1] 'i' ~100", "streak 2"],
      ["no a[2] want=  got=y", "broke 2"],
      ["ok a[2] ' ' ~100", "streak 1", "done a acc=0.75 ms=300 err=1"],
    ],
    marks: { a: "oof", b: ".." },
  },
  {
    rule: "sequential: single letters need no space",
    targets: [word("a", "f"), word("b", "j")],
    steps: keys("f", "j"),
    events: [
      ["ok a[0] 'f' ~null", "streak 1", "done a acc=1 ms=0 err=0"],
      ["ok b[0] 'j' ~null", "streak 2", "done b acc=1 ms=0 err=0"],
    ],
  },
  {
    rule: "sequential: trailingSpace overrides the default both ways",
    targets: [
      word("a", "f", { trailingSpace: true }),
      word("b", "hi", { trailingSpace: false }),
      word("c", "j"),
    ],
    steps: keys("f", " ", "h", "i", "j"),
    events: [
      ["ok a[0] 'f' ~null", "streak 1"],
      ["ok a[1] ' ' ~100", "streak 2", "done a acc=1 ms=100 err=0"],
      ["ok b[0] 'h' ~null", "streak 3"],
      ["ok b[1] 'i' ~100", "streak 4", "done b acc=1 ms=100 err=0"],
      ["ok c[0] 'j' ~null", "streak 5", "done c acc=1 ms=0 err=0"],
    ],
  },
  {
    rule: "sequential: the last target needs no space, and a key fed when no target remains is ignored",
    targets: [word("a", "hi")],
    steps: keys("h", "i", " ", "Backspace"),
    events: [
      ["ok a[0] 'h' ~null", "streak 1"],
      ["ok a[1] 'i' ~100", "streak 2", "done a acc=1 ms=100 err=0"],
      [],
      [],
    ],
  },
  {
    rule: "sequential: a target added behind the current one gives it a trailing space",
    targets: [word("a", "hi")],
    steps: [
      { key: "h", t: 0 },
      { add: [word("b", "yo")] },
      { key: "i", t: 100 },
      { key: " ", t: 200 },
    ],
    events: [
      ["ok a[0] 'h' ~null", "streak 1"],
      [],
      ["ok a[1] 'i' ~100", "streak 2"],
      ["ok a[2] ' ' ~100", "streak 3", "done a acc=1 ms=200 err=0"],
    ],
  },
  {
    rule: "sequential: removing the next target completes a target that only waited for its space",
    targets: [word("a", "hi"), word("b", "yo")],
    steps: [
      { key: "h", t: 0 },
      { key: "i", t: 100 },
      { remove: "b", t: 300 },
    ],
    events: [
      ["ok a[0] 'h' ~null", "streak 1"],
      ["ok a[1] 'i' ~100", "streak 2"],
      ["done a acc=1 ms=300 err=0"],
    ],
    marks: { a: "oo" },
  },
  {
    rule: "sequential: removing the current target moves on to the next",
    targets: [word("a", "hi"), word("b", "yo")],
    steps: [
      { key: "h", t: 0 },
      { remove: "a", t: 50 },
      { key: "y", t: 100 },
      { remove: "nope", t: 150 },
    ],
    events: [["ok a[0] 'h' ~null", "streak 1"], [], ["ok b[0] 'y' ~null", "streak 2"], []],
    marks: { b: "o." },
  },
  // ── case ───────────────────────────────────────────────────────────────────────────────────
  {
    rule: "caseSensitive false: an upper-case key is accepted for a lower-case char, never the reverse",
    config: { caseSensitive: false },
    targets: [word("a", "a"), word("b", "B")],
    steps: keys("A", "b", "B"),
    events: [
      ["ok a[0] 'a' ~null", "streak 1", "done a acc=1 ms=0 err=0"],
      ["no b[0] want=B got=b", "broke 1"],
      ["ok b[0] 'B' ~100", "streak 1", "done b acc=0.5 ms=100 err=1"],
    ],
  },
  {
    rule: "caseSensitive true: the case must match",
    targets: [word("a", "a")],
    steps: keys("A", "a"),
    events: [
      ["no a[0] want=a got=A"],
      ["ok a[0] 'a' ~100", "streak 1", "done a acc=0.5 ms=100 err=1"],
    ],
  },
  {
    rule: "caseSensitive false: an upper-case key also locks a lower-case target",
    config: { targeting: "lockOn", caseSensitive: false },
    targets: [word("a", "sun")],
    steps: keys("S"),
    events: [["lock a", "ok a[0] 's' ~null", "streak 1"]],
  },
  // ── lockOn ─────────────────────────────────────────────────────────────────────────────────
  {
    rule: "lockOn: a tie goes to the lowest priority",
    config: { targeting: "lockOn" },
    targets: [
      word("far", "sun", { priority: 5 }),
      word("near", "sky", { priority: 1 }),
      word("mid", "sea", { priority: 3 }),
    ],
    steps: keys("s"),
    events: [["lock near", "ok near[0] 's' ~null", "streak 1"]],
  },
  {
    rule: "lockOn: equal priorities go to the earliest added",
    config: { targeting: "lockOn" },
    targets: [word("first", "sun", { priority: 2 }), word("second", "sky", { priority: 2 })],
    steps: [{ add: [word("third", "sea", { priority: 2 })] }, { key: "s", t: 0 }],
    events: [[], ["lock first", "ok first[0] 's' ~null", "streak 1"]],
  },
  {
    rule: "lockOn: a target with a priority beats one without, in any order",
    config: { targeting: "lockOn" },
    targets: [word("plain", "sun"), word("ranked", "sky", { priority: 9 })],
    steps: keys("s"),
    events: [["lock ranked", "ok ranked[0] 's' ~null", "streak 1"]],
  },
  {
    rule: "lockOn: a key that starts no target is a miss with targetId null, and breaks the streak",
    config: { targeting: "lockOn" },
    targets: [word("a", "f"), word("b", "jk")],
    steps: keys("f", "x", "Backspace"),
    events: [
      ["lock a", "ok a[0] 'f' ~null", "streak 1", "done a acc=1 ms=0 err=0"],
      ["no null[null] want=null got=x", "broke 1"],
      [],
    ],
  },
  {
    rule: "lockOn: while locked, input goes to that target only and a wrong key follows the policy",
    config: { targeting: "lockOn" },
    targets: [word("a", "sun"), word("b", "ugh")],
    steps: keys("s", "u", "g", "n"),
    events: [
      ["lock a", "ok a[0] 's' ~null", "streak 1"],
      ["ok a[1] 'u' ~100", "streak 2"],
      ["no a[2] want=n got=g", "broke 2"],
      ["ok a[2] 'n' ~100", "streak 1", "done a acc=0.75 ms=300 err=1"],
    ],
    marks: { a: "oof", b: "..." },
  },
  {
    rule: "lockOn: a completed target releases the lock without an unlock event, and can't be locked again",
    config: { targeting: "lockOn" },
    targets: [word("a", "so"), word("b", "sun")],
    steps: keys("s", "o", "s"),
    events: [
      ["lock a", "ok a[0] 's' ~null", "streak 1"],
      ["ok a[1] 'o' ~100", "streak 2", "done a acc=1 ms=100 err=0"],
      ["lock b", "ok b[0] 's' ~null", "streak 3"],
    ],
  },
  {
    rule: "lockOn: trailingSpace is ignored",
    config: { targeting: "lockOn" },
    targets: [word("a", "hi", { trailingSpace: true }), word("b", "yo")],
    steps: keys("h", "i"),
    events: [
      ["lock a", "ok a[0] 'h' ~null", "streak 1"],
      ["ok a[1] 'i' ~100", "streak 2", "done a acc=1 ms=100 err=0"],
    ],
  },
  {
    rule: "lockOn + backspace: Backspace with 0 typed chars unlocks",
    config: { targeting: "lockOn", policy: "backspace" },
    targets: [word("a", "sun"), word("b", "top")],
    steps: keys("s", "Backspace", "Backspace", "Backspace", "t"),
    events: [
      ["lock a", "ok a[0] 's' ~null", "streak 1"],
      ["bs a[0]"],
      ["unlock a"],
      [],
      ["lock b", "ok b[0] 't' ~null", "streak 2"],
    ],
    marks: { a: "...", b: "o.." },
  },
  {
    rule: "lockOn + skip: Backspace back to 0, then once more, unlocks",
    config: { targeting: "lockOn", policy: "skip" },
    targets: [word("a", "sun")],
    steps: keys("s", "x", "Backspace", "Backspace", "Backspace", "s"),
    events: [
      ["lock a", "ok a[0] 's' ~null", "streak 1"],
      ["no a[1] want=u got=x", "broke 1"],
      ["bs a[1]"],
      ["bs a[0]"],
      ["unlock a"],
      ["lock a", "ok a[0] 's' ~null", "streak 1"],
    ],
  },
  {
    rule: "lockOn + stay: Backspace while locked unlocks and resets the target",
    config: { targeting: "lockOn" },
    targets: [word("a", "sun"), word("b", "top")],
    steps: keys("s", "u", "x", "Backspace", "Backspace", "t", "o", "p", "s", "u", "n"),
    events: [
      ["lock a", "ok a[0] 's' ~null", "streak 1"],
      ["ok a[1] 'u' ~100", "streak 2"],
      ["no a[2] want=n got=x", "broke 2"],
      ["unlock a"],
      [],
      ["lock b", "ok b[0] 't' ~null", "streak 1"],
      ["ok b[1] 'o' ~100", "streak 2"],
      ["ok b[2] 'p' ~100", "streak 3", "done b acc=1 ms=200 err=0"],
      // Back to "sun" from the start. Its earlier keystrokes still count: 5 right, 1 wrong.
      ["lock a", "ok a[0] 's' ~null", "streak 4"],
      ["ok a[1] 'u' ~100", "streak 5"],
      ["ok a[2] 'n' ~100", "streak 6", `done a acc=${5 / 6} ms=200 err=1`],
    ],
    marks: { a: "oof", b: "ooo" },
  },
  {
    rule: "lockOn + stay: the reset target shows no progress",
    config: { targeting: "lockOn" },
    targets: [word("a", "sun")],
    steps: keys("s", "x", "Backspace"),
    events: [
      ["lock a", "ok a[0] 's' ~null", "streak 1"],
      ["no a[1] want=u got=x", "broke 1"],
      ["unlock a"],
    ],
    marks: { a: "..." },
  },
  {
    rule: "sequential + stay: Backspace never unlocks or resets",
    targets: [word("a", "sun")],
    steps: keys("s", "Backspace", "u"),
    events: [["ok a[0] 's' ~null", "streak 1"], [], ["ok a[1] 'u' ~200", "streak 2"]],
    marks: { a: "oo." },
  },
  {
    rule: "lockOn + skip: a locked target completes with its wrong chars",
    config: { targeting: "lockOn", policy: "skip" },
    targets: [word("a", "so")],
    steps: keys("s", "x"),
    events: [
      ["lock a", "ok a[0] 's' ~null", "streak 1"],
      ["no a[1] want=o got=x", "broke 1", "done a acc=0.5 ms=100 err=1"],
    ],
  },
  {
    rule: "lockOn: removing the locked target unlocks it and counts no error",
    config: { targeting: "lockOn" },
    targets: [word("a", "sun"), word("b", "top")],
    steps: [
      { key: "s", t: 0 },
      { remove: "a", t: 100 },
      { key: "s", t: 200 },
      { remove: "b", t: 300 },
    ],
    events: [
      ["lock a", "ok a[0] 's' ~null", "streak 1"],
      ["unlock a"],
      ["no null[null] want=null got=s", "broke 1"],
      [],
    ],
    marks: {},
  },
  {
    rule: "lockOn: targets added mid-session can be locked",
    config: { targeting: "lockOn" },
    targets: [],
    steps: [{ key: "s", t: 0 }, { add: [word("a", "sun")] }, { key: "s", t: 100 }],
    events: [["no null[null] want=null got=s"], [], ["lock a", "ok a[0] 's' ~null", "streak 1"]],
  },
  // ── latency, pause ─────────────────────────────────────────────────────────────────────────
  {
    rule: "latency: null for the first char of a target and for the first keystroke after resumed",
    targets: [word("a", "abcd")],
    steps: [
      { key: "a", t: 0 },
      { key: "b", t: 100 },
      { pause: 150 },
      { pause: 160 },
      { key: "x", t: 500 },
      { resume: 1000 },
      { resume: 1010 },
      { key: "c", t: 1100 },
      { key: "d", t: 1250 },
    ],
    events: [
      ["ok a[0] 'a' ~null", "streak 1"],
      ["ok a[1] 'b' ~100", "streak 2"],
      ["paused"],
      [],
      [],
      ["resumed"],
      [],
      ["ok a[2] 'c' ~null", "streak 3"],
      // 1250 ms of wall time minus the 850 ms pause.
      ["ok a[3] 'd' ~150", "streak 4", "done a acc=1 ms=400 err=0"],
    ],
  },
  {
    rule: "latency: resets after resume for a locked target too",
    config: { targeting: "lockOn" },
    targets: [word("a", "sun")],
    steps: [{ key: "s", t: 0 }, { pause: 10 }, { resume: 20 }, { key: "u", t: 30 }],
    events: [
      ["lock a", "ok a[0] 's' ~null", "streak 1"],
      ["paused"],
      ["resumed"],
      ["ok a[1] 'u' ~null", "streak 2"],
    ],
  },
  {
    rule: "keys that are not one char or Backspace are ignored",
    targets: [word("a", "as")],
    steps: keys("Shift", "", "Enter", "a"),
    events: [[], [], [], ["ok a[0] 'a' ~null", "streak 1"]],
  },
  {
    rule: "end: `targets` ends the session with the last target",
    config: { end: { kind: "targets" } },
    targets: [word("a", "f"), word("b", "j")],
    steps: keys("f", "j"),
    events: [
      ["ok a[0] 'f' ~null", "streak 1", "done a acc=1 ms=0 err=0"],
      ["ok b[0] 'j' ~null", "streak 2", "done b acc=1 ms=0 err=0", "end"],
    ],
  },
];

describe("policy and targeting rules (contracts §3.2–3.3)", () => {
  it.each(ROWS)("$rule", (row) => {
    const session = createSession(config(row.config), row.targets);
    expect(run(session, row.steps)).toEqual(row.events);
    if (row.marks !== undefined) {
      const marks = Object.fromEntries(
        session.view().targets.map((t) => [t.id, t.marks.map((m) => MARK[m]).join("")]),
      );
      expect(marks).toEqual(row.marks);
    }
  });

  it.each(["stay", "skip", "backspace"] as const)(
    "every policy × targeting combination types a clean word the same way (%s)",
    (policy) => {
      for (const targeting of ["sequential", "lockOn"] as const) {
        const session = createSession(config({ policy, targeting }), [word("a", "go")]);
        const events = run(session, keys("g", "o")).flat();
        expect(events.filter((e) => !e.startsWith("lock"))).toEqual([
          "ok a[0] 'g' ~null",
          "streak 1",
          "ok a[1] 'o' ~100",
          "streak 2",
          "done a acc=1 ms=100 err=0",
        ]);
        expect(events.includes("lock a")).toBe(targeting === "lockOn");
      }
    },
  );
});

describe("view", () => {
  it("sequential: active is the current target, and nothing is locked", () => {
    const session = createSession(config(), [word("a", "hi"), word("b", "yo")]);
    run(session, keys("h", "x"));
    const view = session.view();
    expect(view.active).toEqual({
      id: "a",
      text: "hi",
      typed: 1,
      // h, i, and the space before "yo"
      marks: ["ok", "wrong", "pending"],
      locked: false,
      complete: false,
    });
    expect(view.targets.map((t) => [t.id, t.typed, t.locked, t.complete])).toEqual([
      ["a", 1, false, false],
      ["b", 0, false, false],
    ]);
    expect(view.streak).toBe(0);
  });

  it("sequential: completed targets stay in view until removed; active is null at the end", () => {
    const session = createSession(config(), [word("a", "f")]);
    run(session, keys("f"));
    const view = session.view();
    expect(view.active).toBeNull();
    expect(view.targets).toEqual([
      { id: "a", text: "f", typed: 1, marks: ["ok"], locked: false, complete: true },
    ]);
    session.removeTarget("a", 10);
    expect(session.view().targets).toEqual([]);
  });

  it("lockOn: active is null until a target is locked", () => {
    const session = createSession(config({ targeting: "lockOn" }), [
      word("a", "sun"),
      word("b", "top"),
    ]);
    expect(session.view().active).toBeNull();
    run(session, keys("t"));
    const view = session.view();
    expect(view.active).toMatchObject({ id: "b", typed: 1, locked: true });
    expect(view.targets.map((t) => t.locked)).toEqual([false, true]);
    expect(view.streak).toBe(1);
  });
});
