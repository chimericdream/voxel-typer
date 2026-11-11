/**
 * The synthetic typist (`tools/sim/typist.ts`, M1-07): neighbor map, latency and error model,
 * human-like corrections per policy, determinism, and purity.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { replay } from "../../../src/engine/replay";
import { createRng } from "../../../src/engine/rng";
import type { SessionConfig, Target, WrongKeyPolicy } from "../../../src/engine/types";
import {
  errorProbability,
  LATENCY_CLAMP_MS,
  MAX_ERROR_PROBABILITY,
  neighborsOf,
  NOTICE_DELAY_MS,
  QWERTY_NEIGHBORS,
  runTypist,
  sampleLatency,
  sampleNoticeDelay,
  TYPIST_PROFILES,
} from "../../../tools/sim/typist";
import type { TypistProfile, TypistRun } from "../../../tools/sim/typist";

const SOURCE = resolve(import.meta.dirname, "../../../tools/sim/typist.ts");

const words = (texts: string[]): Target[] => texts.map((text, i) => ({ id: `w${i}`, text }));

function config(policy: WrongKeyPolicy, patch: Partial<SessionConfig> = {}): SessionConfig {
  return {
    policy,
    targeting: "sequential",
    caseSensitive: true,
    end: { kind: "targets" },
    mode: "practice",
    seed: 1,
    ...patch,
  };
}

const sloppy: TypistProfile = { wpm: 30, errorRate: 0.3, jitter: 0.3 };
const perfect: TypistProfile = { wpm: 30, errorRate: 0, jitter: 0.3 };
const TEXTS = ["sad", "lad", "fall", "dash", "glad", "flask", "salad", "hall"];

describe("QWERTY neighbors", () => {
  it("knows the home row", () => {
    expect(QWERTY_NEIGHBORS["f"]).toBe("dgrtcv");
    expect(QWERTY_NEIGHBORS["a"]).toBe("sqwz");
    expect(QWERTY_NEIGHBORS[";"]).toBe("l'p[./");
    expect(QWERTY_NEIGHBORS[" "]).toBe("cvbnm");
  });

  it("is symmetric between keys of the board", () => {
    for (const [key, near] of Object.entries(QWERTY_NEIGHBORS)) {
      if (key === " ") continue;
      for (const other of near) expect(QWERTY_NEIGHBORS[other] ?? "").toContain(key);
    }
  });

  it("keeps case and has a fallback for unknown chars", () => {
    expect(neighborsOf("F")).toEqual(["D", "G", "R", "T", "C", "V"]);
    expect(neighborsOf("é")).toEqual(["a", "s", "d", "f"]);
    expect(neighborsOf("~")).not.toContain("~");
    for (const key of Object.keys(QWERTY_NEIGHBORS)) expect(neighborsOf(key)).not.toContain(key);
  });
});

describe("error model", () => {
  it("multiplies, learns and caps", () => {
    const p: TypistProfile = {
      wpm: 20,
      errorRate: 0.1,
      jitter: 0,
      perKeyErrorMult: { a: 3, z: 100 },
      learnRate: 1,
    };
    expect(errorProbability(p, "s")).toBeCloseTo(0.1);
    expect(errorProbability(p, "a")).toBeCloseTo(0.3);
    expect(errorProbability(p, "a", { a: 100 })).toBeCloseTo(0.15);
    expect(errorProbability(p, "z")).toBe(MAX_ERROR_PROBABILITY);
    expect(errorProbability({ ...p, errorRate: -1 }, "s")).toBe(0);
    expect(errorProbability({ wpm: 20, errorRate: 0.1, jitter: 0 }, "a", { a: 1e6 })).toBeCloseTo(
      0.1,
    );
  });
});

describe("latency model", () => {
  it("is lognormal around 12000 / wpm", () => {
    const rng = createRng(5);
    const profile: TypistProfile = { wpm: 24, errorRate: 0, jitter: 0.4 };
    const samples = Array.from({ length: 4000 }, () => sampleLatency(profile, rng)).toSorted(
      (a, b) => a - b,
    );
    const median = samples[2000] ?? 0;
    expect(median).toBeGreaterThan(500 * 0.95);
    expect(median).toBeLessThan(500 * 1.05);
    const logs = samples.map(Math.log);
    const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
    const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / logs.length);
    expect(sd).toBeGreaterThan(0.36);
    expect(sd).toBeLessThan(0.44);
  });

  it("is exact with no jitter and clamped at the ends", () => {
    const rng = createRng(1);
    expect(sampleLatency({ wpm: 20, errorRate: 0, jitter: 0 }, rng)).toBe(600);
    expect(sampleLatency({ wpm: 1e9, errorRate: 0, jitter: 0 }, rng)).toBe(LATENCY_CLAMP_MS.min);
    expect(sampleLatency({ wpm: 0.01, errorRate: 0, jitter: 0 }, rng)).toBe(LATENCY_CLAMP_MS.max);
  });

  it("notices a mistake after 150–400 ms", () => {
    const rng = createRng(2);
    const delays = Array.from({ length: 500 }, () => sampleNoticeDelay(rng));
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(NOTICE_DELAY_MS.min);
    expect(Math.max(...delays)).toBeLessThanOrEqual(NOTICE_DELAY_MS.max);
    expect(delays.every(Number.isInteger)).toBe(true);
  });
});

/** A sloppy `stay` run of the shared texts. */
function sloppyRun(seed: number): TypistRun {
  return runTypist({
    config: config("stay"),
    targets: words(TEXTS),
    profile: sloppy,
    rng: createRng(seed),
  });
}

