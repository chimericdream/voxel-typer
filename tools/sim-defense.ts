/**
 * Night Defense wave simulator (task M4-05, PLAN.md §3.2.2, §8 Phase 4).
 *
 *   npm run tool -- sim-defense --runs 50 --waves 10 --seed 1
 *   npm run tool -- sim-defense --runs 100 --seed 2 --slow 1   (also the 5 WPM rows, M4-FIX-3)
 *
 * Plays nights of Defense with M1-07's synthetic typists (`tools/sim/typist.ts`) at 10, 25 and 50
 * WPM, through the real wave director (`src/modes/defense/director.ts`) and the real typing engine
 * in `lockOn` targeting. Each learner first plays a short Mine-like session, whose net WPM and
 * accuracy are the baselines the director starts from, as the game's would be. The report gives, per row,
 * the median over learners of each wave's accuracy, reached-base share and difficulty.
 *
 * **The defense typist.** M1-07's typist errs at a fixed rate, whatever the pace, so on its own
 * nothing the director does could move its accuracy. Real children make more slips when they rush
 * (the speed–accuracy trade-off), so this sim adds a plain pressure model on top:
 *
 * - `pressure` = the most urgent "work left ÷ time left" over the mobs on the field: for each mob,
 *   in the order they will reach the base, the typing time of its word and every word before it
 *   (at the typist's median gap, plus a read delay per word), over the time until it arrives.
 *   Above 1 the typist can't save every mob.
 * - Each key's slip chance is M1-07's chance plus `slope × max(0, pressure − p0)` (capped at 0.9),
 *   (the extra capped at `maxExtra`), and its gap shrinks by up to `rush` (rushing). Defaults
 *   ({@link DEFAULT_PRESSURE}): `p0 = 0.1`, `slope = 0.4`, `maxExtra = 0.2`, `rush = 0.15`.
 * - Calm mode: mobs wait at the waiting line (85 % of the lane), so they never reach the base, and
 *   the typist feels half the pressure.
 *
 * **Pacing** is the game's (M4-FIX-2): when the field empties, the wave's next mob (and the rest of
 * the wave with it) is brought forward with the director's `idlePullMs`, and the pause between two
 * waves is its `breakMs`. Events are played in time order, so the sim also measures every stretch
 * of empty field (`idle`): from the moment the last mob still to type was typed or reached the
 * base, to the next spawn.
 *
 * The model is an assumption, not a measurement. The robustness rows rerun the main rows with
 * half and double the slope, to show the controller does not depend on its exact values.
 *
 * Output is a pure function of the arguments: two runs print byte-identical text.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { MOBS } from "../src/content/mobs";
import { poolFromText } from "../src/content/wordlists/loader";
import { generateTargets } from "../src/engine/generator";
import type { WordPool } from "../src/engine/generator";
import { createRng } from "../src/engine/rng";
import type { Rng } from "../src/engine/rng";
import { createSession } from "../src/engine/session";
import { median } from "../src/engine/stats";
import { breakMs, createDirector, idlePullMs } from "../src/modes/defense/director";
import type { DefenseMob, WaveFeedback, WaveSpec } from "../src/modes/defense/director";
import type { AgeBand, Ms } from "../src/types/core";
import {
  TYPIST_PROFILES,
  errorProbability,
  neighborsOf,
  runTypist,
  sampleLatency,
  sampleNoticeDelay,
} from "./sim/typist";
import type { TypistProfile } from "./sim/typist";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The pressure model (see the module comment). */
export interface PressureModel {
  p0: number;
  slope: number;
  /** The most pressure can add to the slip chance. */
  maxExtra: number;
  rush: number;
}
export const DEFAULT_PRESSURE: PressureModel = { p0: 0.1, slope: 0.4, maxExtra: 0.2, rush: 0.15 };

/** Where calm-mode mobs stop, as a share of the lane. */
const WAIT_LINE = 0.85;
/** Calm mode: the share of the pressure the typist feels. */
const CALM_PRESSURE = 0.5;
/** Calm mode: a waiting mob still counts as this far away, so pressure stays finite. */
const CALM_FLOOR_MS = 1500;
/** Seeing a new word and finding its first key: this long plus one median gap. */
const READ_MS = 500;
/** A wave that takes this many keys is cut short (a stuck typist). */
const MAX_KEYS = 20_000;

