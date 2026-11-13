/**
 * Placement test rules (task M3-05): the ladder, the blocks of each rung and the estimate.
 * Property tests use fast-check with a fixed seed.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  LADDER_RULES,
  MAX_TIER,
  PLACEMENT_GATES,
  PLACEMENT_MIN_ACTIVE_MS,
  PLACEMENT_MIN_GATE_KEYS,
  PLACEMENT_ROW_FLOOR,
  PLACEMENT_TIERS,
  coverKeys,
  createLadder,
  estimatePlacement,
  firstTryShare,
  ladderRecord,
  rowFloorKeys,
  rungRates,
  testsNewKey,
  tierKeys,
} from "../../../src/engine/placement";
import type { Ladder, PlacementProgression, RungScore } from "../../../src/engine/placement";
import { createPlacementDriver, tierTargets } from "../../../src/engine/placement-driver";
import type { TierContext } from "../../../src/engine/placement-driver";
import { createRng } from "../../../src/engine/rng";
import { foldSummaryIntoKeyStats } from "../../../src/engine/stats";
import type { SessionSummary } from "../../../src/engine/stats";
import { BIOME_ORDER } from "../../../src/types/core";
import type { AgeBand } from "../../../src/types/core";
import { loadPlacementPools } from "../../../tools/sim-placement";

const FC = { seed: 4305, numRuns: 200 } as const;
const BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];
const tierOf = (id: string): number => PLACEMENT_TIERS.findIndex((t) => t.id === id);

function summary(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    mode: "placement",
    seed: 1,
    startedAtT: 0,
    activeMs: 90_000,
    keystrokes: 200,
    correct: 190,
    errors: 10,
    uncorrected: 0,
    grossWpm: 25,
    netWpm: 25,
    accuracy: 0.95,
    consistency: 0.5,
    perKey: { f: { attempts: 10, errors: 1, latencies: [400, 500] } },
    bigrams: {},
    longestStreak: 30,
    targetsCompleted: 100,
    ...over,
  };
}

const prog = (over: Partial<PlacementProgression> = {}): PlacementProgression => ({
  band: "builder",
  tierReached: PLACEMENT_TIERS.length - 1,
  sessionIndex: 1,
  ...over,
});

/** The start for a test at `netWpm` and `accuracy` that reached rung `tier`. */
const at = (netWpm: number, accuracy = 0.97, tier = 5, band: AgeBand = "builder") =>
  estimatePlacement(summary({ netWpm, accuracy }), prog({ tierReached: tier, band })).startBiome;

/** Per-key stats with `tries` places for each key of `keys`, `slips` of them slipped once first. */
const row = (keys: string, tries: number, slips: number): SessionSummary["perKey"] =>
  Object.fromEntries(
    Array.from(keys, (k) => [k, { attempts: tries + slips, errors: slips, latencies: [] }]),
  );

/** The start for a fast, accurate test with these per-key stats. */
const fastStart = (perKey: SessionSummary["perKey"]) =>
  estimatePlacement(summary({ netWpm: 60, accuracy: 0.97, perKey }), prog()).startBiome;

/** 61 blocks of one driver run, with a slip every 7th block. */
function driverRun(ctx: TierContext): string[] {
  const d = createPlacementDriver(ctx, createRng(11));
  const out = [d.first().text];
  for (let i = 0; i < 60; i++) out.push(d.next(i % 7 === 0 ? 1 : 0, 500 * (i + 1)).text);
  return out;
}

/** A block of the ladder's current rung: a key it still has to cover, else one of its new keys. */
const blockFor = (l: Ladder): string => l.pending[0] ?? PLACEMENT_TIERS[l.tier]?.newKeys[0] ?? "a";

/** Records blocks of the current rung ({@link blockFor}), clean or not. */
const record = (l: Ladder, cleans: readonly boolean[]): Ladder =>
  cleans.reduce((acc, c) => ladderRecord(acc, c, blockFor(acc)).ladder, l);

/** A ladder on `tier` that has already covered its keys, so only the 8-of-10 window counts. */
const covered = (tier: number, band: AgeBand = "miner"): Ladder => ({
  tier,
  maxTier: MAX_TIER[band],
  recent: [],
  pending: [],
});

