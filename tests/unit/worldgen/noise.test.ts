/**
 * Worldgen noise and sampling (task M2-03).
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  fbm2,
  hash2,
  poissonDisk,
  terrace,
  valueNoise2,
} from "../../../src/content/worldgen/noise";
import { createRng } from "../../../src/engine/rng";

const SEED = 20251111;

describe("value noise", () => {
  it("is deterministic and in [0, 1)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.integer(),
        (x, z, seed) => {
          const v = valueNoise2(x, z, seed);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
          expect(valueNoise2(x, z, seed)).toBe(v);
          const f = fbm2(x, z, seed, 2);
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThan(1);
        },
      ),
      { seed: SEED, numRuns: 500 },
    );
  });

  it("equals the lattice hash at integer points and changes with the seed", () => {
    expect(valueNoise2(3, 7, 11)).toBe(hash2(3, 7, 11) / 4294967296);
    expect(valueNoise2(3.5, 7.5, 11)).not.toBe(valueNoise2(3.5, 7.5, 12));
  });

  it("is continuous: tiny steps give tiny changes", () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.137;
      expect(Math.abs(valueNoise2(x + 1e-4, 2.3, 5) - valueNoise2(x, 2.3, 5))).toBeLessThan(1e-3);
    }
  });
});

describe("terrace", () => {
  it("flattens near each step, is monotone and never moves a value by more than a step", () => {
    expect(terrace(4.1, 2)).toBe(4);
    expect(terrace(5.9, 2)).toBe(6);
    for (let v = 0; v < 20; v += 0.07) {
      expect(Math.abs(terrace(v, 2) - v)).toBeLessThanOrEqual(2);
      expect(terrace(v + 0.07, 2)).toBeGreaterThanOrEqual(terrace(v, 2) - 1e-12);
    }
  });
});

describe("poissonDisk", () => {
  it("keeps every pair at least r apart, inside the box, and is deterministic", () => {
    fc.assert(
      fc.property(fc.integer(), fc.double({ min: 2, max: 8, noNaN: true }), (seed, r) => {
        const a = poissonDisk(40, 30, r, createRng(seed));
        const b = poissonDisk(40, 30, r, createRng(seed));
        expect(a).toEqual(b);
        expect(a.length).toBeGreaterThan(0);
        for (const p of a) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.z).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThan(40);
          expect(p.z).toBeLessThan(30);
        }
        for (const [i, p] of a.entries()) {
          for (const q of a.slice(i + 1)) {
            expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(r);
          }
        }
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it("never returns a point the filter rejects", () => {
    const pts = poissonDisk(40, 40, 3, createRng(9), (p) => p.x > 20);
    expect(pts.length).toBeGreaterThan(10);
    for (const p of pts) expect(p.x).toBeGreaterThan(20);
  });
});