/**
 * The typists of the card: M1-07's `slow`, `avg` and `fast` profiles at exactly 10, 25 and 50 WPM
 * (their error rates, jitter and learning as M1-07 set them).
 */
export const DEFENSE_TYPISTS: Readonly<Record<string, TypistProfile>> = {
  "10wpm": { ...TYPIST_PROFILES.slow, wpm: 10 },
  "25wpm": { ...TYPIST_PROFILES.avg, wpm: 25 },
  "50wpm": { ...TYPIST_PROFILES.fast, wpm: 50 },
};

/**
 * More typists for the pacing check (M4-FIX-2): the card's range is 5–60 WPM. Not in the main
 * report, whose rows the convergence pins read.
 */
export const PACING_TYPISTS: Readonly<Record<string, TypistProfile>> = {
  "5wpm": { ...TYPIST_PROFILES.slow, wpm: 5 },
  ...DEFENSE_TYPISTS,
  "40wpm": { ...TYPIST_PROFILES.fast, wpm: 40 },
  "60wpm": { ...TYPIST_PROFILES.fast, wpm: 60 },
};

/**
 * The sim's mobs: the real roster (M4-03), all eight, as on a late-biome night. The Cave Bat's
 * flavor words are capitalised (the Deep Mines teach Shift), so with the sim's lowercase keys it
 * carries the lesson's words, as it would for a learner who hasn't reached the Mines.
 */
export const SIM_MOBS: readonly DefenseMob[] = MOBS;

/** Every word list in `src/content/wordlists/` (not the blocklist), read with `node:fs`. */
export function loadAllPools(): WordPool[] {
  const dir = join(REPO_ROOT, "src/content/wordlists");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".txt") && f !== "blocklist.txt")
    .toSorted()
    .map((f) => poolFromText(f.slice(0, -4), readFileSync(join(dir, f), "utf8")));
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

/** One row of the report: a typist in a band, with or without a baseline, calm or not. */
export interface RowSpec {
  typist: string;
  band: AgeBand;
  calm: boolean;
  /** false: a new profile (no baseline). */
  baseline: boolean;
  pressure: PressureModel;
  label: string;
}

export interface RowResult {
  spec: RowSpec;
  baselineWpm: number;
  /** Per wave: the median over learners. */
  accuracy: number[];
  difficulty: number[];
  /** Mean reached-base share over learners and waves 4 on. */
  reachedLater: number;
  /** Median over learners of each learner's mean accuracy over waves 4 on. */
  learnerMean: number;
  /** Share of learners whose mean accuracy over waves 4 on is in 85–95 %. */
  inBand: number;
  /**
   * Stability, over every learner's waves from wave 4 on (not medians):
   * - `swamped`: the share of waves that went badly for the child, by the director's own relief
   *   marks (accuracy under 75 %, or more than 30 % of the mobs at the base);
   * - `crowded`: the share of waves with more than 20 % of the mobs at the base;
   * - `low`: the share of waves under 85 % accuracy.
   */
  swamped: number;
  crowded: number;
  low: number;
  /** The `swamped` share over waves 1–3: the part of the night every child plays. */
  swampedEarly: number;
  /** The longest stretch of empty field in any learner's night (dawn not counted), in ms. */
  idleMax: Ms;
  /**
   * The longest opening stretch: from the start of the night (the first frame of dusk, when the
   * first wave starts) to its first mob, over every learner.
   */
  openingMax: Ms;
}

/** How a wave starts, and where it reports the empty stretches it measured. */
export interface WavePacing {
  /** How long the field has already been empty when the wave's clock starts. */
  emptyBeforeMs: Ms;
  /** Each stretch of empty field that ended in this wave is pushed here, in ms. */
  idle?: Ms[];
}

export interface DefenseSimOptions {
  runs: number;
  waves: number;
  seed: number;
}

/** Measures a learner's baseline like the game would: a Mine-style word session (no spaces). */
export function measureBaseline(
  profile: TypistProfile,
  pools: readonly WordPool[],
  rng: Rng,
): { netWpm: number; accuracy: number } {
  const targets = generateTargets(
    {
      kind: "words",
      allowed: ALPHABET,
      weights: Object.fromEntries(ALPHABET.map((k) => [k, 1])),
      pools,
      length: { targets: 30 },
      minLen: 3,
      maxLen: 6,
    },
    rng.fork("baseline:words"),
  ).map((t) => ({ ...t, trailingSpace: false }));
  const run = runTypist({
    config: {
      policy: "stay",
      targeting: "sequential",
      caseSensitive: true,
      end: { kind: "targets" },
      mode: "mine",
      seed: 0,
    },
    targets,
    profile,
    rng: rng.fork("baseline:typist"),
  });
  return { netWpm: run.summary.netWpm, accuracy: run.summary.accuracy };
}

