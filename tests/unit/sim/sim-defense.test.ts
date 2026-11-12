/**
 * The Defense sim (`tools/sim-defense.ts`, task M4-05) against the card's acceptance: synthetic
 * typists at 10, 25 and 50 WPM settle into 85–95 % accuracy within 4 waves and stay there, median
 * over 50 learners, with at most 20 % of mobs reaching the base. `docs/sim.md` has the full report
 * and explains the 50 WPM rows.
 *
 * The full report takes several seconds, more on a loaded machine (decision 96), so these tests
 * get a generous timeout.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESSURE,
  converged,
  formatDefense,
  parseDefenseArgs,
  reportRows,
  simulateDefense,
} from "../../../tools/sim-defense";
import type { RowResult } from "../../../tools/sim-defense";

const TIMEOUT = 60_000;
const opts = { runs: 50, waves: 10, seed: 1 };
const mainRows = reportRows().filter((r) => r.label === "main");

let results: RowResult[] | undefined;
const main = (): RowResult[] => (results ??= simulateDefense(opts, mainRows));
const row = (typist: string, band: string): RowResult => {
  const r = main().find((x) => x.spec.typist === typist && x.spec.band === band);
  if (r === undefined) throw new Error(`no row ${typist}/${band}`);
  return r;
};

describe("defense sim", () => {
  it(
    "10 and 25 WPM: the median accuracy is in 85–95 % from wave 4 on, in every band",
    () => {
      for (const typist of ["10wpm", "25wpm"])
        for (const band of ["sprout", "miner", "builder"])
          expect(converged(row(typist, band)), `${typist} ${band}`).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "50 WPM: learners average 85–95 % from wave 4 on, and the per-wave median stays within 1.5 points",
    () => {
      for (const band of ["sprout", "miner", "builder"]) {
        const r = row("50wpm", band);
        expect(r.learnerMean, band).toBeGreaterThanOrEqual(0.85);
        expect(r.learnerMean, band).toBeLessThanOrEqual(0.95);
        expect(r.inBand, band).toBeGreaterThanOrEqual(0.8);
        for (const a of r.accuracy.slice(3)) {
          expect(a, band).toBeGreaterThanOrEqual(0.85);
          expect(a, band).toBeLessThanOrEqual(0.965);
        }
      }
    },
    TIMEOUT,
  );

  it(
    "keeps the share of mobs at the base at or under 20 %",
    () => {
      for (const r of main()) expect(r.reachedLater, r.spec.typist).toBeLessThanOrEqual(0.2);
    },
    TIMEOUT,
  );

  it(
    "never lets a mob reach the base in calm mode",
    () => {
      const calm = simulateDefense(
        { runs: 10, waves: 6, seed: 2 },
        reportRows().filter((r) => r.label === "calm"),
      );
      for (const r of calm) {
        expect(r.reachedLater).toBe(0);
        for (const d of r.difficulty) expect(d).toBeLessThanOrEqual(1.2);
      }
    },
    TIMEOUT,
  );

  it(
    "prints the same report for the same seed",
    () => {
      const small = { runs: 2, waves: 4, seed: 3 };
      const rows = [
        {
          typist: "25wpm",
          band: "miner" as const,
          calm: false,
          baseline: true,
          pressure: DEFAULT_PRESSURE,
          label: "main",
        },
      ];
      expect(formatDefense(simulateDefense(small, rows), small)).toBe(
        formatDefense(simulateDefense(small, rows), small),
      );
      expect(parseDefenseArgs(["--runs", "5", "--seed", "2", "--sweep", "1"])).toEqual({
        runs: 5,
        waves: 10,
        seed: 2,
        sweep: true,
      });
      expect(() => parseDefenseArgs(["--nope", "1"])).toThrow(/unknown flag/);
    },
    TIMEOUT,
  );
});
