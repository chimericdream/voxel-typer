/**
 * Content generation: turns allowed keys, weights and word pools into targets
 * (docs/impl/contracts.md §5). Pure: randomness comes in as an {@link Rng}.
 *
 * Rules, in priority order (a lower rule gives way when it can't hold together with a higher one):
 *
 * 1. Never emit a char outside `allowed ∪ {' '}`. Nothing relaxes this.
 * 2. Never emit a blocked letter run (see {@link BLOCKED_RUNS}) from random letters.
 * 3. `letters`: no char more than 3 times in a row (impossible when only one key is allowed).
 * 4. Comfort cap (contracts §4): at least 50% of the generated non-space chars come from
 *    "comfortable" keys (see {@link comfortableKeys}).
 */
import type { AgeBand } from "@/types/core";
import type { Rng } from "./rng";
import type { Target } from "./types";

/** What a lesson asks the learner to type. */
export type ContentKind = "letters" | "syllables" | "words" | "phrases" | "sentences";

/** A named list of words, phrases or sentences. Built from `src/content/wordlists/`. */
export interface WordPool {
  id: string;
  band: AgeBand | "all";
  tags: string[];
  items: readonly string[];
}

/** Input of {@link generateTargets}. */
export interface GenerateParams {
  kind: ContentKind;
  /** The generator NEVER emits a char outside `allowed ∪ {' '}`. */
  allowed: readonly string[];
  /** From `keyWeights` (contracts §4). */
  weights: Record<string, number>;
  /** Already filtered to the band. */
  pools: readonly WordPool[];
  /**
   * How much to generate. `{ seconds, estWpm }` converts to chars as
   * `seconds / 60 * estWpm * 5 * 1.3`: 30% headroom, so the learner never runs out.
   */
  length: { chars: number } | { targets: number } | { seconds: number; estWpm: number };
  /** Per target. */
  minLen?: number;
  /** Per target. */
  maxLen?: number;
  capitalize?: "none" | "first" | "mixed";
}

/** Tuning constants of the generator. Exported for tests and the simulator (M1-07). */
export const GENERATOR_CONSTANTS = {
  /** `{ seconds, estWpm }`: chars per word. */
  charsPerWord: 5,
  /** `{ seconds, estWpm }`: headroom multiplier. */
  headroom: 1.3,
  /** Comfort cap: minimum share of generated non-space chars from comfortable keys. */
  comfortShare: 0.5,
  /** Rejection-sampling tries per word-like target before the cap relaxes (contracts §5). */
  itemTries: 200,
  /** Tries per syllable before falling back to a single comfortable char. */
  syllableTries: 20,
  /** `letters`: the longest allowed run of one char. */
  maxRun: 3,
  /** Default syllable length range (contracts §5). */
  syllableMin: 2,
  syllableMax: 3,
  /** `capitalize: 'mixed'`: chance that a target starts with a capital. */
  mixedCapChance: 0.5,
  /** Safety limits, so a bad `length` can't hang the game. */
  maxChars: 20_000,
  maxTargets: 5_000,
} as const;

/**
 * Letter runs random generation must never produce (checked lower-case, as substrings of a
 * syllable and as the tail of the `letters` stream). Pool items are curated and checked by the
 * word-list pipeline instead; this list only guards random letter strings, which are at most a
 * few letters long, so it holds short runs. Kept small and plain on purpose so a reviewer can read
 * it.
 */
const BLOCKED_RUNS: readonly string[] = [
  "anal",
  "anus",
  "ass",
  "bitch",
  "boob",
  "butt",
  "chink",
  "cock",
  "coc",
  "crap",
  "cum",
  "cunt",
  "damn",
  "dick",
  "dik",
  "dyke",
  "fag",
  "fap",
  "fck",
  "fuc",
  "fuk",
  "gay",
  "gook",
  "hell",
  "hoe",
  "homo",
  "jap",
  "jiz",
  "kike",
  "kkk",
  "kys",
  "nazi",
  "nig",
  "pee",
  "penis",
  "piss",
  "poo",
  "porn",
  "puss",
  "rape",
  "sex",
  "sht",
  "shit",
  "slut",
  "spic",
  "tit",
  "twat",
  "wank",
  "wop",
  "wtf",
  "xxx",
];
const MAX_BLOCKED_LEN = BLOCKED_RUNS.reduce((m, w) => Math.max(m, w.length), 0);

const VOWELS: ReadonlySet<string> = new Set(["a", "e", "i", "o", "u"]);
const SPACE = " ";

/** Code points of `text`. */
function charsOf(text: string): string[] {
  return Array.from(text);
}

