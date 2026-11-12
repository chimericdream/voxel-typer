/**
 * Night Defense's wave director (task M4-05, PLAN.md §3.2.2, §8 Phase 4).
 *
 * Pure: no DOM, no three.js, no clock, no global randomness. Every random draw comes from the
 * `rng` passed in, and time is only ever an offset inside a wave (`spawnAtMs`). Night Defense
 * (M4-04) asks for a wave, plays it, tells the director how it went, and asks for the next one.
 *
 * **The controller.** One difficulty scalar `d ∈ [0.3, 2.0]` sets the pace of a wave against the
 * learner's reference speed (their baseline net WPM, or a slow default for a new profile). At
 * `d = 1` a mob spawns about every "reaction + word at the reference speed", and walks its lane in
 * three of those. Lower `d` spreads mobs out and slows them; higher `d` mostly makes them walk
 * faster (see {@link mobTiming}). After each wave the director moves `d`:
 *
 * 1. `step = k × (accuracy − 0.90)`, where `accuracy` is a words-weighted average of the recent
 *    waves (each wave counts half as much as the one after it).
 * 2. If more than 10 % of the wave's mobs reached the base, `step ≤ −1.5 × (share − 0.10)`: a
 *    learner who is accurate but can't keep up still gets slower waves.
 * 3. Search, then fine: until the first wave at or under 90 % (or with too many mobs at the base),
 *    `k = 2.5` and steps are within ±15 %. From then on the learner's edge is close: `k = 1`, steps
 *    within −8 % / +5 %. Near their edge a child's accuracy falls fast with pace, so big steps
 *    there would swing between too easy and swamped.
 * 4. Relief: a wave under 75 % accuracy, or with more than 30 % of its mobs at the base, makes the
 *    next wave 15 % easier, whatever the average says.
 * 5. `d ← clamp(d × (1 + step), 0.3, 2.0)` (calm: at most 1.2, and at most +8 % a wave).
 *
 * `tools/sim-defense.ts` and `docs/sim.md` show how this behaves with synthetic typists.
 *
 * **Calm mode** (on by default for Sprouts) asks for a slower pace, a lower ceiling and gentler
 * steps up, and marks the wave `calm` so the mode makes mobs wait at the waiting line. Nothing
 * here is a timer the child sees: `spawnAtMs` and `speed` only drive the scene.
 *
 * **No failure.** The director only plans waves. A wave that went badly makes the next one easier;
 * nothing it returns can take anything away from the child (M4-10).
 */
import type { WordPool } from "@/engine/generator";
import { generateTargets, typeable } from "@/engine/generator";
import type { Rng } from "@/engine/rng";
import type { AgeBand, Ms } from "@/types/core";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lengthOf = (text: string): number => Array.from(text).length;

/** How fast a kind of mob walks, before the wave's pace. */
export type SpeedClass = "slow" | "medium" | "fast";

/**
 * A mob the director may send, as the mob content (M4-03) describes it. `flavor` is a word-pool
 * tag, written as it appears on the pools (`theme=snow`, `theme=animals`, `biome=frosty`).
 */
export interface DefenseMob {
  readonly id: string;
  readonly speedClass: SpeedClass;
  readonly flavor: string;
}

/** One mob of a wave. */
export interface WaveMob {
  /** Unique within the night: `w<wave>-m<n>`. Use it as the typing target's id. */
  readonly id: string;
  /** Which creature (a {@link DefenseMob} id). */
  readonly mobId: string;
  /** Lane, `0 … lanes − 1`. */
  readonly lane: number;
  /** When it appears at the far end of its lane, from the start of the wave. */
  readonly spawnAtMs: Ms;
  /** Lane lengths per second: `1 / speed` seconds from the horizon to the base. */
  readonly speed: number;
  /** The word it carries: one word, no spaces, only allowed keys. It completes on its last char. */
  readonly word: string;
}

