/**
 * Mine mode's pure rules (task M2-13): crack stages, the ore-vein schedule, the loot fly queue,
 * the wrong-key gate, block choice, and how a lesson turns into a session.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { blocks } from "../../../../src/content/blocks";
import { lessons } from "../../../../src/content/lessons/meadow";
import type { Lesson } from "../../../../src/content/lessons/types";
import { meadowLoot } from "../../../../src/content/loot/meadow";
import type { LootDrop } from "../../../../src/engine/loot";
import { createRng } from "../../../../src/engine/rng";
import type { TargetView } from "../../../../src/engine/types";
import {
  BANNER_GAP_MS,
  FLY_MAX,
  FLY_MS,
  FLY_SLOTS,
  FLY_STAGGER_MS,
  MAX_CRACK_STAGE,
  ORE_VEIN_INTERVAL,
  allowedKeys,
  burstCount,
  caseSensitiveFor,
  chimeStep,
  comboOf,
  crackOverlay,
  crackStage,
  createVeinSchedule,
  emptyFlyQueue,
  emptyWrongGate,
  enqueueDrops,
  feedWrong,
  flightPose,
  flushFlights,
  lengthPlan,
  nextKeyOf,
  pickTargetBlock,
  pickVeinBlock,
  policyFor,
  poolsFor,
  progressOf,
  settleDrops,
  slotOf,
  stepFlights,
  veinOnBreak,
  veinOnStreak,
  veinTake,
} from "../../../../src/modes/mine/logic";
import type { VeinSchedule } from "../../../../src/modes/mine/logic";

const SEED = 1307;

/** Plays a run of correct keys one at a time and counts the ore blocks it earns. */
const play = (s: VeinSchedule, from: number, to: number): { s: VeinSchedule; veins: number } => {
  let veins = 0;
  let cur = s;
  for (let streak = from; streak <= to; streak++) {
    cur = veinOnStreak(cur, streak);
    const taken = veinTake(cur);
    cur = taken.schedule;
    if (taken.vein) veins++;
  }
  return { s: cur, veins };
};

const run = (): string[] => {
  const rng = createRng(SEED);
  return Array.from({ length: 200 }, () => pickTargetBlock(meadowLoot, rng));
};

const drop = (block: string, count = 1): LootDrop => ({ block, count, rarity: "common" });

const view = (over: Partial<TargetView>): TargetView => ({
  id: "g0",
  text: "ad",
  typed: 0,
  marks: ["pending", "pending"],
  locked: false,
  complete: false,
  ...over,
});

const lesson = (id: string): Lesson => {
  const l = lessons.find((x) => x.id === id);
  if (!l) throw new Error(`no lesson ${id}`);
  return l;
};

const mk = (id: string, biome: Lesson["biome"], order: number, keys: string[]): Lesson => ({
  ...lesson("meadow-01"),
  id,
  biome,
  order,
  newKeys: keys,
});

