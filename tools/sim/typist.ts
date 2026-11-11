/**
 * Synthetic typist for the simulator (docs/impl/tasks-m0-m1.md M1-07, PLAN.md §9.3).
 *
 * Pure, like the engine it drives: it never reads a clock or a global random source. Time is a
 * number that the typist advances itself, and every random draw comes from the `Rng` passed in. It imports only pure
 * engine modules.
 *
 * The model:
 * - **Speed.** The time between two keys is lognormal: `median · exp(jitter · z)` with
 *   `median = 12000 / wpm` ms and `z` a standard normal draw. So `jitter` is the σ of the log
 *   latency; 0 types like a metronome.
 * - **Errors.** Each key the typist aims at goes wrong with probability
 *   `errorRate × perKeyErrorMult[key] × learnFactor` (capped at {@link MAX_ERROR_PROBABILITY}).
 *   A wrong key is a QWERTY neighbor of the right one ({@link QWERTY_NEIGHBORS}; M1-11's layout
 *   data isn't merged yet).
 * - **Learning.** `learnFactor = 1 / (1 + learnRate · practice[key] / 100)`, where `practice` is
 *   the number of earlier attempts at the key. With `learnRate` 1, 100 attempts halve the errors.
 * - **Corrections.** Under `backspace` the typist notices a wrong char after a 150–400 ms delay,
 *   presses Backspace and types the key again. Under `stay` the cursor didn't move, so it waits the
 *   same notice delay and types the right key (a Backspace there would do nothing in `sequential`
 *   and would reset a `lockOn` target). Under `skip` it carries on.
 */
import { createSession } from "../../src/engine/session";
import type { Rng } from "../../src/engine/rng";
import type { SessionSummary } from "../../src/engine/stats";
import type {
  EngineEvent,
  SessionConfig,
  SessionSnapshot,
  Target,
  TargetView,
  TypingSession,
} from "../../src/engine/types";
import type { Ms } from "../../src/types/core";

/** How a synthetic typist types. */
export interface TypistProfile {
  /** Typing speed; the median gap between keys is `12000 / wpm` ms. */
  wpm: number;
  /** Chance that a key goes wrong, before the per-key multiplier. 0–1. */
  errorRate: number;
  /** Per expected char: multiplies `errorRate` (default 1). */
  perKeyErrorMult?: Record<string, number>;
  /** σ of the log latency (see the module comment). */
  jitter: number;
  /** How fast errors fall with practice (see the module comment). Default 0: no learning. */
  learnRate?: number;
}

export type TypistName = "slow" | "avg" | "fast" | "pinkyweak";

/** The built-in profiles the `sim` tool offers with `--typist`. */
export const TYPIST_PROFILES: Readonly<Record<TypistName, TypistProfile>> = {
  slow: { wpm: 10, errorRate: 0.08, jitter: 0.45, learnRate: 0.5 },
  avg: { wpm: 22, errorRate: 0.05, jitter: 0.35, learnRate: 0.3 },
  fast: { wpm: 45, errorRate: 0.02, jitter: 0.25, learnRate: 0.2 },
  /**
   * A Miner-age typist whose pinkies lag: `a` and `;` (and the other pinky keys) go wrong four
   * times as often as the rest.
   */
  pinkyweak: {
    wpm: 20,
    errorRate: 0.04,
    perKeyErrorMult: { a: 4, ";": 4, q: 3, z: 3, p: 3, "/": 3, "'": 3 },
    jitter: 0.35,
    learnRate: 0.3,
  },
};

/** No key goes wrong more often than this, whatever the multipliers say. */
export const MAX_ERROR_PROBABILITY = 0.9;
/** The "notice" delay before a correction, in ms (inclusive). */
export const NOTICE_DELAY_MS = { min: 150, max: 400 } as const;
/** Latencies are clamped to this range so a wild draw can't stall a session. */
export const LATENCY_CLAMP_MS = { min: 20, max: 10_000 } as const;
/** A session that takes this many keys is ended by force (a typist stuck on a key). */
export const DEFAULT_MAX_KEYS = 50_000;

const QWERTY_ROWS = ["1234567890-=", "qwertyuiop[]", "asdfghjkl;'", "zxcvbnm,./"] as const;

/**
 * Builds the neighbor map of a staggered QWERTY board: same-row keys to the left and right, and the
 * two touching keys of the rows above and below. Row r key i sits between keys i and i+1 of row
 * r−1, so its upper neighbors are i and i+1 and its lower neighbors are i−1 and i.
 */
function buildNeighbors(): Record<string, string> {
  const map: Record<string, string> = {};
  QWERTY_ROWS.forEach((row, r) => {
    const above = QWERTY_ROWS[r - 1] ?? "";
    const below = QWERTY_ROWS[r + 1] ?? "";
    for (let i = 0; i < row.length; i++) {
      const near = [row[i - 1], row[i + 1], above[i], above[i + 1], below[i - 1], below[i]];
      map[row.charAt(i)] = near.filter((c): c is string => c !== undefined && c !== "").join("");
    }
  });
  // The space bar sits under the bottom row's middle.
  map[" "] = "cvbnm";
  return map;
}

/** For each lowercase key of US QWERTY (and space), its physical neighbors as one string. */
export const QWERTY_NEIGHBORS: Readonly<Record<string, string>> = buildNeighbors();

/**
 * The keys a typist might hit instead of `char`. An uppercase letter's neighbors are uppercase. A
 * char with no known neighbors (outside the map) gets the home-row `asdf` keys minus itself.
 */