/** A planned wave. The mode plays `mobs` in `spawnAtMs` order. */
export interface WaveSpec {
  /** 0 for the first wave of the night. */
  readonly index: number;
  /** How many lanes this wave uses (Sprout 2–3, Miner 3–4, Builder 4–5). */
  readonly lanes: number;
  /** Calm mode: mobs stop at the waiting line and wait until their word is typed. */
  readonly calm: boolean;
  /** The difficulty the wave was planned at. */
  readonly difficulty: number;
  /** The typing speed the wave asks for, in WPM (for tests and the dev overlay, never the child). */
  readonly paceWpm: number;
  readonly mobs: readonly WaveMob[];
}

/** What the mode reports after a wave. */
export interface WaveFeedback {
  /** Accuracy of the wave's keystrokes, 0–1 (`correct / keystrokes`, lockOn misses included). */
  readonly accuracy: number;
  /** Mobs that reached the base. Always 0 in calm mode. */
  readonly reachedBase: number;
  /** Mobs whose word was typed. */
  readonly wordsDone: number;
  /** Active (unpaused) time of the wave. */
  readonly activeMs: Ms;
}

export interface DirectorOptions {
  band: AgeBand;
  /** The profile's baseline net WPM (contracts §6), or null for a new profile. */
  baselineNetWpm: number | null;
  calm: boolean;
  rng: Rng;
  /** The night's mobs. At least one. */
  mobs: readonly DefenseMob[];
  /** Every word pool for the band. A mob's `flavor` picks its pools from these by tag. */
  pools: readonly WordPool[];
  /** The lesson's own pools: used for a mob whose flavor pools have too few typeable words. */
  lessonPools: readonly WordPool[];
  /** The keys the learner knows (`allowedKeysFor`, contracts §6). Words use only these. */
  allowed: readonly string[];
  /** `keyWeights` (contracts §4). Default: every allowed key weighs 1. */
  weights?: Record<string, number>;
  /** Start here instead of the default (e.g. the last wave's `difficulty` of an earlier night). */
  startDifficulty?: number;
}

export interface Director {
  nextWave(): WaveSpec;
  observe(feedback: WaveFeedback): void;
  /** The current difficulty scalar. */
  readonly difficulty: number;
}

