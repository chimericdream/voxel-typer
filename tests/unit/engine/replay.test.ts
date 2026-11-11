/**
 * The replay harness (M1-07): every fixture log in `tests/fixtures/logs/` must replay to its stored,
 * hand-computed summary, and unfinished logs must end where they stop.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lastLogTime, replay } from "../../../src/engine/replay";
import { createSession } from "../../../src/engine/session";
import type { SessionSnapshot } from "../../../src/engine/types";

const DIR = resolve(import.meta.dirname, "../../fixtures/logs");

interface Fixture {
  name: string;
  snapshot: SessionSnapshot;
  expected: { summary: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSnapshot(value: unknown): value is SessionSnapshot {
  return (
    isRecord(value) &&
    value["version"] === 1 &&
    isRecord(value["config"]) &&
    Array.isArray(value["log"]) &&
    Array.isArray(value["initialTargets"])
  );
}

function isFixture(value: unknown): value is Fixture {
  if (!isRecord(value) || typeof value["name"] !== "string") return false;
  const expected = value["expected"];
  return isSnapshot(value["snapshot"]) && isRecord(expected) && isRecord(expected["summary"]);
}

const fixtures = readdirSync(DIR)
  .filter((file) => file.endsWith(".json"))
  .toSorted((a, b) => a.localeCompare(b))
  .map((file) => {
    const parsed: unknown = JSON.parse(readFileSync(resolve(DIR, file), "utf8"));
    if (!isFixture(parsed)) throw new Error(`${file} is not a log fixture`);
    return { file, fixture: parsed };
  });

const config: SessionSnapshot["config"] = {
  policy: "stay",
  targeting: "sequential",
  caseSensitive: true,
  end: { kind: "manual" },
  mode: "practice",
  seed: 1,
};

/** A short session that never ends on its own (`manual`), as a snapshot. */
function unfinished(): SessionSnapshot {
  const session = createSession(config, [
    { id: "w1", text: "as" },
    { id: "w2", text: "sad" },
  ]);
  session.feed({ key: "a", t: 1000, shift: false });
  session.feed({ key: "x", t: 1400, shift: false });
  session.feed({ key: "s", t: 1900, shift: false });
  session.pause(2000);
  session.resume(5000);
  session.feed({ key: " ", t: 5500, shift: false });
  return session.snapshot();
}

describe("replay: fixture logs", () => {
  it("finds the fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
  });

  it.each(fixtures)("$file reproduces its stored summary exactly", ({ fixture }) => {
    const result = replay(fixture.snapshot);
    expect(result.summary).toEqual(fixture.expected.summary);
    expect(result.endedInLog).toBe(true);
    expect(result.events.filter((e) => e.type === "sessionEnd")).toHaveLength(1);
    expect(result.events.at(-1)?.type).toBe("sessionEnd");
  });

  it.each(fixtures)("$file replays the same way twice and through JSON", ({ fixture }) => {
    const copy: unknown = JSON.parse(JSON.stringify(fixture.snapshot));
    if (!isSnapshot(copy)) throw new Error("the snapshot did not survive JSON");
    expect(replay(fixture.snapshot)).toEqual(replay(fixture.snapshot));
    expect(replay(copy)).toEqual(replay(fixture.snapshot));
  });
});

describe("replay: logs that never ended", () => {
  it("ends the session at the log's last timestamp", () => {
    const snap = unfinished();
    expect(snap.log.some((entry) => entry.k === "end")).toBe(false);
    const result = replay(snap);
    expect(result.endedInLog).toBe(false);
    expect(result.events.at(-1)?.type).toBe("sessionEnd");
    // 1000 → 2000 running, paused until 5000, running to 5500: 1000 + 500 ms.
    expect(result.summary.activeMs).toBe(1500);
    expect(result.summary.keystrokes).toBe(4);
    expect(result.summary.errors).toBe(1);

    const session = createSession(config, snap.initialTargets);
    session.feed({ key: "a", t: 1000, shift: false });
    session.feed({ key: "x", t: 1400, shift: false });
    session.feed({ key: "s", t: 1900, shift: false });
    session.pause(2000);
    session.resume(5000);
    session.feed({ key: " ", t: 5500, shift: false });
    const end = session.end(5500).find((e) => e.type === "sessionEnd");
    expect(end?.type === "sessionEnd" ? end.summary : null).toEqual(result.summary);
  });

  it("ends at `endAt` when given", () => {
    const result = replay(unfinished(), 9500);
    expect(result.summary.activeMs).toBe(1000 + 4500);
  });

  it("handles an empty log", () => {
    const snap: SessionSnapshot = { version: 1, config, initialTargets: [], log: [] };
    expect(lastLogTime(snap)).toBe(0);
    const result = replay(snap);
    expect(result.endedInLog).toBe(false);
    expect(result.summary.keystrokes).toBe(0);
    expect(result.summary.accuracy).toBe(1);
    expect(result.events.map((e) => e.type)).toEqual(["sessionEnd"]);
  });

  it("reads the time from every timed entry kind", () => {
    const snap: SessionSnapshot = {
      version: 1,
      config,
      initialTargets: [{ id: "w1", text: "a" }],
      log: [
        { k: "key", input: { key: "x", t: 100, shift: false } },
        { k: "pause", t: 200 },
        { k: "resume", t: 300 },
        { k: "add", targets: [{ id: "w2", text: "s" }] },
        { k: "remove", id: "w2", t: 400 },
      ],
    };
    expect(lastLogTime(snap)).toBe(400);
    expect(lastLogTime({ ...snap, log: [...snap.log, { k: "end", t: 900 }] })).toBe(900);
  });
});