interface LiveMob {
  id: string;
  word: string;
  arriveMs: Ms;
}

/**
 * Plays one wave as `profile` would, under the pressure model. Returns the director's feedback.
 * `practice` (attempts per key) is updated in place, so M1-07's learning carries across waves.
 */
export function playWave(
  spec: WaveSpec,
  profile: TypistProfile,
  pressure: PressureModel,
  rng: Rng,
  practice: Record<string, number>,
  pacing: WavePacing = { emptyBeforeMs: 0 },
): WaveFeedback {
  const latencyRng = rng.fork("latency");
  const errorRng = rng.fork("errors");
  const wrongRng = rng.fork("wrongKey");
  const noticeRng = rng.fork("notice");
  const session = createSession(
    {
      policy: "stay",
      targeting: "lockOn",
      caseSensitive: true,
      end: { kind: "manual" },
      mode: "defense",
      seed: 0,
    },
    [],
  );
  const pending = spec.mobs.toSorted((a, b) => a.spawnAtMs - b.spawnAtMs);
  const live = new Map<string, LiveMob>();
  const gap = 12_000 / profile.wpm;
  let next = 0;
  let t: Ms = 0;
  let reached = 0;
  let keys = 0;
  let justErred = false;
  /** How far the wave's spawn clock has been moved forward by an empty field. */
  let shift: Ms = 0;
  /** When the field last emptied, or null while a mob on it still needs typing. */
  let emptySince: Ms | null = -Math.max(0, pacing.emptyBeforeMs);

  const arrival = (spawn: Ms, speed: number): Ms =>
    spawn + ((spec.calm ? WAIT_LINE : 1) * 1000) / speed;
  /** When the next mob sets out, after the empty field has brought it forward. */
  const nextSpawnAt = (): Ms => {
    const m = pending[next];
    if (m === undefined) return Infinity;
    if (emptySince !== null) shift += idlePullMs(m.spawnAtMs - shift - emptySince, 0);
    return m.spawnAtMs - shift;
  };
  const emptied = (at: Ms): void => {
    if (live.size === 0 && emptySince === null) emptySince = at;
  };
  /** Plays spawns and arrivals up to `to`, in time order. */
  const advance = (to: Ms): void => {
    for (;;) {
      const s = nextSpawnAt();
      let first: LiveMob | null = null;
      if (!spec.calm)
        for (const m of live.values()) if (first === null || m.arriveMs < first.arriveMs) first = m;
      const a = first?.arriveMs ?? Infinity;
      if (Math.min(s, a) > to) return;
      if (s <= a) {
        const m = pending[next++];
        if (m === undefined) return;
        if (emptySince !== null) pacing.idle?.push(s - emptySince);
        emptySince = null;
        live.set(m.id, { id: m.id, word: m.word, arriveMs: arrival(s, m.speed) });
        session.addTargets([{ id: m.id, text: m.word, priority: m.spawnAtMs }]);
      } else if (first !== null) {
        session.removeTarget(first.id, a);
        live.delete(first.id);
        reached++;
        emptied(a);
      }
    }
  };
  const pressureAt = (): number => {
    const view = session.view();
    const typed = new Map(view.targets.map((v) => [v.id, v.typed]));
    let work = 0;
    let p = 0;
    for (const m of [...live.values()].toSorted((a, b) => a.arriveMs - b.arriveMs)) {
      const left = Array.from(m.word).length - (typed.get(m.id) ?? 0);
      work += left * gap + (typed.get(m.id) ? 0 : READ_MS + gap);
      const time = spec.calm
        ? Math.max(CALM_FLOOR_MS, m.arriveMs - t)
        : Math.max(1, m.arriveMs - t);
      p = Math.max(p, work / time);
    }
    return spec.calm ? p * CALM_PRESSURE : p;
  };

  for (;;) {
    advance(t);
    // Drop finished mobs.
    for (const v of session.view().targets) if (v.complete && live.delete(v.id)) emptied(t);
    if (live.size === 0) {
      const at = nextSpawnAt();
      if (!Number.isFinite(at)) break;
      t = Math.max(t, at);
      continue;
    }
    if (keys >= MAX_KEYS) break;
    const view = session.view();
    // Triage: the mob that will arrive first among those the typist can still finish in time
    // (its word at the median gap, plus the read delay); with none, the one arriving last.
    const open = [...live.values()]
      .toSorted((a, b) => a.arriveMs - b.arriveMs)
      .flatMap((m) => {
        const v = view.targets.find((x) => x.id === m.id);
        return v === undefined || v.complete ? [] : [{ m, v }];
      });
    const savable = open.find(
      ({ m, v }) =>
        spec.calm || m.arriveMs - t >= (Array.from(v.text).length - v.typed) * gap + READ_MS + gap,
    );
    const target = view.active ?? (savable ?? open.at(-1))?.v ?? null;
    if (target === null) break;
    const expected = Array.from(target.text)[target.typed] ?? "";
    const p = pressureAt();
    const extra = Math.max(0, p - pressure.p0);
    const slip = Math.min(
      0.9,
      errorProbability(profile, expected, practice) + pressure.slope * extra,
    );
    let dt = sampleLatency(profile, latencyRng) * (1 - pressure.rush * Math.min(1, extra));
    if (view.active === null) dt += READ_MS + gap;
    if (justErred) dt += sampleNoticeDelay(noticeRng);
    t += dt;
    advance(t);
    keys++;
    practice[expected] = (practice[expected] ?? 0) + 1;
    if (errorRng.next() < slip) {
      session.feed({ key: wrongRng.pick(neighborsOf(expected)), t, shift: false });
      justErred = true;
    } else {
      session.feed({ key: expected, t, shift: false });
      justErred = false;
    }
  }
  const end = session.end(t).find((e) => e.type === "sessionEnd");
  if (end?.type !== "sessionEnd") throw new Error("playWave: no sessionEnd");
  return {
    accuracy: end.summary.accuracy,
    reachedBase: reached,
    wordsDone: end.summary.targetsCompleted,
    activeMs: end.summary.activeMs,
    pulledMs: shift,
  };
}

