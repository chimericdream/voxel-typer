/**
 * The session around the typing: the clock, pause/resume, the three end conditions, the summary,
 * the live read model, and snapshot/restore (docs/impl/contracts.md §3.4–3.5).
 */
import { describe, expect, it } from "vitest";
import { createSession, replaySession, restoreSession } from "../../../src/engine/session";
import type { SessionSummary } from "../../../src/engine/stats";
import type {
  EngineEvent,
  KeyInput,
  SessionConfig,
  SessionSnapshot,
  Target,
  TypingSession,
} from "../../../src/engine/types";

function config(over: Partial<SessionConfig> = {}): SessionConfig {
  return {
    policy: "stay",
    targeting: "sequential",
    caseSensitive: true,
    end: { kind: "manual" },
    mode: "mine",
    seed: 7,
    ...over,
  };
}

const key = (k: string, t: number): KeyInput => ({ key: k, t, shift: false });

/** Feeds the chars of `text`, `step` ms apart, starting at `t0`. */
function typeText(session: TypingSession, text: string, t0: number, step: number): EngineEvent[] {
  return Array.from(text).flatMap((char, i) => session.feed(key(char, t0 + i * step)));
}

function summaryOf(events: readonly EngineEvent[]): SessionSummary {
  const ends = events.filter((e) => e.type === "sessionEnd");
  expect(ends).toHaveLength(1);
  const end = ends[0];
  if (end === undefined) throw new Error("no sessionEnd");
  return end.summary;
}

const letters = (text: string): Target[] =>
  Array.from(text).map((char, i) => ({ id: `t${i}`, text: char }));

