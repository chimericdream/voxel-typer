/**
 * Synthetic learner for the progression study (task M3-13, PLAN.md §8 Phase 3, §9.3).
 *
 * M1-07's typist (`./typist.ts`) types every key alike and learns by one global rule. A child
 * meeting a curriculum doesn't: a key they met today is slow and slippy, a key they have pressed a
 * thousand times is quick and sure. This learner keeps a practice count per key and follows a
 * power-law learning curve on each:
 *
 * ```
 * err_k(n) = err0_k × (1 + n / τ)^−β                       chance that key k goes wrong
 * lat_k(n) = floor_k + (lat0_k − floor_k) × (1 + n / τ)^−βLat   its median gap, in ms
 * ```
 *
 * `n` is the key's earlier attempts (every press aimed at it, in any session). `err0_k` and `lat0_k`
 * are the learner's starting error and gap for that key: the profile's base value × the key's
 * {@link keyClass} (home row easiest, then top row, bottom row, digits; pinkies a little worse) ×
 * the learner's own draw for that key (lognormal, σ = `keySpread`), so every learner has a few keys
 * that are weaker than the rest. With `transfer`, a key met later starts a little easier, because
 * the child already knows how to learn a key: `err0` and `lat0 − floor` are scaled by
 * `(1 + N / transfer.tau)^−transfer.beta`, N being every press so far.
 *
 * A capital costs a Shift chord: `HARD_SHIFT` more slips and a slower gap, as in M3-FIX-3's
 * placement typist. "No Peeking!" (a lesson tagged `challenge-hide-keyboard`, for a learner whose
 * band shows the on-screen keyboard) multiplies the slip chance by {@link NO_PEEK_ERROR}.
 *
 * Every number here is an assumption, chosen from what children of each age type like (rough
 * 2nd/4th/7th-grade figures: about 5–8, 10–15 and 20–30 WPM after practice, 85–95 % accuracy), and
 * **not tuned to make the curriculum pass**. docs/sim.md has the table.
 *
 * Pure: no clock, no global randomness. Each learner's per-key draws come from its seed and the key
 * alone, so they don't depend on the order keys are met.
 */
import { createRng, hashString } from "../../src/engine/rng";
import type { Rng } from "../../src/engine/rng";
import { createSession } from "../../src/engine/session";
import type { SessionSummary } from "../../src/engine/stats";
import type { EngineEvent, SessionConfig, Target, TargetView } from "../../src/engine/types";
import type { AgeBand, Ms } from "../../src/types/core";
import { neighborsOf, sampleNoticeDelay } from "./typist";

/** How a learner learns. All times in ms. */
export interface LearnerProfile {
  /** Chance that a brand-new home-row key goes wrong. */
  err0: number;
  /** Attempts scale of the curve: after τ attempts a key is at 2^−β of its start. */
  tau: number;
  /** Error exponent β. Bigger: faster learning. */
  beta: number;
  /** Median gap on a brand-new home-row key. */
  lat0: Ms;
  /** The gap a home-row key tends to with endless practice. */
  latFloor: Ms;
  /** Latency exponent. */
  betaLat: number;
  /** σ of the log gap from key to key (as M1-07's `jitter`). */
  jitter: number;
  /** σ of the learner's own per-key difficulty draw (log scale). */
  keySpread: number;
  /** Learning to learn: later keys start easier (see the module comment). `null`: off. */
  transfer: { tau: number; beta: number } | null;
}

export type Pace = "slow" | "avg" | "fast";
export const PACES: readonly Pace[] = ["slow", "avg", "fast"];

/** τ, jitter, spread and transfer are shared; err0, gaps and β depend on age and pace. */
const SHARED = {
  tau: 25,
  jitter: 0.35,
  keySpread: 0.3,
  transfer: { tau: 1500, beta: 0.15 },
} as const;

const make = (err0: number, beta: number, lat0: Ms, latFloor: Ms): LearnerProfile => ({
  ...SHARED,
  err0,
  beta,
  lat0,
  latFloor,
  betaLat: beta * 0.6,
});

