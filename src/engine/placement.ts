/**
 * Placement test rules (task M3-05, PLAN.md §3.2.8): the key-set ladder the test climbs, the
 * targets of each rung, and the estimate of where a new player starts.
 *
 * Pure (PLAN.md §6.3): no clock and no global randomness. The blocks themselves are made in
 * `./placement-driver.ts`, which needs the generator; this file doesn't, so the app shell can
 * apply a result without loading the generator up front.
 *
 * The thresholds are documented in docs/handoffs/M3-05.md for the pedagogy review.
 */
import type { ContentKind } from "./generator";
import { foldSummaryIntoKeyStats } from "./stats";
import type { KeyStat, SessionSummary } from "./stats";
import type { AgeBand, BiomeId, Ms } from "../types/core";

// ---------------------------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------------------------

export type PlacementTierId = "home" | "top" | "bottom" | "words" | "capitals" | "numbers";

/** One rung of the ladder: the keys it adds and what its blocks show. */
export interface PlacementTier {
  id: PlacementTierId;
  /** Keys this rung adds to the ones before it (weighted up while on this rung). */
  newKeys: readonly string[];
  kind: ContentKind;
  /** Word pool ids for a band, for word-like rungs. Empty for letter rungs. */
  pools: (band: AgeBand) => string[];
  /**
   * Keys of earlier rungs that stay in play. Letter rungs keep all earlier letters. The number
   * rung asks for digits only, so its blocks are digits and nothing else.
   */
  keepEarlier: boolean;
  /** The biome that teaches this rung's keys: where a player who stops on this rung starts. */
  biome: BiomeId;
}

const chars = (s: string): string[] => Array.from(s);
const LOWER = chars("abcdefghijklmnopqrstuvwxyz");
const UPPER = LOWER.map((c) => c.toUpperCase());

/**
 * Home row → top → bottom → words → capitals → numbers (the card). Each rung's biome is the one
 * that teaches it (PLAN.md §3.1). The bottom rung leaves out `, . /`: they come with the
 * punctuation lessons, not with the letters.
 */
export const PLACEMENT_TIERS: readonly PlacementTier[] = [
  {
    id: "home",
    newKeys: chars("asdfghjkl;"),
    kind: "letters",
    pools: () => [],
    keepEarlier: true,
    biome: "meadow",
  },
  {
    id: "top",
    newKeys: chars("qwertyuiop"),
    kind: "letters",
    pools: () => [],
    keepEarlier: true,
    biome: "birch",
  },
  {
    id: "bottom",
    newKeys: chars("zxcvbnm"),
    kind: "letters",
    pools: () => [],
    keepEarlier: true,
    biome: "shore",
  },
  {
    id: "words",
    newKeys: [],
    kind: "words",
    pools: (band) => [`frosty-${band}`],
    keepEarlier: true,
    biome: "frosty",
  },
  {
    id: "capitals",
    newKeys: UPPER,
    kind: "words",
    pools: (band) => [`mines-${band}`],
    keepEarlier: true,
    biome: "mines",
  },
  {
    id: "numbers",
    newKeys: chars("1234567890"),
    kind: "letters",
    pools: () => [],
    keepEarlier: false,
    biome: "marsh",
  },
];

/**
 * The ladder's rules (the card): a rung opens on 8 clean blocks among the last 10 that use one of
 * its new keys, once each of the keys it must cover has broken cleanly (M3-FIX-3 N1).
 */
export const LADDER_RULES = {
  /** Blocks looked back on, counted from the start of the current rung. */
  window: 10,
  /** Clean blocks (no slip) in that window that open the next rung. */
  need: 8,
} as const;

/**
 * The keys a rung must see broken cleanly, each at least once, before it can open the next one:
 * the new keys of a single-letter rung. Word rungs cover none: the words rung adds no keys, and
 * every capitals block already has a capital.
 */
export function coverKeys(tier: number): string[] {
  const own = PLACEMENT_TIERS[tier];
  return own === undefined || own.kind !== "letters" ? [] : [...own.newKeys];
}

/**
 * Whether a block counts toward its rung's 8-of-10 window: it uses one of the rung's new keys.
 * A rung with no new keys (words) counts every block. So the window can't fill on old keys alone
 * (M3-FIX-3 N1).
 */
