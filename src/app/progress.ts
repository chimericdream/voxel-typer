/**
 * Folds a finished lesson into the profile (task M2-10, docs/impl/contracts.md §6, §15).
 *
 * Pure: takes the time as a parameter and returns a new profile. play-host calls it once per
 * finished lesson, then autosaves.
 */
import type { Lesson } from "@/content/lessons/types";
import { foldSummaryIntoBigramStats, foldSummaryIntoKeyStats } from "@/engine/stats";
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
