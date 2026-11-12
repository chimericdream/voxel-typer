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
  PLACEMENT_TIERS,
  createLadder,
  estimatePlacement,
  ladderRecord,
  tierKeys,
} from "../../../src/engine/placement";
import type { Ladder, PlacementProgression } from "../../../src/engine/placement";
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

/** 61 blocks of one driver run, with a slip every 7th block. */
function driverRun(ctx: TierContext): string[] {
  const d = createPlacementDriver(ctx, createRng(11));
  const out = [d.first().text];
  for (let i = 0; i < 60; i++) out.push(d.next(i % 7 === 0 ? 1 : 0).text);
  return out;
}

const record = (l: Ladder, cleans: readonly boolean[]): Ladder =>
  cleans.reduce((acc, c) => ladderRecord(acc, c).ladder, l);

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
    const l = createLadder("miner");
    // 7 clean of 7: not yet.
    expect(
      record(
        l,
        Array.from({ length: 7 }, () => true),
      ).tier,
    ).toBe(0);
    // The 8th clean block opens the top row, and the count starts over.
    const up = ladderRecord(
      record(
        l,
        Array.from({ length: 7 }, () => true),
      ),
      true,
    );
    expect(up.advanced).toBe(true);
    expect(up.ladder).toEqual({ tier: 1, maxTier: MAX_TIER.miner, recent: [] });
    // Two slips among ten keep it shut until the window slides past them... 8 of 10 is enough.
    const mixed = [false, false, true, true, true, true, true, true, true];
    expect(record(l, mixed).tier).toBe(0);
    expect(record(l, [...mixed, true]).tier).toBe(1);
    // Three slips in the last ten: 7 of 10, still home row.
    expect(record(l, [false, true, false, true, true, true, false, true, true, true]).tier).toBe(0);
  });

  it("only ever counts the last 10 blocks", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 120 }), (cleans) => {
        let l = createLadder("builder");
        for (const c of cleans) {
          const before = l;
          const r = ladderRecord(l, c);
          l = r.ladder;
          expect(l.recent.length).toBeLessThanOrEqual(LADDER_RULES.window);
          const window = [...before.recent, c].slice(-LADDER_RULES.window);
          const good = window.filter(Boolean).length;
          expect(r.advanced).toBe(good >= LADDER_RULES.need && before.tier < before.maxTier);
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
    const ids = new Set<string>([d.first().id]);
    let next = d.first();
    for (let i = 0; i < 7; i++) {
      next = d.next(0);
      ids.add(next.id);
    }
    expect(d.tierReached()).toBe(0);
    const after = d.next(0); // the 8th clean block opens the top row
    expect(d.tierReached()).toBe(1);
    expect(after.id.startsWith("p1-")).toBe(true);
    ids.add(after.id);
    for (let i = 0; i < 40; i++) ids.add(d.next(1).id);
    expect(ids.size).toBe(1 + 7 + 1 + 40);
    expect(d.blocks()).toBe(48);
    // Slips keep it on the top row.
    expect(d.tierReached()).toBe(1);
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
          const p = prog({ tierReached, band });
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