/** Tuning. Exported for tests and the simulator; `docs/sim.md` records why they are what they are. */
export const DIRECTOR_CONSTANTS = {
  dMin: 0.3,
  dMax: 2.0,
  /** Calm mode's ceiling. */
  calmDMax: 1.2,
  /** Start: `d` with a baseline, and with a new profile (on top of the slow default reference). */
  startD: 0.8,
  newProfileStartD: 0.7,
  /** Reference WPM for a profile with no baseline: on the slow side for each band. */
  defaultBaselineWpm: { sprout: 5, miner: 10, builder: 15 } satisfies Record<AgeBand, number>,
  /** A baseline is clamped into this range before use. */
  baselineClampWpm: { min: 2, max: 120 },
  /** The accuracy the controller aims at: the middle of the 85–95 % band. */
  accuracyTarget: 0.9,
  /** Search mode: step per unit of accuracy error (0.05 off target is a 12.5 % step). */
  kAccuracy: 2.5,
  /** A wave's reached-base share above which the step is pulled down, and the gain of that pull. */
  reachedAim: 0.1,
  kReached: 1.5,
  /** Largest change of `d` per wave, down and up (calm: up only {@link calmMaxStepUp}). */
  maxStep: 0.15,
  /** Fine mode (see {@link ControllerState.fine}): gain and largest steps up and down. */
  kAccuracyFine: 1,
  fineMaxStepUp: 0.05,
  fineMaxStepDown: 0.08,
  calmMaxStepUp: 0.08,
  /**
   * Memory of the smoothed accuracy: each wave, the older waves count this much less. Waves are
   * weighted by their words done, so a short wave counts less. One wave is only 30–100 keys, so a
   * single wave's accuracy is noisy (±3–5 points).
   */
  memory: 0.5,
  /**
   * Relief: a wave this bad on its own (accuracy below, or reached share above) makes the next one
   * a full step easier, whatever the average says.
   */
  reliefAccuracy: 0.75,
  reliefReached: 0.3,
  /** A wave with less active time than this tells nothing about accuracy. */
  minActiveMs: 2000,
  /** Calm mode asks for this share of the pace. */
  calmPace: 0.75,
  /**
   * How long a wave's spawns last: about this long per band, plus {@link waveGrowthMs} per wave
   * up to the fourth. A fast learner gets more mobs in that time and a slow one fewer, so every
   * wave holds enough keys to measure, and no wave drags on.
   */
  waveMs: { sprout: 20_000, miner: 25_000, builder: 30_000 } satisfies Record<AgeBand, Ms>,
  waveGrowthMs: 3000,
  waveGrowthWaves: 3,
  /** Mobs per wave, whatever the time says. Calm mode has at most {@link calmMaxMobs}. */
  mobsPerWave: { min: 3, max: 18 },
  calmMaxMobs: 10,
  /** Lanes per band: the first below `d = 1`, the second from it. */
  lanes: { sprout: [2, 3], miner: [3, 4], builder: [4, 5] } satisfies Record<
    AgeBand,
    readonly [number, number]
  >,
  /** Word lengths per band (code points). */
  wordLength: {
    sprout: { min: 2, max: 4 },
    miner: { min: 3, max: 6 },
    builder: { min: 4, max: 8 },
  } satisfies Record<AgeBand, { min: number; max: number }>,
  /** Time to see a new word and find its first key, added to its typing time. */
  reactionMs: { sprout: 1400, miner: 900, builder: 650 } satisfies Record<AgeBand, Ms>,
  /** The first mob of a wave appears this long after the wave starts. */
  firstSpawnMs: 1200,
  /** At `d = 1`, travel time = this many times a mob's base work (reaction + typing). */
  travelFactor: 3,
  /**
   * How the time scale `k` (`d`, times `calmPace` in calm mode) moves the spawn gap and the travel
   * time. Below `k = 1` the gap is `base / k`: fewer mobs for a learner who needs it. From `k = 1`
   * it is `base / k^a`, while travel is `travelFactor × base / k^b` throughout. So above the
   * learner's own pace a higher `d` mostly asks for quicker words (each mob has less time), not
   * for many more words a minute. More words than the learner can type would swamp them: every
   * slip costs time, which brings more pressure and more slips.
   */
  spawnExponent: 0.3,
  speedExponent: 1.5,
  /** Travel time is kept inside this range, so mobs never dash or crawl. */
  travelMs: { min: 4000, max: 40_000 },
  speedMult: { slow: 0.8, medium: 1, fast: 1.25 } satisfies Record<SpeedClass, number>,
  /** A flavor needs this many typeable words before it is used instead of the lesson's pools. */
  minFlavorWords: 8,
  /** Candidate words generated per mob, so first letters can differ. */
  candidatesPerMob: 3,
} as const;

const C = DIRECTOR_CONSTANTS;

/** The difficulty a night starts at. */
export function startDifficulty(
  opts: Pick<DirectorOptions, "baselineNetWpm" | "startDifficulty">,
): number {
  if (opts.startDifficulty !== undefined && Number.isFinite(opts.startDifficulty))
    return clamp(opts.startDifficulty, C.dMin, C.dMax);
  return hasBaseline(opts.baselineNetWpm) ? C.startD : C.newProfileStartD;
}

const hasBaseline = (wpm: number | null): wpm is number =>
  wpm !== null && Number.isFinite(wpm) && wpm > 0;

/** The WPM that `d = 1` stands for: the baseline, or the band's slow default. */
export function referenceWpm(band: AgeBand, baselineNetWpm: number | null): number {
  return hasBaseline(baselineNetWpm)
    ? clamp(baselineNetWpm, C.baselineClampWpm.min, C.baselineClampWpm.max)
    : C.defaultBaselineWpm[band];
}

