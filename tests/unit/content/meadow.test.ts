/**
 * Meadow lessons 1–6 (task M2-12): the lesson data, its word pools, and what the generator makes
 * from them for every band over ten seeds.
 */
import { describe, expect, it } from "vitest";
import { lessons } from "../../../src/content/lessons/meadow";
import type { Lesson } from "../../../src/content/lessons/types";
import { wordPools } from "../../../src/content/wordlists/pools";
import { keyWeights } from "../../../src/engine/adaptive";
import { generateTargets, typeable } from "../../../src/engine/generator";
import type { WordPool } from "../../../src/engine/generator";
import { createRng } from "../../../src/engine/rng";
import type { Target } from "../../../src/engine/types";
import en from "../../../src/i18n/en";
import type { AgeBand } from "../../../src/types/core";

const BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];
/** Contracts §6 defaults. */
const DEFAULT_SCALE: Record<AgeBand, number> = { sprout: 0.6, miner: 1, builder: 1.3 };
/** Adaptive defaults per band (contracts §4). */
const TARGET_LATENCY: Record<AgeBand, number> = { sprout: 900, miner: 500, builder: 300 };
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const WORD_LIKE = new Set(["words", "phrases", "sentences"]);

/**
 * The keys a lesson may use: every earlier Meadow lesson's `newKeys` plus its own. Meadow is the
 * first biome, so this is what `allowedKeysFor` (not implemented yet) will return.
 */
function allowedFor(lesson: Lesson): string[] {
  return lessons.filter((l) => l.order <= lesson.order).flatMap((l) => l.newKeys);
}

/** The lesson's pools for one band, the way a mode resolves them (contracts §5, §6). */
function poolsFor(lesson: Lesson, band: AgeBand): WordPool[] {
  const ids = lesson.pools;
  const picked =
    ids === undefined
      ? wordPools.filter((p) => p.tags.includes(`biome=${lesson.biome}`))
      : wordPools.filter((p) => ids.includes(p.id));
  return picked.filter((p) => p.band === band || p.band === "all");
}

/** The lesson's char budget for one band. All Meadow lessons use `{ chars }`. */
function charsFor(lesson: Lesson, band: AgeBand): number {
  if (!("chars" in lesson.length)) throw new Error(`${lesson.id}: expected a chars length`);
  const scale = lesson.bandScale?.[band] ?? DEFAULT_SCALE[band];
  return Math.ceil(lesson.length.chars * scale);
}

function generate(lesson: Lesson, band: AgeBand, seed: number): Target[] {
  const allowed = allowedFor(lesson);
  return generateTargets(
    {
      kind: lesson.kind,
      allowed,
      weights: keyWeights({
        allowed,
        focus: lesson.newKeys,
        stats: {},
        sessionIndex: 0,
        targetLatencyMs: TARGET_LATENCY[band],
      }),
      pools: poolsFor(lesson, band),
      length: { chars: charsFor(lesson, band) },
      capitalize: "none",
    },
    createRng(seed),
  );
}

