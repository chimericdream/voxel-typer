/**
 * `src/engine/matcher.ts` on its own: the per-target transitions are pure, and the corners the
 * session rarely reaches still behave.
 */
import { describe, expect, it } from "vitest";
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
} from "../../../src/engine/matcher";
import type { TargetState } from "../../../src/engine/matcher";
import type { WrongKeyPolicy } from "../../../src/engine/types";

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/** Types `keys` 100 ms apart, starting at `t0`. Every intermediate state is frozen. */
function type(
  state: TargetState,
  keys: readonly string[],
  policy: WrongKeyPolicy,
  t0 = 0,
): TargetState {
  let current = deepFreeze(state);
  keys.forEach((key, i) => {
    current = deepFreeze(applyKey(current, { key, t: t0 + i * 100, shift: false }, policy).state);
  });
  return current;
}

const fresh = (text: string): TargetState => createTargetState({ id: "a", text });

describe("createTargetState", () => {
  it("starts untyped, with one pending mark per char", () => {
    expect(fresh("hi")).toEqual({
      id: "a",
      text: "hi",
      chars: ["h", "i"],
      cursor: 0,
      marks: ["pending", "pending"],
      erred: [false, false],
      complete: false,
      startedT: null,
      lastT: null,
      pausedMs: 0,
      correct: 0,
      wrong: 0,
    });
  });

  it("treats a surrogate pair as one position", () => {
    const state = fresh("a🙂");
    expect(state.chars).toEqual(["a", "🙂"]);
    expect(type(state, ["a", "🙂"], "stay").complete).toBe(true);
  });
});

describe("applyKey", () => {
  it("never mutates the state it is given", () => {
    for (const policy of ["stay", "skip", "backspace"] as const) {
      // `type` freezes every state, so a mutation would throw.
      const end = type(
        withTrailingSpace(fresh("abc"), true),
        ["a", "x", BACKSPACE, "b", "c", "z", BACKSPACE, " ", " "],
        policy,
      );
      expect(end.correct + end.wrong).toBeGreaterThan(0);
    }
  });

  it("a complete target ignores every key", () => {
    const done = type(fresh("a"), ["a"], "stay");
    expect(done.complete).toBe(true);
    for (const key of ["a", "x", BACKSPACE]) {
      expect(applyKey(done, { key, t: 500, shift: false }, "backspace")).toEqual({
        state: done,
        events: [],
      });
    }
  });

  it("is case-sensitive unless told otherwise", () => {
    const input = { key: "A", t: 0, shift: true };
    expect(applyKey(fresh("a"), input, "stay").events[0]?.type).toBe("wrong");
    expect(applyKey(fresh("a"), input, "stay", false).events[0]).toMatchObject({
      type: "correct",
      char: "a",
    });
  });

  it("an ignored Backspace leaves the state untouched; a real one counts for latency", () => {
    const one = type(fresh("abc"), ["a"], "backspace");
    expect(applyKey(one, { key: BACKSPACE, t: 50, shift: false }, "stay").state).toBe(one);
    const start = fresh("abc");
    expect(applyKey(start, { key: BACKSPACE, t: 50, shift: false }, "backspace").state).toBe(start);

    const back = applyKey(one, { key: BACKSPACE, t: 50, shift: false }, "backspace").state;
    expect(back.lastT).toBe(50);
    expect(applyKey(back, { key: "a", t: 80, shift: false }, "backspace").events[0]).toMatchObject({
      type: "correct",
      latencyMs: 30,
    });
  });

  it("clamps a latency from out-of-order timestamps to 0", () => {
    const one = applyKey(fresh("ab"), { key: "a", t: 100, shift: false }, "stay").state;
    expect(applyKey(one, { key: "b", t: 40, shift: false }, "stay").events).toEqual([
      { type: "correct", t: 40, targetId: "a", index: 1, char: "b", latencyMs: 0 },
      { type: "targetComplete", t: 40, targetId: "a", accuracy: 1, durationMs: 0, errors: 0 },
    ]);
  });

  it("counts errors once per position, and keystrokes in accuracy", () => {
    const end = type(fresh("ab"), ["x", "y", "z", "a", "q", "b"], "stay");
    expect(end).toMatchObject({ complete: true, correct: 2, wrong: 4, marks: ["fixed", "fixed"] });
    const last = applyKey(
      type(fresh("ab"), ["x", "y", "z", "a", "q"], "stay"),
      { key: "b", t: 500, shift: false },
      "stay",
    ).events[1];
    expect(last).toEqual({
      type: "targetComplete",
      t: 500,
      targetId: "a",
      accuracy: 2 / 6,
      durationMs: 500,
      errors: 2,
    });
  });
});