/** Controller memory: `d`, the forgetful sums behind the smoothed accuracy, and the mode. */
export interface ControllerState {
  readonly d: number;
  /** Σ accuracy × words done, and Σ words done, each times {@link DIRECTOR_CONSTANTS.memory} per wave. */
  readonly accSum: number;
  readonly accWeight: number;
  /**
   * Fine mode: a wave has come in at or under the target (or with too many mobs at the base), so
   * the learner's edge is near and steps are small from now on.
   */
  readonly fine: boolean;
}

export const initialControllerState = (d: number): ControllerState => ({
  d,
  accSum: 0,
  accWeight: 0,
  fine: false,
});

/** A count from the mode: non-finite or negative counts as 0. */
const countOf = (v: number): number => (Number.isFinite(v) ? Math.max(0, v) : 0);

/** The smoothed accuracy, or null before any wave has counted. */
export function smoothedAccuracy(s: Pick<ControllerState, "accSum" | "accWeight">): number | null {
  return s.accWeight > 0 ? s.accSum / s.accWeight : null;
}

/**
 * One controller step (see the module comment): folds a wave's feedback into the smoothed accuracy
 * and moves `d`. A wave in which no mob was resolved leaves the state as it was. Non-finite or
 * negative counts count as 0 and a non-finite accuracy is left out of the average, so bad input
 * never throws and never pushes `d` out of its bounds.
 */
export function controllerStep(
  s: ControllerState,
  f: WaveFeedback,
  calm: boolean,
): ControllerState {
  const done = countOf(f.wordsDone);
  const reached = countOf(f.reachedBase);
  const resolved = done + reached;
  if (resolved === 0) return s;
  // A wave with no words done, or hardly any typing, says nothing about accuracy.
  const accCounts = done > 0 && Number.isFinite(f.accuracy) && countOf(f.activeMs) >= C.minActiveMs;
  const acc = accCounts ? clamp(f.accuracy, 0, 1) : null;
  const accSum = C.memory * s.accSum + (acc === null ? 0 : acc * done);
  const accWeight = C.memory * s.accWeight + (acc === null ? 0 : done);
  const accuracy = smoothedAccuracy({ accSum, accWeight });
  const share = reached / resolved;

  const fine = s.fine || (acc !== null && acc <= C.accuracyTarget) || share > C.reachedAim;
  let step =
    accuracy === null ? 0 : (fine ? C.kAccuracyFine : C.kAccuracy) * (accuracy - C.accuracyTarget);
  if (share > C.reachedAim) step = Math.min(step, -C.kReached * (share - C.reachedAim));
  const up = Math.min(calm ? C.calmMaxStepUp : C.maxStep, fine ? C.fineMaxStepUp : C.maxStep);
  step = clamp(step, fine ? -C.fineMaxStepDown : -C.maxStep, up);
  if ((acc !== null && acc < C.reliefAccuracy) || share > C.reliefReached) step = -C.maxStep;
  const d = clamp(s.d * (1 + step), C.dMin, calm ? C.calmDMax : C.dMax);
  return { d, accSum, accWeight, fine };
}

/** The typing speed a wave asks for. */
export function paceWpm(reference: number, d: number, calm: boolean): number {
  return reference * d * (calm ? C.calmPace : 1);
}

/** Lanes a wave uses. */
export function laneCount(band: AgeBand, d: number): number {
  const [low, high] = C.lanes[band];
  return d < 1 ? low : high;
}

/**
 * How many mobs wave `index` sends: its spawn time ({@link DIRECTOR_CONSTANTS.waveMs}) over the
 * spawn gap of a middle-length word at this difficulty.
 */
export function waveSize(
  band: AgeBand,
  index: number,
  reference: number,
  d: number,
  calm: boolean,
): number {
  const len = C.wordLength[band];
  const scale = d * (calm ? C.calmPace : 1);
  const { gapMs } = mobTiming(band, (len.min + len.max) / 2, reference, scale, "medium");
  const ms = C.waveMs[band] + C.waveGrowthMs * Math.min(Math.max(0, index), C.waveGrowthWaves);
  const max = calm ? C.calmMaxMobs : C.mobsPerWave.max;
  return clamp(Math.round(ms / gapMs) + 1, C.mobsPerWave.min, max);
}