describe("the ladder", () => {
  it("climbs home → top → bottom → words → capitals → numbers", () => {
    expect(PLACEMENT_TIERS.map((t) => t.id)).toEqual([
      "home",
      "top",
      "bottom",
      "words",
      "capitals",
      "numbers",
    ]);
    expect(PLACEMENT_TIERS.map((t) => t.biome)).toEqual(BIOME_ORDER.slice(0, 6));
  });

  it("opens the next rung on 8 clean blocks of the last 10", () => {
    const l = covered(0);
    // 7 clean of 7: not yet.
    expect(
      record(
        l,
        Array.from({ length: 7 }, () => true),
      ).tier,
    ).toBe(0);
    // The 8th clean block opens the top row, and the count starts over there.
    const up = ladderRecord(
      record(
        l,
        Array.from({ length: 7 }, () => true),
      ),
      true,
      "f",
    );
    expect(up.advanced).toBe(true);
    expect(up.ladder).toEqual({
      tier: 1,
      maxTier: MAX_TIER.miner,
      recent: [],
      pending: Array.from("qwertyuiop"),
    });
    // Two slips among ten keep it shut until the window slides past them... 8 of 10 is enough.
    const mixed = [false, false, true, true, true, true, true, true, true];
    expect(record(l, mixed).tier).toBe(0);
    expect(record(l, [...mixed, true]).tier).toBe(1);
    // Three slips in the last ten: 7 of 10, still home row.
    expect(record(l, [false, true, false, true, true, true, false, true, true, true]).tier).toBe(0);
  });

  it("opens a rung only once each of its new keys broke cleanly (N1)", () => {
    // The home row has 10 keys: 8 clean blocks are not enough, the 10th key opens it.
    const home = createLadder("miner");
    expect(home.pending).toEqual(Array.from("asdfghjkl;"));
    const nine = record(
      home,
      Array.from({ length: 9 }, () => true),
    );
    expect(nine.tier).toBe(0);
    expect(nine.pending).toEqual([";"]);
    expect(ladderRecord(nine, true, ";").advanced).toBe(true);
    // Clean blocks on a key already covered don't stand in for the missing one.
    let l = nine;
    for (let i = 0; i < 20; i++) l = ladderRecord(l, true, "f").ladder;
    expect(l.tier).toBe(0);
    // A slip doesn't cover its key.
    expect(ladderRecord(nine, false, ";").ladder.pending).toEqual([";"]);
  });

  it("counts only blocks that use one of the rung's new keys (N1)", () => {
    const top = covered(1);
    // Home-row blocks on the top rung change nothing, clean or not.
    expect(ladderRecord(top, true, "f")).toEqual({ ladder: top, advanced: false });
    expect(ladderRecord(top, false, "j")).toEqual({ ladder: top, advanced: false });
    expect(ladderRecord(top, false, "q").ladder.recent).toEqual([false]);
    // The words rung adds no keys, so every block counts; every capitals block has a capital.
    expect(testsNewKey(tierOf("words"), "fish")).toBe(true);
    expect(testsNewKey(tierOf("capitals"), "Ada")).toBe(true);
    expect(testsNewKey(tierOf("capitals"), "ada")).toBe(false);
    expect(testsNewKey(tierOf("bottom"), "f")).toBe(false);
    expect(testsNewKey(tierOf("bottom"), "z")).toBe(true);
  });

  it("covers the new keys of the letter rungs only", () => {
    expect(coverKeys(tierOf("home")).join("")).toBe("asdfghjkl;");
    expect(coverKeys(tierOf("top")).join("")).toBe("qwertyuiop");
    expect(coverKeys(tierOf("bottom")).join("")).toBe("zxcvbnm");
    expect(coverKeys(tierOf("words"))).toEqual([]);
    expect(coverKeys(tierOf("capitals"))).toEqual([]);
    expect(coverKeys(99)).toEqual([]);
  });

  it("only ever counts the last 10 counted blocks, and opens on 8 of them plus coverage", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.boolean(), fc.boolean()), { maxLength: 160 }), (steps) => {
        let l = createLadder("builder");
        for (const [clean, onNewKey] of steps) {
          const before = l;
          const own = PLACEMENT_TIERS[before.tier];
          // An old key of the rung, if it has any.
          const old = tierKeys(before.tier).find((k) => !(own?.newKeys ?? []).includes(k));
          const text = onNewKey || old === undefined ? blockFor(before) : old;
          const r = ladderRecord(l, clean, text);
          l = r.ladder;
          expect(l.recent.length).toBeLessThanOrEqual(LADDER_RULES.window);
          if (!testsNewKey(before.tier, text)) {
            expect(r).toEqual({ ladder: before, advanced: false });
            continue;
          }
          const window = [...before.recent, clean].slice(-LADDER_RULES.window);
          const good = window.filter(Boolean).length;
          const pending = clean ? before.pending.filter((k) => k !== text) : before.pending;
          expect(r.advanced).toBe(
            good >= LADDER_RULES.need && pending.length === 0 && before.tier < before.maxTier,
          );
          expect(l.tier).toBe(before.tier + (r.advanced ? 1 : 0));
        }
      }),
      FC,
    );
  });

  it("stops at the band's top rung: words for a Sprout (so never past Frosty)", () => {
    expect(MAX_TIER).toEqual({ sprout: tierOf("words"), miner: tierOf("capitals"), builder: 5 });
    const top = record(
      createLadder("sprout"),
      Array.from({ length: 200 }, () => true),
    );
    expect(top.tier).toBe(tierOf("words"));
  });
});