/** One learner's night: baseline, then `waves` waves through the director. */
export function playNight(
  spec: RowSpec,
  pools: readonly WordPool[],
  waves: number,
  rng: Rng,
  idle?: Ms[],
  opening?: Ms[],
): { baseline: number; feedback: WaveFeedback[]; difficulty: number[] } {
  const profile = PACING_TYPISTS[spec.typist];
  if (profile === undefined) throw new Error(`unknown typist ${spec.typist}`);
  const bandPools = pools.filter((p) => p.band === spec.band || p.band === "all");
  const lessonPools = bandPools.filter(
    (p) => p.tags.includes("biome=frosty") && p.tags.includes("kind=words"),
  );
  const baseline = measureBaseline(profile, lessonPools, rng.fork("baseline"));
  const director = createDirector({
    band: spec.band,
    baselineNetWpm: spec.baseline ? baseline.netWpm : null,
    baselineAccuracy: spec.baseline ? baseline.accuracy : null,
    calm: spec.calm,
    rng: rng.fork("director"),
    mobs: SIM_MOBS,
    pools: bandPools,
    lessonPools,
    allowed: ALPHABET,
  });
  const practice: Record<string, number> = {};
  const feedback: WaveFeedback[] = [];
  const difficulty: number[] = [];
  for (let w = 0; w < waves; w++) {
    const wave = director.nextWave();
    difficulty.push(wave.difficulty);
    // The first wave starts the night, with the dusk announcement still up; each later one after
    // the game's pause, which ends `maxIdleMs` after the field emptied. The sim's field is empty as
    // a wave ends.
    const emptyBeforeMs = w === 0 ? 0 : breakMs(0, wave.mobs[0]?.spawnAtMs ?? 0);
    const stretches: Ms[] = [];
    const pacing: WavePacing = { emptyBeforeMs, idle: stretches };
    const f = playWave(wave, profile, spec.pressure, rng.fork(`wave:${w}`), practice, pacing);
    idle?.push(...stretches);
    if (w === 0 && stretches[0] !== undefined) opening?.push(stretches[0]);
    feedback.push(f);
    director.observe(f);
  }
  return { baseline: baseline.netWpm, feedback, difficulty };
}