/**
 * How likely each speed class is at difficulty `d`: slow mobs always, medium ones from about
 * `d = 0.5`, fast ones from about `d = 1`. Calm mode halves the fast ones.
 */
export function speedClassWeight(cls: SpeedClass, d: number, calm: boolean): number {
  if (cls === "slow") return 1;
  if (cls === "medium") return clamp((d - 0.3) / 0.4, 0.25, 1);
  return clamp((d - 0.7) / 0.5, 0.1, 1) * (calm ? 0.5 : 1);
}

/**
 * Timing of one mob. `base` is what the learner needs at their reference speed: a reaction time
 * plus the word at `reference` WPM. `scale` is the wave's time scale (`d`, times
 * {@link DIRECTOR_CONSTANTS.calmPace} in calm mode).
 *
 * - The next mob spawns `gapMs` later: `base / scale` below 1, `base / scale^spawnExponent` from 1.
 * - The mob walks its lane in `travelFactor × base / scale^speedExponent` (faster for a fast mob,
 *   slower for a slow one), kept inside {@link DIRECTOR_CONSTANTS.travelMs}.
 */
export function mobTiming(
  band: AgeBand,
  wordLength: number,
  reference: number,
  scale: number,
  cls: SpeedClass,
): { gapMs: Ms; speed: number } {
  const baseMs = C.reactionMs[band] + (wordLength * 12_000) / Math.max(0.1, reference);
  const k = Math.max(0.01, scale);
  const gapMs = baseMs / (k < 1 ? k : k ** C.spawnExponent);
  const travel = clamp(
    (C.travelFactor * baseMs) / k ** C.speedExponent / C.speedMult[cls],
    C.travelMs.min,
    C.travelMs.max,
  );
  return { gapMs, speed: 1000 / travel };
}

/** Pools of single words (not phrases or sentences). */
const wordKind = (p: WordPool): boolean =>
  !p.tags.some((t) => t.startsWith("kind=") && t !== "kind=words");

/** The pools a flavor stands for: word pools carrying its tag. */
export function flavorPools(pools: readonly WordPool[], flavor: string): WordPool[] {
  return pools.filter((p) => p.tags.includes(flavor) && wordKind(p));
}

/** Pool items that would make a good mob word: one word, typeable, the right length. */
export function usableWords(
  pools: readonly WordPool[],
  allowed: ReadonlySet<string>,
  len: { min: number; max: number },
): number {
  const seen = new Set<string>();
  for (const p of pools)
    for (const item of p.items) {
      const n = lengthOf(item);
      if (!item.includes(" ") && n >= len.min && n <= len.max && typeable(item, allowed))
        seen.add(item);
    }
  return seen.size;
}