export function neighborsOf(char: string): string[] {
  const lower = char.toLowerCase();
  const upper = char !== lower;
  const near = Object.hasOwn(QWERTY_NEIGHBORS, lower) ? (QWERTY_NEIGHBORS[lower] ?? "") : "";
  const keys = near === "" ? ["a", "s", "d", "f"].filter((c) => c !== lower) : near.split("");
  return upper ? keys.map((c) => c.toUpperCase()) : keys;
}

/** The chance that the typist hits a wrong key when aiming at `key`. */
export function errorProbability(
  profile: TypistProfile,
  key: string,
  practice: Readonly<Record<string, number>> = {},
): number {
  const mults = profile.perKeyErrorMult ?? {};
  const mult = Object.hasOwn(mults, key) ? (mults[key] ?? 1) : 1;
  const done = Object.hasOwn(practice, key) ? (practice[key] ?? 0) : 0;
  const learn = 1 / (1 + ((profile.learnRate ?? 0) * Math.max(0, done)) / 100);
  return Math.min(MAX_ERROR_PROBABILITY, Math.max(0, profile.errorRate * mult * learn));
}

/** One gap between keys, in ms. Uses exactly two `rng.next()` calls (Box–Muller). */
export function sampleLatency(profile: TypistProfile, rng: Rng): Ms {
  const u1 = 1 - rng.next(); // (0, 1], so the log is finite
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const median = 12_000 / profile.wpm;
  const ms = median * Math.exp(profile.jitter * z);
  return Math.min(LATENCY_CLAMP_MS.max, Math.max(LATENCY_CLAMP_MS.min, ms));
}

/** The notice delay before a correction. One `rng.int` call. */
export function sampleNoticeDelay(rng: Rng): Ms {
  return rng.int(NOTICE_DELAY_MS.min, NOTICE_DELAY_MS.max);
}

/** Input of {@link runTypist}. */
export interface TypistRunOptions {
  config: SessionConfig;
  targets: Target[];
  profile: TypistProfile;
  /** All randomness. The run forks `latency`, `errors`, `wrongKey` and `notice` from it. */
  rng: Rng;
  /** The time of the first key is `startT` plus one latency. Default 0. */
  startT?: Ms;
  /** Earlier attempts per key, for learning (`KeyStat.attempts`). */
  practice?: Readonly<Record<string, number>>;
  /** Force the end after this many keys (default {@link DEFAULT_MAX_KEYS}). */
  maxKeys?: number;
}

/** What one simulated session produced. */
export interface TypistRun {
  snapshot: SessionSnapshot;
  events: EngineEvent[];
  summary: SessionSummary;
  /** Every key the typist pressed, in order (Backspace included). */
  keysPressed: number;
  /**
   * `true` when the session ended by its own rule (last target, deadline), or a `manual` session ran
   * out of targets. `false` when the typist forced the end (`maxKeys`, or no text left before a
   * deadline).
   */
  endedNaturally: boolean;
}

/** The target the typist works on: the active one, or under `lockOn` the first open target. */
function currentTarget(session: TypingSession): TargetView | null {
  const view = session.view();
  if (view.active !== null) return view.active;
  return view.targets.find((target) => !target.complete) ?? null;
}

/** The char the cursor of `target` waits for: the next text char, or the trailing space. */
function expectedChar(target: TargetView): string {
  // Code points, as the matcher counts them; Array.from keeps a surrogate pair together.
  const chars = Array.from(target.text);
  return chars[target.typed] ?? " ";
}

/**
 * Plays one session: builds it from `config` and `targets`, types until it ends (or no target is
 * left, or `maxKeys` is reached, then ends it at the last key's time) and returns the log, the
 * events and the summary. Deterministic for the same options and rng seed.
 */
export function runTypist(opts: TypistRunOptions): TypistRun {
  const { config, profile, practice = {}, maxKeys = DEFAULT_MAX_KEYS } = opts;
  const latencyRng = opts.rng.fork("latency");
  const errorRng = opts.rng.fork("errors");
  const wrongKeyRng = opts.rng.fork("wrongKey");
  const noticeRng = opts.rng.fork("notice");
  const session = createSession(config, opts.targets);
  const events: EngineEvent[] = [];
  let t = opts.startT ?? 0;
  let keysPressed = 0;
  let justErred = false;
  let endedNaturally = true;

  const press = (key: string): void => {
    t += sampleLatency(profile, latencyRng);
    if (justErred) t += sampleNoticeDelay(noticeRng);
    keysPressed++;
    events.push(...session.feed({ key, t, shift: key !== key.toLowerCase() }));
  };

  while (!session.view().ended) {
    const target = currentTarget(session);
    if (target === null || keysPressed >= maxKeys) {
      // A `manual` session has no end of its own: running out of targets is its natural end.
      endedNaturally = target === null && config.end.kind === "manual";
      events.push(...session.end(t));
      break;
    }
    if (config.policy === "backspace" && target.marks.slice(0, target.typed).includes("wrong")) {
      press("Backspace");
      justErred = false;
      continue;
    }
    const expected = expectedChar(target);
    if (errorRng.next() < errorProbability(profile, expected, practice)) {
      const wrong = wrongKeyRng.pick(neighborsOf(expected));
      press(wrong);
      justErred = config.policy !== "skip";
    } else {
      press(expected);
      justErred = false;
    }
  }

  const end = events.findLast((event) => event.type === "sessionEnd");
  if (end?.type !== "sessionEnd") throw new Error("runTypist: the session produced no sessionEnd");
  return {
    snapshot: session.snapshot(),
    events,
    summary: end.summary,
    keysPressed,
    endedNaturally,
  };
}
