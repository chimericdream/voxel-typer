/**
 * The `sim` tool (`tools/sim.ts`, M1-07): argument parsing, lesson resolution, determinism of the
 * printed report, and the pinky-weak tuning goal recorded in docs/sim.md.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Lesson } from "../../../src/content/lessons/types";
import {
  ADHOC_KEYS,
  adhocLesson,
  DEFAULT_OPTIONS,
  formatReport,
  lessonFromData,
  parseArgs,
  simulate,
} from "../../../tools/sim";
import type { SimOptions } from "../../../tools/sim";

const REPO = resolve(import.meta.dirname, "../../..");

const small: SimOptions = { ...DEFAULT_OPTIONS, runs: 4, sessions: 2, chars: 60 };

function lesson(patch: Partial<Lesson> & Pick<Lesson, "id" | "biome" | "order">): Lesson {
  return {
    titleKey: "common.title",
    newKeys: [],
    reviewKeys: [],
    kind: "letters",
    length: { chars: 100 },
    mode: "mine",
    targets: { accuracy: 0.9 },
    ...patch,
  };
}

describe("parseArgs", () => {
  it("has the card's defaults", () => {
    expect(parseArgs([])).toEqual(DEFAULT_OPTIONS);
    expect(DEFAULT_OPTIONS).toMatchObject({ lesson: "adhoc", runs: 50, seed: 1 });
  });

  it("reads every flag", () => {
    expect(
      parseArgs([
        "--lesson",
        "meadow-03",
        "--typist",
        "pinkyweak",
        "--runs",
        "7",
        "--sessions",
        "3",
        "--seed",
        "-4",
        "--band",
        "builder",
        "--kind",
        "letters",
        "--chars",
        "80",
      ]),
    ).toEqual({
      lesson: "meadow-03",
      typist: "pinkyweak",
      runs: 7,
      sessions: 3,
      seed: -4,
      band: "builder",
      kind: "letters",
      chars: 80,
    });
  });

  it.each([
    [["--typist", "robot"], /--typist/],
    [["--runs", "0"], /--runs/],
    [["--runs", "1.5"], /--runs/],
    [["--seed", "x"], /--seed/],
    [["--band", "adult"], /--band/],
    [["--kind", "poems"], /--kind/],
    [["--runs"], /needs a value/],
    [["--fast", "1"], /unknown option/],
  ])("rejects %j", (args, message) => {
    expect(() => parseArgs(args)).toThrow(message);
  });
});

describe("lessons", () => {
  it("adhoc is Meadow's ten keys with no focus", () => {
    const l = adhocLesson(DEFAULT_OPTIONS);
    expect(l.allowed).toEqual(ADHOC_KEYS);
    expect(l.focus).toEqual([]);
    expect(l.policy).toBe("stay");
    expect(adhocLesson({ kind: "sentences", chars: 10 }).policy).toBe("backspace");
  });

  it("resolves a curriculum lesson by the contract defaults", () => {
    const all = [
      lesson({ id: "birch-01", biome: "birch", order: 1, newKeys: ["e", "i"] }),
      lesson({ id: "meadow-01", biome: "meadow", order: 1, newKeys: ["f", "j"] }),
      lesson({ id: "meadow-02", biome: "meadow", order: 2, newKeys: ["d", "k", " "] }),
      lesson({ id: "sparkstone-01", biome: "sparkstone", order: 1, newKeys: ["1"] }),
      lesson({
        id: "citadel-01",
        biome: "citadel",
        order: 1,
        newKeys: ["z"],
        kind: "sentences",
        length: { seconds: 60 },
        mode: "defense",
      }),
    ];
    const meadow = lessonFromData(all, "meadow-02", "sprout");
    expect(meadow.allowed).toEqual(["f", "j", "d", "k"]);
    expect(meadow.focus).toEqual(["d", "k", " "]);
    expect(meadow.length).toEqual({ chars: 60 });
    expect(meadow.policy).toBe("stay");
    expect(meadow.caseSensitive).toBe(false);
    expect(meadow.targeting).toBe("sequential");

    const citadel = lessonFromData(all, "citadel-01", "builder");
    expect(citadel.allowed).not.toContain("1");
    expect(citadel.allowed).toContain("e");
    expect(citadel.policy).toBe("backspace");
    expect(citadel.targeting).toBe("lockOn");
    expect(citadel.caseSensitive).toBe(true);
    expect(citadel.length).toEqual({ seconds: 78 });

    expect(lessonFromData(all, "birch-01", "builder").policy).toBe("skip");
    expect(lessonFromData(all, "sparkstone-01", "miner").allowed).toContain("1");
    expect(() => lessonFromData(all, "nope", "miner")).toThrow(/adhoc/);
    expect(() => lessonFromData([], "nope", "miner")).toThrow(/none yet/);
  });

  it("simulates a timed curriculum lesson", () => {
    const timed = lessonFromData(
      [
        lesson({
          id: "meadow-01",
          biome: "meadow",
          order: 1,
          newKeys: ["f", "j"],
          length: { seconds: 20 },
        }),
      ],
      "meadow-01",
      "miner",
    );
    const report = simulate(timed, small);
    const stars = report.rows.flatMap((row) => row.stars);
    expect(stars.reduce((a, b) => a + b, 0)).toBe(small.runs * small.sessions);
    expect(report.rows.every((row) => row.stars[0] === 0)).toBe(true);
  });
});

describe("determinism", () => {
  it("prints the same report for the same seed and a different one for another", () => {
    const adhoc = adhocLesson(small);
    const a = formatReport(simulate(adhoc, small));
    expect(formatReport(simulate(adhoc, small))).toBe(a);
    expect(formatReport(simulate(adhoc, { ...small, seed: 2 }))).not.toBe(a);
    expect(a).toContain("Per session");
    expect(a).toContain("Adaptive weights after session 2");
    expect(a).toContain("Bigram SRS");
  });

  it("two CLI runs print byte-identical output", () => {
    const args = ["--import", "tsx", "tools/sim.ts", "--typist", "pinkyweak", "--runs", "3"];
    const run = () =>
      spawnSync(process.execPath, [...args, "--sessions", "2", "--seed", "9"], { cwd: REPO });
    const first = run();
    const second = run();
    expect(first.status).toBe(0);
    expect(first.stdout.length).toBeGreaterThan(0);
    expect(Buffer.compare(first.stdout, second.stdout)).toBe(0);
  });

  it("the CLI explains bad arguments and exits 2", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "tools/sim.ts", "--lesson", "meadow-99"],
      {
        cwd: REPO,
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/meadow-99/);
    expect(result.stderr).toMatch(/Usage/);
  });
});

describe("pinky-weak tuning (docs/sim.md)", () => {
  const opts: SimOptions = { ...DEFAULT_OPTIONS, typist: "pinkyweak", runs: 50, sessions: 5 };

  it.each(["syllables", "letters"] as const)(
    "%s: a and ; are the top-2 weights after 5 sessions, and no key starves",
    (kind) => {
      const report = simulate(adhocLesson({ ...opts, kind }), { ...opts, kind });
      const byWeight = report.keys.toSorted((x, y) => y.weight - x.weight).map((k) => k.key);
      expect(byWeight.slice(0, 2).toSorted()).toEqual([";", "a"]);
      const byTop2 = report.keys.toSorted((x, y) => y.top2 - x.top2).map((k) => k.key);
      expect(byTop2.slice(0, 2).toSorted()).toEqual([";", "a"]);
      // The most common top-2 pair in every session is {a, ;}.
      for (const row of report.rows) {
        const best = [...row.topPairs].toSorted((x, y) => y[1] - x[1])[0];
        expect(best?.[0]).toBe("; a");
      }
      for (const key of report.keys) expect(key.share).toBeGreaterThan(0.04);
    },
  );
});
