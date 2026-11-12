/**
 * The placement sim (`tools/sim-placement.ts`, task M3-05) and the card's acceptance: a slow
 * typist starts at the Meadow, an average one in Birch Forest or Sandy Shore, and a fast Builder
 * at Frosty Peaks or later. A Sprout never starts past Frosty Peaks.
 */
import { describe, expect, it } from "vitest";
import { BIOME_ORDER } from "../../../src/types/core";
import type { BiomeId } from "../../../src/types/core";
import {
  formatPlacement,
  parsePlacementArgs,
  simulatePlacement,
} from "../../../tools/sim-placement";
import type { PlacementRow } from "../../../tools/sim-placement";

const opts = { runs: 40, seed: 1 };
const rows = simulatePlacement(opts);
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

  it("prints the same report for the same seed", () => {
    expect(formatPlacement(simulatePlacement(opts), opts)).toBe(formatPlacement(rows, opts));
    expect(parsePlacementArgs(["--runs", "5", "--seed", "2"])).toEqual({ runs: 5, seed: 2 });
    expect(() => parsePlacementArgs(["--nope", "1"])).toThrow(/unknown flag/);
  });
});