describe("ending", () => {
  it("feeding after end throws, and the throwing feed is not logged", () => {
    const session = createSession(config(), letters("fj"));
    session.feed(key("f", 0));
    expect(session.end(100).map((e) => e.type)).toEqual(["sessionEnd"]);
    expect(() => session.feed(key("j", 200))).toThrow("feed after the session ended");
    expect(session.snapshot().log.map((e) => e.k)).toEqual(["key", "end"]);
  });

  it("feeding after a `targets` session ended itself throws", () => {
    const session = createSession(config({ end: { kind: "targets" } }), letters("f"));
    expect(session.feed(key("f", 0)).map((e) => e.type)).toContain("sessionEnd");
    expect(session.view().ended).toBe(true);
    expect(() => session.feed(key("f", 10))).toThrow();
  });

  it("after the end every other call is a quiet no-op", () => {
    const session = createSession(config(), letters("fj"));
    session.end(50);
    const before = session.snapshot();
    expect(session.end(60)).toEqual([]);
    expect(session.pause(70)).toEqual([]);
    expect(session.resume(80)).toEqual([]);
    expect(session.removeTarget("t0", 90)).toEqual([]);
    session.addTargets([{ id: "new", text: "k" }]);
    expect(session.snapshot()).toEqual(before);
    expect(session.view().targets.map((t) => t.id)).toEqual(["t0", "t1"]);
  });

  it("a `time` session ends on the first feed at or after the deadline, exactly once", () => {
    const session = createSession(config({ end: { kind: "time", ms: 1000 } }), letters("asdfjkl"));
    const events = [
      ...session.feed(key("a", 5000)),
      ...session.feed(key("s", 5400)),
      ...session.feed(key("d", 5999)),
      // 1000 ms after the first key: the deadline. This key is not typed.
      ...session.feed(key("f", 6000)),
      ...session.end(6100),
    ];
    expect(events.filter((e) => e.type === "sessionEnd")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "sessionEnd", t: 6000 });
    expect(summaryOf(events)).toMatchObject({
      startedAtT: 5000,
      activeMs: 1000,
      keystrokes: 3,
      correct: 3,
      targetsCompleted: 3,
    });
    expect(session.view().targets.map((t) => t.complete)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(() => session.feed(key("f", 6200))).toThrow();
  });

  it("a `time` session ended late by the mode still reports the limit as its active time", () => {
    const session = createSession(config({ end: { kind: "time", ms: 1000 } }), letters("as"));
    session.feed(key("a", 0));
    const summary = summaryOf(session.end(4000));
    expect(summary.activeMs).toBe(1000);
    // 1 correct char in 1/60 min: (1 / 5) / (1000 / 60000) = 12
    expect(summary.grossWpm).toBe(12);
    expect(session.view().elapsedMs).toBe(1000);
  });

  it("paused time does not count toward a `time` deadline", () => {
    const session = createSession(config({ end: { kind: "time", ms: 1000 } }), letters("asdf"));
    const events = [
      ...session.feed(key("a", 0)),
      ...session.pause(400),
      ...session.resume(10_400),
      // 400 + 500 = 900 ms active: still running.
      ...session.feed(key("s", 10_900)),
      // 400 + 600 = 1000 ms active: over.
      ...session.feed(key("d", 11_000)),
    ];
    expect(events.map((e) => e.type)).toEqual([
      "correct",
      "streak",
      "targetComplete",
      "paused",
      "resumed",
      "correct",
      "streak",
      "targetComplete",
      "sessionEnd",
    ]);
    expect(summaryOf(events)).toMatchObject({ activeMs: 1000, keystrokes: 2 });
  });

  it("a `manual` session only ends when told", () => {
    const session = createSession(config(), letters("f"));
    session.feed(key("f", 0));
    expect(session.view().ended).toBe(false);
    // Nothing is left to type, so the key is ignored.
    expect(session.feed(key("x", 100_000))).toEqual([]);
    expect(session.view().ended).toBe(false);
  });

  it("sequential: keys fed when no target remains are not keystrokes and keep the streak", () => {
    const session = createSession(config(), letters("fj"));
    session.feed(key("f", 0));
    session.feed(key("j", 500));
    expect(session.feed(key("x", 1000))).toEqual([]);
    expect(session.feed(key(" ", 1500))).toEqual([]);
    expect(session.view().streak).toBe(2);
    session.addTargets([{ id: "more", text: "k" }]);
    expect(session.feed(key("k", 2000)).map((e) => e.type)).toEqual([
      "correct",
      "streak",
      "targetComplete",
    ]);
    expect(summaryOf(session.end(3000))).toMatchObject({
      keystrokes: 3,
      correct: 3,
      errors: 0,
      accuracy: 1,
      longestStreak: 3,
      activeMs: 3000,
    });
  });

  it("sequential: an ignored key does not start the clock, but does end a `time` session", () => {
    const empty = createSession(config(), []);
    expect(empty.feed(key("x", 500))).toEqual([]);
    empty.addTargets([{ id: "a", text: "f" }]);
    empty.feed(key("f", 2000));
    expect(summaryOf(empty.end(3000))).toMatchObject({ startedAtT: 2000, activeMs: 1000 });

    const timed = createSession(config({ end: { kind: "time", ms: 1000 } }), letters("f"));
    timed.feed(key("f", 0));
    expect(timed.feed(key("x", 400))).toEqual([]);
    const events = timed.feed(key("x", 1000));
    expect(events.map((e) => e.type)).toEqual(["sessionEnd"]);
    expect(summaryOf(events)).toMatchObject({ keystrokes: 1, correct: 1, activeMs: 1000 });
  });

  it("a `targets` session does not end when its last open target is removed", () => {
    const session = createSession(config({ end: { kind: "targets" } }), letters("fj"));
    session.feed(key("f", 0));
    expect(session.removeTarget("t1", 10)).toEqual([]);
    expect(session.view().ended).toBe(false);
  });

  it("ending a session that never got a key gives an empty summary", () => {
    const session = createSession(config({ lessonId: "meadow-01" }), letters("f"));
    session.pause(10);
    expect(session.feed(key("f", 20))).toEqual([]);
    expect(summaryOf(session.end(500))).toEqual({
      lessonId: "meadow-01",
      mode: "mine",
      seed: 7,
      startedAtT: 500,
      activeMs: 0,
      keystrokes: 0,
      correct: 0,
      errors: 0,
      uncorrected: 0,
      grossWpm: 0,
      netWpm: 0,
      accuracy: 1,
      consistency: 0,
      perKey: {},
      bigrams: {},
      longestStreak: 0,
      targetsCompleted: 0,
    });
  });
});