/**
 * The nine learners of the study. A 6–7-year-old Sprout starts at 2.4 s a key and about 1 slip in
 * 4 on a new key; a fast Builder at 0.6 s and 1 in 14. The floors are a home-row key after a very
 * long time: 12/15/20 WPM (Sprout), 18/27/37 (Miner), 27/37/55 (Builder).
 */
export const LEARNER_PROFILES: Readonly<Record<AgeBand, Readonly<Record<Pace, LearnerProfile>>>> = {
  sprout: {
    slow: make(0.3, 0.4, 2400, 1000),
    avg: make(0.24, 0.5, 1800, 800),
    fast: make(0.17, 0.6, 1300, 600),
  },
  miner: {
    slow: make(0.22, 0.45, 1500, 650),
    avg: make(0.16, 0.55, 1100, 450),
    fast: make(0.11, 0.65, 800, 320),
  },
  builder: {
    slow: make(0.16, 0.5, 1100, 450),
    avg: make(0.11, 0.6, 800, 320),
    fast: make(0.07, 0.7, 600, 220),
  },
};

/** A capital (a Shift chord): this many times the slips and the gap of its letter. */
export const HARD_SHIFT = { errors: 1.5, latency: 1.6 } as const;
/** "No Peeking!" with the keyboard normally on screen: this many times the slips. */
export const NO_PEEK_ERROR = 1.4;
/** No key goes wrong more often than this. */
export const MAX_ERROR = 0.6;

const HOME = "asdfghjkl;'";
const TOP = "qwertyuiop[]";
const BOTTOM = "zxcvbnm,./";
const PINKY = "qaz;p/'[]1`0-=";

/** How hard a key is for anyone, before the learner's own draw: slips × and gap ×. */
export function keyClass(key: string): { errors: number; latency: number } {
  const k = key.toLowerCase();
  let c: { errors: number; latency: number };
  if (k === " ") c = { errors: 0.4, latency: 0.8 };
  else if (HOME.includes(k)) c = { errors: 1, latency: 1 };
  else if (TOP.includes(k)) c = { errors: 1.3, latency: 1.15 };
  else if (BOTTOM.includes(k)) c = { errors: 1.5, latency: 1.25 };
  else if (/^[0-9]$/.test(k)) c = { errors: 2, latency: 1.6 };
  else c = { errors: 1.6, latency: 1.4 };
  return PINKY.includes(k) ? { errors: c.errors * 1.25, latency: c.latency * 1.1 } : c;
}

/** One learner: a profile, a seed for its own key draws, and its practice so far. */
export interface Learner {
  profile: LearnerProfile;
  seed: number;
  /** Attempts per key (lowercase; a capital counts for its letter). */
  practice: Record<string, number>;
  /** Every attempt so far. */
  total: number;
}

export function createLearner(profile: LearnerProfile, seed: number): Learner {
  return { profile, seed, practice: {}, total: 0 };
}