describe("tierKeys", () => {
  it("adds each rung's keys to the earlier ones", () => {
    expect(tierKeys(0).join("")).toBe("asdfghjkl;");
    expect(tierKeys(1)).toEqual([...tierKeys(0), ...Array.from("qwertyuiop")]);
    expect(tierKeys(2)).toEqual([...tierKeys(1), ...Array.from("zxcvbnm")]);
    expect(
      tierKeys(3)
        .filter((k) => /[a-z]/.test(k))
        .toSorted()
        .join(""),
    ).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(tierKeys(4)).toEqual(expect.arrayContaining(["A", "Z", "a", "z"]));
  });

  it("asks for digits only on the number rung", () => {
    expect(tierKeys(tierOf("numbers")).join("")).toBe("1234567890");
  });
});

describe("tierTargets", () => {
  const pools = loadPlacementPools();
  const ctx = (band: AgeBand): TierContext => ({
    band,
    pools,
    stats: {},
    sessionIndex: 0,
    targetLatencyMs: 500,
  });

  it("only ever asks for the rung's keys, with no trailing space", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: PLACEMENT_TIERS.length - 1 }),
        fc.constantFrom(...BANDS),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        (tier, band, seed) => {
          const allowed = new Set(tierKeys(tier));
          const out = tierTargets(tier, ctx(band), createRng(seed), "x");
          expect(out.length).toBeGreaterThan(0);
          for (const target of out) {
            expect(target.trailingSpace).toBe(false);
            for (const ch of target.text) expect(allowed.has(ch)).toBe(true);
          }
        },
      ),
      { ...FC, numRuns: 120 },
    );
  });

  it("makes words on the word rung and capitals on the capitals rung", () => {
    const words = tierTargets(tierOf("words"), ctx("miner"), createRng(1), "w");
    expect(words.every((w) => w.text.length > 1)).toBe(true);
    const caps = tierTargets(tierOf("capitals"), ctx("miner"), createRng(1), "c");
    expect(caps.some((w) => /^[A-Z]/.test(w.text))).toBe(true);
  });

  it("shows the keys still to cover first (N1)", () => {
    const top = tierOf("top");
    const out = tierTargets(top, ctx("miner"), createRng(5), "t", 12, Array.from("qwertyuiop"));
    expect(out).toHaveLength(12);
    const lead = out.slice(0, 10).map((x) => x.text);
    expect(lead.toSorted().join("")).toBe("eiopqrtuwy");
    // A batch no longer than the keys to cover is all cover keys.
    const three = tierTargets(top, ctx("miner"), createRng(5), "t", 3, Array.from("qwe"));
    expect(three.map((x) => x.text).toSorted()).toEqual(["e", "q", "w"]);
  });

  it("is deterministic for a seed", () => {
    const a = tierTargets(1, ctx("sprout"), createRng(9), "a");
    const b = tierTargets(1, ctx("sprout"), createRng(9), "a");
    expect(a).toEqual(b);
  });
});

