/**
 * Property tests for the typing session (task M1-03 acceptance): for any targets and any stream of
 * keys and session calls,
 *  (a) `correct + errors === keystrokes`,
 *  (b) no event names a target the session doesn't hold,
 *  (c) `restoreSession(snapshot())` plus the same remaining inputs yields the same events,
 *  (d) a pause of any length doesn't change WPM over active time.
 *
 * fast-check runs with a fixed seed, so a failure reproduces.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createSession, restoreSession } from "../../../src/engine/session";
import type { SessionSummary } from "../../../src/engine/stats";
import type { EngineEvent, SessionConfig, Target, TypingSession } from "../../../src/engine/types";

const SEED = 20_261_111;
const RUNS = 400;

// ── generators ───────────────────────────────────────────────────────────────────────────────

const charArb = fc.constantFrom("a", "s", "d", "f", "A");

const targetSpecArb = fc.record({
  text: fc.array(charArb, { minLength: 1, maxLength: 5 }).map((chars) => chars.join("")),
  priority: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
  trailingSpace: fc.option(fc.boolean(), { nil: undefined }),
});
type TargetSpec = ReturnType<typeof specType>;
function specType(): {
  text: string;
  priority: number | undefined;
  trailingSpace: boolean | undefined;
} {
  return { text: "", priority: undefined, trailingSpace: undefined };
}

const configArb: fc.Arbitrary<SessionConfig> = fc.record({
  policy: fc.constantFrom("stay", "skip", "backspace"),
  targeting: fc.constantFrom("sequential", "lockOn"),
  caseSensitive: fc.boolean(),
  end: fc.oneof(
    fc.constant({ kind: "targets" } as const),
    fc.constant({ kind: "manual" } as const),
    fc.record({ kind: fc.constant("time" as const), ms: fc.integer({ min: 0, max: 8000 }) }),
  ),
  mode: fc.constant("practice"),
  seed: fc.integer({ min: 0, max: 99 }),
});

const dtArb = fc.integer({ min: 0, max: 600 });

/** A raw key, often wrong. */
const keyOpArb = fc.record({
  kind: fc.constant("key" as const),
  key: fc.constantFrom("a", "s", "d", "f", "A", "S", " ", "x", "Backspace", "Backspace", "Shift"),
  dt: dtArb,
});
/** The key the session is waiting for (so targets do get finished). */
const hitOpArb = fc.record({ kind: fc.constant("hit" as const), pick: fc.nat(), dt: dtArb });
const typingOpArb = fc.oneof(
  { weight: 3, arbitrary: hitOpArb },
  { weight: 2, arbitrary: keyOpArb },
);

const anyOpArb = fc.oneof(
  { weight: 12, arbitrary: typingOpArb },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("pause" as const), dt: dtArb }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("resume" as const), dt: dtArb }) },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("remove" as const), pick: fc.nat(), dt: dtArb }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("add" as const),
      specs: fc.array(targetSpecArb, { minLength: 1, maxLength: 2 }),
    }),
  },
);
type Op = ReturnType<typeof opType>;
function opType():
  | { kind: "key"; key: string; dt: number }
  | { kind: "hit"; pick: number; dt: number }
  | { kind: "pause"; dt: number }
  | { kind: "resume"; dt: number }
  | { kind: "remove"; pick: number; dt: number }
  | { kind: "add"; specs: TargetSpec[] } {
  return { kind: "pause", dt: 0 };
}

const scenarioArb = fc.record({
  config: configArb,
  initial: fc.array(targetSpecArb, { minLength: 0, maxLength: 5 }),
  ops: fc.array(anyOpArb, { minLength: 0, maxLength: 60 }),
});

// ── running a scenario ───────────────────────────────────────────────────────────────────────