const reachedShare = (f: WaveFeedback): number => {
  const n = f.reachedBase + f.wordsDone;
  return n === 0 ? 0 : f.reachedBase / n;
};
const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
const share = <T>(xs: readonly T[], test: (x: T) => boolean): number =>
  xs.length === 0 ? 0 : xs.filter(test).length / xs.length;

/** The rows the report prints. */
export function reportRows(): RowSpec[] {
  const rows: RowSpec[] = [];
  const P = DEFAULT_PRESSURE;
  const bands: readonly AgeBand[] = ["sprout", "miner", "builder"];
  for (const typist of Object.keys(DEFENSE_TYPISTS))
    for (const band of bands)
      rows.push({ typist, band, calm: false, baseline: true, pressure: P, label: "main" });
  for (const typist of Object.keys(DEFENSE_TYPISTS))
    rows.push({
      typist,
      band: "miner",
      calm: false,
      baseline: false,
      pressure: P,
      label: "new profile",
    });
  for (const typist of Object.keys(DEFENSE_TYPISTS))
    rows.push({ typist, band: "sprout", calm: true, baseline: true, pressure: P, label: "calm" });
  for (const slope of [P.slope / 2, P.slope * 2])
    for (const typist of Object.keys(DEFENSE_TYPISTS))
      rows.push({
        typist,
        band: "miner",
        calm: false,
        baseline: true,
        pressure: { ...P, slope },
        label: `slope ${slope}`,
      });
  return rows;
}

/**
 * The slow learners' rows (M4-FIX-3): a 5 WPM typist in every band, with a baseline, as a new
 * profile, and calm.
 */
export function slowRows(): RowSpec[] {
  const rows: RowSpec[] = [];
  const bands: readonly AgeBand[] = ["sprout", "miner", "builder"];
  for (const [label, calm, baseline] of [
    ["main", false, true],
    ["new profile", false, false],
    ["calm", true, true],
  ] as const)
    for (const band of bands)
      rows.push({ typist: "5wpm", band, calm, baseline, pressure: DEFAULT_PRESSURE, label });
  return rows;
}

/**
 * New profiles (M4-FIX-3 review): every band at 5, 10, 25 and 50 WPM with no baseline. A new
 * profile's first wave is played at a cautious guess, so these rows check it neither swamps the
 * slow learners nor holds the fast ones back.
 */
export function newProfileRows(): RowSpec[] {
  const rows: RowSpec[] = [];
  const bands: readonly AgeBand[] = ["sprout", "miner", "builder"];
  for (const typist of ["5wpm", "10wpm", "25wpm", "50wpm"])
    for (const band of bands)
      rows.push({
        typist,
        band,
        calm: false,
        baseline: false,
        pressure: DEFAULT_PRESSURE,
        label: "new profile",
      });
  return rows;
}

/**
 * The pacing check's rows (M4-FIX-2): every band and every typist of {@link PACING_TYPISTS}, with
 * a baseline, as a new profile, and calm.
 */
export function pacingRows(): RowSpec[] {
  const rows: RowSpec[] = [];
  const bands: readonly AgeBand[] = ["sprout", "miner", "builder"];
  for (const typist of Object.keys(PACING_TYPISTS))
    for (const band of bands)
      for (const [label, calm, baseline] of [
        ["main", false, true],
        ["new profile", false, false],
        ["calm", true, true],
      ] as const)
        rows.push({ typist, band, calm, baseline, pressure: DEFAULT_PRESSURE, label });
  return rows;
}

