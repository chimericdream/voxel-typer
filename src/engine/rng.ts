/**
 * Seeded randomness (docs/impl/contracts.md §2). Pure: no `Math.random()`, ever.
 *
 * Algorithm (fixed, so test fixtures stay valid): **sfc32**, seeded through splitmix32 from the
 * 32-bit seed. String seeds are hashed with cyrb53 and truncated to uint32. A golden test pins the
 * first 10 outputs of `createRng(42)` and `createRng('voxel')`.
 *
 * Stubs only; M1-02 implements them.
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

/** Creates a stream. A string seed is hashed with cyrb53 and truncated to 32 bits. */
export function createRng(seed: number | string): Rng {
  void seed;
  throw new Error("not implemented: createRng");
}

/** cyrb53 hash of `s`, truncated to a uint32. */
export function hashString(s: string): number {
  void s;
  throw new Error("not implemented: hashString");
}

/**
 * The seed string of a daily challenge: `"daily-YYYY-MM-DD"`. The caller passes the local date; the
 * engine never reads the clock.
 */
export function dailySeed(localDate: { y: number; m: number; d: number }): string {
  void localDate;
  throw new Error("not implemented: dailySeed");
}
