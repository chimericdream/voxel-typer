import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  GENERATOR_CONSTANTS,
  comfortableKeys,
  containsBlockedRun,
  generateTargets,
  lengthBudget,
  typeable,
} from "../../../src/engine/generator";
import type { ContentKind, GenerateParams, WordPool } from "../../../src/engine/generator";
import { createRng } from "../../../src/engine/rng";
import type { Target } from "../../../src/engine/types";

const SEED = 20261106;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz;".split("");
const HOME_ROW = [..."asdfjkl;".split(""), " "];
const KINDS: readonly ContentKind[] = ["letters", "syllables", "words", "phrases", "sentences"];

function pool(items: string[], id = "test"): WordPool {
  return { id, band: "all", tags: [], items };
}

function params(patch: Partial<GenerateParams> = {}): GenerateParams {
  return {
    kind: "letters",
    allowed: HOME_ROW,
    weights: {},
    pools: [],
    length: { chars: 100 },
    ...patch,
  };
}

const gen = (p: GenerateParams, seed: number | string = 1): Target[] =>
  generateTargets(p, createRng(seed));

/** Non-space chars of the output and how many of them are comfortable. */
function comfortShare(targets: readonly Target[], comfortable: ReadonlySet<string>): number {
  let total = 0;
  let comf = 0;
  for (const t of targets) {
    for (const c of t.text) {
      if (c === " ") continue;
      total += 1;
      if (comfortable.has(c)) comf += 1;
    }
  }
  return total === 0 ? 1 : comf / total;
}

/** Bottom-half keys, computed independently of the generator. */
function bottomHalf(keys: readonly string[], weights: Record<string, number>): Set<string> {
  const w = (k: string): number => weights[k] ?? 1;
  const sorted = keys.map(w).toSorted((a, b) => a - b);
  const threshold = sorted[Math.ceil(sorted.length / 2) - 1] ?? 0;
  return new Set(keys.filter((k) => w(k) <= threshold));
}

const allowedArb = (minLength: number) =>
  fc
    .tuple(
      fc.uniqueArray(fc.constantFrom(...ALPHABET), { minLength, maxLength: ALPHABET.length }),
      fc.boolean(),
    )
    .map(([keys, space]) => (space ? [...keys, " "] : keys));

/** Weights shaped like `keyWeights` output: 1–13, focus keys ≥ 3. */
const weightsArb = fc.dictionary(
  fc.constantFrom(...ALPHABET, " "),
  fc.double({ min: 1, max: 13, noNaN: true }),
);

