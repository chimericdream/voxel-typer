/**
 * The progression study (`tools/sim-progression.ts`, `tools/sim/learner.ts`, task M3-13): the
 * learner's power-law curve, the tool's loaders against the game's, a small deterministic run, and
 * the Phase 3 pin (PLAN.md §8: an average Miner finishes biomes 1–4 in 40–90 sessions). Mine and
 * the tool build sessions with one function, `planLesson` (M3-FIX-11), so there is no copy to
 * check. The full study (docs/sim.md) is behind the tool:
 * `npm run tool -- sim-progression --study --runs 40 --seed 1`.
 */
import { describe, expect, it } from "vitest";
import { lessons } from "../../../src/content/lessons";
import { POOL_IDS, wordPools } from "../../../src/content/wordlists/pools";
import { median } from "../../../src/engine/stats";
import { REMEDIAL_EVERY, REMEDIAL_RULES } from "../../../src/engine/remedial";
import {
  configLabel,
  formatProgression,
  formatTrace,
  loadLessons,
  loadPools,
  parseProgressionArgs,
  playLearnerCurriculum,
  rulesFor,
  scaledProfile,
  simulateProgression,
} from "../../../tools/sim-progression";
import type { ProgressionOptions } from "../../../tools/sim-progression";
import {
  LEARNER_PROFILES,
  createLearner,
  errorChance,
  medianGap,
  practise,
} from "../../../tools/sim/learner";

const data = { lessons, pools: wordPools };
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const base: ProgressionOptions = { runs: 1, seed: 1, max: 40, camps: "take", policy: "game" };

/** A key's slip chance averaged over learners, so one learner's own key draws don't decide it. */
const mean = (key: string): number => {
  let sum = 0;
  for (let s = 0; s < 200; s++)
    sum += errorChance(createLearner(LEARNER_PROFILES.miner.avg, s), key);
  return sum / 200;
};

describe("learner", () => {
  it("follows err0 × (1 + n/τ)^−β on each key", () => {
    const profile = { ...LEARNER_PROFILES.miner.avg, transfer: null };
    const learner = createLearner(profile, 7);
    const start = errorChance(learner, "f");
    for (let i = 0; i < 50; i++) practise(learner, "f");
    const ratio = errorChance(learner, "f") / start;
    expect(ratio).toBeCloseTo((1 + 50 / profile.tau) ** -profile.beta, 10);
    // Practice on one key leaves another key's curve alone (no transfer here).
    expect(errorChance(learner, "j")).toBe(errorChance(createLearner(profile, 7), "j"));
  });

  it("gets quicker with practice, never below the key's floor", () => {
    const learner = createLearner(LEARNER_PROFILES.sprout.slow, 3);
    const first = medianGap(learner, "k");
    for (let i = 0; i < 5000; i++) practise(learner, "k");
    const late = medianGap(learner, "k");
    expect(late).toBeLessThan(first);
    expect(late).toBeGreaterThan(LEARNER_PROFILES.sprout.slow.latFloor * 0.5);
  });

  it("finds the top row harder than the home row, and capitals harder still", () => {
    expect(mean("e")).toBeGreaterThan(mean("d"));
    expect(mean("E")).toBeGreaterThan(mean("e"));
  });
});

describe("the tool's game glue", () => {
  it("loads the same lessons and pools as the game's aggregators", async () => {
    const loaded = await loadLessons();
    expect(loaded.map((l) => l.id).toSorted(byText)).toEqual(
      lessons.map((l) => l.id).toSorted(byText),
    );
    const pools = new Set(loadPools().map((p) => p.id));
    for (const id of POOL_IDS) expect(pools.has(id), id).toBe(true);
  });
});