describe("summary (contracts §3.5)", () => {
  it("stay: hand-computed counters, rates and per-key tables", () => {
    const session = createSession(config(), [
      { id: "w1", text: "as" },
      { id: "w2", text: "sad" },
    ]);
    // a s ␣ s x x a d, 200 ms apart, then end at 2400.
    const events = [...typeText(session, "as sxxad", 0, 200), ...session.end(2400)];
    const summary = summaryOf(events);
    // minutes = 2400 / 60000 = 0.04; gross = (6 / 5) / 0.04 = 30
    expect(summary).toEqual({
      mode: "mine",
      seed: 7,
      startedAtT: 0,
      activeMs: 2400,
      keystrokes: 8,
      correct: 6,
      errors: 2,
      uncorrected: 0,
      grossWpm: 30,
      netWpm: 30,
      accuracy: 0.75,
      // 5 latencies only: under 10 samples.
      consistency: 0,
      perKey: {
        // "a" in "as": first char, no latency. "a" in "sad": one wrong key (the repeat is not
        // counted), then right, 200 ms after the second wrong key.
        a: { attempts: 3, errors: 1, latencies: [200] },
        s: { attempts: 2, errors: 0, latencies: [200] },
        " ": { attempts: 1, errors: 0, latencies: [200] },
        d: { attempts: 1, errors: 0, latencies: [200] },
      },
      bigrams: {
        as: { attempts: 1, errors: 0, latencies: [200] },
        "s ": { attempts: 1, errors: 0, latencies: [200] },
        sa: { attempts: 2, errors: 1, latencies: [200] },
        ad: { attempts: 1, errors: 0, latencies: [200] },
      },
      longestStreak: 4,
      targetsCompleted: 2,
    });
  });

  it("skip: uncorrected positions lower net WPM, and removed targets don't count", () => {
    const session = createSession(config({ policy: "skip" }), [
      { id: "w1", text: "cat" },
      { id: "w2", text: "dog" },
      { id: "w3", text: "ox" },
    ]);
    // "cxt " → 1 wrong position in w1. "dxg " → 1 wrong position in w2. "z" → wrong in w3.
    typeText(session, "cxt dxg z", 0, 500);
    session.removeTarget("w2", 4100);
    const summary = summaryOf(session.end(6000));
    // minutes = 0.1; gross = (6 / 5) / 0.1 = 12; uncorrected = w1 + w3 = 2; net = 12 − 2 / 0.1 → 0
    expect(summary).toMatchObject({
      activeMs: 6000,
      keystrokes: 9,
      correct: 6,
      errors: 3,
      uncorrected: 2,
      netWpm: 0,
      targetsCompleted: 2,
    });
    expect(summary.grossWpm).toBeCloseTo(12, 12);
    expect(summary.accuracy).toBeCloseTo(6 / 9, 12);
  });

  it("skip: a position fixed with Backspace is not uncorrected", () => {
    const session = createSession(config({ policy: "skip" }), [{ id: "w1", text: "cat" }]);
    const keys = ["c", "x", "Backspace", "a", "t"];
    keys.forEach((k, i) => session.feed(key(k, i * 1000)));
    // gross = (3 / 5) / (6000 / 60000) = 6
    const summary = summaryOf(session.end(6000));
    expect(summary).toMatchObject({ keystrokes: 4, correct: 3, errors: 1, uncorrected: 0 });
    expect(summary.grossWpm).toBeCloseTo(6, 12);
    expect(summary.netWpm).toBe(summary.grossWpm);
  });

  it("backspace: wrong chars left at the end are still 0 uncorrected", () => {
    const session = createSession(config({ policy: "backspace" }), [{ id: "w1", text: "cat" }]);
    typeText(session, "cx", 0, 100);
    expect(summaryOf(session.end(2000)).uncorrected).toBe(0);
  });

  it("rates are 0 under one second of active time", () => {
    const session = createSession(config(), letters("asdf"));
    typeText(session, "asdf", 0, 100);
    expect(summaryOf(session.end(999))).toMatchObject({
      activeMs: 999,
      correct: 4,
      grossWpm: 0,
      netWpm: 0,
      accuracy: 1,
    });
  });

  it("consistency is 1 for a perfectly even rhythm and lower for an uneven one", () => {
    const even = createSession(config(), [{ id: "w", text: "asdfasdfasdf" }]);
    typeText(even, "asdfasdfasdf", 0, 150);
    expect(summaryOf(even.end(2000)).consistency).toBe(1);

    const uneven = createSession(config(), [{ id: "w", text: "asdfasdfasd" }]);
    // 10 latencies: five of 100 ms, five of 300 ms. mean 200, population stddev 100 → 1 − 0.5
    const gaps = [0, 100, 300, 100, 300, 100, 300, 100, 300, 100, 300];
    let t = 0;
    Array.from("asdfasdfasd").forEach((char, i) => {
      t += gaps[i] ?? 0;
      uneven.feed(key(char, t));
    });
    expect(summaryOf(uneven.end(3000)).consistency).toBe(0.5);
  });

  it("consistency is 1 when every latency is 0", () => {
    const session = createSession(config(), [{ id: "w", text: "asdfasdfasdf" }]);
    typeText(session, "asdfasdfasdf", 0, 0);
    expect(summaryOf(session.end(2000)).consistency).toBe(1);
  });

  it("caps a key's latencies at 200 per session", () => {
    const text = "a".repeat(260);
    const session = createSession(config(), [{ id: "w", text }]);
    typeText(session, text, 0, 10);
    const summary = summaryOf(session.end(5000));
    expect(summary.perKey["a"]).toMatchObject({ attempts: 260, errors: 0 });
    expect(summary.perKey["a"]?.latencies).toHaveLength(200);
    expect(summary.bigrams["aa"]?.latencies).toHaveLength(200);
  });

  it("lockOn misses count as keystrokes and errors but belong to no key", () => {
    const session = createSession(config({ targeting: "lockOn" }), [{ id: "m", text: "so" }]);
    typeText(session, "xyso", 0, 500);
    expect(summaryOf(session.end(2000))).toMatchObject({
      keystrokes: 4,
      correct: 2,
      errors: 2,
      accuracy: 0.5,
      perKey: {
        s: { attempts: 1, errors: 0, latencies: [] },
        o: { attempts: 1, errors: 0, latencies: [500] },
      },
    });
  });

  it("the summary is JSON-serializable and detached from the session", () => {
    const session = createSession(config(), letters("as"));
    typeText(session, "as", 0, 600);
    const summary = summaryOf(session.end(1200));
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});

describe("clock, pause and the live read model", () => {
  it("elapsed time starts at the first key and skips pauses", () => {
    const session = createSession(config(), letters("asdf"));
    expect(session.view()).toMatchObject({ elapsedMs: 0, paused: false, ended: false });
    session.feed(key("a", 1000));
    session.feed(key("s", 1500));
    expect(session.view().elapsedMs).toBe(500);
    session.pause(1700);
    expect(session.view()).toMatchObject({ elapsedMs: 700, paused: true });
    session.resume(9000);
    session.feed(key("d", 9100));
    expect(session.view()).toMatchObject({ elapsedMs: 800, paused: false });
  });

  it("keys fed while paused are ignored: no events, no keystrokes", () => {
    const session = createSession(config(), letters("as"));
    session.feed(key("a", 0));
    session.pause(100);
    expect(session.feed(key("s", 200))).toEqual([]);
    expect(session.feed(key("x", 300))).toEqual([]);
    session.resume(400);
    expect(summaryOf(session.end(500))).toMatchObject({ keystrokes: 1, activeMs: 200 });
  });

  it.each([0, 1, 10_000, 3_600_000])(
    "a target completed by a removal during a pause of %d ms has the same duration",
    (pauseMs) => {
      const session = createSession(config({ end: { kind: "targets" } }), [
        { id: "a", text: "ab" },
        { id: "b", text: "cd" },
      ]);
      session.feed(key("a", 0));
      session.feed(key("b", 100));
      session.pause(200);
      // Removing "b" drops the space "a" was waiting for, so "a" completes while paused.
      const events = session.removeTarget("b", 200 + pauseMs);
      expect(events.slice(0, 1)).toEqual([
        {
          type: "targetComplete",
          t: 200 + pauseMs,
          targetId: "a",
          accuracy: 1,
          durationMs: 200,
          errors: 0,
        },
      ]);
      expect(summaryOf(events)).toMatchObject({
        activeMs: 200,
        keystrokes: 2,
        targetsCompleted: 1,
      });
      // The session has ended; a late resume changes nothing, and the replay agrees.
      expect(session.resume(300 + pauseMs)).toEqual([]);
      expect(replaySession(session.snapshot()).events.slice(-2)).toEqual(events);
      expect(restoreSession(session.snapshot()).view()).toEqual(session.view());
    },
  );

  it("a pause still in progress is counted once: at the removal, not again at resume", () => {
    const session = createSession(config(), [
      { id: "a", text: "ab" },
      { id: "b", text: "cd" },
      { id: "c", text: "ef" },
    ]);
    session.feed(key("a", 0));
    session.pause(100);
    // "a" is not typed out, so nothing completes, and it still needs its space ("c" follows).
    expect(session.removeTarget("b", 5100)).toEqual([]);
    session.resume(10_100);
    session.feed(key("b", 10_200));
    const done = session.feed(key(" ", 10_300)).find((e) => e.type === "targetComplete");
    // 10300 ms of wall time minus the 10000 ms pause.
    expect(done).toMatchObject({ targetId: "a", durationMs: 300 });
  });

  it("two pauses, the second still open when the target settles", () => {
    const session = createSession(config(), [
      { id: "a", text: "ab" },
      { id: "b", text: "cd" },
    ]);
    session.feed(key("a", 0));
    session.pause(100);
    session.resume(1100);
    session.feed(key("b", 1200));
    session.pause(1300);
    const events = session.removeTarget("b", 9300);
    // 9300 − 1000 (first pause) − 8000 (open pause) = 300
    expect(events).toEqual([
      { type: "targetComplete", t: 9300, targetId: "a", accuracy: 1, durationMs: 300, errors: 0 },
    ]);
    expect(replaySession(session.snapshot()).events.at(-1)).toEqual(events[0]);
  });

  it("ending during a pause does not count the paused time", () => {
    const session = createSession(config(), letters("asdf"));
    session.feed(key("a", 0));
    session.feed(key("s", 1500));
    session.pause(2000);
    expect(session.view().elapsedMs).toBe(2000);
    const summary = summaryOf(session.end(602_000));
    expect(summary.activeMs).toBe(2000);
    // (2 / 5) / (2000 / 60000) = 12
    expect(summary.grossWpm).toBeCloseTo(12, 12);
    expect(session.view()).toMatchObject({ elapsedMs: 2000, ended: true });
  });

  it("a `time` session ended during a pause reports only its active time", () => {
    const session = createSession(config({ end: { kind: "time", ms: 5000 } }), letters("as"));
    session.feed(key("a", 0));
    session.pause(1000);
    expect(summaryOf(session.end(90_000)).activeMs).toBe(1000);
  });

  it("a pause before the first key delays the start", () => {
    const session = createSession(config(), letters("as"));
    expect(session.pause(0).map((e) => e.type)).toEqual(["paused"]);
    expect(session.resume(5000).map((e) => e.type)).toEqual(["resumed"]);
    session.feed(key("a", 5100));
    expect(summaryOf(session.end(6100))).toMatchObject({ startedAtT: 5100, activeMs: 1000 });
  });

  it("a timestamp that goes backwards never shortens the active time", () => {
    const session = createSession(config(), letters("asd"));
    session.feed(key("a", 1000));
    session.feed(key("s", 2000));
    session.feed(key("d", 1500));
    expect(session.view().elapsedMs).toBe(1000);
  });

  it("live values are 0 before 2 s of activity", () => {
    const session = createSession(config(), [{ id: "w", text: "asdfasdf" }]);
    typeText(session, "asdfasd", 0, 300);
    expect(session.view()).toMatchObject({ elapsedMs: 1800, liveWpm: 0, liveAccuracy: 0 });
    session.feed(key("f", 2000));
    // 8 correct chars over 2 s: (8 / 5) / (2000 / 60000) = 48
    expect(session.view()).toMatchObject({ elapsedMs: 2000, liveWpm: 48, liveAccuracy: 1 });
  });

  it("live values cover the last 10 s of active time only", () => {
    const text = "asdfjkl;".repeat(4);
    const session = createSession(config(), [{ id: "w", text }]);
    // 10 clean keys in the first 4.5 s, then a long quiet stretch (active, not paused).
    typeText(session, text.slice(0, 10), 0, 500);
    session.feed(key("x", 16_000));
    session.feed(key("x", 17_000));
    session.feed(key(text.charAt(10), 18_000));
    // Window (8000, 18000]: the two wrong keys and one right key; the first 10 keys fell out.
    const view = session.view();
    expect(view.elapsedMs).toBe(18_000);
    expect(view.liveWpm).toBeCloseTo(1 / 5 / (10_000 / 60_000), 12);
    expect(view.liveAccuracy).toBeCloseTo(1 / 3, 12);
  });

  it("live accuracy is 1 when the window holds no keystrokes", () => {
    const session = createSession(config(), letters("as"));
    session.feed(key("a", 0));
    session.removeTarget("nope", 30_000);
    expect(session.view()).toMatchObject({ elapsedMs: 30_000, liveWpm: 0, liveAccuracy: 1 });
  });

  it("the streak resets on any wrong key and the longest one is kept", () => {
    const session = createSession(config(), [{ id: "w", text: "asdfjk" }]);
    typeText(session, "asdxfjk", 0, 100);
    expect(session.view().streak).toBe(3);
    expect(summaryOf(session.end(1000)).longestStreak).toBe(3);
  });
});

describe("targets", () => {
  it("rejects an empty text and a duplicate id, and changes nothing when it does", () => {
    expect(() => createSession(config(), [{ id: "a", text: "" }])).toThrow(
      'target "a" has no text',
    );
    expect(() =>
      createSession(config(), [
        { id: "a", text: "x" },
        { id: "a", text: "y" },
      ]),
    ).toThrow('duplicate target id "a"');

    const session = createSession(config(), [{ id: "a", text: "x" }]);
    expect(() =>
      session.addTargets([
        { id: "b", text: "y" },
        { id: "a", text: "z" },
      ]),
    ).toThrow('duplicate target id "a"');
    expect(session.view().targets.map((t) => t.id)).toEqual(["a"]);
    expect(session.snapshot().log).toEqual([]);
  });

  it("an id can be reused once its target is removed", () => {
    const session = createSession(config({ targeting: "lockOn" }), [{ id: "mob", text: "so" }]);
    session.removeTarget("mob", 0);
    session.addTargets([{ id: "mob", text: "go" }]);
    expect(session.feed(key("g", 10))[0]).toEqual({ type: "targetLocked", t: 10, targetId: "mob" });
  });

  it("does not keep references to the caller's objects", () => {
    const cfg = config();
    const targets: Target[] = [{ id: "a", text: "as" }];
    const added: Target[] = [{ id: "b", text: "df" }];
    const input = key("a", 0);
    const session = createSession(cfg, targets);
    session.addTargets(added);
    session.feed(input);
    cfg.policy = "skip";
    targets.push({ id: "z", text: "zz" });
    added.push({ id: "y", text: "yy" });
    input.key = "q";

    const snap = session.snapshot();
    expect(snap).toEqual({
      version: 1,
      config: config(),
      initialTargets: [{ id: "a", text: "as" }],
      log: [
        { k: "add", targets: [{ id: "b", text: "df" }] },
        { k: "key", input: { key: "a", t: 0, shift: false } },
      ],
    });
    // The snapshot is a copy too.
    snap.log.length = 0;
    expect(session.snapshot().log).toHaveLength(2);
    // `stay` is still the policy: the wrong key does not advance.
    session.feed(key("x", 100));
    expect(session.view().active?.typed).toBe(1);
  });
});

/** A lockOn session that has seen every kind of log entry. */
function scripted(): { session: TypingSession; events: EngineEvent[] } {
  const session = createSession(
    config({ targeting: "lockOn", policy: "backspace", end: { kind: "time", ms: 60_000 } }),
    [
      { id: "m1", text: "sun", priority: 2 },
      { id: "m2", text: "sky", priority: 1 },
    ],
  );
  const events = [
    ...session.feed({ key: "s", t: 100, shift: false, code: "KeyS" }),
    ...session.feed(key("x", 300)),
    ...session.feed(key("Backspace", 450)),
    ...session.pause(500),
    ...session.feed(key("k", 600)),
    ...session.resume(2500),
    ...session.feed(key("Shift", 2550)),
    ...session.feed(key("k", 2600)),
  ];
  session.addTargets([{ id: "m3", text: "top" }]);
  events.push(...session.removeTarget("m1", 2700), ...session.removeTarget("ghost", 2710));
  return { session, events };
}

/** What both sessions are asked to do after the snapshot. */
function future(s: TypingSession): EngineEvent[] {
  return [...s.feed(key("y", 2900)), ...s.feed(key("t", 3100)), ...s.end(4000)];
}

function isSnapshot(value: unknown): value is SessionSnapshot {
  return typeof value === "object" && value !== null && "log" in value;
}

describe("snapshot and restore", () => {
  it("the snapshot holds the full log, in call order, and survives JSON", () => {
    const { session } = scripted();
    const snap = session.snapshot();
    expect(snap.log.map((e) => e.k)).toEqual([
      "key",
      "key",
      "key",
      "pause",
      "key",
      "resume",
      "key",
      "key",
      "add",
      "remove",
      "remove",
    ]);
    expect(snap.log[0]).toEqual({
      k: "key",
      input: { key: "s", t: 100, shift: false, code: "KeyS" },
    });
    const copy: unknown = JSON.parse(JSON.stringify(snap));
    expect(copy).toEqual(snap);
  });

  it("a restored session has the same view, the same snapshot and the same future", () => {
    const { session, events } = scripted();
    const snap = session.snapshot();
    const replayed = replaySession(snap);
    expect(replayed.events).toEqual(events);

    const restored = restoreSession(snap);
    expect(restored.view()).toEqual(session.view());
    expect(restored.snapshot()).toEqual(snap);

    expect(future(restored)).toEqual(future(session));
    expect(restored.view()).toEqual(session.view());
  });

  it("restores an ended session as ended", () => {
    const session = createSession(config({ end: { kind: "targets" } }), letters("f"));
    session.feed(key("f", 0));
    const restored = restoreSession(session.snapshot());
    expect(restored.view()).toEqual(session.view());
    expect(restored.view().ended).toBe(true);
    expect(() => restored.feed(key("f", 1))).toThrow();
  });

  it("rejects a snapshot version it does not know", () => {
    const snap: unknown = JSON.parse(
      JSON.stringify({ ...createSession(config(), []).snapshot(), version: 2 }),
    );
    if (!isSnapshot(snap)) throw new Error("not a snapshot");
    expect(() => restoreSession(snap)).toThrow("unsupported session snapshot version: 2");
  });
});
