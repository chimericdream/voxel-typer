/**
 * Loot rolls (task M2-04, docs/impl/contracts.md §18): rarity unlocks by streak and accuracy,
 * monotone in streak, count by word length, ore-vein bonus, and no speed input.
 */
import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import { meadowLoot } from "../../../src/content/loot/meadow";
import type { LootTable } from "../../../src/content/loot/types";
import {
  RARITIES,
  TIER_ODDS,
  lootCount,
  lootLevel,
  lootTierOdds,
  rollLoot,
} from "../../../src/engine/loot";
import type { LootContext } from "../../../src/engine/loot";
import { createRng } from "../../../src/engine/rng";
import type { AgeBand } from "../../../src/types/core";

const ctx = (over: Partial<LootContext> = {}): LootContext => ({
  biome: "meadow",
  wordLen: 4,
  streak: 0,
  targetAccuracy: 0.9,
  band: "miner",
  oreVein: false,
  ...over,
});

const rank = (r: string): number => RARITIES.findIndex((x) => x === r);
const expectedRank = (c: LootContext): number => {
  const odds = lootTierOdds(c);
  return RARITIES.reduce((sum, r, i) => sum + odds[r] * i, 0);
};

const arbCtx = fc.record({
  biome: fc.constant("meadow" as const),
  wordLen: fc.integer({ min: 1, max: 40 }),
  streak: fc.integer({ min: 0, max: 200 }),
  targetAccuracy: fc.double({ min: 0, max: 1, noNaN: true }),
  band: fc.constantFrom<AgeBand>("sprout", "miner", "builder"),
  oreVein: fc.boolean(),
});

describe("speed is not an input (type level)", () => {
  it("the context has exactly these fields", () => {
    expectTypeOf<keyof LootContext>().toEqualTypeOf<
      "biome" | "wordLen" | "streak" | "targetAccuracy" | "band" | "oreVein"
    >();
    expectTypeOf<keyof Parameters<typeof rollLoot>[0]>().toEqualTypeOf<keyof LootContext>();
  });

  it("rejects any speed field", () => {
    const rng = createRng(1);
    // @ts-expect-error wpm is not a loot input
    expect(() => rollLoot({ ...ctx(), wpm: 80 }, meadowLoot, rng)).not.toThrow();
    // @ts-expect-error speed is not a loot input
    expect(() => rollLoot({ ...ctx(), speed: 2 }, meadowLoot, rng)).not.toThrow();
  });
});

describe("rarity unlocks", () => {
  it.each([
    ["miner", 0, 0.9, false, 0],
    ["miner", 9, 0.99, false, 0],
    ["miner", 0, 1, false, 1],
    ["miner", 10, 0.5, false, 1],
    ["miner", 24, 1, false, 1],
    ["miner", 25, 0.5, false, 2],
    ["miner", 100, 1, false, 2],
    ["miner", 39, 1, true, 2],
    ["miner", 40, 0.5, true, 3],
    ["builder", 40, 0.5, true, 3],
    ["sprout", 14, 0.5, false, 1],
    ["sprout", 15, 0.5, false, 2],
    ["sprout", 24, 0.5, true, 2],
    ["sprout", 25, 0.5, true, 3],
    ["sprout", 25, 0.5, false, 2],
  ] as const)("%s streak %i accuracy %d vein %s → level %i", (band, streak, acc, vein, level) => {
    expect(lootLevel({ band, streak, targetAccuracy: acc, oreVein: vein })).toBe(level);
  });

  it("tier odds sum to 1, and each level dominates the one before", () => {
    for (const row of TIER_ODDS) expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    for (let l = 1; l < TIER_ODDS.length; l++) {
      let lower = 0;
      let higher = 0;
      for (let i = 0; i < 4; i++) {
        lower += TIER_ODDS[l - 1]?.[i] ?? 0;
        higher += TIER_ODDS[l]?.[i] ?? 0;
        expect(higher).toBeLessThanOrEqual(lower + 1e-12);
      }
    }
  });

  it("level 0 drops only common blocks", () => {
    const rng = createRng(3);
    for (let i = 0; i < 300; i++) {
      for (const d of rollLoot(ctx(), meadowLoot, rng)) expect(d.rarity).toBe("common");
    }
  });
});