/** Builds a wave director. Deterministic for the same options and rng seed. */
export function createDirector(opts: DirectorOptions): Director {
  if (opts.mobs.length === 0) throw new Error("createDirector: no mobs");
  if (!opts.allowed.some((k) => k !== " ")) throw new Error("createDirector: no allowed keys");
  const { band, calm, rng } = opts;
  const reference = referenceWpm(band, opts.baselineNetWpm);
  const allowedSet = new Set(opts.allowed);
  const weights =
    opts.weights ?? Object.fromEntries(opts.allowed.filter((k) => k !== " ").map((k) => [k, 1]));
  const len = C.wordLength[band];
  const lessonPools = opts.lessonPools.filter(wordKind);

  // Which pools each flavor draws from: its own when it has enough typeable words, else the
  // lesson's (learning first: the lesson's words still practise the right keys).
  const poolsByFlavor = new Map<string, readonly WordPool[]>();
  for (const mob of opts.mobs) {
    if (poolsByFlavor.has(mob.flavor)) continue;
    const own = flavorPools(opts.pools, mob.flavor);
    poolsByFlavor.set(
      mob.flavor,
      usableWords(own, allowedSet, len) >= C.minFlavorWords ? own : lessonPools,
    );
  }

  let state = initialControllerState(
    clamp(startDifficulty(opts), C.dMin, calm ? C.calmDMax : C.dMax),
  );
  let index = 0;

  function wordsFor(flavor: string, count: number, waveRng: Rng): string[] {
    const generate = (kind: "words" | "syllables"): string[] =>
      generateTargets(
        {
          kind,
          allowed: opts.allowed,
          weights,
          pools: poolsByFlavor.get(flavor) ?? lessonPools,
          length: { targets: count * C.candidatesPerMob },
          minLen: len.min,
          maxLen: len.max,
        },
        waveRng.fork(`${kind}:${flavor}`),
      )
        .map((t) => t.text)
        .filter((w) => w !== "" && !w.includes(" "));
    // The generator already falls back to syllables when no pool word is typeable. This covers
    // the rest (a key set too small for any word of the band's length).
    const words = generate("words");
    return words.length > 0 ? words : generate("syllables");
  }

  function nextWave(): WaveSpec {
    const d = state.d;
    const waveRng = rng.fork(`wave:${index}`);
    const pace = paceWpm(reference, d, calm);
    const timeScale = d * (calm ? C.calmPace : 1);
    const lanes = laneCount(band, d);
    const count = waveSize(band, index, reference, d, calm);

    const pickRng = waveRng.fork("mobs");
    const mobWeights = opts.mobs.map((m) => speedClassWeight(m.speedClass, d, calm));
    const chosen = Array.from({ length: count }, () => pickRng.weightedPick(opts.mobs, mobWeights));

    const pending = new Map<string, string[]>();
    for (const flavor of new Set(chosen.map((m) => m.flavor))) {
      const n = chosen.filter((m) => m.flavor === flavor).length;
      pending.set(flavor, wordsFor(flavor, n, waveRng));
    }

    const laneRng = waveRng.fork("lanes");
    const mobs: WaveMob[] = [];
    const used = new Set<string>();
    let t = C.firstSpawnMs;
    let prevLane = -1;
    for (const [i, mob] of chosen.entries()) {
      // Mobs still walking when this one spawns: about `travelFactor` before it. Their words
      // should start with other letters, so the first key picks one mob (lockOn).
      const onField = mobs.slice(-C.travelFactor).map((m) => m.word.charAt(0));
      const word = pickWord(pending.get(mob.flavor) ?? [], used, onField);
      used.add(word);
      const { gapMs, speed } = mobTiming(
        band,
        lengthOf(word),
        reference,
        timeScale,
        mob.speedClass,
      );
      const others = Array.from({ length: lanes }, (_, l) => l).filter((l) => l !== prevLane);
      const lane = laneRng.pick(others.length > 0 ? others : [0]);
      prevLane = lane;
      mobs.push({
        id: `w${index}-m${i}`,
        mobId: mob.id,
        lane,
        spawnAtMs: Math.round(t),
        speed,
        word,
      });
      t += gapMs;
    }
    const spec: WaveSpec = { index, lanes, calm, difficulty: d, paceWpm: pace, mobs };
    index += 1;
    return spec;
  }

  return {
    nextWave,
    observe(feedback: WaveFeedback): void {
      state = controllerStep(state, feedback, calm);
    },
    get difficulty(): number {
      return state.d;
    },
  };
}

/**
 * Takes a word from `candidates` (in generator order): the first one not used yet in the wave
 * whose first letter no mob on the field shares, else the first unused one, else the first.
 */
function pickWord(
  candidates: readonly string[],
  used: ReadonlySet<string>,
  onField: readonly string[],
): string {
  const fresh = candidates.find((w) => !used.has(w) && !onField.includes(w.charAt(0)));
  const word = fresh ?? candidates.find((w) => !used.has(w)) ?? candidates[0];
  if (word === undefined) throw new Error("createDirector: the generator gave no words");
  return word;
}