describe("meadow lesson data", () => {
  it("has lessons meadow-01 to meadow-06 in order", () => {
    expect(lessons.map((l) => l.id)).toEqual([
      "meadow-01",
      "meadow-02",
      "meadow-03",
      "meadow-04",
      "meadow-05",
      "meadow-06",
    ]);
    expect(lessons.map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const l of lessons) expect(l.biome).toBe("meadow");
  });

  it("introduces f j, d k, s l, a ; in that order, each key once", () => {
    expect(lessons.map((l) => l.newKeys.join(" "))).toEqual(["f j", "d k", "s l", "a ;", "", ""]);
  });

  it("reviews only keys that were introduced earlier", () => {
    for (const l of lessons) {
      const earlier = new Set(lessons.filter((e) => e.order < l.order).flatMap((e) => e.newKeys));
      for (const k of l.reviewKeys) expect(earlier.has(k), `${l.id} reviews ${k}`).toBe(true);
    }
  });

  it("plays in mine mode, rewards accuracy 0.85 only", () => {
    for (const l of lessons) {
      expect(l.mode).toBe("mine");
      expect(l.targets).toEqual({ accuracy: 0.85 });
    }
  });

  it("uses the kinds of the card", () => {
    expect(lessons.map((l) => l.kind)).toEqual([
      "letters",
      "letters",
      "syllables",
      "letters",
      "words",
      "phrases",
    ]);
    expect(lessons[0]?.tags).toEqual(["intro"]);
  });

  it("has an English title for every lesson", () => {
    const table: Record<string, string> = en.lessonsMeadow;
    for (const l of lessons) {
      const [ns, key, ...rest] = l.titleKey.split(".");
      expect(ns).toBe("lessonsMeadow");
      expect(rest).toEqual([]);
      expect(table[key ?? ""], l.titleKey).toBeTypeOf("string");
    }
  });

  it("is ~25–40 chars long for Sprouts and ~60–80 for Builders", () => {
    for (const l of lessons) {
      expect(charsFor(l, "sprout"), l.id).toBeGreaterThanOrEqual(25);
      expect(charsFor(l, "sprout"), l.id).toBeLessThanOrEqual(40);
      expect(charsFor(l, "builder"), l.id).toBeGreaterThanOrEqual(60);
      expect(charsFor(l, "builder"), l.id).toBeLessThanOrEqual(80);
    }
  });

  it("lesson 1 is the shortest lesson for every band", () => {
    const [first, ...rest] = lessons;
    if (first === undefined) throw new Error("no lessons");
    for (const band of BANDS) {
      for (const l of rest) expect(charsFor(first, band)).toBeLessThanOrEqual(charsFor(l, band));
    }
  });

  it("word lessons have at least 20 typeable pool items for every band", () => {
    for (const l of lessons.filter((x) => WORD_LIKE.has(x.kind))) {
      const allowed = new Set([...allowedFor(l), " "]);
      for (const band of BANDS) {
        const items = new Set(
          poolsFor(l, band).flatMap((p) => p.items.filter((i) => typeable(i, allowed))),
        );
        expect(items.size, `${l.id} ${band}`).toBeGreaterThanOrEqual(20);
      }
    }
  });
});

describe("meadow lessons generate", () => {
  for (const lesson of lessons) {
    for (const band of BANDS) {
      describe(`${lesson.id} for ${band}`, () => {
        const runs = SEEDS.map((seed) => generate(lesson, band, seed));
        const allowed = new Set(allowedFor(lesson));

        it("only allowed keys", () => {
          for (const targets of runs) {
            expect(targets.length).toBeGreaterThan(0);
            for (const t of targets) {
              for (const c of t.text) {
                expect(c === " " ? lesson.kind === "phrases" : allowed.has(c), `"${t.text}"`).toBe(
                  true,
                );
              }
            }
          }
        });

        it("enough to fill the lesson", () => {
          for (const targets of runs) {
            const chars = targets.reduce((n, t) => n + t.text.length, 0) + targets.length - 1;
            const budget = charsFor(lesson, band);
            expect(chars).toBeGreaterThanOrEqual(lesson.kind === "letters" ? budget : budget - 1);
          }
        });

        if (lesson.kind === "letters") {
          // A letters target is one key, so a lesson can have at most as many distinct targets as
          // keys. Variety here is the order: every seed gives a different run, and the 10 runs
          // use every allowed key.
          it("a different run for each of 10 seeds, using every allowed key", () => {
            const runsText = new Set(runs.map((r) => r.map((t) => t.text).join("")));
            expect(runsText.size).toBe(SEEDS.length);
            expect(new Set(runs.flat().map((t) => t.text))).toEqual(allowed);
          });
        } else {
          it("at least 20 distinct targets over 10 seeds", () => {
            const distinct = new Set(runs.flat().map((t) => t.text));
            expect(distinct.size).toBeGreaterThanOrEqual(20);
          });
        }

        if (WORD_LIKE.has(lesson.kind)) {
          it("only pool items (never the syllable fallback)", () => {
            const items = new Set(poolsFor(lesson, band).flatMap((p) => p.items));
            for (const t of runs.flat()) expect(items.has(t.text), `"${t.text}"`).toBe(true);
          });
        }
      });
    }
  }

  it("every new key shows up in its own lesson, for every band and seed", () => {
    for (const lesson of lessons) {
      for (const band of BANDS) {
        for (const seed of SEEDS) {
          const text = generate(lesson, band, seed)
            .map((t) => t.text)
            .join("");
          for (const k of lesson.newKeys) expect(text, `${lesson.id} ${band} ${seed}`).toContain(k);
        }
      }
    }
  });
});