describe("rollLoot properties", () => {
  it("more streak never lowers expected rarity, nor the rarity drawn from the same seed", () => {
    fc.assert(
      fc.property(arbCtx, fc.integer({ min: 0, max: 200 }), fc.integer(), (c, extra, seed) => {
        const more = { ...c, streak: c.streak + extra };
        expect(expectedRank(more)).toBeGreaterThanOrEqual(expectedRank(c));
        const a = rollLoot(c, meadowLoot, createRng(seed))[0];
        const b = rollLoot(more, meadowLoot, createRng(seed))[0];
        expect(rank(b?.rarity ?? "")).toBeGreaterThanOrEqual(rank(a?.rarity ?? ""));
      }),
      { seed: 2504, numRuns: 2000 },
    );
  });

  it("epic only on an ore-vein bonus at a long streak", () => {
    fc.assert(
      fc.property(arbCtx, fc.integer(), (c, seed) => {
        const drops = rollLoot(c, meadowLoot, createRng(seed));
        const epicAt = c.band === "sprout" ? 25 : 40;
        if (!c.oreVein || c.streak < epicAt) {
          for (const d of drops) expect(d.rarity).not.toBe("epic");
        }
      }),
      { seed: 2505, numRuns: 2000 },
    );
  });

  it("count is 1 + floor(wordLen / 4); one drop, or up to two on an ore vein", () => {
    fc.assert(
      fc.property(arbCtx, fc.integer(), (c, seed) => {
        const drops = rollLoot(c, meadowLoot, createRng(seed));
        const each = 1 + Math.floor(c.wordLen / 4);
        if (c.oreVein) {
          expect(drops.length === 1 || drops.length === 2).toBe(true);
          expect(drops.reduce((n, d) => n + d.count, 0)).toBe(2 * each);
        } else {
          expect(drops).toHaveLength(1);
          expect(drops[0]?.count).toBe(each);
        }
        for (const d of drops) {
          const entry = meadowLoot.entries.find((e) => e.block === d.block);
          expect(entry?.rarity).toBe(d.rarity);
        }
      }),
      { seed: 2506, numRuns: 2000 },
    );
  });

  it("is deterministic for a seed", () => {
    const c = ctx({ streak: 50, oreVein: true, wordLen: 9 });
    expect(rollLoot(c, meadowLoot, createRng("loot"))).toEqual(
      rollLoot(c, meadowLoot, createRng("loot")),
    );
  });
});

describe("rollLoot details", () => {
  it("lootCount", () => {
    expect([0, 1, 3, 4, 7, 8, 12].map(lootCount)).toEqual([1, 1, 1, 2, 2, 3, 4]);
    expect(lootCount(-3)).toBe(1);
  });

  it("tier frequencies follow the odds (level 3, 10k rolls)", () => {
    const rng = createRng(11);
    const seen = { common: 0, uncommon: 0, rare: 0, epic: 0 };
    const c = ctx({ streak: 40, oreVein: true });
    const n = 10000;
    for (let i = 0; i < n; i++) for (const d of rollLoot(c, meadowLoot, rng)) seen[d.rarity]++;
    const total = seen.common + seen.uncommon + seen.rare + seen.epic;
    const odds = lootTierOdds(c);
    // Merged duplicates shave a little off `common`, so the tolerance is loose.
    for (const r of RARITIES) expect(seen[r] / total).toBeCloseTo(odds[r], 1);
  });

  it("a tier the table lacks falls back to the nearest lower tier", () => {
    const table: LootTable = {
      biome: "meadow",
      entries: [
        { block: "dirt", rarity: "common", weight: 1 },
        { block: "clay", rarity: "uncommon", weight: 1 },
      ],
    };
    const rng = createRng(5);
    const c = ctx({ streak: 60, oreVein: true });
    for (let i = 0; i < 200; i++) {
      for (const d of rollLoot(c, table, rng)) expect(["dirt", "clay"]).toContain(d.block);
    }
  });

  it("throws on a table for another biome or without common entries", () => {
    const rng = createRng(1);
    expect(() => rollLoot(ctx({ biome: "birch" }), meadowLoot, rng)).toThrow(/meadow/);
    const noCommon: LootTable = {
      biome: "meadow",
      entries: [{ block: "glass", rarity: "rare", weight: 1 }],
    };
    expect(() => rollLoot(ctx(), noCommon, rng)).toThrow(/common/);
  });
});