export function testsNewKey(tier: number, text: string): boolean {
  const own = PLACEMENT_TIERS[tier];
  if (own === undefined || own.newKeys.length === 0) return true;
  return Array.from(text).some((c) => own.newKeys.includes(c));
}

/**
 * The highest rung a band may reach. Sprouts stop at words, so they never place past Frosty;
 * Miners stop at capitals, so they never place past the Deep Mines (M3-05 review N3).
 */
export const MAX_TIER: Readonly<Record<AgeBand, number>> = {
  sprout: PLACEMENT_TIERS.findIndex((t) => t.id === "words"),
  miner: PLACEMENT_TIERS.findIndex((t) => t.id === "capitals"),
  builder: PLACEMENT_TIERS.length - 1,
};

/** Where the test stands. */
export interface Ladder {
  /** The current rung, an index into {@link PLACEMENT_TIERS}. */
  readonly tier: number;
  readonly maxTier: number;
  /**
   * Clean (true) or not, for the blocks finished on the current rung that use one of its new keys
   * ({@link testsNewKey}), oldest first. Last 10 kept.
   */
  readonly recent: readonly boolean[];
  /** The rung's {@link coverKeys} not yet broken cleanly. The rung can't open the next while any is left. */
  readonly pending: readonly string[];
}

export function createLadder(band: AgeBand): Ladder {
  return { tier: 0, maxTier: MAX_TIER[band], recent: [], pending: coverKeys(0) };
}

/**
 * Records one finished block, `text`, and whether it was `clean` (no slip). A block that uses
 * none of the rung's new keys changes nothing. The next rung opens (unless this is the band's top
 * rung) when 8 of the last 10 counted blocks were clean and every key the rung must cover has
 * broken cleanly; the count starts over there.
 */
export function ladderRecord(
  l: Ladder,
  clean: boolean,
  text: string,
): { ladder: Ladder; advanced: boolean } {
  if (!testsNewKey(l.tier, text)) return { ladder: l, advanced: false };
  const typed = Array.from(text);
  const pending = clean ? l.pending.filter((k) => !typed.includes(k)) : l.pending;
  const recent = [...l.recent, clean].slice(-LADDER_RULES.window);
  const good = recent.filter(Boolean).length;
  if (good >= LADDER_RULES.need && pending.length === 0 && l.tier < l.maxTier) {
    const tier = l.tier + 1;
    return {
      ladder: { tier, maxTier: l.maxTier, recent: [], pending: coverKeys(tier) },
      advanced: true,
    };
  }
  return { ladder: { tier: l.tier, maxTier: l.maxTier, recent, pending }, advanced: false };
}

/** The keys a rung asks for: its own plus, for most rungs, every earlier rung's. */
export function tierKeys(tier: number): string[] {
  const own = PLACEMENT_TIERS[tier];
  if (own === undefined) return [];
  if (!own.keepEarlier) return [...own.newKeys];
  const keys: string[] = [];
  for (const t of PLACEMENT_TIERS.slice(0, tier + 1)) {
    if (!t.keepEarlier) continue;
    for (const k of t.newKeys) if (!keys.includes(k)) keys.push(k);
  }
  // Word rungs spell with the whole alphabet: the letters rungs only add up to it.
  if (own.kind !== "letters") for (const k of LOWER) if (!keys.includes(k)) keys.push(k);
  return keys;
}

// ---------------------------------------------------------------------------------------------
// The test's length
// ---------------------------------------------------------------------------------------------

/** The test's length, in every mode. Calm mode ends here too, with no clock shown (review B1). */
export const PLACEMENT_MS: Ms = 90_000;

// ---------------------------------------------------------------------------------------------
// The estimate
// ---------------------------------------------------------------------------------------------

/**
 * What the test measured from its start until the rung after this one opened: cumulative, so it
 * takes in the earlier rungs too. Placement mode records one for each rung it leaves
 * (`createPlacementDriver().rungScores()`).
 */
export interface RungScore {
  /** The rung, an index into {@link PLACEMENT_TIERS}. */
  tier: number;
  /** Unpaused time from the start of the test until the next rung opened. */
  ms: Ms;
  /** Keys pressed on those blocks, right and wrong. */
  keystrokes: number;
  /** Right keys on those blocks. */
  correct: number;
}