describe("crack stages", () => {
  it("is floor(9 × typed / len)", () => {
    expect(crackStage(0, 4)).toBe(0);
    expect(crackStage(1, 4)).toBe(2);
    expect(crackStage(2, 4)).toBe(4);
    expect(crackStage(3, 4)).toBe(6);
    expect(crackStage(4, 4)).toBe(9);
    expect(crackStage(1, 3)).toBe(3);
    expect(crackStage(1, 13)).toBe(0);
    expect(crackStage(1, 1)).toBe(9);
  });

  it("stays inside 0–9 and never goes back as more is typed (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (len) => {
        let last = 0;
        for (let typed = 0; typed <= len + 2; typed++) {
          const s = crackStage(typed, len);
          expect(Number.isInteger(s)).toBe(true);
          expect(s).toBeGreaterThanOrEqual(last);
          expect(s).toBeLessThanOrEqual(MAX_CRACK_STAGE);
          last = s;
        }
        expect(crackStage(len, len)).toBe(MAX_CRACK_STAGE);
      }),
      { seed: SEED },
    );
  });

  it("copes with nonsense input", () => {
    expect(crackStage(3, 0)).toBe(0);
    expect(crackStage(-1, 5)).toBe(0);
    expect(crackStage(Number.NaN, 5)).toBe(0);
  });

  it("shows no overlay on a whole block, and a hairline after the first key of a long one", () => {
    expect(crackOverlay(0, 5)).toBeNull();
    expect(crackOverlay(1, 13)).toBe(0);
    expect(crackOverlay(5, 5)).toBe(9);
  });

  it("scales the burst with the word, inside 8–30", () => {
    expect(burstCount(1)).toBe(10);
    expect(burstCount(4)).toBe(16);
    expect(burstCount(40)).toBe(30);
    expect(burstCount(-3)).toBe(8);
  });

  it("climbs the chime with the letters of a word, and with the streak on single letters", () => {
    expect([0, 1, 2, 3].map((i) => chimeStep(i, 4, 99))).toEqual([0, 1, 2, 3]);
    expect([1, 2, 3, 10, 11].map((s) => chimeStep(0, 1, s))).toEqual([0, 1, 2, 9, 0]);
    expect(chimeStep(25, 30, 1)).toBe(9);
  });
});

describe("ore-vein schedule", () => {
  it("uses the card's intervals: every 15 in a row, Sprout 10", () => {
    expect(ORE_VEIN_INTERVAL).toEqual({ sprout: 10, miner: 15, builder: 15 });
    expect(createVeinSchedule("sprout")).toEqual({ interval: 10, nextAt: 10, ready: false });
  });

  it("earns one ore block at each multiple of the interval", () => {
    expect(play(createVeinSchedule("sprout"), 1, 9).veins).toBe(0);
    expect(play(createVeinSchedule("sprout"), 1, 10).veins).toBe(1);
    expect(play(createVeinSchedule("sprout"), 1, 35).veins).toBe(3);
    expect(play(createVeinSchedule("miner"), 1, 44).veins).toBe(2);
    expect(play(createVeinSchedule("miner"), 1, 45).veins).toBe(3);
  });

  it("starts counting again after a slip, and keeps a vein already earned", () => {
    const earned = veinOnStreak(createVeinSchedule("sprout"), 10);
    expect(earned).toEqual({ interval: 10, nextAt: 20, ready: true });
    const slipped = veinOnBreak(earned);
    expect(slipped).toEqual({ interval: 10, nextAt: 10, ready: true });
    expect(veinTake(slipped)).toEqual({
      schedule: { interval: 10, nextAt: 10, ready: false },
      vein: true,
    });
    // After the slip it takes a full 10 in a row again.
    expect(play(veinTake(slipped).schedule, 1, 9).veins).toBe(0);
    expect(play(veinTake(slipped).schedule, 1, 10).veins).toBe(1);
  });

  it("gives one ore block, not several, when a long word jumps past a mark", () => {
    // A 12-letter word typed inside one block: the streak passes 10 without a block in between.
    let s = createVeinSchedule("sprout");
    for (let streak = 1; streak <= 12; streak++) s = veinOnStreak(s, streak);
    expect(s.ready).toBe(true);
    expect(s.nextAt).toBe(20);
    expect(veinTake(veinTake(s).schedule).vein).toBe(false);
    // Even a jump of several intervals at once earns one.
    expect(veinOnStreak(createVeinSchedule("sprout"), 37)).toEqual({
      interval: 10,
      nextAt: 40,
      ready: true,
    });
  });

  it("returns the same object when nothing changes", () => {
    const s = createVeinSchedule("miner");
    expect(veinOnStreak(s, 3)).toBe(s);
    expect(veinOnBreak(s)).toBe(s);
    expect(veinTake(s).schedule).toBe(s);
  });
});