/** Plays every learner of one row and takes the medians. */
export function simulateRow(
  spec: RowSpec,
  pools: readonly WordPool[],
  opts: DefenseSimOptions,
): RowResult {
  const root = createRng(opts.seed);
  const idle: Ms[] = [];
  const opening: Ms[] = [];
  const nights = Array.from({ length: opts.runs }, (_, r) =>
    playNight(
      spec,
      pools,
      opts.waves,
      root.fork(`${spec.typist}:${spec.band}:run:${r}`),
      idle,
      opening,
    ),
  );
  const perWave = (f: (n: (typeof nights)[number], w: number) => number): number[] =>
    Array.from({ length: opts.waves }, (_, w) => median(nights.map((n) => f(n, w))) ?? 0);
  const means = nights.map((n) => mean(n.feedback.slice(3).map((f) => f.accuracy)));
  const later = nights.flatMap((n) => n.feedback.slice(3));
  return {
    spec,
    baselineWpm: median(nights.map((n) => n.baseline)) ?? 0,
    accuracy: perWave((n, w) => n.feedback[w]?.accuracy ?? 0),
    difficulty: perWave((n, w) => n.difficulty[w] ?? 0),
    reachedLater: mean(nights.flatMap((n) => n.feedback.slice(3).map(reachedShare))),
    learnerMean: median(means) ?? 0,
    inBand: means.filter((m) => m >= 0.85 && m <= 0.95).length / opts.runs,
    swamped: share(later, (f) => f.accuracy < 0.75 || reachedShare(f) > 0.3),
    crowded: share(later, (f) => reachedShare(f) > 0.2),
    low: share(later, (f) => f.accuracy < 0.85),
    swampedEarly: share(
      nights.flatMap((n) => n.feedback.slice(0, 3)),
      (f) => f.accuracy < 0.75 || reachedShare(f) > 0.3,
    ),
    idleMax: Math.max(0, ...idle),
    openingMax: Math.max(0, ...opening),
  };
}

export function simulateDefense(opts: DefenseSimOptions, rows = reportRows()): RowResult[] {
  const pools = loadAllPools();
  return rows.map((r) => simulateRow(r, pools, opts));
}

/** Converged: the median accuracy of wave 4 and of every later wave is in 85–95 %. */
export function converged(r: RowResult): boolean {
  return r.accuracy.slice(3).every((a) => a >= 0.85 && a <= 0.95);
}

const pct0 = (v: number): string => (100 * v).toFixed(0);
const pct1 = (v: number): string => (100 * v).toFixed(1);

export function formatDefense(results: readonly RowResult[], opts: DefenseSimOptions): string {
  const waves = Array.from({ length: opts.waves }, (_, w) => `${w + 1}`);
  const out: string[] = [
    `Defense sim: ${opts.runs} learners per row, ${opts.waves} waves, seed ${opts.seed}.`,
    "Waves 1-N: median accuracy % over learners. Range 4+: lowest and highest of those medians from",
    "wave 4 on. Learner mean 4+: median over learners of their own mean accuracy from wave 4 on; In",
    "band: the share of learners whose mean is in 85-95 %. Reached 4+: mean share of mobs at the base.",
    "Swamped / Crowded / Low 4+: the share of all waves from wave 4 on (every learner, not medians)",
    "that were under 75 % accuracy or had over 30 % of the mobs at the base / had over 20 % of the",
    "mobs at the base / were under 85 % accuracy. Swamped 1-3: the swamped share over waves 1 to 3.",
    "Empty max: the longest stretch with no mob left to type, in any learner's night, in seconds.",
    "",
    `| Row | Typist | Band | Baseline | ${waves.join(" | ")} | Range 4+ | Learner mean 4+ | In band | Reached 4+ | Swamped 4+ | Crowded 4+ | Low 4+ | Swamped 1-3 | Empty max | d first→last | Converged |`,
    `|---|---|---|---:|${waves.map(() => "---:").join("|")}|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|`,
  ];
  for (const r of results) {
    const later = r.accuracy.slice(3);
    const d0 = r.difficulty[0] ?? 0;
    const d1 = r.difficulty.at(-1) ?? 0;
    const cells = [
      r.spec.label,
      r.spec.typist,
      r.spec.band,
      r.spec.baseline ? r.baselineWpm.toFixed(1) : "none",
      ...r.accuracy.map(pct0),
      `${pct1(Math.min(...later))}-${pct1(Math.max(...later))}`,
      pct1(r.learnerMean),
      `${pct0(r.inBand)}%`,
      `${pct1(r.reachedLater)}%`,
      `${pct0(r.swamped)}%`,
      `${pct0(r.crowded)}%`,
      `${pct0(r.low)}%`,
      `${pct0(r.swampedEarly)}%`,
      (r.idleMax / 1000).toFixed(1),
      `${d0.toFixed(2)}→${d1.toFixed(2)}`,
      converged(r) ? "yes" : "no",
    ];
    out.push(`| ${cells.join(" | ")} |`);
  }
  return `${out.join("\n")}\n`;
}

/** One point of the plant sweep: what a typist does at a fixed difficulty (no controller). */
export interface SweepPoint {
  typist: string;
  d: number;
  /** Mean accuracy and mean reached share over learners and waves 3–4. */
  accuracy: number;
  reached: number;
}