/** Pool items mixing allowed and not-allowed chars, capitals, digits and stray spaces. */
const poolsArb = fc.array(
  fc
    .array(fc.stringMatching(/^[a-zA-Z;' 0-9.]{0,12}$/), { maxLength: 30 })
    .map((items) => pool(items)),
  { maxLength: 3 },
);

const lengthArb: fc.Arbitrary<GenerateParams["length"]> = fc.oneof(
  fc.record({ chars: fc.integer({ min: 0, max: 300 }) }),
  fc.record({ targets: fc.integer({ min: 0, max: 60 }) }),
  fc.record({
    seconds: fc.integer({ min: 0, max: 60 }),
    estWpm: fc.integer({ min: 1, max: 40 }),
  }),
);

const paramsArb = (minKeys: number): fc.Arbitrary<GenerateParams> =>
  fc
    .record({
      kind: fc.constantFrom(...KINDS),
      allowed: allowedArb(minKeys),
      weights: weightsArb,
      pools: poolsArb,
      length: lengthArb,
      minLen: fc.option(fc.integer({ min: 1, max: 6 }), { nil: undefined }),
      maxLen: fc.option(fc.integer({ min: 1, max: 12 }), { nil: undefined }),
      capitalize: fc.constantFrom("none" as const, "first" as const, "mixed" as const),
    })
    .map(({ minLen, maxLen, ...rest }) => {
      const p: GenerateParams = { ...rest };
      if (minLen !== undefined) p.minLen = minLen;
      if (maxLen !== undefined) p.maxLen = maxLen;
      return p;
    });

describe("safety: allowed chars only", () => {
  it("never emits a char outside allowed ∪ {' '} (2000 cases)", () => {
    fc.assert(
      fc.property(paramsArb(1), fc.integer(), (p, seed) => {
        const ok = new Set([...p.allowed, " "]);
        for (const t of gen(p, seed)) {
          for (const c of t.text) expect(ok.has(c)).toBe(true);
          expect(t.text.length).toBeGreaterThan(0);
          expect(t.text.trim()).toBe(t.text);
        }
      }),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it("also holds when uppercase letters are allowed and capitalization is on", () => {
    const allowed = [..."asdfjkl".split(""), ..."ASDF".split(""), " "];
    const items = ["sad", "Sad", "lad", "flask", "Jack", "ask dad", "fall"];
    for (const kind of KINDS) {
      for (const capitalize of ["first", "mixed"] as const) {
        const out = gen(params({ kind, allowed, pools: [pool(items)], capitalize }), kind);
        for (const t of out) expect(typeable(t.text, new Set(allowed))).toBe(true);
      }
    }
  });

  it("never emits a blocked letter run from random letters", () => {
    const risky = [..."asfuckitnigpeo".split(""), " "];
    for (let seed = 0; seed < 300; seed++) {
      for (const kind of ["letters", "syllables"] as const) {
        const out = gen(params({ kind, allowed: risky, length: { chars: 120 } }), seed);
        if (kind === "letters")
          expect(containsBlockedRun(out.map((t) => t.text).join(""))).toBe(false);
        else for (const t of out) expect(containsBlockedRun(t.text)).toBe(false);
      }
    }
  });

  it("avoids 'ass' even with only a and s allowed", () => {
    for (let seed = 0; seed < 200; seed++) {
      const letters = gen(params({ allowed: ["a", "s"], weights: { s: 1, a: 5 } }), seed);
      expect(letters.map((t) => t.text).join("")).not.toContain("ass");
      for (const t of gen(params({ kind: "syllables", allowed: ["a", "s"] }), seed)) {
        expect(t.text).not.toContain("ass");
      }
    }
  });
});

describe("determinism", () => {
  it("same params and seed give identical output", () => {
    fc.assert(
      fc.property(paramsArb(1), fc.integer(), (p, seed) => {
        expect(gen(p, seed)).toEqual(gen(p, seed));
      }),
      { seed: SEED, numRuns: 300 },
    );
  });

  it("different seeds give different output", () => {
    for (const kind of KINDS) {
      const p = params({ kind, pools: [pool(["sad", "lad", "flask", "ask", "fall", "dad"])] });
      expect(gen(p, 1)).not.toEqual(gen(p, 2));
    }
  });

  it("pins a small output so accidental changes show up", () => {
    const p = params({ kind: "syllables", length: { targets: 6 } });
    expect(gen(p, 42).map((t) => t.text)).toMatchInlineSnapshot(`
      [
        "fal",
        "afa",
        "saj",
        "saa",
        ";as",
        "ad",
      ]
    `);
  });

  it("does not change its inputs", () => {
    const p = params({ kind: "words", pools: [pool(["sad", "lad"])], weights: { a: 2 } });
    const copy = structuredClone(p);
    gen(p);
    expect(p).toEqual(copy);
  });
});

describe("comfort cap", () => {
  it("comfortableKeys takes keys at or below the median rank, keeping ties together", () => {
    const keys = ["a", "s", "d", "f", " "];
    expect(comfortableKeys(keys, { a: 1, s: 2, d: 5, f: 9 })).toEqual(new Set(["a", "s"]));
    expect(comfortableKeys(keys, { a: 1, s: 5, d: 5, f: 5 })).toEqual(
      new Set(["a", "s", "d", "f"]),
    );
    expect(comfortableKeys(["a", "s", "d"], { a: 1, s: 2, d: 3 })).toEqual(new Set(["a", "s"]));
    expect(comfortableKeys(["a"], { a: 7 })).toEqual(new Set(["a"]));
    expect(comfortableKeys([" "], {})).toEqual(new Set());
    // Missing or invalid weights count as 1.
    expect(comfortableKeys(["a", "s", "d", "f"], { a: Number.NaN, s: -1, d: 3, f: 4 })).toEqual(
      new Set(["a", "s"]),
    );
  });

  it("≥ 50% of chars come from bottom-half keys (500 cases, ≥ 4 keys)", () => {
    fc.assert(
      fc.property(paramsArb(4), fc.integer(), (raw, seed) => {
        const p: GenerateParams = { ...raw, capitalize: "none" };
        const keys = p.allowed.filter((k) => k !== " ");
        const comfortable = bottomHalf(keys, p.weights);
        if (p.kind !== "letters" && p.kind !== "syllables") {
          // The cap can only hold if some typeable item is comfortable enough (§5 relaxes it
          // otherwise); with no typeable item at all the generator falls back to syllables.
          const allowed = new Set(keys);
          const candidates = p.pools
            .flatMap((x) => x.items)
            .filter(
              (s) =>
                s.length > 0 &&
                s.trim() === s &&
                !s.includes("  ") &&
                s.replaceAll(" ", "").length > 0 &&
                (p.minLen === undefined || s.length >= p.minLen) &&
                (p.maxLen === undefined || s.length <= p.maxLen) &&
                typeable(s, allowed),
            );
          fc.pre(
            candidates.length === 0 ||
              candidates.some(
                (s) =>
                  comfortShare([{ id: "x", text: s }], comfortable) >=
                  GENERATOR_CONSTANTS.comfortShare,
              ),
          );
        }
        expect(comfortShare(gen(p, seed), comfortable)).toBeGreaterThanOrEqual(0.5);
      }),
      { seed: SEED, numRuns: 500 },
    );
  });

  it("holds for words even when weak-key words dominate the weights", () => {
    const weights = { a: 1, s: 1, d: 1, f: 1, j: 13, k: 13, l: 13 };
    const comfortable = bottomHalf(["a", "s", "d", "f", "j", "k", "l"], weights);
    const items = ["jkl", "kjl", "lkj", "jj", "kk", "sad", "fads", "add", "lad", "jak"];
    for (let seed = 0; seed < 50; seed++) {
      const out = gen(
        params({
          kind: "words",
          allowed: [..."asdfjkl".split(""), " "],
          weights,
          pools: [pool(items)],
        }),
        seed,
      );
      expect(comfortShare(out, comfortable)).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("relaxes the cap (never the allowed set) when no item is comfortable enough", () => {
    const weights = { a: 1, s: 1, j: 10, k: 10 };
    const out = gen(
      params({
        kind: "words",
        allowed: ["a", "s", "j", "k", " "],
        weights,
        pools: [pool(["jk", "kj"])],
      }),
    );
    expect(out.length).toBeGreaterThan(0);
    for (const t of out) expect(["jk", "kj"]).toContain(t.text);
  });

  it("still biases letters toward weak keys", () => {
    const out = gen(
      params({
        weights: { a: 1, s: 1, d: 1, f: 1, j: 9, k: 1, l: 1, ";": 1 },
        length: { chars: 4000 },
      }),
    );
    const js = out.filter((t) => t.text === "j").length;
    expect(js / out.length).toBeGreaterThan(0.25);
  });
});

describe("letters", () => {
  it("never repeats a char more than 3 times in a row", () => {
    fc.assert(
      fc.property(allowedArb(2), weightsArb, fc.integer(), (allowed, weights, seed) => {
        const text = gen(params({ allowed, weights, length: { chars: 300 } }), seed)
          .map((t) => t.text)
          .join("");
        expect(text).not.toMatch(/(.)\1{3}/);
      }),
      { seed: SEED, numRuns: 500 },
    );
  });

  it("holds with one overwhelming weight", () => {
    const text = gen(
      params({ allowed: ["a", "s"], weights: { a: 1e6, s: 1 }, length: { chars: 2000 } }),
    )
      .map((t) => t.text)
      .join("");
    expect(text).not.toMatch(/(.)\1{3}/);
  });

  it("emits single chars with trailingSpace false and unique ids", () => {
    const out = gen(params({ length: { targets: 50 } }));
    expect(out).toHaveLength(50);
    for (const t of out) {
      expect(Array.from(t.text)).toHaveLength(1);
      expect(t.trailingSpace).toBe(false);
      expect(t.text).not.toBe(" ");
    }
    expect(new Set(out.map((t) => t.id)).size).toBe(50);
  });

  it("repeats the only key when just one is allowed", () => {
    expect(gen(params({ allowed: ["f"], length: { chars: 5 } })).map((t) => t.text)).toEqual([
      "f",
      "f",
      "f",
      "f",
      "f",
    ]);
  });
});

describe("length", () => {
  it("{ seconds, estWpm } converts to seconds/60 * estWpm * 5 * 1.3 chars", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 1, max: 80 }),
        (seconds, estWpm) => {
          const expected = Math.ceil((seconds / 60) * estWpm * 5 * 1.3);
          expect(lengthBudget({ seconds, estWpm })).toEqual({ chars: expected });
          // Letters: one char per target, so the count is exact.
          expect(gen(params({ length: { seconds, estWpm } }))).toHaveLength(expected);
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    expect(lengthBudget({ seconds: 60, estWpm: 10 })).toEqual({ chars: 65 });
  });

  it("word-like chars budgets count the spaces between targets and stop once reached", () => {
    for (const kind of ["syllables", "words"] as const) {
      for (const chars of [1, 7, 50, 333]) {
        const out = gen(
          params({ kind, pools: [pool(["sad", "lad", "flask", "ask"])], length: { chars } }),
        );
        const typed = out.reduce((n, t) => n + t.text.length, 0) + out.length - 1;
        const last = out.at(-1)?.text.length ?? 0;
        expect(typed).toBeGreaterThanOrEqual(chars);
        expect(typed - last - 1).toBeLessThan(chars);
        for (const t of out) expect(t.trailingSpace).toBe(true);
      }
    }
  });

  it("{ targets } gives exactly that many targets; zero gives none", () => {
    for (const kind of KINDS) {
      expect(gen(params({ kind, pools: [pool(["sad"])], length: { targets: 17 } }))).toHaveLength(
        17,
      );
      expect(gen(params({ kind, length: { targets: 0 } }))).toEqual([]);
      expect(gen(params({ kind, length: { chars: 0 } }))).toEqual([]);
    }
  });

  it("rejects negative or non-finite lengths and clamps huge ones", () => {
    expect(() => gen(params({ length: { chars: -1 } }))).toThrow(RangeError);
    expect(() => gen(params({ length: { targets: Number.NaN } }))).toThrow(RangeError);
    expect(() => gen(params({ length: { seconds: Infinity, estWpm: 10 } }))).toThrow(RangeError);
    expect(lengthBudget({ chars: 1e12 })).toEqual({ chars: GENERATOR_CONSTANTS.maxChars });
    expect(lengthBudget({ targets: 1e12 })).toEqual({ targets: GENERATOR_CONSTANTS.maxTargets });
  });

  it("returns nothing when no key is allowed", () => {
    expect(gen(params({ allowed: [] }))).toEqual([]);
    expect(gen(params({ kind: "words", allowed: [" "], pools: [pool(["a"])] }))).toEqual([]);
  });
});

describe("syllables", () => {
  it("home row (only vowel a) gives 2–3-char syllables that each have the vowel", () => {
    const out = gen(params({ kind: "syllables", length: { targets: 300 } }));
    for (const t of out) {
      expect(t.text.length).toBeGreaterThanOrEqual(2);
      expect(t.text.length).toBeLessThanOrEqual(3);
      expect(t.text).toContain("a");
    }
    const texts = new Set(out.map((t) => t.text));
    // CV, VC, VV and CVC shapes all show up.
    expect([...texts].some((s) => /^[^a]a$/.test(s))).toBe(true);
    expect([...texts].some((s) => /^a[^a]$/.test(s))).toBe(true);
    expect(texts.has("aa")).toBe(true);
    expect([...texts].some((s) => /^[^a]a[^a]$/.test(s))).toBe(true);
  });

  it("uses only consonants when no vowel is allowed", () => {
    for (const t of gen(params({ kind: "syllables", allowed: [..."sdfjkl".split(""), " "] }))) {
      expect(t.text).toMatch(/^[sdfjkl]{2,3}$/);
    }
  });

  it("minLen/maxLen narrow the 2–3 range where they overlap it", () => {
    for (const t of gen(params({ kind: "syllables", maxLen: 2, length: { targets: 50 } }))) {
      expect(t.text).toHaveLength(2);
    }
    for (const t of gen(params({ kind: "syllables", minLen: 3, length: { targets: 50 } }))) {
      expect(t.text).toHaveLength(3);
    }
  });
});

describe("words, phrases, sentences", () => {
  const allowed = [..."asdfjkl".split(""), " "];

  it("picks only typeable, well-formed pool items within the length bounds", () => {
    const items = ["sad", "lad", "flask", "ask dad", "jam", "Sad", "", " sad", "sad  lad", "a"];
    const ok = new Set(["sad", "lad", "flask", "ask dad"]);
    for (const kind of ["words", "phrases", "sentences"] as const) {
      const out = gen(
        params({ kind, allowed, pools: [pool(items)], minLen: 2, length: { targets: 200 } }),
      );
      for (const t of out) expect(ok.has(t.text)).toBe(true);
      expect(new Set(out.map((t) => t.text))).toEqual(ok);
    }
  });

  it("weights items by the sum of their chars' weights", () => {
    const weights = { a: 1, s: 1, d: 1, f: 1, j: 1, k: 1, l: 1 };
    const out = gen(
      params({
        kind: "words",
        allowed,
        weights,
        pools: [pool(["as", "ad", "flask"])],
        length: { targets: 4000 },
      }),
    );
    const n = (text: string): number => out.filter((t) => t.text === text).length;
    // Weights 5 vs 2 vs 2. Back-to-back repeats are rejected, so the expected ratio is 5/12 : 7/24 ≈ 1.43.
    expect(n("flask")).toBeGreaterThan(1.25 * n("as"));
    expect(n("flask")).toBeGreaterThan(1.25 * n("ad"));
  });

  it("avoids the same item twice in a row when there is a choice", () => {
    const out = gen(
      params({
        kind: "words",
        allowed,
        pools: [pool(["sad", "lad", "dad"])],
        length: { targets: 500 },
      }),
    );
    for (let i = 1; i < out.length; i++) expect(out[i]?.text).not.toBe(out[i - 1]?.text);
  });

  it("draws from every pool given", () => {
    const out = gen(
      params({
        kind: "words",
        allowed,
        pools: [pool(["sad"], "p1"), pool(["lad"], "p2")],
        length: { targets: 50 },
      }),
    );
    expect(new Set(out.map((t) => t.text))).toEqual(new Set(["sad", "lad"]));
  });

  it("falls back to syllables when no item is typeable", () => {
    for (const pools of [[], [pool(["zoo", "quiz"])]]) {
      const out = gen(params({ kind: "words", allowed, pools, length: { targets: 20 } }));
      expect(out).toHaveLength(20);
      for (const t of out) expect(t.text).toMatch(/^[asdfjkl]{2,3}$/);
    }
  });

  it("capitalize 'first' upper-cases each target's first char only when the capital is allowed", () => {
    const pools = [pool(["sad", "lad", "dad"])];
    const withCaps = gen(
      params({ kind: "words", allowed: [...allowed, "S"], pools, capitalize: "first" }),
    );
    expect(withCaps.map((t) => t.text)).toContain("Sad");
    expect(withCaps.map((t) => t.text)).not.toContain("sad");
    expect(withCaps.map((t) => t.text)).toContain("lad");
    const noCaps = gen(params({ kind: "words", allowed, pools, capitalize: "first" }));
    for (const t of noCaps) expect(t.text).toMatch(/^[a-z]/);
  });

  it("capitalize 'mixed' gives a mix and changes nothing else", () => {
    const pools = [pool(["sad", "dad", "fad"])];
    const caps = [...allowed, "S", "D", "F"];
    const plain = gen(params({ kind: "words", allowed: caps, pools, length: { targets: 200 } }), 9);
    const mixed = gen(
      params({
        kind: "words",
        allowed: caps,
        pools,
        length: { targets: 200 },
        capitalize: "mixed",
      }),
      9,
    );
    expect(mixed.map((t) => t.text.toLowerCase())).toEqual(plain.map((t) => t.text));
    const upper = mixed.filter((t) => /^[A-Z]/.test(t.text)).length;
    expect(upper).toBeGreaterThan(60);
    expect(upper).toBeLessThan(140);
  });
});

describe("typeable", () => {
  const set = new Set(["a", "s", "d", "'"]);
  it("is true only when every char is allowed (a space always is)", () => {
    expect(typeable("sad", set)).toBe(true);
    expect(typeable("sad ads", set)).toBe(true);
    expect(typeable("sad's", set)).toBe(true);
    expect(typeable("Sad", set)).toBe(false);
    expect(typeable("sax", set)).toBe(false);
    expect(typeable("sad\t", set)).toBe(false);
    expect(typeable("", set)).toBe(true);
  });
  it("works per code point", () => {
    expect(typeable("😀a", new Set(["😀", "a"]))).toBe(true);
    expect(typeable("😀", new Set(["\ud83d"]))).toBe(false);
  });
});