describe("which block a target shows", () => {
  it("picks only common Meadow blocks, deterministically", () => {
    const common = new Set(
      meadowLoot.entries.filter((e) => e.rarity === "common").map((e) => e.block),
    );
    const picks = run();
    for (const p of picks) expect(common.has(p)).toBe(true);
    expect(new Set(picks).size).toBeGreaterThan(5);
    expect(run()).toEqual(picks);
  });

  it("shows a finer ore for a longer streak", () => {
    expect(pickVeinBlock(meadowLoot, blocks, "sprout", 10)).toBe("char-ore");
    expect(pickVeinBlock(meadowLoot, blocks, "sprout", 15)).toBe("copper-ore");
    expect(pickVeinBlock(meadowLoot, blocks, "sprout", 25)).toBe("meadowstone");
    expect(pickVeinBlock(meadowLoot, blocks, "miner", 15)).toBe("char-ore");
    expect(pickVeinBlock(meadowLoot, blocks, "miner", 25)).toBe("copper-ore");
    expect(pickVeinBlock(meadowLoot, blocks, "builder", 40)).toBe("meadowstone");
  });

  it("has no ore block for a table without ores", () => {
    const plain = { biome: "meadow" as const, entries: meadowLoot.entries.slice(0, 3) };
    expect(pickVeinBlock(plain, blocks, "miner", 99)).toBeNull();
  });

  it("makes a common drop the block that was mined, and leaves finds alone", () => {
    const drops: LootDrop[] = [
      { block: "dirt", count: 2, rarity: "common" },
      { block: "bluebells", count: 1, rarity: "uncommon" },
    ];
    expect(settleDrops(drops, "oak-log", false)).toEqual([
      { block: "oak-log", count: 2, rarity: "common" },
      { block: "bluebells", count: 1, rarity: "uncommon" },
    ]);
    // An ore block's drops stay as rolled.
    expect(settleDrops(drops, "copper-ore", true)).toEqual(drops);
    // The input is not changed.
    expect(drops[0]?.block).toBe("dirt");
  });
});