const normal = (rng: Rng): number => {
  const u1 = 1 - rng.next();
  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

/** The learner's own difficulty for a key: two lognormal factors, from its seed and the key. */
function ownDraw(learner: Learner, key: string): { errors: number; latency: number } {
  const rng = createRng(hashString(`${learner.seed}:key:${key}`));
  const z = normal(rng);
  const zl = 0.5 * z + Math.sqrt(0.75) * normal(rng); // gaps correlate with slips (ρ = 0.5)
  const s = learner.profile.keySpread;
  return { errors: Math.exp(s * z), latency: Math.exp(0.5 * s * zl) };
}

const practiceOf = (learner: Learner, key: string): number =>
  Object.hasOwn(learner.practice, key) ? (learner.practice[key] ?? 0) : 0;

const transferOf = (learner: Learner): number => {
  const tr = learner.profile.transfer;
  return tr === null ? 1 : (1 + learner.total / tr.tau) ** -tr.beta;
};

/** Options of one press. */
export interface PressContext {
  /** "No Peeking!" for a learner who normally sees the keyboard. */
  noPeek?: boolean;
}

/** The learner's chance of a slip on `char` now. */
export function errorChance(learner: Learner, char: string, ctx: PressContext = {}): number {
  const key = char.toLowerCase();
  const p = learner.profile;
  const curve = (1 + practiceOf(learner, key) / p.tau) ** -p.beta;
  const shift = char !== key ? HARD_SHIFT.errors : 1;
  const peek = ctx.noPeek === true ? NO_PEEK_ERROR : 1;
  const raw =
    p.err0 * keyClass(key).errors * ownDraw(learner, key).errors * transferOf(learner) * curve;
  return Math.min(MAX_ERROR, raw * shift * peek);
}

/** The learner's median gap before `char` now, in ms. */
export function medianGap(learner: Learner, char: string): Ms {
  const key = char.toLowerCase();
  const p = learner.profile;
  const mult = keyClass(key).latency * ownDraw(learner, key).latency;
  const floor = p.latFloor * mult;
  const start = floor + (p.lat0 * mult - floor) * transferOf(learner);
  const curve = (1 + practiceOf(learner, key) / p.tau) ** -p.betaLat;
  const shift = char !== key ? HARD_SHIFT.latency : 1;
  return (floor + (start - floor) * curve) * shift;
}

/** Counts one attempt at `char`. */
export function practise(learner: Learner, char: string): void {
  const key = char.toLowerCase();
  learner.practice[key] = practiceOf(learner, key) + 1;
  learner.total++;
}

/** Input of {@link playLearner}. */
export interface LearnerRunOptions {
  config: SessionConfig;
  targets: Target[];
  learner: Learner;
  /** All randomness of the session. */
  rng: Rng;
  ctx?: PressContext;
  /** Force the end after this many keys. */
  maxKeys?: number;
}

/** What one session produced. */
export interface LearnerRun {
  summary: SessionSummary;
  events: EngineEvent[];
  keysPressed: number;
}

function currentTarget(view: { active: TargetView | null; targets: TargetView[] }) {
  return view.active ?? view.targets.find((t) => !t.complete) ?? null;
}

/**
 * Plays one session on the real typing engine, as M1-07's `runTypist` does (same corrections for
 * `stay`, `backspace` and `skip`), with this learner's per-key slips and gaps. The learner learns
 * as it goes: every aimed press counts towards that key's curve straight away. It never types a
 * habit space between blocks (Mine would drop it anyway).
 */
export function playLearner(opts: LearnerRunOptions): LearnerRun {
  const { config, learner, ctx = {}, maxKeys = 20_000 } = opts;
  const gapRng = opts.rng.fork("latency");
  const errorRng = opts.rng.fork("errors");
  const wrongRng = opts.rng.fork("wrongKey");
  const noticeRng = opts.rng.fork("notice");
  const session = createSession(config, opts.targets);
  const events: EngineEvent[] = [];
  let t: Ms = 0;
  let keys = 0;
  let justErred = false;

  const press = (key: string, gapFor: string): void => {
    const gap = medianGap(learner, gapFor) * Math.exp(learner.profile.jitter * normal(gapRng));
    t += Math.min(10_000, Math.max(20, gap));
    if (justErred) t += sampleNoticeDelay(noticeRng);
    keys++;
    events.push(...session.feed({ key, t, shift: key !== key.toLowerCase() }));
  };

  while (!session.view().ended) {
    const view = session.view();
    const target = currentTarget(view);
    if (target === null || keys >= maxKeys) {
      events.push(...session.end(t));
      break;
    }
    if (config.policy === "backspace" && target.marks.slice(0, target.typed).includes("wrong")) {
      press("Backspace", "a");
      justErred = false;
      continue;
    }
    const expected = Array.from(target.text)[target.typed] ?? " ";
    const slip = errorRng.next() < errorChance(learner, expected, ctx);
    practise(learner, expected);
    if (slip) {
      press(wrongRng.pick(neighborsOf(expected)), expected);
      justErred = config.policy !== "skip";
    } else {
      press(expected, expected);
      justErred = false;
    }
  }
  const end = events.findLast((e) => e.type === "sessionEnd");
  if (end?.type !== "sessionEnd")
    throw new Error("playLearner: the session produced no sessionEnd");
  return { summary: end.summary, events, keysPressed: keys };
}
