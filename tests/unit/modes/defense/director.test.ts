/**
 * Night Defense's wave director (task M4-05): the controller's bounds and rules, the waves it
 * plans (timing, lanes, words) and determinism. The convergence evidence is in `sim-defense.test.ts`
 * and `docs/sim.md`.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { WordPool } from "../../../../src/engine/generator";
import { typeable } from "../../../../src/engine/generator";
import { createRng } from "../../../../src/engine/rng";
import {
  DIRECTOR_CONSTANTS as C,
  controllerStep,
  createDirector,
  initialControllerState,
  laneCount,
  mobTiming,
  paceWpm,
  referenceWpm,
  startDifficulty,
  waveSize,
} from "../../../../src/modes/defense/director";
import type {
  ControllerState,
  DefenseMob,
  DirectorOptions,
  WaveFeedback,
  WaveSpec,
} from "../../../../src/modes/defense/director";
import { isInZone, pureZoneGlobs } from "../../../../tools/check-boundaries";
import type { AgeBand } from "../../../../src/types/core";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");
const HOME_ROW = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"];
const BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];

const pool = (id: string, tags: string[], items: string[]): WordPool => ({
  id,
  band: "all",
  tags: ["kind=words", "case=lower", ...tags],
  items,
});
const SNOW = pool(
  "snow",
  ["theme=snow"],
  ["snow", "ice", "cold", "frost", "sled", "melt", "flake", "chill", "mitt", "puff", "hail"],
);
const FOOD = pool("food", ["theme=food"], ["jam", "pie", "bun", "egg"]);
const LESSON = pool(
  "lesson",
  ["biome=frosty"],
  ["tree", "rock", "path", "lamp", "camp", "moss", "fern", "pond", "hill", "leaf", "wind"],
);
const HOME = pool("home", ["biome=meadow"], ["sad", "dad", "lad", "fall", "glad", "flask", "ask"]);
const MOBS: readonly DefenseMob[] = [
  { id: "frost-pup", speedClass: "medium", flavor: "theme=snow" },
  { id: "slimeling", speedClass: "slow", flavor: "theme=food" },
  { id: "cave-bat", speedClass: "fast", flavor: "theme=snow" },
];

const options = (over: Partial<DirectorOptions> = {}): DirectorOptions => ({
  band: "miner",
  baselineNetWpm: 20,
  calm: false,
  rng: createRng(7),
  mobs: MOBS,
  pools: [SNOW, FOOD, LESSON],
  lessonPools: [LESSON],
  allowed: ALPHABET,
  ...over,
});

const feedback = (over: Partial<WaveFeedback> = {}): WaveFeedback => ({
  accuracy: 0.9,
  reachedBase: 0,
  wordsDone: 10,
  activeMs: 20_000,
  ...over,
});

/** Plays `n` waves, feeding back `f(wave)`. */
function night(opts: DirectorOptions, n: number, f: (w: WaveSpec) => WaveFeedback): WaveSpec[] {
  const director = createDirector(opts);
  const waves: WaveSpec[] = [];
  for (let i = 0; i < n; i++) {
    const wave = director.nextWave();
    waves.push(wave);
    director.observe(f(wave));
  }
  return waves;
}

const arbFeedback = fc.record({
  accuracy: fc.oneof(fc.double({ min: -0.5, max: 1.5, noNaN: true }), fc.constant(Number.NaN)),
  reachedBase: fc.oneof(fc.integer({ min: -3, max: 30 }), fc.constant(Number.NaN)),
  wordsDone: fc.oneof(fc.integer({ min: -3, max: 30 }), fc.constant(Number.POSITIVE_INFINITY)),
  activeMs: fc.oneof(fc.integer({ min: 0, max: 60_000 }), fc.constant(Number.NaN)),
});

describe("purity", () => {
  it("is a pure zone", () => {
    expect(isInZone("src/modes/defense/director.ts", pureZoneGlobs())).toBe(true);
  });
});