describe("progression run", () => {
  const miner = playLearnerCurriculum("miner", "avg", 0, { ...base, max: 200 }, data);

  it("finishes the biomes in order, with stars on every play", () => {
    const at = miner.finishedAt;
    expect(at.meadow).toBeDefined();
    expect(at.frosty).toBeDefined();
    expect(at.meadow ?? 0).toBeLessThan(at.birch ?? 0);
    expect(at.birch ?? 0).toBeLessThan(at.shore ?? 0);
    expect(at.shore ?? 0).toBeLessThan(at.frosty ?? 0);
    expect(miner.stars[0]).toBe(0);
    expect(miner.sessions).toBe(at.frosty);
  });

  it("keeps camps at least the rate limit apart", () => {
    const at = miner.camps.map((c) => c.session);
    for (let i = 1; i < at.length; i++) {
      expect((at[i] ?? 0) - (at[i - 1] ?? 0)).toBeGreaterThanOrEqual(REMEDIAL_EVERY);
    }
  });

  it("is deterministic for a seed", () => {
    const opts: ProgressionOptions = { ...base, bands: ["sprout"], paces: ["slow"] };
    const a = formatProgression(simulateProgression(opts, data), opts, lessons);
    const b = formatProgression(simulateProgression(opts, data), opts, lessons);
    expect(a).toBe(b);
    const other = { ...opts, seed: 2 };
    expect(formatProgression(simulateProgression(other, data), other, lessons)).not.toBe(a);
    const trace = { ...parseProgressionArgs(["--trace", "sprout:slow:0", "--max", "20"]) };
    expect(formatTrace(trace, data)).toBe(formatTrace(trace, data));
  });

  it("meets the Phase 3 pin: average Miners finish biomes 1–4 in 40–90 sessions (median)", () => {
    const opts: ProgressionOptions = {
      ...base,
      runs: 5,
      max: 200,
      bands: ["miner"],
      paces: ["avg"],
    };
    const done = simulateProgression(opts, data).map((o) => o.finishedAt.frosty ?? Infinity);
    const mid = median(done) ?? Infinity;
    expect(mid).toBeGreaterThanOrEqual(40);
    expect(mid).toBeLessThanOrEqual(90);
  });

  it("ships the alternate mastery retry: --policy alternate plays as the game does", () => {
    const opts = { ...base, max: 120 };
    const game = playLearnerCurriculum("sprout", "slow", 0, opts, data);
    const alt = playLearnerCurriculum("sprout", "slow", 0, { ...opts, policy: "alternate" }, data);
    expect(alt).toEqual(game);
    const before = playLearnerCurriculum("sprout", "slow", 0, { ...opts, policy: "fewest" }, data);
    expect(before).not.toEqual(game);
  });

  it("passes camps by with --camps skip, and the what-if never touches the game's picks", () => {
    const skip = playLearnerCurriculum(
      "miner",
      "avg",
      0,
      { ...base, max: 200, camps: "skip" },
      data,
    );
    expect(skip.camps).toEqual([]);
    expect(skip.offers).toBeGreaterThan(0);
    const fast = playLearnerCurriculum("builder", "fast", 0, { ...base, max: 200 }, data);
    const what = playLearnerCurriculum(
      "builder",
      "fast",
      0,
      { ...base, max: 200, policy: "mastery-first" },
      data,
    );
    // A fast Builder passes every mastery first time, so the what-if changes nothing.
    expect(what).toEqual(fast);
  });
});

describe("parseProgressionArgs", () => {
  it("has defaults and rejects bad flags", () => {
    expect(parseProgressionArgs([])).toMatchObject({
      runs: 40,
      seed: 1,
      max: 300,
      camps: "take",
      policy: "game",
      study: false,
      trace: null,
    });
    expect(parseProgressionArgs(["--study", "--runs", "5"])).toMatchObject({
      study: true,
      runs: 5,
    });
    expect(() => parseProgressionArgs(["--camps", "maybe"])).toThrow();
    expect(() => parseProgressionArgs(["--trace", "adult:slow:0"])).toThrow();
    expect(() => parseProgressionArgs(["--bogus", "1"])).toThrow();
    expect(() => parseProgressionArgs(["--policy", "sometimes"])).toThrow();
    expect(() => parseProgressionArgs(["--err-scale", "-1"])).toThrow();
    expect(() => parseProgressionArgs(["--sprout-speed", "maybe"])).toThrow();
  });

  it("reads the policy, the learner scales and the camp rules", () => {
    const args = parseProgressionArgs([
      "--policy",
      "alternate",
      "--err-scale",
      "0.7",
      "--lat-scale",
      "1.3",
      "--relative",
      "2",
      "--every",
      "3",
      "--sprout-speed",
      "off",
      "--sweep",
    ]);
    expect(args).toMatchObject({
      policy: "alternate",
      errScale: 0.7,
      latScale: 1.3,
      remedial: { relative: 2, every: 3 },
      sproutSpeed: false,
      sweep: true,
    });
    expect(rulesFor("miner", args)).toEqual({ ...REMEDIAL_RULES, relative: 2, every: 3 });
    expect(rulesFor("sprout", args).speed).toBe(false);
    expect(rulesFor("miner", {})).toEqual(REMEDIAL_RULES);
    expect(configLabel(args)).toContain("err0 ×0.7");
    const p = scaledProfile(LEARNER_PROFILES.sprout.slow, args);
    expect(p.err0).toBeCloseTo(LEARNER_PROFILES.sprout.slow.err0 * 0.7, 10);
    expect(p.lat0).toBeCloseTo(LEARNER_PROFILES.sprout.slow.lat0 * 1.3, 10);
  });
});
