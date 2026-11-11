/**
 * Tests for the seeded RNG (docs/impl/contracts.md §2, task M1-02).
 *
 * The golden values were cross-checked against the canonical published implementations of
 * sfc32 + splitmix32 (bryc's PRNG gist) and of cyrb53 (its low 32 bits), so they pin the real
 * algorithms, not just "whatever the code emitted once". Contracts §2 freezes them.
 *
 * Property tests run with a fixed fast-check seed so any failure reproduces exactly
 * (docs/impl/README.md §4.2).
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRng, dailySeed, hashString, type Rng } from "../../../src/engine/rng";

/** Fixed fast-check parameters: property failures must reproduce exactly. */
const FC = { seed: 20261111, numRuns: 300 } as const;

/** The first `n` outputs of a stream. */
const first = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => rng.next());

const TWO_POW_32 = 4294967296;

const GOLDEN_42 = [
  0.8686135609168559, 0.41595513583160937, 0.33768315333873034, 0.5103033822961152,
  0.8812672768253833, 0.650209850165993, 0.5959547508973628, 0.8414379844907671,
  0.49469241802580655, 0.44902881793677807,
];

const GOLDEN_VOXEL = [
  0.8795447205193341, 0.3427201481536031, 0.4473181185312569, 0.6604261635802686,
  0.2981953485868871, 0.5172141590155661, 0.6311196363531053, 0.10281437146477401,
  0.8208079116884619, 0.32965744310058653,
];

describe("golden values (contracts §2)", () => {
  it("pins the first 10 next() outputs of createRng(42)", () => {
    expect(first(createRng(42), 10)).toEqual(GOLDEN_42);
  });

  it("pins the first 10 next() outputs of createRng('voxel')", () => {
    expect(first(createRng("voxel"), 10)).toEqual(GOLDEN_VOXEL);
  });

  it("hashes string seeds with cyrb53 truncated to uint32", () => {
    expect(hashString("voxel")).toBe(400076782);
    expect(hashString("")).toBe(451841411);
    expect(createRng("voxel").seed).toBe(hashString("voxel"));
  });
});

describe("createRng", () => {
  it("gives the same sequence for the same seed", () => {
    expect(first(createRng(7), 25)).toEqual(first(createRng(7), 25));
    expect(first(createRng("meadow"), 25)).toEqual(first(createRng("meadow"), 25));
  });

  it("gives different sequences for different seeds", () => {
    expect(first(createRng(1), 10)).not.toEqual(first(createRng(2), 10));
    expect(first(createRng("voxel"), 10)).not.toEqual(first(createRng("Voxel"), 10));
  });

  it("reduces number seeds with >>> 0", () => {
    expect(createRng(-1).seed).toBe(4294967295);
    expect(createRng(3.7).seed).toBe(3);
    expect(first(createRng(-1), 5)).toEqual(first(createRng(4294967295), 5));
  });

  it("exposes the seed it started from", () => {
    expect(createRng(42).seed).toBe(42);
  });

  it("property: seed is always a uint32 and next() is always in [0, 1)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        (seed) => {
          const rng = createRng(seed);
          expect(Number.isInteger(rng.seed)).toBe(true);
          expect(rng.seed).toBeGreaterThanOrEqual(0);
          expect(rng.seed).toBeLessThan(TWO_POW_32);
          for (const v of first(rng, 50)) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
          }
        },
      ),
      FC,
    );
  });
});

describe("int", () => {
  it("property: always an integer within [min, max], for any safe-integer bounds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        fc.integer(),
        (x, y, seed) => {
          const lo = Math.min(x, y);
          const hi = Math.max(x, y);
          const rng = createRng(seed);
          for (let k = 0; k < 10; k++) {
            const v = rng.int(lo, hi);
            expect(Number.isInteger(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(lo);
            expect(v).toBeLessThanOrEqual(hi);
          }
        },
      ),
      FC,
    );
  });

  it("hits both ends of a small range", () => {
    const rng = createRng(42);
    const seen = new Set<number>();
    for (let k = 0; k < 1000; k++) seen.add(rng.int(0, 1));
    expect([...seen].toSorted((a, b) => a - b)).toEqual([0, 1]);
  });

  it("returns the only value when min === max", () => {
    expect(createRng(1).int(5, 5)).toBe(5);
  });

  it("throws on min > max and on non-integer bounds", () => {
    const rng = createRng(1);
    expect(() => rng.int(5, 4)).toThrow(RangeError);
    expect(() => rng.int(1.5, 3)).toThrow(RangeError);
    expect(() => rng.int(1, Number.NaN)).toThrow(RangeError);
    expect(() => rng.int(1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("pick", () => {
  it("throws on an empty array", () => {
    expect(() => createRng(1).pick([])).toThrow(RangeError);
  });

  it("returns the only item of a single-item array", () => {
    expect(createRng(1).pick(["only"])).toBe("only");
  });

  it("covers every item over many draws", () => {
    const rng = createRng(42);
    const items = ["a", "b", "c", "d"] as const;
    const seen = new Set<string>();
    for (let k = 0; k < 1000; k++) seen.add(rng.pick(items));
    expect(seen.size).toBe(items.length);
  });

  it("rejects undefined elements (the noUncheckedIndexedAccess guard)", () => {
    // `pick` returns `T`; with an element that is literally `undefined` the read guard throws
    // instead of silently passing `undefined` through. Nothing in the game passes such arrays.
    expect(() => createRng(1).pick([undefined])).toThrow(RangeError);
  });
});

describe("weightedPick", () => {
  it("property: never picks a zero-weight item", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 10 }), { minLength: 1 }),
        fc.integer(),
        (weights, seed) => {
          fc.pre(weights.some((w) => w > 0));
          const items = weights.map((_, i) => i);
          const rng = createRng(seed);
          for (let k = 0; k < 20; k++) {
            const picked = rng.weightedPick(items, weights);
            expect(weights[picked] ?? 0).toBeGreaterThan(0);
          }
        },
      ),
      FC,
    );
  });

  it("matches the weights within 2% over 100k draws (fixed seed)", () => {
    const rng = createRng(1234);
    const items = ["common", "uncommon", "rare", "epic", "never"] as const;
    const weights = [1, 2, 3, 4, 0];
    const draws = 100_000;
    const counts = new Map<string, number>();
    for (let k = 0; k < draws; k++) {
      const picked = rng.weightedPick(items, weights);
      counts.set(picked, (counts.get(picked) ?? 0) + 1);
    }
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(draws);
    expect(counts.get("never") ?? 0).toBe(0);
    const expectedShares: Record<string, number> = {
      common: 0.1,
      uncommon: 0.2,
      rare: 0.3,
      epic: 0.4,
    };
    for (const [item, share] of Object.entries(expectedShares)) {
      const observed = (counts.get(item) ?? 0) / draws;
      expect(Math.abs(observed - share), `${item} share ${observed}`).toBeLessThanOrEqual(0.02);
    }
  });

  it("throws on mismatched lengths, invalid weights and no positive weight", () => {
    const rng = createRng(1);
    expect(() => rng.weightedPick(["a", "b"], [1])).toThrow(RangeError);
    expect(() => rng.weightedPick(["a"], [-1])).toThrow(RangeError);
    expect(() => rng.weightedPick(["a"], [Number.NaN])).toThrow(RangeError);
    expect(() => rng.weightedPick(["a"], [Number.POSITIVE_INFINITY])).toThrow(RangeError);
    expect(() => rng.weightedPick(["a"], [0])).toThrow(RangeError);
    expect(() => rng.weightedPick([], [])).toThrow(RangeError);
  });
});