describe("start", () => {
  it("starts at 0.8 of the baseline, or 0.7 of a slow band default for a new profile", () => {
    expect(startDifficulty({ baselineNetWpm: 22 })).toBe(C.startD);
    expect(startDifficulty({ baselineNetWpm: null })).toBe(C.newProfileStartD);
    expect(startDifficulty({ baselineNetWpm: 0 })).toBe(C.newProfileStartD);
    expect(startDifficulty({ baselineNetWpm: Number.NaN })).toBe(C.newProfileStartD);
    expect(referenceWpm("miner", 22)).toBe(22);
    expect(referenceWpm("miner", null)).toBe(C.defaultBaselineWpm.miner);
    expect(referenceWpm("builder", 500)).toBe(C.baselineClampWpm.max);
    for (const band of BANDS) expect(referenceWpm(band, null)).toBeLessThanOrEqual(15);
  });

  it("can resume from an earlier night, inside the bounds", () => {
    expect(startDifficulty({ baselineNetWpm: 20, startDifficulty: 1.3 })).toBe(1.3);
    expect(startDifficulty({ baselineNetWpm: 20, startDifficulty: 9 })).toBe(C.dMax);
    expect(startDifficulty({ baselineNetWpm: 20, startDifficulty: 0 })).toBe(C.dMin);
    expect(createDirector(options({ calm: true, startDifficulty: 1.9 })).difficulty).toBe(
      C.calmDMax,
    );
  });
});

describe("controller", () => {
  const s0 = initialControllerState(1);

  it("keeps d inside [0.3, 2.0] and every step inside ±15 % (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: C.dMin, max: C.dMax, noNaN: true }),
        fc.boolean(),
        fc.array(arbFeedback, { minLength: 1, maxLength: 12 }),
        (d0, calm, fs) => {
          let s: ControllerState = initialControllerState(Math.min(d0, calm ? C.calmDMax : d0));
          for (const f of fs) {
            const next = controllerStep(s, f, calm);
            expect(next.d).toBeGreaterThanOrEqual(C.dMin);
            expect(next.d).toBeLessThanOrEqual(calm ? C.calmDMax : C.dMax);
            const step = next.d / s.d - 1;
            expect(step).toBeGreaterThanOrEqual(-C.maxStep - 1e-9);
            expect(step).toBeLessThanOrEqual((calm ? C.calmMaxStepUp : C.maxStep) + 1e-9);
            s = next;
          }
        },
      ),
      { seed: 4205, numRuns: 300 },
    );
  });

  it("steps up above 90 % and down below it", () => {
    expect(controllerStep(s0, feedback({ accuracy: 0.97 }), false).d).toBeCloseTo(1.15);
    expect(controllerStep(s0, feedback({ accuracy: 0.93 }), false).d).toBeCloseTo(1.075);
    expect(controllerStep(s0, feedback({ accuracy: 0.86 }), false).d).toBeLessThan(1);
    expect(controllerStep(s0, feedback({ accuracy: 0.9 }), false).d).toBeCloseTo(1);
  });

  it("slows down when mobs reach the base, however accurate the child is", () => {
    const some = controllerStep(s0, feedback({ accuracy: 1, wordsDone: 8, reachedBase: 2 }), false);
    expect(some.d).toBeLessThan(1);
    expect(some.fine).toBe(true);
    const many = controllerStep(s0, feedback({ accuracy: 1, wordsDone: 6, reachedBase: 4 }), false);
    expect(many.d).toBeCloseTo(1 - C.maxStep);
  });

  it("gives relief at once after a hard wave", () => {
    const fine: ControllerState = { ...s0, fine: true };
    expect(controllerStep(fine, feedback({ accuracy: 0.7 }), false).d).toBeCloseTo(1 - C.maxStep);
    // In fine mode an ordinary miss is a small step.
    const small = controllerStep(fine, feedback({ accuracy: 0.86 }), false).d;
    expect(small).toBeLessThan(1);
    expect(small).toBeGreaterThanOrEqual(1 - C.fineMaxStepDown - 1e-9);
  });

  it("switches to small steps up after the first wave at or under target", () => {
    const easy = controllerStep(s0, feedback({ accuracy: 0.99 }), false);
    expect(easy.fine).toBe(false);
    const edge = controllerStep(easy, feedback({ accuracy: 0.88 }), false);
    expect(edge.fine).toBe(true);
    const after = controllerStep(edge, feedback({ accuracy: 1 }), false);
    expect(after.d / edge.d - 1).toBeLessThanOrEqual(C.fineMaxStepUp + 1e-9);
  });

  it("weights waves by words done and forgets older ones", () => {
    // A tiny 2-word wave at 60 % after a 20-word wave at 95 %: the average stays above target.
    const big = controllerStep(s0, feedback({ accuracy: 0.95, wordsDone: 20 }), false);
    const tiny = controllerStep(
      big,
      feedback({ accuracy: 0.6, wordsDone: 2, activeMs: 1500 }),
      false,
    );
    // Too short to count for accuracy: no relief, and the average still says "a bit easy".
    expect(tiny.d).toBeGreaterThan(big.d);
  });

  it("ignores a wave in which nothing was resolved", () => {
    const f = feedback({ wordsDone: 0, reachedBase: 0 });
    expect(controllerStep(s0, f, false)).toBe(s0);
  });

  it("never steps up on a wave where nothing was typed (an idle child)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.boolean(), (reached, calm) => {
        const next = controllerStep(
          s0,
          feedback({ accuracy: 1, wordsDone: 0, reachedBase: reached }),
          calm,
        );
        expect(next.d).toBeLessThan(s0.d);
      }),
      { seed: 4206 },
    );
  });

  it("is gentler in calm mode: lower ceiling, smaller steps up", () => {
    let s = initialControllerState(1);
    for (let i = 0; i < 20; i++) s = controllerStep(s, feedback({ accuracy: 1 }), true);
    expect(s.d).toBe(C.calmDMax);
    expect(
      controllerStep(initialControllerState(1), feedback({ accuracy: 1 }), true).d,
    ).toBeCloseTo(1 + C.calmMaxStepUp);
  });
});

