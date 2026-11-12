/**
 * Folds a finished lesson into the profile (task M2-10, docs/impl/contracts.md §6, §15).
 *
 * Pure: takes the time as a parameter and returns a new profile. play-host calls it once per
 * finished lesson, then autosaves.
 */
import type { Lesson } from "@/content/lessons/types";
import { estimatePlacement } from "@/engine/placement";
import type { PlacementEstimate } from "@/engine/placement";
import { foldSummaryIntoBigramStats, foldSummaryIntoKeyStats } from "@/engine/stats";
import { PLACEMENT_TIER_EXTRA } from "@/modes/placement/lesson";
import type { ModeResult } from "@/modes/types";
import type { Profile, StoredSummary } from "@/save/schema";
import { BIOME_ORDER } from "@/types/core";
import type { BiomeId, EpochMs } from "@/types/core";

/** Biomes a biome's mastery lesson (≥ 2 stars) unlocks. Caverns opens both side and main path. */
export function biomesUnlockedBy(biome: BiomeId): BiomeId[] {
  if (biome === "caverns") return ["sparkstone", "citadel"];
  const next = BIOME_ORDER[BIOME_ORDER.indexOf(biome) + 1];
  return next === undefined ? [] : [next];
}

const MASTERY_STARS = 2;

type Stars = ModeResult["stars"];
const moreStars = (a: Stars, b: Stars): Stars => (a >= b ? a : b);

function storedSummary(result: ModeResult, at: EpochMs): StoredSummary {
  const { perKey: _perKey, bigrams: _bigrams, ...rest } = result.summary;
  return { ...rest, at };
}

function addLoot(
  inventory: Readonly<Record<string, number>>,
  loot: Readonly<Record<string, number>>,
): Record<string, number> {
  const next: Record<string, number> = { ...inventory };
  for (const [block, count] of Object.entries(loot)) {
    if (!Number.isInteger(count) || count <= 0) continue;
    next[block] = (next[block] ?? 0) + count;
  }
  return next;
}

/**
 * The profile after one finished session: session counter, key and bigram stats, history,
 * inventory, and for a lesson its best scores, plays and unlocks. Nothing ever re-locks.
 */
export function applyResult(
  profile: Readonly<Profile>,
  lesson: Lesson | null,
  result: ModeResult,
  at: EpochMs,
): Profile {
  const sessionIndex = profile.sessionCounter + 1;
  const { summary } = result;
  let progress = profile.progress;

  if (lesson !== null) {
    const prev = progress.lessons[lesson.id];
    const lessons = {
      ...progress.lessons,
      [lesson.id]: {
        bestStars: prev === undefined ? result.stars : moreStars(prev.bestStars, result.stars),
        bestNetWpm: Math.max(prev?.bestNetWpm ?? 0, summary.netWpm),
        bestAccuracy: Math.max(prev?.bestAccuracy ?? 0, summary.accuracy),
        plays: (prev?.plays ?? 0) + 1,
        lastPlayed: at,
      },
    };
    let unlockedBiomes = progress.unlockedBiomes;
    if (lesson.tags?.includes("mastery") === true && result.stars >= MASTERY_STARS) {
      const add = biomesUnlockedBy(lesson.biome).filter((b) => !unlockedBiomes.includes(b));
      if (add.length > 0) unlockedBiomes = [...unlockedBiomes, ...add];
    }
    progress = { ...progress, lessons, unlockedBiomes };
  }

  return {
    ...profile,
    progress,
    sessionCounter: sessionIndex,
    keyStats: foldSummaryIntoKeyStats(profile.keyStats, summary, sessionIndex),
    bigramStats: foldSummaryIntoBigramStats(profile.bigramStats, summary, sessionIndex),
    inventory: addLoot(profile.inventory, result.loot),
    history: [...profile.history, storedSummary(result, at)],
  };
}

// ---------------------------------------------------------------------------------------------
// Placement (task M3-05)
// ---------------------------------------------------------------------------------------------