/** Turns specs into targets with ids `t0`, `t1`, … that are unique across the whole scenario. */
function makeTargets(specs: readonly TargetSpec[], firstIndex: number): Target[] {
  return specs.map((spec, i) => ({
    id: `t${firstIndex + i}`,
    text: spec.text,
    ...(spec.priority === undefined ? {} : { priority: spec.priority }),
    ...(spec.trailingSpace === undefined ? {} : { trailingSpace: spec.trailingSpace }),
  }));
}

/** A scenario with times and ids resolved, so it can be run on several sessions. */
type Step =
  | { kind: "key"; key: string; t: number }
  | { kind: "hit"; pick: number; t: number }
  | { kind: "pause"; t: number }
  | { kind: "resume"; t: number }
  | { kind: "remove"; id: string; t: number }
  | { kind: "add"; targets: Target[] };

function compile(
  initial: readonly TargetSpec[],
  ops: readonly Op[],
): { targets: Target[]; steps: Step[] } {
  const targets = makeTargets(initial, 0);
  let made = targets.length;
  let t = 1000;
  const steps = ops.map((op): Step => {
    if (op.kind === "add") {
      const added = makeTargets(op.specs, made);
      made += added.length;
      return { kind: "add", targets: added };
    }
    t += op.dt;
    if (op.kind === "remove") return { kind: "remove", id: `t${op.pick % (made + 1)}`, t };
    if (op.kind === "key") return { kind: "key", key: op.key, t };
    if (op.kind === "hit") return { kind: "hit", pick: op.pick, t };
    return { kind: op.kind, t };
  });
  return { targets, steps };
}

/** The key that moves the session forward: the next char of the active target, or one that locks. */
function wantedKey(session: TypingSession, pick: number): string {
  const view = session.view();
  if (view.active !== null) {
    return Array.from(view.active.text)[view.active.typed] ?? (pick % 2 === 0 ? " " : "Backspace");
  }
  const open = view.targets.filter((target) => !target.complete);
  const chosen = open[pick % Math.max(1, open.length)];
  return chosen === undefined ? "a" : (Array.from(chosen.text)[0] ?? "a");
}

function apply(session: TypingSession, step: Step, shift = 0): EngineEvent[] {
  if (step.kind === "add") {
    session.addTargets(step.targets);
    return [];
  }
  const t = step.t + shift;
  if (step.kind === "pause") return session.pause(t);
  if (step.kind === "resume") return session.resume(t);
  if (step.kind === "remove") return session.removeTarget(step.id, t);
  if (session.view().ended) return [];
  const key = step.kind === "key" ? step.key : wantedKey(session, step.pick);
  return session.feed({ key, t, shift: false });
}

function lastTime(steps: readonly Step[]): number {
  let t = 1000;
  for (const step of steps) if (step.kind !== "add") t = step.t;
  return t;
}

function summaryIn(events: readonly EngineEvent[]): SessionSummary {
  const ends = events.filter((event) => event.type === "sessionEnd");
  expect(ends).toHaveLength(1);
  const end = ends[0];
  if (end === undefined) throw new Error("no sessionEnd");
  return end.summary;
}

// ── properties ───────────────────────────────────────────────────────────────────────────────