describe("keyMatches", () => {
  it.each([
    ["a", "a", true, true],
    ["a", "A", true, false],
    ["a", "A", false, true],
    ["A", "a", false, false],
    ["A", "A", false, true],
    [";", ":", false, false],
  ])("expected %j, got %j, caseSensitive %j → %j", (expected, got, caseSensitive, result) => {
    expect(keyMatches(expected, got, caseSensitive)).toBe(result);
  });
});

describe("trailing space", () => {
  it("defaults to words yes, single chars no; an explicit flag wins", () => {
    expect(wantsTrailingSpace({ text: "hi" })).toBe(true);
    expect(wantsTrailingSpace({ text: "h" })).toBe(false);
    expect(wantsTrailingSpace({ text: "🙂" })).toBe(false);
    expect(wantsTrailingSpace({ text: "h", trailingSpace: true })).toBe(true);
    expect(wantsTrailingSpace({ text: "hi", trailingSpace: false })).toBe(false);
  });

  it("adds and drops the space position, and is a no-op when nothing changes", () => {
    const plain = fresh("hi");
    expect(withTrailingSpace(plain, false)).toBe(plain);
    const spaced = withTrailingSpace(plain, true);
    expect(spaced).toMatchObject({
      chars: ["h", "i", " "],
      marks: ["pending", "pending", "pending"],
    });
    expect(withTrailingSpace(spaced, true)).toBe(spaced);
    expect(withTrailingSpace(spaced, false)).toEqual(plain);
  });

  it("leaves a complete target alone", () => {
    const done = type(fresh("hi"), ["h", "i"], "stay");
    expect(withTrailingSpace(done, true)).toBe(done);
  });

  it("dropping the space pulls the cursor back and lets the target settle", () => {
    // `backspace`: "hi" + a wrong key at the space. The target is typed out but blocked.
    const blocked = type(withTrailingSpace(fresh("hi"), true), ["h", "i", "x"], "backspace");
    expect(blocked).toMatchObject({ cursor: 3, complete: false, marks: ["ok", "ok", "wrong"] });
    expect(settleTarget(blocked, 900, "backspace")).toEqual({ state: blocked, events: [] });

    const dropped = withTrailingSpace(blocked, false);
    expect(dropped).toMatchObject({ cursor: 2, marks: ["ok", "ok"], erred: [false, false] });
    expect(settleTarget(dropped, 900, "backspace").events).toEqual([
      {
        type: "targetComplete",
        t: 900,
        targetId: "a",
        accuracy: 2 / 3,
        durationMs: 900,
        errors: 0,
      },
    ]);
  });
});

describe("settleTarget", () => {
  it("does nothing to a target that is not typed out, or already complete", () => {
    const half = type(fresh("hi"), ["h"], "stay");
    expect(settleTarget(half, 10, "stay")).toEqual({ state: half, events: [] });
    const done = type(fresh("hi"), ["h", "i"], "stay");
    expect(settleTarget(done, 10, "stay")).toEqual({ state: done, events: [] });
  });
});

describe("resumeTarget and releaseTarget", () => {
  it("resume clears the latency clock and keeps the pause out of the duration", () => {
    const untouched = fresh("ab");
    expect(resumeTarget(untouched, 500)).toBe(untouched);

    const resumed = resumeTarget(type(fresh("ab"), ["a"], "stay"), 500);
    expect(resumed).toMatchObject({ lastT: null, pausedMs: 500, startedT: 0 });
    expect(applyKey(resumed, { key: "b", t: 700, shift: false }, "stay").events).toEqual([
      { type: "correct", t: 700, targetId: "a", index: 1, char: "b", latencyMs: null },
      { type: "targetComplete", t: 700, targetId: "a", accuracy: 1, durationMs: 200, errors: 0 },
    ]);
  });

  it("release restarts the target's timing but keeps its counters", () => {
    const typed = type(fresh("ab"), ["a", BACKSPACE], "backspace");
    expect(releaseTarget(resumeTarget(typed, 40))).toMatchObject({
      startedT: null,
      lastT: null,
      pausedMs: 0,
      correct: 1,
      cursor: 0,
    });
  });
});

describe("targetView", () => {
  it("copies the marks", () => {
    const state = type(fresh("ab"), ["a"], "stay");
    const view = targetView(state, true);
    expect(view).toEqual({
      id: "a",
      text: "ab",
      typed: 1,
      marks: ["ok", "pending"],
      locked: true,
      complete: false,
    });
    expect(view.marks).not.toBe(state.marks);
  });
});