/** The rung a placement result reached (`ModeResult.extra.placementTier`), or 0. */
export function placementTierOf(result: Pick<ModeResult, "extra">): number {
  const raw = result.extra?.[PLACEMENT_TIER_EXTRA];
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/** The estimate of a placement result for a profile (pure; the Placement screen reuses it). */
export function placementEstimateOf(
  profile: Readonly<Profile>,
  result: ModeResult,
): PlacementEstimate {
  return estimatePlacement(result.summary, {
    band: profile.ageBand,
    tierReached: placementTierOf(result),
    sessionIndex: profile.sessionCounter + 1,
  });
}

/**
 * Where a player really starts for an estimate: the estimated biome when it has lessons, else the
 * nearest biome before it that has some (biomes get their lessons one by one; until then a strong
 * typist starts at the furthest island that can be played). Meadow when none has any.
 */
export function playableStart(estimate: BiomeId, lessons: readonly Lesson[]): BiomeId {
  const has = new Set(lessons.map((l) => l.biome));
  for (let i = BIOME_ORDER.indexOf(estimate); i >= 0; i--) {
    const biome = BIOME_ORDER[i];
    if (biome !== undefined && has.has(biome)) return biome;
  }
  return "meadow";
}

/**
 * A lesson the placement test let the player skip: one star, never played. `plays: 0` is what
 * marks it (a real play always counts at least one), so no save field is needed. Its best WPM and
 * accuracy are 0 because nothing was measured; never show them as a score.
 */
export const testedOut = (at: EpochMs): Profile["progress"]["lessons"][string] => ({
  bestStars: 1,
  bestNetWpm: 0,
  bestAccuracy: 0,
  plays: 0,
  lastPlayed: at,
});

/** True for a lesson record the placement test filled in ({@link testedOut}). */
export const isTestedOut = (rec: { plays: number }): boolean => rec.plays === 0;

/**
 * The profile after a placement test (PLAN.md §3.2.8, contracts §6 "Unlocks"). Like
 * {@link applyResult} it counts the session, folds bigrams, keeps the loot and the history. Then:
 *
 * - the start is {@link playableStart} of {@link estimatePlacement};
 * - every biome on the path up to the start unlocks (nothing ever re-locks);
 * - each lesson in the biomes before the start, not yet played, is "tested out" ({@link testedOut});
 * - key stats take the test's baseline for keys the profile has no stats for yet;
 * - `progress.placement` records when and where (the start actually used).
 */
export function applyPlacement(
  profile: Readonly<Profile>,
  lessons: readonly Lesson[],
  result: ModeResult,
  at: EpochMs,
): Profile {
  const sessionIndex = profile.sessionCounter + 1;
  const estimate = placementEstimateOf(profile, result);
  const startBiome = playableStart(estimate.startBiome, lessons);
  const upTo = BIOME_ORDER.indexOf(startBiome);

  const unlockedBiomes = [...profile.progress.unlockedBiomes];
  for (const biome of BIOME_ORDER.slice(0, upTo + 1)) {
    if (!unlockedBiomes.includes(biome)) unlockedBiomes.push(biome);
  }
  const done = { ...profile.progress.lessons };
  for (const lesson of lessons) {
    if (BIOME_ORDER.indexOf(lesson.biome) >= upTo || done[lesson.id] !== undefined) continue;
    done[lesson.id] = testedOut(at);
  }

  return {
    ...profile,
    progress: {
      ...profile.progress,
      lessons: done,
      unlockedBiomes,
      placement: { doneAt: at, startBiome },
    },
    sessionCounter: sessionIndex,
    // Stats from real lessons, if any, win over the test's.
    keyStats: { ...estimate.keyBaseline, ...profile.keyStats },
    bigramStats: foldSummaryIntoBigramStats(profile.bigramStats, result.summary, sessionIndex),
    inventory: addLoot(profile.inventory, result.loot),
    history: [...profile.history, storedSummary(result, at)],
  };
}
