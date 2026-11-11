/**
 * Seeded randomness (docs/impl/contracts.md §2). Pure: no `Math.random()`, ever.
 *
 * Algorithm (fixed, so test fixtures stay valid): **sfc32**, seeded through splitmix32 from the
 * 32-bit seed. String seeds are hashed with cyrb53 and truncated to uint32. A golden test pins the
 * first 10 outputs of `createRng(42)` and `createRng('voxel')`.
 *
 * Changing any constant or step here changes every seeded sequence in the game (daily challenges,
 * generated drills, test fixtures). Don't.
 */

/** A deterministic random stream. The same seed always gives the same sequence. */
export interface Rng {
  /** A float in `[0, 1)`. */
  next(): number;
  /** An integer between `minInclusive` and `maxInclusive`, both included. */
  int(minInclusive: number, maxInclusive: number): number;
  /** One item, uniformly. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** One item, with probability proportional to its weight. */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T;
  /** A new, shuffled array (Fisher–Yates). The input is not changed. */
  shuffle<T>(items: readonly T[]): T[];
  /** An independent child stream, deterministic for each (parent seed, label) pair. */
  fork(label: string): Rng;
  /** The 32-bit seed this stream started from. */
  readonly seed: number;
}

const TWO_POW_32 = 4294967296;

/** splitmix32: expands one 32-bit seed into a stream of well-mixed uint32 words. */
function splitmix32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let t = state ^ (state >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

/** sfc32 (Small Fast Counting, 32-bit). Returns uint32 words. */
function sfc32(seed: number): () => number {
  const mix = splitmix32(seed);
  let a = mix() | 0;
  let b = mix() | 0;
  let c = mix() | 0;
  let d = mix() | 0;
  return () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
}

function assertInt(name: string, n: number): void {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`rng: ${name} must be a safe integer, got ${n}`);
  }
}

/**
 * Reads `items[index]`. With `noUncheckedIndexedAccess`, every element read is `T | undefined`,
 * so this guard replaces a cast: every call site proves the index is in range first, and the
 * guard is a safety net. It also rejects elements that are literally `undefined`, which no
 * caller in this game passes (items are targets, words, block ids, ...).
 */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new RangeError(`rng: no value at index ${index}`);
  }
  return item;
}

function makeRng(seed: number): Rng {
  const word = sfc32(seed);
  const next = (): number => word() / TWO_POW_32;

  const int = (minInclusive: number, maxInclusive: number): number => {
    assertInt("minInclusive", minInclusive);
    assertInt("maxInclusive", maxInclusive);
    if (minInclusive > maxInclusive) {
      throw new RangeError(`rng.int: min ${minInclusive} is greater than max ${maxInclusive}`);
    }
    const span = maxInclusive - minInclusive + 1;
    // Clamp guards against float rounding when `span` is huge; for small spans it never fires.
    return Math.min(maxInclusive, minInclusive + Math.floor(next() * span));
  };

  const rng: Rng = {
    seed,
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError("rng.pick: empty array");
      return at(items, int(0, items.length - 1));
    },
    weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
      if (items.length !== weights.length) {
        throw new RangeError(
          `rng.weightedPick: ${items.length} items but ${weights.length} weights`,
        );
      }
      let total = 0;
      for (const w of weights) {
        if (!Number.isFinite(w) || w < 0) {
          throw new RangeError(`rng.weightedPick: weight ${w} is not a finite number >= 0`);
        }
        total += w;
      }
      if (total <= 0) throw new RangeError("rng.weightedPick: no item has a positive weight");

      const r = next() * total;
      let cumulative = 0;
      let lastPositive = -1;
      for (let i = 0; i < weights.length; i++) {
        const w = at(weights, i);
        if (w <= 0) continue;
        cumulative += w;
        lastPositive = i;
        if (r < cumulative) return at(items, i);
      }
      // Float rounding can leave `r` a hair above the running sum; the last live item owns that gap.
      return at(items, lastPositive);
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        const a = at(out, i);
        const b = at(out, j);
        out[i] = b;
        out[j] = a;
      }
      return out;
    },
    fork(label: string): Rng {
      return createRng(hashString(`${seed}:${label}`));
    },
  };
  return rng;
}

/**
 * Creates a stream. A string seed is hashed with cyrb53 and truncated to 32 bits. A number seed is
 * converted to uint32 with `>>> 0` (so `-1` becomes `4294967295` and fractions are dropped).
 */
export function createRng(seed: number | string): Rng {
  return makeRng(typeof seed === "string" ? hashString(seed) : seed >>> 0);
}

/** cyrb53 hash of `s`, truncated to a uint32 (the low 32 bits of the 53-bit hash). */
export function hashString(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  // The full cyrb53 also folds h1 into h2 for the high 21 bits; truncation discards them.
  return h1 >>> 0;
}

/** Zero-pads `n` to `width` digits, for the fixed-width parts of a daily seed. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * The seed string of a daily challenge: `"daily-YYYY-MM-DD"`. The caller passes the local date; the
 * engine never reads the clock.
 */
export function dailySeed(localDate: { y: number; m: number; d: number }): string {
  return `daily-${pad(localDate.y, 4)}-${pad(localDate.m, 2)}-${pad(localDate.d, 2)}`;
}