describe("typing session properties", () => {
  it("(a) correct + errors === keystrokes, and the summary agrees with the events", () => {
    fc.assert(
      fc.property(scenarioArb, ({ config, initial, ops }) => {
        const { targets, steps } = compile(initial, ops);
        const session = createSession(config, targets);
        const events = steps.flatMap((step) => apply(session, step));
        events.push(...session.end(lastTime(steps) + 1000));

        const summary = summaryIn(events);
        expect(summary.correct + summary.errors).toBe(summary.keystrokes);
        expect(summary.correct).toBe(events.filter((e) => e.type === "correct").length);
        expect(summary.errors).toBe(events.filter((e) => e.type === "wrong").length);
        expect(summary.targetsCompleted).toBe(
          events.filter((e) => e.type === "targetComplete").length,
        );
        expect(summary.longestStreak).toBe(
          Math.max(0, ...events.map((e) => (e.type === "streak" ? e.length : 0))),
        );
        expect(summary.accuracy).toBeGreaterThanOrEqual(0);
        expect(summary.accuracy).toBeLessThanOrEqual(1);
        expect(summary.netWpm).toBeLessThanOrEqual(summary.grossWpm);
        if (config.policy !== "skip") expect(summary.uncorrected).toBe(0);
        expect(events.at(-1)?.type).toBe("sessionEnd");
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("(b) no event references a target the session doesn't hold", () => {
    fc.assert(
      fc.property(scenarioArb, ({ config, initial, ops }) => {
        const { targets, steps } = compile(initial, ops);
        const session = createSession(config, targets);
        const live = new Set(targets.map((target) => target.id));
        for (const step of steps) {
          // Once the session has ended, adding and removing do nothing.
          const open = !session.view().ended;
          if (open && step.kind === "add") for (const target of step.targets) live.add(target.id);
          // A `remove` step may still name the target it removes (`targetUnlocked`).
          for (const event of apply(session, step)) {
            if ("targetId" in event && event.targetId !== null) {
              expect(live.has(event.targetId), `${event.type} for ${event.targetId}`).toBe(true);
            }
          }
          if (open && step.kind === "remove") live.delete(step.id);
          expect(session.view().targets.map((target) => target.id)).toEqual([...live]);
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("(c) restoreSession(snapshot()) then the same remaining inputs yields identical events", () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), ({ config, initial, ops }, cut) => {
        const { targets, steps } = compile(initial, ops);
        const at = cut % (steps.length + 1);
        const original = createSession(config, targets);
        for (const step of steps.slice(0, at)) apply(original, step);

        const snap = original.snapshot();
        const throughJson: unknown = JSON.parse(JSON.stringify(snap));
        expect(throughJson).toEqual(snap);
        const restored = restoreSession(snap);
        expect(restored.view()).toEqual(original.view());

        for (const step of steps.slice(at)) {
          expect(apply(restored, step)).toEqual(apply(original, step));
        }
        const endAt = lastTime(steps) + 1000;
        expect(restored.end(endAt)).toEqual(original.end(endAt));
        expect(restored.view()).toEqual(original.view());
        expect(restored.snapshot()).toEqual(original.snapshot());
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("(d) pausing for any duration doesn't change WPM computed over active time", () => {
    fc.assert(
      fc.property(
        configArb,
        fc.array(targetSpecArb, { minLength: 1, maxLength: 5 }),
        fc.array(typingOpArb, { minLength: 1, maxLength: 60 }),
        fc.nat(),
        fc.integer({ min: 0, max: 3_600_000 }),
        (config, initial, ops, cut, pauseMs) => {
          const { targets, steps } = compile(initial, ops);
          const at = cut % (steps.length + 1);
          const endAt = lastTime(steps) + 1000;

          const plain = createSession(config, targets);
          const plainEvents = steps.flatMap((step) => apply(plain, step));
          plainEvents.push(...plain.end(endAt));

          const paused = createSession(config, targets);
          const pausedEvents = steps.slice(0, at).flatMap((step) => apply(paused, step));
          const pauseAt = lastTime(steps.slice(0, at));
          pausedEvents.push(...paused.pause(pauseAt), ...paused.resume(pauseAt + pauseMs));
          pausedEvents.push(...steps.slice(at).flatMap((step) => apply(paused, step, pauseMs)));
          pausedEvents.push(...paused.end(endAt + pauseMs));

          const a = summaryIn(plainEvents);
          const b = summaryIn(pausedEvents);
          expect(b.activeMs).toBe(a.activeMs);
          expect(b.grossWpm).toBe(a.grossWpm);
          expect(b.netWpm).toBe(a.netWpm);
          expect([b.keystrokes, b.correct, b.errors, b.uncorrected]).toEqual([
            a.keystrokes,
            a.correct,
            a.errors,
            a.uncorrected,
          ]);
          expect(b.targetsCompleted).toBe(a.targetsCompleted);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