describe("loot fly queue", () => {
  it("gives each new block the next hotbar slot and keeps it", () => {
    let q = emptyFlyQueue();
    q = enqueueDrops(q, [drop("dirt")], 0).queue;
    q = enqueueDrops(q, [drop("stone")], 10).queue;
    q = enqueueDrops(q, [drop("dirt")], 20).queue;
    expect(q.flights.map((f) => f.slot)).toEqual([0, 1, 0]);
    expect(q.seen).toEqual(["dirt", "stone"]);
    expect(slotOf(q.seen, "stone")).toBe(1);
    expect(slotOf(q.seen, "new-thing")).toBe(2);
  });

  it("wraps to the first slot after nine different blocks", () => {
    const seen = Array.from({ length: FLY_SLOTS }, (_, i) => `b${i}`);
    expect(slotOf(seen, "b8")).toBe(8);
    expect(slotOf(seen, "tenth")).toBe(0);
  });

  it("staggers the drops of one block and lands them in order", () => {
    const { queue, landed } = enqueueDrops(emptyFlyQueue(), [drop("a"), drop("b", 3)], 1000);
    expect(landed).toEqual([]);
    expect(queue.flights.map((f) => f.startMs)).toEqual([1000, 1000 + FLY_STAGGER_MS]);
    expect(queue.flights.map((f) => f.id)).toEqual([1, 2]);

    expect(stepFlights(queue, 1000 + FLY_MS - 1).landed).toEqual([]);
    const first = stepFlights(queue, 1000 + FLY_MS);
    expect(first.landed.map((f) => f.block)).toEqual(["a"]);
    expect(first.queue.flights).toHaveLength(1);
    const second = stepFlights(first.queue, 1000 + FLY_STAGGER_MS + FLY_MS);
    expect(second.landed.map((f) => [f.block, f.count])).toEqual([["b", 3]]);
    expect(second.queue.flights).toEqual([]);
  });

  it("never loses or doubles an item, whatever the timing (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            gap: fc.integer({ min: 0, max: 700 }),
            drops: fc.array(
              fc.record({
                block: fc.constantFrom("a", "b", "c", "d"),
                count: fc.integer({ min: 0, max: 4 }),
              }),
              { maxLength: 3 },
            ),
            instant: fc.boolean(),
          }),
          { maxLength: 30 },
        ),
        (steps) => {
          let q = emptyFlyQueue();
          let now = 0;
          const sent = new Map<string, number>();
          const got = new Map<string, number>();
          const ids = new Set<number>();
          const land = (flights: readonly { id: number; block: string; count: number }[]): void => {
            for (const f of flights) {
              expect(ids.has(f.id)).toBe(false);
              ids.add(f.id);
              got.set(f.block, (got.get(f.block) ?? 0) + f.count);
            }
          };
          for (const s of steps) {
            now += s.gap;
            const stepped = stepFlights(q, now);
            land(stepped.landed);
            q = stepped.queue;
            for (const d of s.drops) sent.set(d.block, (sent.get(d.block) ?? 0) + d.count);
            const added = enqueueDrops(
              q,
              s.drops.map((d) => ({ ...d, rarity: "common" as const })),
              now,
              s.instant,
            );
            land(added.landed);
            q = added.queue;
            expect(q.flights.length).toBeLessThanOrEqual(FLY_MAX);
          }
          const flushed = flushFlights(q);
          land(flushed.landed);
          expect(flushed.queue.flights).toEqual([]);
          for (const [block, n] of sent) expect(got.get(block) ?? 0).toBe(n);
        },
      ),
      { seed: SEED },
    );
  });

  it("lands at once under reduced motion, and when the air is full", () => {
    const instant = enqueueDrops(emptyFlyQueue(), [drop("a"), drop("b")], 0, true);
    expect(instant.queue.flights).toEqual([]);
    expect(instant.landed.map((f) => f.block)).toEqual(["a", "b"]);

    let q = emptyFlyQueue();
    for (let i = 0; i < FLY_MAX; i++) q = enqueueDrops(q, [drop(`b${i}`)], 0).queue;
    const over = enqueueDrops(q, [drop("extra", 2)], 0);
    expect(over.queue.flights).toHaveLength(FLY_MAX);
    expect(over.landed.map((f) => [f.block, f.count])).toEqual([["extra", 2]]);
  });

  it("skips empty drops", () => {
    const { queue, landed } = enqueueDrops(emptyFlyQueue(), [drop("a", 0)], 0);
    expect(queue.flights).toEqual([]);
    expect(landed).toEqual([]);
  });

  it("flies from the block to the slot along a small hop", () => {
    const [f] = enqueueDrops(emptyFlyQueue(), [drop("a")], 100).queue.flights;
    if (!f) throw new Error("no flight");
    expect(flightPose(f, 50)).toMatchObject({ k: 0, lift: 0, scale: 1, visible: false });
    expect(flightPose(f, 100)).toMatchObject({ k: 0, visible: true });
    const mid = flightPose(f, 100 + FLY_MS / 2);
    expect(mid.k).toBeCloseTo(0.75);
    expect(mid.lift).toBeGreaterThan(0.2);
    expect(flightPose(f, 100 + FLY_MS)).toMatchObject({ k: 1, lift: 0, scale: 0.65 });
    expect(flightPose(f, 99_999)).toMatchObject({ k: 1, lift: 0 });
  });
});