describe("waves", () => {
  it("is deterministic for a seed", () => {
    const play = (seed: number): WaveSpec[] =>
      night(options({ rng: createRng(seed) }), 6, (w) =>
        feedback({ accuracy: 0.8 + 0.03 * w.index, wordsDone: w.mobs.length }),
      );
    expect(play(11)).toEqual(play(11));
    expect(play(11)).not.toEqual(play(12));
  });

  it("plans mobs in spawn order, in their lanes, with sane speeds", () => {
    for (const band of BANDS)
      for (const calm of [false, true]) {
        const waves = night(options({ band, calm }), 8, (w) =>
          feedback({ accuracy: 0.96, wordsDone: w.mobs.length }),
        );
        for (const w of waves) {
          expect(w.calm).toBe(calm);
          expect(w.lanes).toBe(laneCount(band, w.difficulty));
          expect(w.mobs.length).toBe(waveSize(band, w.index, 20, w.difficulty, calm));
          expect(w.mobs.length).toBeLessThanOrEqual(calm ? C.calmMaxMobs : C.mobsPerWave.max);
          expect(new Set(w.mobs.map((m) => m.id)).size).toBe(w.mobs.length);
          w.mobs.forEach((m, i) => {
            expect(m.id).toBe(`w${w.index}-m${i}`);
            expect(m.lane).toBeGreaterThanOrEqual(0);
            expect(m.lane).toBeLessThan(w.lanes);
            if (i > 0) {
              const prev = w.mobs[i - 1];
              expect(m.spawnAtMs).toBeGreaterThan(prev?.spawnAtMs ?? -1);
              if (w.lanes > 1) expect(m.lane).not.toBe(prev?.lane);
            }
            expect(1000 / m.speed).toBeGreaterThanOrEqual(C.travelMs.min - 1e-6);
            expect(1000 / m.speed).toBeLessThanOrEqual(C.travelMs.max + 1e-6);
          });
        }
      }
  });

  it("gives Sprouts 2–3 lanes, Miners 3–4 and Builders 4–5", () => {
    expect([laneCount("sprout", 0.5), laneCount("sprout", 1.5)]).toEqual([2, 3]);
    expect([laneCount("miner", 0.5), laneCount("miner", 1.5)]).toEqual([3, 4]);
    expect([laneCount("builder", 0.5), laneCount("builder", 1.5)]).toEqual([4, 5]);
  });

  it("spaces mobs out at low d and speeds them up at high d", () => {
    const at = (k: number): { gapMs: number; speed: number } =>
      mobTiming("miner", 5, 20, k, "medium");
    expect(at(0.5).gapMs).toBeCloseTo(at(1).gapMs * 2);
    expect(at(2).gapMs).toBeLessThan(at(1).gapMs);
    expect(at(2).gapMs).toBeGreaterThan(at(1).gapMs / 2);
    expect(at(2).speed).toBeGreaterThan(at(1).speed * 2);
    expect(mobTiming("miner", 5, 20, 1, "fast").speed).toBeGreaterThan(at(1).speed);
  });

  it("is slower in calm mode at the same difficulty", () => {
    expect(paceWpm(20, 1, true)).toBeLessThan(paceWpm(20, 1, false));
    const plain = createDirector(options({ startDifficulty: 1 })).nextWave();
    const calm = createDirector(options({ calm: true, startDifficulty: 1 })).nextWave();
    const gap = (w: WaveSpec): number =>
      ((w.mobs.at(-1)?.spawnAtMs ?? 0) - (w.mobs[0]?.spawnAtMs ?? 0)) / (w.mobs.length - 1);
    expect(gap(calm)).toBeGreaterThan(gap(plain));
    expect(Math.max(...calm.mobs.map((m) => m.speed))).toBeLessThan(
      Math.max(...plain.mobs.map((m) => m.speed)) + 1e-9,
    );
  });

  it("sends easier mobs at low difficulty", () => {
    const count = (d: number, cls: string): number =>
      createDirector(options({ startDifficulty: d, rng: createRng(3) }))
        .nextWave()
        .mobs.filter((m) => MOBS.find((x) => x.id === m.mobId)?.speedClass === cls).length;
    let lowFast = 0;
    let highFast = 0;
    for (let i = 0; i < 20; i++) {
      lowFast += count(0.4, "fast");
      highFast += count(1.6, "fast");
    }
    expect(lowFast).toBeLessThan(highFast);
  });
});

