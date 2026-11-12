/**
 * Lessons for biomes 1–4 (task M3-03): the shape the card asks for, and what the drills give a
 * child. The curriculum validator (`curriculum.test.ts`) checks the general rules: keys, variety,
 * real words, mastery and boss placement, space practice and titles.
 */
import { describe, expect, it } from "vitest";
import { generateFor, loadPools } from "../../../tools/validate-curriculum";
import { lessons } from "../../../src/content/lessons";
import type { Lesson } from "../../../src/content/lessons/types";
import { PLACEMENT_TIERS } from "../../../src/engine/placement";
import type { BiomeId } from "../../../src/types/core";

const BIOMES = ["meadow", "birch", "shore", "frosty"] as const;
const of = (biome: BiomeId): Lesson[] => lessons.filter((l) => l.biome === biome);
const isReview = (l: Lesson): boolean => l.newKeys.length === 0;
const pools = loadPools();
/** The key groups a biome introduces, in order. */
const order = (b: BiomeId): string[] =>
  of(b).flatMap((l) => (l.newKeys.length ? [l.newKeys.join("")] : []));
/** Every key a biome introduces, sorted. */
const keysOf = (b: BiomeId): string[] =>
  of(b)
    .flatMap((l) => l.newKeys)
    .toSorted();
/** The keys of the placement rung whose start biome is `biome`, sorted. */
const rung = (biome: BiomeId): string[] =>
  (PLACEMENT_TIERS.find((t) => t.biome === biome)?.newKeys ?? []).toSorted();

describe("biomes 1–4", () => {
  it("have 14, 15, 14 and 12 lessons", () => {
    expect(BIOMES.map((b) => of(b).length)).toEqual([14, 15, 14, 12]);
  });

  it("introduce their keys in this order", () => {
    expect(order("meadow")).toEqual(["fj", "dk", "sl", "a;", "gh"]);
    expect(order("birch")).toEqual(["ei", "ru", "ty", "ow", "qp"]);
    expect(order("shore")).toEqual(["mv", "nb", "cx", "z"]);
    expect(order("frosty")).toEqual([]);
  });

  it("make every 4th lesson a review (Meadow from lesson 8: 1–6 came before the rule)", () => {
    for (const b of BIOMES) {
      for (const l of of(b)) {
        if (l.order % 4 !== 0 || (b === "meadow" && l.order === 4)) continue;
        expect(isReview(l), l.id).toBe(true);
      }
    }
  });

  it("have one hide-the-keyboard challenge each, never the mastery or boss lesson", () => {
    for (const b of BIOMES) {
      const c = of(b).filter((l) => l.tags?.includes("challenge-hide-keyboard"));
      expect(c, b).toHaveLength(1);
      expect(c[0]?.tags, b).toEqual(["challenge-hide-keyboard"]);
    }
  });

  it("end with a 90 s mastery check at accuracy 0.9, then the boss", () => {
    for (const b of BIOMES) {
      const list = of(b);
      const mastery = list.at(-2);
      const boss = list.at(-1);
      expect(mastery?.tags, b).toEqual(["mastery"]);
      expect(mastery?.length, b).toEqual({ seconds: 90 });
      expect(mastery?.bandScale, b).toEqual({ sprout: 1, miner: 1, builder: 1 });
      expect(mastery?.targets.accuracy, b).toBe(0.9);
      expect(mastery?.mode, b).toBe("mine");
      expect(boss?.tags, b).toEqual(["boss"]);
      expect(boss?.mode, b).toBe("boss");
    }
  });

  it("reward accuracy only until Frosty Peaks; there the speed target climbs from 1.0 to 1.15", () => {
    for (const b of ["meadow", "birch", "shore"] as const) {
      for (const l of of(b)) expect(l.targets.wpmRelative, l.id).toBeUndefined();
    }
    const speeds = of("frosty").flatMap((l) =>
      l.targets.wpmRelative === undefined ? [] : [l.targets.wpmRelative],
    );
    expect(speeds[0]).toBe(1);
    expect(speeds.at(-1)).toBe(1.15);
    expect(Math.max(...speeds)).toBe(1.15);
    for (const [i, s] of speeds.entries())
      if (i > 0) expect(s).toBeGreaterThanOrEqual(speeds[i - 1] ?? 0);
    // Single-letter review and the challenge carry no speed target.
    for (const l of of("frosty")) {
      if (l.kind === "letters" || l.tags?.includes("challenge-hide-keyboard")) {
        expect(l.targets.wpmRelative, l.id).toBeUndefined();
      }
    }
  });

  it("teach the same key sets as the placement test's rungs, so tested-out lessons match", () => {
    for (const b of ["meadow", "birch", "shore"] as const) expect(keysOf(b), b).toEqual(rung(b));
    expect(PLACEMENT_TIERS.find((t) => t.biome === "frosty")?.kind).toBe("words");
  });
});

describe("drills", () => {
  const SEEDS = 50;
  const inScope = new Set<string>(BIOMES);
  const drills = lessons.filter((l) => inScope.has(l.biome) && l.newKeys.length > 0);

  it("show each new key about 2+ times in a Sprout session, and in ≥ 85 % of sessions", () => {
    for (const l of drills) {
      for (const k of l.newKeys) {
        let total = 0;
        let sessions = 0;
        for (let seed = 1; seed <= SEEDS; seed++) {
          const text = generateFor(lessons, l, "sprout", seed, pools)
            .map((t) => t.text)
            .join("");
          const n = text.split("").filter((c) => c === k).length;
          total += n;
          if (n > 0) sessions++;
        }
        expect(total / SEEDS, `${l.id} '${k}' per session`).toBeGreaterThanOrEqual(2);
        expect(sessions / SEEDS, `${l.id} '${k}' sessions`).toBeGreaterThanOrEqual(0.85);
      }
    }
  });

  it("bring back `j` and `;` in every biome after Meadow 04", () => {
    for (const b of BIOMES) {
      const later = of(b).filter((l) => b !== "meadow" || l.order > 4);
      const seen = new Set<string>();
      for (const l of later) {
        for (let seed = 1; seed <= 5; seed++) {
          for (const t of generateFor(lessons, l, "sprout", seed, pools))
            for (const c of t.text) seen.add(c);
        }
      }
      expect(seen.has("j"), `${b} j`).toBe(true);
      expect(seen.has(";"), `${b} ;`).toBe(true);
    }
  });
});
