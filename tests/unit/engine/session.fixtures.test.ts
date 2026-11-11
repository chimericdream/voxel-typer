/**
 * Replays every hand-written log in `tests/fixtures/logs/` and checks the summary against the
 * hand-computed one stored next to it (the arithmetic is in each file's `why`).
 *
 * The replay harness (M1-07) reuses these files: `{ name, why, snapshot, expected: { summary } }`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { replaySession, restoreSession } from "../../../src/engine/session";
import type { SessionSnapshot } from "../../../src/engine/types";

const DIR = resolve(import.meta.dirname, "../../fixtures/logs");

interface Fixture {
  name: string;
  why: string[];
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
    Array.isArray(value["initialTargets"]) &&
    Array.isArray(value["log"])
  );
}

function isFixture(value: unknown): value is Fixture {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    Array.isArray(value["why"]) &&
    isSnapshot(value["snapshot"]) &&
    isRecord(value["expected"]) &&
    isRecord(value["expected"]["summary"])
  );
}

const fixtures = readdirSync(DIR)
  .filter((file) => file.endsWith(".json"))
  .toSorted((a, b) => a.localeCompare(b))
  .map((file) => {
    const parsed: unknown = JSON.parse(readFileSync(resolve(DIR, file), "utf8"));
    if (!isFixture(parsed)) throw new Error(`${file} is not a log fixture`);
    return { file, fixture: parsed };
  });

describe("fixture logs", () => {
  it("cover every policy and both targeting modes", () => {
    const combos = new Set(
      fixtures.map(({ fixture }) => {
        const { policy, targeting } = fixture.snapshot.config;
        return `${policy}/${targeting}`;
      }),
    );
    expect([...combos].toSorted((a, b) => a.localeCompare(b))).toEqual([
      "backspace/sequential",
      "skip/sequential",
      "stay/lockOn",
      "stay/sequential",
    ]);
  });

  it.each(fixtures)("$file replays to its hand-computed summary", ({ fixture }) => {
    expect(fixture.why.length).toBeGreaterThan(0);
    const { session, events } = replaySession(fixture.snapshot);
    const ends = events.filter((event) => event.type === "sessionEnd");
    expect(ends).toHaveLength(1);
    expect(ends[0]?.summary).toEqual(fixture.expected.summary);
    expect(events.at(-1)?.type).toBe("sessionEnd");
    expect(session.view().ended).toBe(true);
    // The restored session reproduces the log it was built from.
    expect(restoreSession(fixture.snapshot).snapshot()).toEqual(fixture.snapshot);
  });
});
