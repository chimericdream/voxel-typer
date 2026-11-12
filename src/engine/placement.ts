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
 * What the test measured on the blocks typed at or below one rung: everything from the start of
 * the test until the next rung opened (cumulative, so it includes the earlier rungs). Placement mode records one for each rung it leaves
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
 * biome's rung on the ladder is needed too. Each gate is judged on the blocks that earned the
 * rung, not on the whole test (see {@link estimatePlacement}). Net WPM counts a single letter as
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
 *    scores is judged on the whole test;
 * 3. the band allows it: a Sprout never starts past Frosty Peaks, a Miner never past the Deep
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
      start = i;
    }
  }
  return { startBiome: PLACEMENT_TIERS[start]?.biome ?? "meadow", keyBaseline };
}
