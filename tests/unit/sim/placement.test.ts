/**
 * The placement sim (`tools/sim-placement.ts`, task M3-05) and the card's acceptance: a slow
 * typist starts at the Meadow, an average one in Birch Forest or Sandy Shore, and a fast Builder
 * at Frosty Peaks or later. A Sprout never starts past Frosty Peaks. M3-FIX-3: the typists have
 * slower digits and Shift, a home-row-only child is held back, and each rung shows its new keys.
 * M3-FIX-10: that child never starts past Birch, on any of 10 seeds.
 */
import { describe, expect, it } from "vitest";
import { BIOME_ORDER } from "../../../src/types/core";
import type { AgeBand, BiomeId } from "../../../src/types/core";
import { hashString } from "../../../src/engine/rng";
import {
  HOME_ROW_ONLY,
  formatPlacement,
  loadPlacementPools,
  parsePlacementArgs,
  playPlacement,
  simulatePlacement,
} from "../../../tools/sim-placement";
import type { PlacementRow } from "../../../tools/sim-placement";

const opts = { runs: 40, seed: 1 };
const BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];
const report = simulatePlacement(opts);
const rows = report.rows;
const row = (band: string, typist: string): PlacementRow => {
  const r = rows.find((x) => x.band === band && x.typist === typist);
  if (!r) throw new Error(`no row ${band}/${typist}`);
  return r;
};
/** Share of the row's learners who start in one of `biomes`. */
const share = (r: PlacementRow, biomes: readonly BiomeId[]): number =>
  biomes.reduce((n, b) => n + (r.starts[b] ?? 0), 0) / opts.runs;
const atOrAfter = (b: BiomeId): BiomeId[] => BIOME_ORDER.slice(BIOME_ORDER.indexOf(b));

describe("placement sim", () => {
  it("meets the card's acceptance for every band", () => {
    for (const band of ["sprout", "miner", "builder"]) {
      expect(share(row(band, "slow"), ["meadow"]), `${band} slow`).toBeGreaterThanOrEqual(0.9);
      expect(share(row(band, "avg"), ["birch", "shore"]), `${band} avg`).toBeGreaterThanOrEqual(
        0.9,
      );
    }
    expect(share(row("builder", "fast"), atOrAfter("frosty"))).toBeGreaterThanOrEqual(0.9);
  });

  it("never starts a Sprout past Frosty Peaks", () => {
    for (const r of rows.filter((x) => x.band === "sprout")) {
      expect(share(r, atOrAfter("mines"))).toBe(0);
    }
  });

  it("starts a fast Builder at the Marsh despite slow digits, unlike the whole-test rule (N2)", () => {
    const fast = row("builder", "fast");
    expect(share(fast, ["marsh"])).toBeGreaterThanOrEqual(0.9);
    // The M3-05 rule, every gate on the whole test, would have started most of them earlier.
    expect(fast.lowerOnWholeTest / opts.runs).toBeGreaterThanOrEqual(0.5);
    expect(share(row("miner", "fast"), ["mines"])).toBeGreaterThanOrEqual(0.9);
  });

  it(
    "never starts a child who knows only the home row past Birch, over 10 seeds (M3-FIX-10)",
    {
      timeout: 60_000,
    },
    () => {
      // Before the row floor, about 1 in 300 of these learners passed the pooled gates by luck and
      // started at the Shore (12 of 3600 over seeds 1–30). The floor judges the top row on its own.
      // Seeds as in `simulatePlacement`, so a seed here is the same learners as `--seed`.
      const pools = loadPlacementPools();
      const past: string[] = [];
      for (let seed = 1; seed <= 10; seed++) {
        for (const band of BANDS) {
          for (let run = 0; run < opts.runs; run++) {
            const learner = hashString(`${seed}:${band}:homeonly:${run}`);
            const start = playPlacement(band, HOME_ROW_ONLY, pools, learner).startBiome;
            if (!["meadow", "birch"].includes(start)) past.push(`${seed}/${band}/${run}: ${start}`);
          }
        }
      }
      expect(past).toEqual([]);
    },
  );

  it("shows every new key of a letter rung before it opens the next (N1)", () => {
    for (const c of report.coverage) {
      expect(c.learners, c.tier).toBeGreaterThan(0);
      expect(c.keysShown, c.tier).toBe(1);
      expect(c.firstEight, c.tier).toBeGreaterThanOrEqual(0.85);
    }
  });

  // Two full sims: slow on a loaded machine (decision 96), so it gets a longer timeout.
  it("prints the same report for the same seed", { timeout: 60_000 }, () => {
    expect(formatPlacement(simulatePlacement(opts), opts)).toBe(formatPlacement(report, opts));
    expect(parsePlacementArgs(["--runs", "5", "--seed", "2"])).toEqual({ runs: 5, seed: 2 });
    expect(() => parsePlacementArgs(["--nope", "1"])).toThrow(/unknown flag/);
  });
});