/** True when `text` can be typed with the `allowed` chars alone. A space always counts as typeable. */
export function typeable(text: string, allowed: ReadonlySet<string>): boolean {
  for (const c of charsOf(text)) {
    if (c !== SPACE && !allowed.has(c)) return false;
  }
  return true;
}

/** True when `text` (any case) contains a blocked letter run. */
export function containsBlockedRun(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_RUNS.some((w) => lower.includes(w));
}

/** `weights[k]` when it is a finite positive number, otherwise 1. */
function weightOf(weights: Record<string, number>, key: string): number {
  const w = weights[key];
  return w !== undefined && Number.isFinite(w) && w > 0 ? w : 1;
}

/** The distinct non-space keys of `allowed`, in first-seen order. */
function keysOf(allowed: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const k of allowed) if (k !== SPACE && k.length > 0) seen.add(k);
  return [...seen];
}

/**
 * The comfort cap's "keys whose weight is within the bottom half" (contracts §4): sort the keys by
 * weight, take the weight at rank `ceil(n / 2)`; every key at or below it is comfortable. So at
 * least half the keys are comfortable, ties are never split, and when all weights are equal every
 * key is comfortable.
 */
export function comfortableKeys(
  allowed: readonly string[],
  weights: Record<string, number>,
): Set<string> {
  const keys = keysOf(allowed);
  const sorted = keys.map((k) => weightOf(weights, k)).toSorted((a, b) => a - b);
  const threshold = sorted[Math.ceil(sorted.length / 2) - 1];
  if (threshold === undefined) return new Set();
  return new Set(keys.filter((k) => weightOf(weights, k) <= threshold));
}

function check(n: number, what: string): number {
  if (!Number.isFinite(n) || n < 0) {
    throw new RangeError(`generateTargets: ${what} ${n} is not a finite number >= 0`);
  }
  return n;
}

/** Converts a `length` to a budget. Throws a `RangeError` on a negative or non-finite value. */
export function lengthBudget(
  length: GenerateParams["length"],
): { chars: number } | { targets: number } {
  if ("targets" in length) {
    return {
      targets: Math.min(
        GENERATOR_CONSTANTS.maxTargets,
        Math.floor(check(length.targets, "targets")),
      ),
    };
  }
  const chars =
    "chars" in length
      ? check(length.chars, "chars")
      : (check(length.seconds, "seconds") / 60) *
        check(length.estWpm, "estWpm") *
        GENERATOR_CONSTANTS.charsPerWord *
        GENERATOR_CONSTANTS.headroom;
  return { chars: Math.min(GENERATOR_CONSTANTS.maxChars, Math.ceil(chars)) };
}

/** Running count of generated non-space chars, for the comfort cap. */
interface Tally {
  comfortable: number;
  total: number;
}

/** Would adding `comfortable` of `total` chars keep the comfort share? */
function keepsCap(t: Tally, comfortable: number, total: number): boolean {
  return t.comfortable + comfortable >= GENERATOR_CONSTANTS.comfortShare * (t.total + total);
}

/** Keeps `filtered` when it isn't empty, else `items`: a filter that gives way rather than fail. */
function soft<T>(items: readonly T[], keep: (item: T) => boolean): readonly T[] {
  const filtered = items.filter(keep);
  return filtered.length > 0 ? filtered : items;
}

interface Ctx {
  keys: readonly string[];
  weights: Record<string, number>;
  comfortable: ReadonlySet<string>;
  tally: Tally;
}

/**
 * Weighted pick of one char from `pool`, forced to a comfortable key when the cap needs it. When
 * `pool` has no comfortable key, `anyComfortable` lets the pick leave `pool` for any comfortable
 * allowed key (syllables give up the consonant–vowel slot for the cap); without it the pool's
 * own rules win.
 */
function pickChar(ctx: Ctx, pool: readonly string[], rng: Rng, anyComfortable = false): string {
  const needComfort = !keepsCap(ctx.tally, 0, 1);
  const isComfortable = (k: string): boolean => ctx.comfortable.has(k);
  const choices = !needComfort
    ? pool
    : pool.some(isComfortable) || !anyComfortable
      ? soft(pool, isComfortable)
      : soft(ctx.keys, isComfortable);
  return rng.weightedPick(
    choices,
    choices.map((k) => weightOf(ctx.weights, k)),
  );
}

function count(ctx: Ctx, text: string): void {
  for (const c of charsOf(text)) {
    if (c === SPACE) continue;
    ctx.tally.total += 1;
    if (ctx.comfortable.has(c)) ctx.tally.comfortable += 1;
  }
}

