/**
 * CSV export (task M3-11): RFC 4180 quoting, formula-injection guard, the round trip, and the
 * session rows the Parent Dashboard exports.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  csvCell,
  csvFileName,
  defuseFormula,
  parseCsv,
  toCsv,
} from "../../../src/app/csv";
import { testedOut } from "../../../src/app/progress";
import { lessons } from "../../../src/content/lessons";
import { t } from "../../../src/i18n";
import type { Profile, StoredSummary } from "../../../src/save/schema";
import {
  curriculumProgress,
  minutesPerDay,
  sessionRows,
  sessionTrend,
  sessionsCsv,
  weeklyTrend,
} from "../../../src/ui/screens/parent-logic";
import { fixture } from "./helpers";

const SEED = 20261112;

const stored = (over: Partial<StoredSummary> = {}): StoredSummary => ({
  lessonId: "meadow-01",
  mode: "mine",
  seed: 1,
  startedAtT: 0,
  activeMs: 120_000,
  keystrokes: 200,
  correct: 190,
  errors: 10,
  uncorrected: 0,
  grossWpm: 19,
  netWpm: 19,
  accuracy: 0.95,
  consistency: 0.5,
  longestStreak: 20,
  targetsCompleted: 10,
  at: new Date(2026, 10, 10, 16, 30).getTime(),
  ...over,
});

describe("csv cells", () => {
  it("escapes a text cell that starts a formula, and leaves numbers alone", () => {
    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(defuseFormula(`${lead}SUM(A1)`)).toBe(`'${lead}SUM(A1)`);
    }
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("Captain Quill")).toBe("Captain Quill");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\ntwo")).toBe('"one\ntwo"');
  });

  it("writes a BOM and CRLF lines", () => {
    const text = toCsv([
      ["a", 1],
      ["b", 2],
    ]);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text.slice(1)).toBe("a,1\r\nb,2\r\n");
  });

  it("round-trips any text that doesn't start a formula (property)", () => {
    const safe = fc.string().filter((s) => !/^[=+\-@\t\r]/.test(s));
    fc.assert(
      fc.property(
        fc.array(fc.array(safe, { minLength: 1, maxLength: 5 }), { minLength: 1 }),
        (rows) => {
          // A lone empty cell is an empty line; CSV can't tell it from no row, so skip that shape.
          fc.pre(rows.every((r) => !(r.length === 1 && r[0] === "")));
          expect(parseCsv(toCsv(rows))).toEqual(rows);
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });

  it("keeps formula text inert after a round trip", () => {
    expect(parseCsv(toCsv([["=1+1", "-2", "+x", "@y"]]))).toEqual([["'=1+1", "'-2", "'+x", "'@y"]]);
  });

  it("file names keep only plain letters, digits and dashes", () => {
    expect(csvFileName("Captain Quill", "2026-11-12")).toBe(
      "voxel-typer-sessions-captain-quill-2026-11-12.csv",
    );
    expect(csvFileName("../=evil\\name", "2026-11-12")).toBe(
      "voxel-typer-sessions-evil-name-2026-11-12.csv",
    );
    expect(csvFileName("☆☆", "2026-11-12")).toBe("voxel-typer-sessions-player-2026-11-12.csv");
  });
});

describe("sessions CSV", () => {
  it("has the nickname and session numbers only, and round-trips them", () => {
    const p = fixture("veteran-builder");
    const rows = parseCsv(toCsv(sessionsCsv(p, lessons)));
    expect(rows[0]).toEqual([
      t("parent.csv.player"),
      t("parent.csv.date"),
      t("parent.csv.time"),
      t("parent.csv.activity"),
      t("parent.csv.minutes"),
      t("parent.csv.wpm"),
      t("parent.csv.accuracy"),
    ]);
    const shown = sessionRows(p, lessons);
    expect(rows.length).toBe(shown.length + 1);
    shown.forEach((r, i) => {
      expect(rows[i + 1]).toEqual([
        p.name,
        r.date,
        r.time,
        r.activity,
        String(r.minutes),
        String(r.netWpm),
        String(r.accuracyPct),
      ]);
    });
    // Nothing else about the child: no id, no age band, no avatar.
    const text = toCsv(sessionsCsv(p, lessons));
    expect(text).not.toContain(p.id);
    expect(text).not.toContain(p.ageBand);
  });

  it("escapes a nickname that starts a formula", () => {
    const p: Profile = { ...fixture("veteran-builder"), name: "=cmd|calc" };
    const rows = parseCsv(toCsv(sessionsCsv(p, lessons)));
    expect(rows[1]?.[0]).toBe("'=cmd|calc");
  });

  it("labels remedial practice as Practice, and placement as the placement test", () => {
    const p: Profile = {
      ...fixture("fresh-builder"),
      history: [
        stored({ lessonId: "remedial-1x9z", mode: "mine" }),
        stored({ lessonId: "placement", mode: "placement" }),
        stored({ lessonId: "meadow-01" }),
      ],
    };
    const rows = sessionRows(p, lessons);
    expect(rows.map((r) => r.kind)).toEqual(["practice", "placement", "lesson"]);
    expect(rows[0]?.activity).toBe(t("parent.activity.practice"));
    expect(rows[1]?.activity).toBe(t("parent.activity.placement"));
    expect(rows[0]?.minutes).toBe(2);
  });
});

describe("dashboard numbers", () => {
  it("remedial practice counts in minutes and trends but never as a curriculum lesson", () => {
    const at = new Date(2026, 10, 12, 10).getTime();
    const base = fixture("fresh-builder");
    const p: Profile = {
      ...base,
      history: [stored({ lessonId: "remedial-abc", at, activeMs: 300_000, netWpm: 22 })],
    };
    const days = minutesPerDay(p, at);
    expect(days.at(-1)?.minutes).toBe(5);
    expect(sessionTrend(p).map((x) => x.netWpm)).toEqual([22]);
    const ids = curriculumProgress(p, lessons).flatMap((b) => b.lessons.map((l) => l.id));
    expect(ids.some((id) => id.startsWith("remedial-"))).toBe(false);
  });

  it("tested-out lessons show as tested out, never as a zero score, and stay out of trends", () => {
    const base = fixture("fresh-builder");
    const p: Profile = {
      ...base,
      progress: {
        ...base.progress,
        lessons: { "meadow-01": testedOut(0), "meadow-02": testedOut(0) },
      },
    };
    const meadow = curriculumProgress(p, lessons).find((b) => b.biome === "meadow");
    const first = meadow?.lessons[0];
    expect(first?.state).toBe("testedOut");
    expect(first?.bestWpm).toBeNull();
    expect(first?.bestPct).toBeNull();
    expect(meadow?.testedOut).toBe(2);
    expect(meadow?.played).toBe(0);
    expect(sessionTrend(p)).toEqual([]);
    expect(weeklyTrend(p)).toEqual([]);
  });

  it("minutes per day covers 28 local days ending today, oldest first", () => {
    const today = new Date(2026, 10, 12, 9).getTime();
    const p: Profile = {
      ...fixture("fresh-builder"),
      history: [
        stored({ at: new Date(2026, 10, 12, 8).getTime(), activeMs: 60_000 }),
        stored({ at: new Date(2026, 10, 12, 8, 30).getTime(), activeMs: 90_000 }),
        stored({ at: new Date(2026, 9, 16, 8).getTime(), activeMs: 60_000 }),
        stored({ at: new Date(2026, 9, 15, 8).getTime(), activeMs: 60_000 }),
      ],
    };
    const days = minutesPerDay(p, today);
    expect(days).toHaveLength(28);
    expect(days[0]?.date).toBe("2026-10-16");
    expect(days[0]?.minutes).toBe(1);
    expect(days.at(-1)?.date).toBe("2026-11-12");
    expect(days.at(-1)?.minutes).toBe(2.5);
  });

  it("weekly trend joins compacted weeks and history weeks", () => {
    const p: Profile = {
      ...fixture("fresh-builder"),
      weekly: [
        { weekStart: "2026-01-05", minutes: 30, sessions: 2, avgNetWpm: 10, avgAccuracy: 0.9 },
      ],
      history: [stored({ netWpm: 20, accuracy: 1 }), stored({ netWpm: 30, accuracy: 0.9 })],
    };
    const weeks = weeklyTrend(p, (at) => (at > 0 ? "2026-11-09" : "x"));
    expect(weeks.map((w) => [w.netWpm, w.accuracyPct, w.sessions])).toEqual([
      [10, 90, 2],
      [25, 95, 2],
    ]);
  });
});