describe("createPlacementDriver", () => {
  const ctx: TierContext = {
    band: "miner",
    pools: loadPlacementPools(),
    stats: {},
    sessionIndex: 0,
    targetLatencyMs: 500,
  };

  it("serves the new rung's blocks right after a rung opens, with unique ids", () => {
    const d = createPlacementDriver(ctx, createRng(3));
    const first = d.first();
    const ids = new Set<string>([first.id]);
    const home = [first.text];
    let t = 0;
    // The home rung shows its 10 keys first; the 10th clean one opens the top row.
    for (let i = 0; i < 9; i++) {
      t += 400;
      const next = d.next(0, t);
      ids.add(next.id);
      home.push(next.text);
    }
    expect(home.toSorted().join("")).toBe(";adfghjkls");
    expect(d.tierReached()).toBe(0);
    const after = d.next(0, t + 400);
    expect(d.tierReached()).toBe(1);
    expect(after.id.startsWith("p1-")).toBe(true);
    ids.add(after.id);
    const top = [after.text];
    for (let i = 0; i < 40; i++) {
      t += 400;
      const next = d.next(1, t);
      ids.add(next.id);
      if (i < 9) top.push(next.text);
    }
    // The top rung shows its 10 new keys first too.
    expect(top.toSorted().join("")).toBe("eiopqrtuwy");
    expect(ids.size).toBe(1 + 9 + 1 + 40);
    expect(d.blocks()).toBe(50);
    // Slips keep it on the top row.
    expect(d.tierReached()).toBe(1);
  });

  it("scores the blocks at or below each rung it leaves (N2)", () => {
    const d = createPlacementDriver(ctx, createRng(3));
    d.first();
    // Home rung: one slip on the first block, then clean blocks until the rung opens.
    let blocks = 1;
    d.next(1, 1400);
    while (d.tierReached() === 0 && blocks < 20) {
      blocks++;
      d.next(0, 1000 + 400 * blocks);
    }
    expect(d.tierReached()).toBe(1);
    // The slipped key has to break cleanly later, so it takes more than the 10 home keys.
    expect(blocks).toBeGreaterThan(10);
    const scores = d.rungScores(1000);
    expect(scores).toEqual([
      { tier: 0, ms: 400 * blocks, keystrokes: blocks + 1, correct: blocks },
    ]);
    // Times before the start count as 0.
    expect(d.rungScores(10_000_000)[0]?.ms).toBe(0);
  });

  it("plays the same test for the same seed", () => {
    expect(driverRun(ctx)).toEqual(driverRun(ctx));
  });
});