describe("wrong-key gate", () => {
  it("cues the first slip and shows the banner", () => {
    expect(feedWrong(emptyWrongGate(), "k", 1000)).toMatchObject({ cue: true, banner: true });
  });

  it("gives one cue for a key held down for 5 seconds", () => {
    let gate = emptyWrongGate();
    let cues = 0;
    let banners = 0;
    for (let now = 0; now <= 5000; now += 33) {
      const fed = feedWrong(gate, "k", now);
      gate = fed.gate;
      if (fed.cue) cues++;
      if (fed.banner) banners++;
    }
    expect(cues).toBe(1);
    expect(banners).toBe(1);
  });

  it("shows the banner at most once every 5 seconds", () => {
    let gate = emptyWrongGate();
    const banners: number[] = [];
    // A new slip every 600 ms for 12 s: each is cued, few get a banner.
    for (let i = 0; i <= 20; i++) {
      const now = i * 600;
      const fed = feedWrong(gate, i % 2 === 0 ? "k" : "d", now);
      gate = fed.gate;
      expect(fed.cue).toBe(true);
      if (fed.banner) banners.push(now);
    }
    expect(banners).toEqual([0, 5400, 10800]);
    for (let i = 1; i < banners.length; i++) {
      expect((banners[i] ?? 0) - (banners[i - 1] ?? 0)).toBeGreaterThanOrEqual(BANNER_GAP_MS);
    }
  });

  it("never cues more than 3 times a second, however the keys are mashed (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ gap: fc.integer({ min: 0, max: 300 }), key: fc.constantFrom("a", "s", "d") }),
          { minLength: 1, maxLength: 80 },
        ),
        (presses) => {
          let gate = emptyWrongGate();
          let now = 0;
          const cues: number[] = [];
          for (const p of presses) {
            now += p.gap;
            const fed = feedWrong(gate, p.key, now);
            gate = fed.gate;
            if (fed.cue) cues.push(now);
            if (fed.banner) expect(fed.cue).toBe(true);
          }
          for (let i = 0; i < cues.length; i++) {
            const inWindow = cues.filter((c) => c >= (cues[i] ?? 0) && c < (cues[i] ?? 0) + 1000);
            expect(inWindow.length).toBeLessThanOrEqual(3);
          }
        },
      ),
      { seed: SEED },
    );
  });

  it("cues the same key again after a pause", () => {
    const first = feedWrong(emptyWrongGate(), "k", 0);
    expect(feedWrong(first.gate, "k", 200).cue).toBe(false);
    expect(feedWrong(first.gate, "k", 800).cue).toBe(true);
  });
});

describe("HUD values", () => {
  it("lights min(9, floor(streak / 3)) hotbar slots", () => {
    expect([0, 2, 3, 8, 27, 500].map(comboOf)).toEqual([0, 0, 1, 2, 9, 9]);
  });

  it("points the keyboard at the next char, then the trailing space", () => {
    expect(nextKeyOf(null)).toBeNull();
    expect(nextKeyOf(view({}))).toBe("a");
    expect(nextKeyOf(view({ typed: 1 }))).toBe("d");
    // The last word has no trailing space.
    expect(nextKeyOf(view({ typed: 2, marks: ["ok", "ok"] }))).toBeNull();
    expect(nextKeyOf(view({ typed: 2, marks: ["ok", "ok", "pending"] }))).toBe(" ");
    expect(nextKeyOf(view({ typed: 2, marks: ["ok", "wrong", "pending"] }))).toBeNull();
    expect(nextKeyOf(view({ complete: true }))).toBeNull();
  });

  it("fills the progress bar by blocks, with the current block's share", () => {
    expect(progressOf(0, null, 10)).toBe(0);
    expect(progressOf(5, null, 10)).toBe(0.5);
    expect(progressOf(5, view({ typed: 1 }), 10)).toBeCloseTo(0.55);
    expect(progressOf(10, null, 10)).toBe(1);
    expect(progressOf(3, null, 0)).toBe(0);
  });
});