/**
 * The plant: each typist at fixed difficulties (`startDifficulty`, no `observe`), 4 waves, the
 * last two measured. Shows where accuracy starts to fall and how steep the fall is.
 */
export function sweepPlant(opts: DefenseSimOptions, band: AgeBand = "miner"): SweepPoint[] {
  const pools = loadAllPools();
  const bandPools = pools.filter((p) => p.band === band || p.band === "all");
  const lessonPools = bandPools.filter(
    (p) => p.tags.includes("biome=frosty") && p.tags.includes("kind=words"),
  );
  const points: SweepPoint[] = [];
  for (const typist of Object.keys(DEFENSE_TYPISTS)) {
    const profile = DEFENSE_TYPISTS[typist];
    if (profile === undefined) continue;
    for (let i = 0; i <= 11; i++) {
      const d = 0.5 + i / 10;
      const acc: number[] = [];
      const reached: number[] = [];
      for (let r = 0; r < opts.runs; r++) {
        const rng = createRng(opts.seed).fork(`sweep:${typist}:${r}`);
        const base = measureBaseline(profile, lessonPools, rng.fork("baseline"));
        const director = createDirector({
          band,
          baselineNetWpm: base.netWpm,
          baselineAccuracy: base.accuracy,
          calm: false,
          rng: rng.fork("director"),
          mobs: SIM_MOBS,
          pools: bandPools,
          lessonPools,
          allowed: ALPHABET,
          startDifficulty: d,
        });
        const practice: Record<string, number> = {};
        for (let w = 0; w < 4; w++) {
          const wave = director.nextWave();
          const f = playWave(wave, profile, DEFAULT_PRESSURE, rng.fork(`wave:${w}`), practice);
          if (w < 2) continue;
          acc.push(f.accuracy);
          reached.push(reachedShare(f));
        }
      }
      points.push({ typist, d, accuracy: mean(acc), reached: mean(reached) });
    }
  }
  return points;
}

export function formatSweep(points: readonly SweepPoint[], opts: DefenseSimOptions): string {
  const ds = [...new Set(points.map((p) => p.d))];
  const out = [
    `Plant sweep (miner band, fixed d, ${opts.runs} learners, waves 3-4): mean accuracy % / reached %`,
    "",
    `| Typist | ${ds.map((d) => `d ${d.toFixed(1)}`).join(" | ")} |`,
    `|---|${ds.map(() => "---:").join("|")}|`,
  ];
  for (const typist of Object.keys(DEFENSE_TYPISTS)) {
    const row = ds.map((d) => {
      const p = points.find((x) => x.typist === typist && x.d === d);
      return p === undefined ? "" : `${pct0(p.accuracy)} / ${pct0(p.reached)}`;
    });
    out.push(`| ${typist} | ${row.join(" | ")} |`);
  }
  return `${out.join("\n")}\n`;
}

export interface DefenseSimArgs extends DefenseSimOptions {
  /** Also print the plant sweep. */
  sweep: boolean;
  /** Also print the 5 WPM rows ({@link slowRows}) and the new profiles ({@link newProfileRows}). */
  slow: boolean;
}

export function parseDefenseArgs(args: readonly string[]): DefenseSimArgs {
  const opts: DefenseSimArgs = { runs: 50, waves: 10, seed: 1, sweep: false, slow: false };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = Number(args[i + 1]);
    if (!Number.isInteger(value) || value < 0)
      throw new Error(`${flag ?? ""} needs a whole number`);
    if (flag === "--runs") opts.runs = Math.max(1, value);
    else if (flag === "--waves") opts.waves = Math.max(4, value);
    else if (flag === "--seed") opts.seed = value;
    else if (flag === "--sweep") opts.sweep = value !== 0;
    else if (flag === "--slow") opts.slow = value !== 0;
    else throw new Error(`unknown flag ${flag ?? ""}`);
  }
  return opts;
}

if (resolve(argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const opts = parseDefenseArgs(argv.slice(2));
  process.stdout.write(formatDefense(simulateDefense(opts), opts));
  if (opts.slow) {
    const rows = [...slowRows(), ...newProfileRows().filter((r) => r.typist !== "5wpm")];
    process.stdout.write(`\n${formatDefense(simulateDefense(opts, rows), opts)}`);
  }
  if (opts.sweep) process.stdout.write(`\n${formatSweep(sweepPlant(opts), opts)}`);
}