describe("estimatePlacement", () => {
  it("returns the session's key stats as the baseline", () => {
    const s = summary();
    expect(estimatePlacement(s, prog({ sessionIndex: 4 })).keyBaseline).toEqual(
      foldSummaryIntoKeyStats({}, s, 4),
    );
  });

  it("follows the gates", () => {
    expect(at(5)).toBe("meadow");
    expect(at(PLACEMENT_GATES.birch?.netWpm ?? 0)).toBe("birch");
    expect(at(PLACEMENT_GATES.shore?.netWpm ?? 0)).toBe("shore");
    expect(at(PLACEMENT_GATES.frosty?.netWpm ?? 0)).toBe("frosty");
    expect(at(PLACEMENT_GATES.mines?.netWpm ?? 0)).toBe("mines");
    expect(at(PLACEMENT_GATES.marsh?.netWpm ?? 0)).toBe("marsh");
    expect(at(200)).toBe("marsh");
    // Fast but sloppy stays nearer home.
    expect(at(60, 0.89)).toBe("birch");
    expect(at(60, 0.8)).toBe("meadow");
    // Fast but the ladder stopped on the top row: Birch.
    expect(at(60, 0.99, 1)).toBe("birch");
    // A Sprout never starts past Frosty Peaks, even if the rung said more.
    expect(at(60, 0.99, 5, "sprout")).toBe("frosty");
  });

  it("judges each gate on the blocks that earned its rung (N2)", () => {
    const builder = prog({ band: "builder", tierReached: tierOf("numbers") });
    // Slow digits pulled the whole test down to 20 WPM, but up to the capitals the child typed 80.
    const slowDigits = summary({ netWpm: 20, accuracy: 0.9 });
    const rungs: RungScore[] = [0, 1, 2, 3, 4].map((tier) => ({
      tier,
      ms: 6000 * (tier + 1),
      keystrokes: 82 * (tier + 1),
      correct: 80 * (tier + 1),
    }));
    expect(rungRates({ tier: 0, ms: 6000, keystrokes: 82, correct: 80 }).netWpm).toBeCloseTo(160);
    expect(estimatePlacement(slowDigits, { ...builder, rungs }).startBiome).toBe("marsh");
    // The M3-05 rule (whole test): the slow digits drag the child down to the Shore.
    expect(estimatePlacement(slowDigits, builder).startBiome).toBe("shore");
    // A rung left slowly holds the start at the biome it opened, whatever came after it.
    const slowWords = rungs.map((r) => (r.tier === 3 ? { ...r, ms: 600_000 } : r));
    const fast = summary({ netWpm: 60 });
    expect(estimatePlacement(fast, { ...builder, rungs: slowWords }).startBiome).toBe("frosty");
  });

  it("judges a gate on at least PLACEMENT_MIN_GATE_KEYS keystrokes", () => {
    const p = prog({ band: "builder", tierReached: tierOf("top") });
    // Two slips in 12 home-row keys is 83 %, under Birch's bar; too few keys to judge on.
    const tiny: RungScore = { tier: 0, ms: 6000, keystrokes: 12, correct: 10 };
    expect(tiny.keystrokes).toBeLessThan(PLACEMENT_MIN_GATE_KEYS);
    const fast = summary({ netWpm: 30 });
    expect(estimatePlacement(fast, { ...p, rungs: [tiny] }).startBiome).toBe("birch");
    // With enough keys the same accuracy counts.
    const enough: RungScore = { tier: 0, ms: 30_000, keystrokes: 72, correct: 60 };
    expect(estimatePlacement(fast, { ...p, rungs: [enough] }).startBiome).toBe("meadow");
    // The floor's value, as a literal (M3-FIX-10): 45 keys at 83 % still fall through to the whole
    // test, and 60 keys at 83 % count. Reading the constant back alone would let it drift.
    const fortyFive: RungScore = { tier: 0, ms: 20_000, keystrokes: 45, correct: 37 };
    expect(estimatePlacement(fast, { ...p, rungs: [fortyFive] }).startBiome).toBe("birch");
    const sixty: RungScore = { tier: 0, ms: 25_000, keystrokes: 60, correct: 50 };
    expect(estimatePlacement(fast, { ...p, rungs: [sixty] }).startBiome).toBe("meadow");
  });

  it("starts past Birch only with the top row known, and past the Shore with the bottom row too (M3-FIX-10)", () => {
    expect(rowFloorKeys(tierOf("home"))).toEqual([]);
    expect(rowFloorKeys(tierOf("top")).join("")).toBe("qwertyuiop");
    expect(rowFloorKeys(tierOf("bottom")).join("")).toBe("qwertyuiopzxcvbnm");
    expect(rowFloorKeys(tierOf("numbers"))).toEqual(rowFloorKeys(tierOf("bottom")));
    expect(PLACEMENT_ROW_FLOOR).toBe(0.88);
    // 9 of 10 top-row places hit first time is 90 %; 7 of 10 (a home-row-only child) is 70 %.
    const top90 = row("qwertyuiop", 10, 1);
    expect(firstTryShare({ perKey: top90 }, rowFloorKeys(1))).toBeCloseTo(0.9);
    const top70 = row("qwertyuiop", 10, 3);
    expect(firstTryShare({ perKey: top70 }, rowFloorKeys(1))).toBeCloseTo(0.7);
    // Fast and accurate overall, but the top row isn't known: Birch, where it is taught.
    expect(fastStart({ ...top70, ...row("zxcvbnm", 10, 0) })).toBe("birch");
    // The top row known, the bottom row not: the Shore. Pooled with the top row, 3 slips on each
    // bottom key is 31 slips in 170 places (82 %); 1 slip on each is 17 (90 %).
    expect(fastStart({ ...top90, ...row("zxcvbnm", 10, 3) })).toBe("shore");
    expect(fastStart({ ...top90, ...row("zxcvbnm", 10, 1) })).toBe("marsh");
    // No record for a row (none happens in a real test: a letter rung can't be left before each
    // of its keys broke cleanly) holds nothing back.
    expect(firstTryShare({ perKey: {} }, rowFloorKeys(2))).toBe(1);
    expect(fastStart({})).toBe("marsh");
    // A place still being tried when the test ended: one wrong press, no right one.
    expect(firstTryShare({ perKey: { q: { attempts: 1, errors: 1, latencies: [] } } }, ["q"])).toBe(
      0,
    );
  });

  it("starts a short test at the Meadow", () => {
    const short = summary({ activeMs: PLACEMENT_MIN_ACTIVE_MS - 1, netWpm: 80, accuracy: 1 });
    expect(estimatePlacement(short, prog()).startBiome).toBe("meadow");
  });

  it("never starts past the rung reached or the band's cap, and more speed never starts earlier", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 120, noNaN: true }),
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.double({ min: 0.5, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 5 }),
        fc.constantFrom(...BANDS),
        (wpm, extra, accuracy, tierReached, band) => {
          const p = prog({ tierReached, band, rungs: [] });
          const slow = estimatePlacement(summary({ netWpm: wpm, accuracy }), p).startBiome;
          const fast = estimatePlacement(summary({ netWpm: wpm + extra, accuracy }), p).startBiome;
          const i = BIOME_ORDER.indexOf(slow);
          expect(i).toBeLessThanOrEqual(Math.min(tierReached, MAX_TIER[band]));
          expect(BIOME_ORDER.indexOf(fast)).toBeGreaterThanOrEqual(i);
          if (band === "sprout") expect(i).toBeLessThanOrEqual(BIOME_ORDER.indexOf("frosty"));
        },
      ),
      FC,
    );
  });
});