describe("from a lesson to a session", () => {
  it("allows every key up to the lesson, in the order they were taught", () => {
    expect(allowedKeys(lessons, lesson("meadow-01"))).toEqual(["f", "j"]);
    expect(allowedKeys(lessons, lesson("meadow-03"))).toEqual(["f", "j", "d", "k", "s", "l"]);
    expect(allowedKeys(lessons, lesson("meadow-06"))).toEqual([
      "f",
      "j",
      "d",
      "k",
      "s",
      "l",
      "a",
      ";",
    ]);
  });

  it("counts earlier biomes, and keeps the Sparkstone side branch out", () => {
    const all = [
      mk("citadel-01", "citadel", 1, ["Q"]),
      mk("sparkstone-01", "sparkstone", 1, ["{"]),
      mk("birch-01", "birch", 1, ["e"]),
      mk("meadow-01", "meadow", 1, ["f", "j"]),
      mk("birch-02", "birch", 2, ["i", "f"]),
    ];
    const byId = (id: string): Lesson => all.find((l) => l.id === id) ?? lesson("meadow-01");
    expect(allowedKeys(all, byId("birch-01"))).toEqual(["f", "j", "e"]);
    expect(allowedKeys(all, byId("birch-02"))).toEqual(["f", "j", "e", "i"]);
    expect(allowedKeys(all, byId("citadel-01"))).toEqual(["f", "j", "e", "i", "Q"]);
    expect(allowedKeys(all, byId("sparkstone-01"))).toEqual(["f", "j", "e", "i", "{"]);
  });

  it("defaults the policy to stay, skip for Builder and backspace for sentences", () => {
    const l = lesson("meadow-05");
    expect(policyFor(l, "sprout")).toBe("stay");
    expect(policyFor(l, "miner")).toBe("stay");
    expect(policyFor(l, "builder")).toBe("skip");
    expect(policyFor({ kind: "sentences" }, "sprout")).toBe("backspace");
    expect(policyFor({ kind: "words", policy: { builder: "stay" } }, "builder")).toBe("stay");
  });

  it("lets A count for a only for Sprout in the early biomes", () => {
    expect(caseSensitiveFor({ biome: "meadow" }, "sprout")).toBe(false);
    expect(caseSensitiveFor({ biome: "meadow" }, "miner")).toBe(true);
    expect(caseSensitiveFor({ biome: "mines" }, "sprout")).toBe(true);
    expect(caseSensitiveFor({ biome: "mines", caseInsensitiveFor: ["miner"] }, "miner")).toBe(
      false,
    );
  });

  it("scales the length by band, as the Meadow table says", () => {
    const opts = { calm: false, estWpm: 10 };
    expect(lengthPlan(lesson("meadow-01"), "sprout", opts).length).toEqual({ chars: 25 });
    expect(lengthPlan(lesson("meadow-01"), "builder", opts).length).toEqual({ chars: 60 });
    expect(lengthPlan(lesson("meadow-05"), "sprout", opts).length).toEqual({ chars: 36 });
    expect(lengthPlan(lesson("meadow-05"), "miner", opts)).toEqual({
      length: { chars: 60 },
      end: { kind: "targets" },
      timeLimitMs: null,
    });
    expect(lengthPlan({ length: { targets: 10 } }, "builder", opts).length).toEqual({
      targets: 13,
    });
  });

  it("times a seconds lesson, except in calm mode", () => {
    const timed = lengthPlan({ length: { seconds: 60 } }, "miner", { calm: false, estWpm: 12 });
    expect(timed).toEqual({
      length: { seconds: 60, estWpm: 12 },
      end: { kind: "time", ms: 60_000 },
      timeLimitMs: 60_000,
    });
    const calm = lengthPlan({ length: { seconds: 60 } }, "miner", { calm: true, estWpm: 12 });
    expect(calm).toEqual({ length: { chars: 60 }, end: { kind: "targets" }, timeLimitMs: null });
  });

  it("uses the pools a lesson names, else its biome's, for the band", () => {
    const pools = [
      { id: "home-row", band: "all" as const, tags: ["biome=meadow"], items: ["dad"] },
      { id: "meadow-phrases", band: "all" as const, tags: ["biome=meadow"], items: ["a dad"] },
      { id: "birch-miner", band: "miner" as const, tags: ["biome=birch"], items: ["tree"] },
      { id: "birch-sprout", band: "sprout" as const, tags: ["biome=birch"], items: ["he"] },
    ];
    expect(poolsFor(lesson("meadow-05"), "sprout", pools).map((p) => p.id)).toEqual(["home-row"]);
    expect(poolsFor({ biome: "meadow" }, "miner", pools).map((p) => p.id)).toEqual([
      "home-row",
      "meadow-phrases",
    ]);
    expect(poolsFor({ biome: "birch" }, "sprout", pools).map((p) => p.id)).toEqual([
      "birch-sprout",
    ]);
  });
});