/** How the test went, besides the summary. */
export interface PlacementProgression {
  band: AgeBand;
  /** The highest rung reached (opened), an index into {@link PLACEMENT_TIERS}. */
  tierReached: number;
  /** The profile's session index the test counts as (for the key stats). */
  sessionIndex: number;
  /**
   * A score for each rung the test left, below {@link tierReached}. Without them every gate is
   * judged on the whole test, as M3-05 did.
   */
  rungs?: readonly RungScore[];
}

export interface PlacementEstimate {
  startBiome: BiomeId;
  /** Per-key stats from the test, as the profile would fold them. */
  keyBaseline: Record<string, KeyStat>;
}

/**
 * The speed and accuracy a player needs to start in each biome past the Meadow. Reaching the
 * biome's rung on the ladder is needed too. Each gate is judged on the blocks typed before the
 * biome's rung opened, with at least {@link PLACEMENT_MIN_GATE_KEYS} keystrokes, not on the whole
 * test (see {@link estimatePlacement}). Net WPM counts a single letter as
 * one char, like every WPM in the game.
 */
export const PLACEMENT_GATES: Readonly<
  Partial<Record<BiomeId, { netWpm: number; accuracy: number }>>
> = {
  birch: { netWpm: 12, accuracy: 0.88 },
  shore: { netWpm: 17, accuracy: 0.9 },
  frosty: { netWpm: 26, accuracy: 0.92 },
  mines: { netWpm: 32, accuracy: 0.93 },
  marsh: { netWpm: 38, accuracy: 0.94 },
};

/**
 * The fewest keystrokes a gate is judged on. When the blocks before a rung opened are fewer, the
 * count runs on to the end of the next rung, and so on (M3-FIX-3 N2). The home rung alone is
 * about 12 keys, too few for an accuracy bar: two slips there would be 83 %.
 */
export const PLACEMENT_MIN_GATE_KEYS = 60;

/**
 * A test shorter than this, in unpaused elapsed time (`SessionSummary.activeMs`, not time spent
 * typing), says too little to move anyone past the Meadow. Every test runs 90 s, so today it only
 * guards against a result cut short.
 */
export const PLACEMENT_MIN_ACTIVE_MS: Ms = 30_000;

/**
 * The row floor (M3-FIX-10): a player starts past Birch Forest only if they typed the top row
 * right on the first try at least this share of the time, over the whole test, and past Sandy
 * Shore only if they did the same on the top and bottom rows together ({@link rowFloorKeys}).
 *
 * The speed and accuracy gates pool every key, so a child who slips on a third of the top row
 * could pass them by luck and miss all of Birch Forest. The floor is Birch's own accuracy bar. It
 * pools a row's keys because one key gets only 5–10 tries in a test, too few to tell a slip from a
 * gap; a row gets about 25–140.
 */
export const PLACEMENT_ROW_FLOOR = 0.88;

/**
 * The share of the places asking for one of `keys` that the player hit on the first try, over the
 * whole test; 1 when none was asked for. Every wrong-key policy is `stay`, so each place ends on
 * one right press, and a second wrong press at the same place isn't counted (`./stats`): places
 * are `attempts − errors`.
 */
export function firstTryShare(
  summary: Pick<SessionSummary, "perKey">,
  keys: readonly string[],
): number {
  let attempts = 0;
  let errors = 0;
  for (const k of keys) {
    attempts += summary.perKey[k]?.attempts ?? 0;
    errors += summary.perKey[k]?.errors ?? 0;
  }
  const places = attempts - errors;
  return places <= 0 ? (errors === 0 ? 1 : 0) : Math.max(0, 1 - errors / places);
}

/**
 * The keys whose {@link PLACEMENT_ROW_FLOOR} a player must meet to start past rung `tier`'s biome:
 * the letter rows from the top row up to that rung's. So the top row past Birch, and the top and
 * bottom rows together past the Shore: the bottom row alone is about 20 places, too few to judge
 * a fast typist on. The home row has no floor: everyone starts at the Meadow anyway, and in the
 * sim a home-row floor only moved average and weak-pinky typists back there. Past the letter rungs
 * nothing is added: the gates judge the word rungs.
 */