describe("words", () => {
  it("uses only allowed keys, one word, the band's lengths", () => {
    for (const band of BANDS) {
      const len = C.wordLength[band];
      const waves = night(options({ band }), 5, (w) => feedback({ wordsDone: w.mobs.length }));
      for (const m of waves.flatMap((w) => w.mobs)) {
        expect(m.word).not.toMatch(/\s/);
        expect(typeable(m.word, new Set(ALPHABET))).toBe(true);
        expect(m.word.length).toBeGreaterThanOrEqual(len.min);
        expect(m.word.length).toBeLessThanOrEqual(len.max);
      }
    }
  });

  it("takes a mob's words from its flavor pool when it has enough", () => {
    const waves = night(options(), 4, (w) => feedback({ wordsDone: w.mobs.length }));
    for (const m of waves.flatMap((w) => w.mobs)) {
      // Frost pups and cave bats carry snow words. Food has too few words: the lesson's instead.
      const from = m.mobId === "slimeling" ? LESSON : SNOW;
      expect(from.items).toContain(m.word);
    }
  });

  it("keeps to the learner's keys: home row only", () => {
    const waves = night(
      options({ allowed: HOME_ROW, pools: [SNOW, HOME], lessonPools: [HOME], band: "sprout" }),
      4,
      (w) => feedback({ wordsDone: w.mobs.length }),
    );
    const home = new Set(HOME_ROW);
    for (const m of waves.flatMap((w) => w.mobs)) {
      expect(typeable(m.word, home)).toBe(true);
    }
  });

  it("avoids the first letter of the mobs still walking when it can, and repeats within a wave", () => {
    const waves = night(options(), 6, (w) => feedback({ wordsDone: w.mobs.length }));
    let clashes = 0;
    let pairs = 0;
    for (const w of waves) {
      w.mobs.forEach((m, i) => {
        for (const prev of w.mobs.slice(Math.max(0, i - C.travelFactor), i)) {
          pairs++;
          if (prev.word.charAt(0) === m.word.charAt(0)) clashes++;
        }
      });
      const words = w.mobs.map((m) => m.word);
      expect(new Set(words).size).toBeGreaterThanOrEqual(Math.min(words.length, 8));
    }
    expect(clashes / pairs).toBeLessThan(0.1);
  });

  it("never hands out a phrase, even when the lesson's pools are phrase lists", () => {
    const phrases: WordPool = {
      id: "phrases",
      band: "all",
      tags: ["kind=phrases", "case=lower"],
      items: ["a big cat", "the red hen", "go home"],
    };
    const waves = night(
      options({
        mobs: [{ id: "x", speedClass: "slow", flavor: "theme=none" }],
        pools: [],
        lessonPools: [phrases],
      }),
      3,
      (w) => feedback({ wordsDone: w.mobs.length }),
    );
    for (const m of waves.flatMap((w) => w.mobs)) {
      expect(m.word).not.toMatch(/\s/);
      expect(m.word.length).toBeGreaterThan(0);
    }
  });

  it("refuses a night with no mobs or no keys", () => {
    expect(() => createDirector(options({ mobs: [] }))).toThrow(/no mobs/);
    expect(() => createDirector(options({ allowed: [" "] }))).toThrow(/no allowed keys/);
  });
});