/** Generates targets one by one until the budget is used. */
function fill(
  budget: { chars: number } | { targets: number },
  spaced: boolean,
  next: () => string,
): string[] {
  const out: string[] = [];
  let used = 0;
  const more = (): boolean =>
    "targets" in budget ? out.length < budget.targets : used < budget.chars;
  while (more() && out.length < GENERATOR_CONSTANTS.maxTargets) {
    const text = next();
    used += charsOf(text).length + (spaced && out.length > 0 ? 1 : 0);
    out.push(text);
  }
  return out;
}

function generateLetters(
  ctx: Ctx,
  budget: { chars: number } | { targets: number },
  rng: Rng,
): string[] {
  let stream = "";
  return fill(budget, false, () => {
    const tail = stream.slice(-(MAX_BLOCKED_LEN - 1));
    const runChar = stream.slice(-1);
    const run = stream.endsWith(runChar.repeat(GENERATOR_CONSTANTS.maxRun));
    let pool = soft(ctx.keys, (k) => !endsWithBlocked(tail + k));
    if (run && runChar !== "") pool = soft(pool, (k) => k !== runChar);
    const c = pickChar(ctx, pool, rng);
    count(ctx, c);
    stream = (stream + c).slice(-Math.max(MAX_BLOCKED_LEN, GENERATOR_CONSTANTS.maxRun));
    return c;
  });
}

function endsWithBlocked(s: string): boolean {
  const lower = s.toLowerCase();
  return BLOCKED_RUNS.some((w) => lower.endsWith(w));
}

/** The syllable length range: 2–3, narrowed by `minLen`/`maxLen` where they overlap it. */
function syllableRange(p: GenerateParams): [number, number] {
  const lo = Math.max(GENERATOR_CONSTANTS.syllableMin, p.minLen ?? 0);
  const hi = Math.min(GENERATOR_CONSTANTS.syllableMax, p.maxLen ?? Infinity);
  return lo <= hi ? [lo, hi] : [GENERATOR_CONSTANTS.syllableMin, GENERATOR_CONSTANTS.syllableMax];
}

const PATTERNS: Readonly<Record<number, readonly string[]>> = {
  2: ["CV", "VC", "VV"],
  3: ["CVC", "CVC", "VCV", "CVV"],
};

function generateSyllables(
  ctx: Ctx,
  p: GenerateParams,
  budget: { chars: number } | { targets: number },
  rng: Rng,
): string[] {
  const vowels = ctx.keys.filter((k) => VOWELS.has(k.toLowerCase()));
  const consonants = ctx.keys.filter((k) => !VOWELS.has(k.toLowerCase()));
  const [lo, hi] = syllableRange(p);

  const one = (): string => {
    const len = rng.int(lo, hi);
    const pattern =
      vowels.length === 0
        ? "C".repeat(len)
        : consonants.length === 0
          ? "V".repeat(len)
          : rng.pick(PATTERNS[len] ?? ["C".repeat(len)]);
    // Draft against a copy of the tally, so a rejected syllable leaves no trace.
    const draft: Ctx = { ...ctx, tally: { ...ctx.tally } };
    let s = "";
    for (const slot of pattern) {
      const c = pickChar(draft, slot === "V" ? vowels : consonants, rng, true);
      count(draft, c);
      s += c;
    }
    return s;
  };

  return fill(budget, true, () => {
    for (let i = 0; i < GENERATOR_CONSTANTS.syllableTries; i++) {
      const s = one();
      if (!containsBlockedRun(s)) {
        count(ctx, s);
        return s;
      }
    }
    // A single char is never a blocked run.
    const c = pickChar(ctx, ctx.keys, rng);
    count(ctx, c);
    return c;
  });
}

interface Item {
  text: string;
  total: number;
  comfortable: number;
  share: number;
}

/** Typeable, well-formed pool items within the length bounds, deduplicated, in pool order. */
function candidateItems(p: GenerateParams, ctx: Ctx): Item[] {
  const allowed = new Set(ctx.keys);
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const pool of p.pools) {
    for (const text of pool.items) {
      if (seen.has(text)) continue;
      seen.add(text);
      const len = charsOf(text).length;
      if (len === 0 || text.trim() !== text || text.includes("  ")) continue;
      if (p.minLen !== undefined && len < p.minLen) continue;
      if (p.maxLen !== undefined && len > p.maxLen) continue;
      if (!typeable(text, allowed)) continue;
      let total = 0;
      let comfortable = 0;
      for (const c of charsOf(text)) {
        if (c === SPACE) continue;
        total += 1;
        if (ctx.comfortable.has(c)) comfortable += 1;
      }
      if (total === 0) continue;
      out.push({ text, total, comfortable, share: comfortable / total });
    }
  }
  return out;
}