describe("runTypist", () => {
  it("types every target with no errors when errorRate is 0", () => {
    const run = runTypist({
      config: config("stay"),
      targets: words(TEXTS),
      profile: perfect,
      rng: createRng(3),
    });
    expect(run.endedNaturally).toBe(true);
    expect(run.summary.accuracy).toBe(1);
    expect(run.summary.targetsCompleted).toBe(TEXTS.length);
    // Every char plus a space after each word but the last.
    const chars = TEXTS.join(" ").length;
    expect(run.summary.keystrokes).toBe(chars);
    expect(run.keysPressed).toBe(chars);
  });

  it("is deterministic for a seed and differs across seeds", () => {
    expect(sloppyRun(7)).toEqual(sloppyRun(7));
    expect(sloppyRun(7).snapshot.log).not.toEqual(sloppyRun(8).snapshot.log);
  });

  it.each(["stay", "skip", "backspace"] as const)(
    "%s: its snapshot replays to the same summary",
    (policy) => {
      const run = runTypist({
        config: config(policy),
        targets: words(TEXTS),
        profile: sloppy,
        rng: createRng(11),
      });
      expect(replay(run.snapshot).summary).toEqual(run.summary);
      expect(run.summary.errors).toBeGreaterThan(0);
    },
  );

  it("stay: retypes after a notice delay, never presses Backspace, leaves nothing wrong", () => {
    const run = runTypist({
      config: config("stay"),
      targets: words(TEXTS),
      profile: sloppy,
      rng: createRng(12),
    });
    const keys = run.snapshot.log.flatMap((e) => (e.k === "key" ? [e.input] : []));
    expect(keys.some((k) => k.key === "Backspace")).toBe(false);
    expect(run.summary.uncorrected).toBe(0);
    expect(run.summary.targetsCompleted).toBe(TEXTS.length);
    const wrongAt = new Set(run.events.flatMap((e) => (e.type === "wrong" ? [e.t] : [])));
    keys.forEach((k, i) => {
      const next = keys[i + 1];
      if (wrongAt.has(k.t) && next) {
        expect(next.t - k.t).toBeGreaterThanOrEqual(NOTICE_DELAY_MS.min + LATENCY_CLAMP_MS.min);
      }
    });
  });

  it("backspace: presses Backspace after each wrong char and finishes clean", () => {
    const run = runTypist({
      config: config("backspace"),
      targets: words(TEXTS),
      profile: sloppy,
      rng: createRng(13),
    });
    const keys = run.snapshot.log.flatMap((e) => (e.k === "key" ? [e.input] : []));
    const wrongAt = new Set(run.events.flatMap((e) => (e.type === "wrong" ? [e.t] : [])));
    expect(wrongAt.size).toBeGreaterThan(0);
    keys.forEach((k, i) => {
      if (!wrongAt.has(k.t)) return;
      const next = keys[i + 1];
      expect(next?.key).toBe("Backspace");
      expect((next?.t ?? 0) - k.t).toBeGreaterThanOrEqual(NOTICE_DELAY_MS.min);
    });
    expect(run.summary.uncorrected).toBe(0);
    expect(run.summary.targetsCompleted).toBe(TEXTS.length);
  });

  it("skip: carries on without correcting", () => {
    const run = runTypist({
      config: config("skip"),
      targets: words(TEXTS),
      profile: sloppy,
      rng: createRng(14),
    });
    const keys = run.snapshot.log.flatMap((e) => (e.k === "key" ? [e.input] : []));
    expect(keys.some((k) => k.key === "Backspace")).toBe(false);
    expect(run.summary.uncorrected).toBeGreaterThan(0);
    expect(run.summary.keystrokes).toBe(TEXTS.join(" ").length);
  });

  it("hits a weak key's neighbors more often", () => {
    const profile: TypistProfile = {
      wpm: 30,
      errorRate: 0.03,
      jitter: 0.3,
      perKeyErrorMult: { a: 8 },
    };
    const run = runTypist({
      config: config("stay"),
      targets: words(Array.from({ length: 60 }, (_, i) => TEXTS[i % TEXTS.length] ?? "sad")),
      profile,
      rng: createRng(15),
    });
    const rate = (k: string) =>
      (run.summary.perKey[k]?.errors ?? 0) / (run.summary.perKey[k]?.attempts ?? 1);
    expect(rate("a")).toBeGreaterThan(2 * rate("s"));
    expect(rate("a")).toBeGreaterThan(2 * rate("l"));
    const wrongForA = run.events.flatMap((e) =>
      e.type === "wrong" && e.expected === "a" ? [e.got] : [],
    );
    expect(wrongForA.length).toBeGreaterThan(0);
    for (const got of wrongForA) expect("sqwz").toContain(got);
  });

  it("works under lockOn and with a time limit", () => {
    const run = runTypist({
      config: config("stay", { targeting: "lockOn", end: { kind: "time", ms: 3000 } }),
      targets: words(TEXTS),
      profile: sloppy,
      rng: createRng(16),
      startT: 1000,
    });
    expect(run.endedNaturally).toBe(true);
    expect(run.summary.activeMs).toBe(3000);
    expect(run.summary.startedAtT).toBeGreaterThan(1000);
    expect(replay(run.snapshot).summary).toEqual(run.summary);
  });

  it("ends by force at maxKeys or when the targets run out", () => {
    const forced = runTypist({
      config: config("stay"),
      targets: words(TEXTS),
      profile: perfect,
      rng: createRng(17),
      maxKeys: 5,
    });
    expect(forced.endedNaturally).toBe(false);
    expect(forced.keysPressed).toBe(5);
    const outOfText = runTypist({
      config: config("stay", { end: { kind: "time", ms: 600_000 } }),
      targets: words(["as"]),
      profile: perfect,
      rng: createRng(18),
    });
    expect(outOfText.endedNaturally).toBe(false);
    expect(outOfText.summary.targetsCompleted).toBe(1);
  });

  it("types uppercase with shift", () => {
    const run = runTypist({
      config: config("stay"),
      targets: words(["Sad"]),
      profile: perfect,
      rng: createRng(19),
    });
    const first = run.snapshot.log[0];
    expect(first?.k === "key" ? first.input : null).toMatchObject({ key: "S", shift: true });
  });

  it("ships the four profiles the tool offers", () => {
    expect(Object.keys(TYPIST_PROFILES).toSorted()).toEqual(["avg", "fast", "pinkyweak", "slow"]);
    expect(TYPIST_PROFILES.pinkyweak.perKeyErrorMult?.["a"]).toBeGreaterThan(1);
    expect(TYPIST_PROFILES.pinkyweak.perKeyErrorMult?.[";"]).toBeGreaterThan(1);
  });
});

describe("purity", () => {
  const source = readFileSync(SOURCE, "utf8");

  it("reads no clock and no global randomness", () => {
    for (const banned of [/Date\b/, /Math\.random/, /performance\b/, /process\b/, /globalThis/]) {
      expect(source).not.toMatch(banned);
    }
  });

  it("imports only pure engine modules and types", () => {
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(imports.length).toBeGreaterThan(0);
    for (const path of imports) expect(path).toMatch(/^\.\.\/\.\.\/src\/(engine|types)\//);
  });
});
