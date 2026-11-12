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

/** The ladder's rules (the card): a rung opens on 8 clean blocks among the last 10. */
export const LADDER_RULES = {
  /** Blocks looked back on, counted from the start of the current rung. */
  window: 10,
  /** Clean blocks (no slip) in that window that open the next rung. */
  need: 8,
} as const;

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
  /** Clean (true) or not, for the blocks finished on the current rung, oldest first. Last 10 kept. */
  readonly recent: readonly boolean[];
}

export function createLadder(band: AgeBand): Ladder {
  return { tier: 0, maxTier: MAX_TIER[band], recent: [] };
}

/**
 * Records one finished block. `clean` means it had no slip. When 8 of the last 10 blocks on this
 * rung were clean, the next rung opens (unless this is the band's top rung) and the count starts
 * over there.
 */
export function ladderRecord(l: Ladder, clean: boolean): { ladder: Ladder; advanced: boolean } {
  const recent = [...l.recent, clean].slice(-LADDER_RULES.window);
  const good = recent.filter(Boolean).length;
  if (good >= LADDER_RULES.need && l.tier < l.maxTier) {
    return { ladder: { tier: l.tier + 1, maxTier: l.maxTier, recent: [] }, advanced: true };
  }
  return { ladder: { tier: l.tier, maxTier: l.maxTier, recent }, advanced: false };
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

/** How the test went, besides the summary. */
export interface PlacementProgression {
  band: AgeBand;
  /** The highest rung reached (opened), an index into {@link PLACEMENT_TIERS}. */
  tierReached: number;
  /** The profile's session index the test counts as (for the key stats). */
  sessionIndex: number;
}

export interface PlacementEstimate {
  startBiome: BiomeId;
  /** Per-key stats from the test, as the profile would fold them. */
  keyBaseline: Record<string, KeyStat>;
}

/**
 * The speed and accuracy a player needs, over the whole test, to start in each biome past the
 * Meadow. Reaching the biome's rung on the ladder is needed too. Net WPM counts a single letter as
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

/** Fewer active seconds than this says too little to move anyone past the Meadow. */
export const PLACEMENT_MIN_ACTIVE_MS: Ms = 30_000;

/**
 * The biome a new player starts in, and their key baseline. The start is the furthest biome on
 * the ladder's path (Meadow, Birch, Shore, Frosty, Deep Mines, Marsh) for which all hold:
 *
 * 1. the test reached that biome's rung;
 * 2. net WPM and accuracy meet the biome's {@link PLACEMENT_GATES} (and every earlier one's);
 * 3. the band allows it: a Sprout never starts past Frosty Peaks.
 *
 * A short test (under {@link PLACEMENT_MIN_ACTIVE_MS}) starts at the Meadow.
 */
export function estimatePlacement(
  summary: SessionSummary,
  progression: PlacementProgression,
): PlacementEstimate {
  const keyBaseline = foldSummaryIntoKeyStats({}, summary, progression.sessionIndex);
  const top = Math.min(progression.tierReached, MAX_TIER[progression.band]);
  let start = 0;
  if (summary.activeMs >= PLACEMENT_MIN_ACTIVE_MS) {
    for (let i = 1; i <= top; i++) {
      const biome = PLACEMENT_TIERS[i]?.biome;
      const gate = biome === undefined ? undefined : PLACEMENT_GATES[biome];
      if (gate === undefined) break;
      if (summary.netWpm < gate.netWpm || summary.accuracy < gate.accuracy) break;
      start = i;
    }
  }
  return { startBiome: PLACEMENT_TIERS[start]?.biome ?? "meadow", keyBaseline };
}