describe("shuffle", () => {
  it("property: returns a permutation in a new array, input untouched", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.integer(), (items, seed) => {
        const before = [...items];
        const out = createRng(seed).shuffle(items);
        expect(out).not.toBe(items);
        expect(items).toEqual(before);
        expect(out).toHaveLength(items.length);
        expect(out.toSorted((a, b) => a - b)).toEqual(before.toSorted((a, b) => a - b));
      }),
      FC,
    );
  });

  it("shuffles an empty array to a new empty array", () => {
    const input: number[] = [];
    const out = createRng(1).shuffle(input);
    expect(out).toEqual([]);
    expect(out).not.toBe(input);
  });

  it("reorders a long-enough array (fixed seed)", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    expect(createRng(42).shuffle(items)).not.toEqual(items);
  });

  it("is reproducible per seed", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(createRng(9).shuffle(items)).toEqual(createRng(9).shuffle(items));
  });
});

describe("fork", () => {
  it("follows the task-card formula: createRng(hashString(seed + ':' + label))", () => {
    const parent = createRng(7);
    expect(parent.fork("wave").seed).toBe(hashString("7:wave"));
    const fromString = createRng("voxel");
    expect(fromString.fork("daily").seed).toBe(hashString(`${fromString.seed}:daily`));
  });

  it("differs from the parent and from sibling forks", () => {
    const parent = createRng(7);
    const mobs = first(parent.fork("mobs"), 10);
    const loot = first(parent.fork("loot"), 10);
    expect(mobs).not.toEqual(first(parent, 10));
    expect(loot).not.toEqual(first(parent, 10));
    expect(mobs).not.toEqual(loot);
  });

  it("is reproducible: same parent seed + label gives the same stream", () => {
    expect(first(createRng(7).fork("mobs"), 25)).toEqual(first(createRng(7).fork("mobs"), 25));
    expect(first(createRng("voxel").fork("a").fork("b"), 25)).toEqual(
      first(createRng("voxel").fork("a").fork("b"), 25),
    );
  });

  it("does not depend on how far the parent has been consumed", () => {
    const parent = createRng(7);
    const before = first(parent.fork("x"), 10);
    parent.next();
    parent.next();
    parent.int(0, 100);
    expect(first(parent.fork("x"), 10)).toEqual(before);
  });

  it("property: deterministic for any seed and label", () => {
    fc.assert(
      fc.property(fc.integer(), fc.string(), (seed, label) => {
        const a = createRng(seed).fork(label);
        const b = createRng(seed).fork(label);
        expect(a.seed).toBe(b.seed);
        expect(first(a, 10)).toEqual(first(b, 10));
      }),
      FC,
    );
  });
});

describe("hashString", () => {
  it("property: deterministic uint32 for any string", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const h = hashString(s);
        expect(h).toBe(hashString(s));
        expect(Number.isInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(TWO_POW_32);
      }),
      FC,
    );
  });
});

describe("dailySeed", () => {
  it("formats as daily-YYYY-MM-DD with zero padding", () => {
    expect(dailySeed({ y: 2026, m: 11, d: 11 })).toBe("daily-2026-11-11");
    expect(dailySeed({ y: 5, m: 1, d: 9 })).toBe("daily-0005-01-09");
  });

  it("gives equal streams for equal dates and different streams for different dates", () => {
    const day = dailySeed({ y: 2026, m: 3, d: 1 });
    const nextDay = dailySeed({ y: 2026, m: 3, d: 2 });
    expect(first(createRng(day), 10)).toEqual(
      first(createRng(dailySeed({ y: 2026, m: 3, d: 1 })), 10),
    );
    expect(first(createRng(day), 10)).not.toEqual(first(createRng(nextDay), 10));
  });
});