export function rowFloorKeys(tier: number): readonly string[] {
  const keys: string[] = [];
  for (const [i, t] of PLACEMENT_TIERS.entries()) {
    if (i === 0 || i > tier || t.kind !== "letters" || !t.keepEarlier) continue;
    keys.push(...t.newKeys);
  }
  return keys;
}

/** Net WPM and accuracy of a {@link RungScore}, by the session formulas (`./stats`). */
export function rungRates(score: RungScore): { netWpm: number; accuracy: number } {
  // Every wrong-key policy is `stay` in the test, so nothing is left uncorrected: net = gross.
  const netWpm = score.ms < 1000 ? 0 : score.correct / 5 / (score.ms / 60_000);
  const accuracy = score.keystrokes === 0 ? 1 : score.correct / score.keystrokes;
  return { netWpm, accuracy };
}

/**
 * The biome a new player starts in, and their key baseline. The start is the furthest biome on
 * the ladder's path (Meadow, Birch, Shore, Frosty, Deep Mines, Marsh) for which all hold:
 *
 * 1. the test reached that biome's rung;
 * 2. the biome's {@link PLACEMENT_GATES} (and every earlier one's) is met by net WPM and accuracy
 *    on the blocks typed before the biome's rung opened: the keys the biome takes as known, not
 *    the ones it teaches. With fewer than {@link PLACEMENT_MIN_GATE_KEYS} keystrokes there, the
 *    blocks of the following rungs join in, up to the whole test. So the slower digits and Shift
 *    of later rungs don't pull down the gates before them (M3-FIX-3 N2). A result without rung
 *    scores is judged on the whole test.
 *
 *    In practice that 60-key floor decides most of it. The three letter rungs come to about 35 keys, so
 *    the Birch, Shore, Frosty and Deep Mines gates are all judged on everything up to the end of
 *    the words rung (or on the whole test, if the test never left it, as for every Sprout). Only
 *    the Marsh gate is judged on its own blocks, everything up to the end of the capitals;
 * 3. the start skips no row the player doesn't know: past Birch the top row, and past the Shore
 *    the top and bottom rows, typed right on the first try at least {@link PLACEMENT_ROW_FLOOR}
 *    of the time over the whole test (M3-FIX-10);
 * 4. the band allows it: a Sprout never starts past Frosty Peaks, a Miner never past the Deep
 *    Mines.
 *
 * A short test (under {@link PLACEMENT_MIN_ACTIVE_MS}) starts at the Meadow.
 */
export function estimatePlacement(
  summary: SessionSummary,
  progression: PlacementProgression,
): PlacementEstimate {
  const keyBaseline = foldSummaryIntoKeyStats({}, summary, progression.sessionIndex);
  const top = Math.min(progression.tierReached, MAX_TIER[progression.band]);
  const scoreFor = (tier: number): { netWpm: number; accuracy: number } => {
    // Rung scores are cumulative from the start of the test, so the first big enough one wins.
    for (let left = tier - 1; left < progression.tierReached; left++) {
      const score = progression.rungs?.find((r) => r.tier === left);
      if (score !== undefined && score.keystrokes >= PLACEMENT_MIN_GATE_KEYS) {
        return rungRates(score);
      }
    }
    return { netWpm: summary.netWpm, accuracy: summary.accuracy };
  };
  let start = 0;
  if (summary.activeMs >= PLACEMENT_MIN_ACTIVE_MS) {
    for (let i = 1; i <= top; i++) {
      const biome = PLACEMENT_TIERS[i]?.biome;
      const gate = biome === undefined ? undefined : PLACEMENT_GATES[biome];
      if (gate === undefined) break;
      const got = scoreFor(i);
      if (got.netWpm < gate.netWpm || got.accuracy < gate.accuracy) break;
      // Starting here skips the biome before it: its row must be known (M3-FIX-10).
      if (firstTryShare(summary, rowFloorKeys(i - 1)) < PLACEMENT_ROW_FLOOR) break;
      start = i;
    }
  }
  return { startBiome: PLACEMENT_TIERS[start]?.biome ?? "meadow", keyBaseline };
}