function generateItems(
  ctx: Ctx,
  items: readonly Item[],
  budget: { chars: number } | { targets: number },
  rng: Rng,
): string[] {
  // Cumulative weights for an O(log n) pick that uses exactly one `next()`.
  const cumulative: number[] = [];
  let sum = 0;
  for (const it of items) {
    let w = 0;
    for (const c of charsOf(it.text)) if (c !== SPACE) w += weightOf(ctx.weights, c);
    sum += w;
    cumulative.push(sum);
  }
  const pickIndex = (): number => {
    const r = rng.next() * sum;
    let a = 0;
    let b = cumulative.length - 1;
    while (a < b) {
      const m = (a + b) >> 1;
      if ((cumulative[m] ?? sum) > r) b = m;
      else a = m + 1;
    }
    return a;
  };
  // The relaxed fallback: the most comfortable item, first in pool order on a tie.
  let best = 0;
  items.forEach((it, i) => {
    if (it.share > (items[best]?.share ?? -1)) best = i;
  });

  let previous = -1;
  return fill(budget, true, () => {
    let chosen = -1;
    for (let i = 0; i < GENERATOR_CONSTANTS.itemTries; i++) {
      const idx = pickIndex();
      const it = items[idx];
      if (it === undefined) continue;
      if (idx === previous && items.length > 1) continue;
      if (keepsCap(ctx.tally, it.comfortable, it.total)) {
        chosen = idx;
        break;
      }
    }
    if (chosen < 0) chosen = best;
    const it = items[chosen];
    if (it === undefined) throw new Error("generateTargets: no candidate item");
    previous = chosen;
    ctx.tally.comfortable += it.comfortable;
    ctx.tally.total += it.total;
    return it.text;
  });
}

/** Upper-cases the first char when its upper-case form is allowed; otherwise leaves it. */
function capitalizeFirst(text: string, allowed: ReadonlySet<string>): string {
  const [first = "", ...rest] = charsOf(text);
  const up = first.toUpperCase();
  return up !== first && charsOf(up).length === 1 && allowed.has(up) ? up + rest.join("") : text;
}

/**
 * Generates the targets of a session. The same params and the same seed give the same output.
 *
 * - `letters`: single chars, weighted by `weights`, no char more than 3 times in a row. The targets
 *   have `trailingSpace: false`.
 * - `syllables`: 2–3-char pseudo-syllables from the allowed chars, consonant–vowel aware when
 *   vowels exist. For early home-row lessons (`a` is the only vowel) it uses patterns like `aa`,
 *   `as`, `sad`, `fa`.
 * - `words` / `phrases` / `sentences`: picks pool items for which `typeable(item, allowed)` holds,
 *   weighted by the sum of their chars' weights. It enforces the comfort cap (§4) by rejection
 *   sampling, with a fallback that relaxes the cap after 200 tries. It never relaxes the allowed
 *   set.
 * - If no pool item is typeable, it falls back to `syllables` and changes nothing else: the caller
 *   just sees fewer word-like targets. The curriculum validator (M3-01) makes sure this never
 *   happens for a shipped lesson.
 *
 * Details beyond the contract (docs/handoffs/M1-06.md): `chars` budgets count the spaces between
 * word-like targets; `capitalize` only upper-cases a target's first char when that capital is in
 * `allowed`; random letter strings never contain a blocked run.
 */
export function generateTargets(p: GenerateParams, rng: Rng): Target[] {
  const budget = lengthBudget(p.length);
  const keys = keysOf(p.allowed);
  if (keys.length === 0) return [];
  const ctx: Ctx = {
    keys,
    weights: p.weights,
    comfortable: comfortableKeys(keys, p.weights),
    tally: { comfortable: 0, total: 0 },
  };

  let texts: string[];
  let letters = false;
  if (p.kind === "letters") {
    texts = generateLetters(ctx, budget, rng.fork("letters"));
    letters = true;
  } else {
    const items = p.kind === "syllables" ? [] : candidateItems(p, ctx);
    texts =
      items.length > 0
        ? generateItems(ctx, items, budget, rng.fork("items"))
        : generateSyllables(ctx, p, budget, rng.fork("syllables"));
  }

  const cap = p.capitalize ?? "none";
  if (cap !== "none") {
    const allowed = new Set(keys);
    const capRng = rng.fork("capitalize");
    texts = texts.map((t) =>
      cap === "first" || capRng.next() < GENERATOR_CONSTANTS.mixedCapChance
        ? capitalizeFirst(t, allowed)
        : t,
    );
  }

  return texts.map((text, i) => ({ id: `g${i}`, text, trailingSpace: !letters }));
}
