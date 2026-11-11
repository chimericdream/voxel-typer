/**
 * Save data schema (docs/impl/contracts.md §15). Pure.
 *
 * Everything stays on the device. A profile holds a nickname and an age band; no real names, no
 * email, no birth date. Orchestrator-owned after M1-09.
 */
import type { SessionSummary, KeyStat } from "@/engine/stats";
import type { VoxelGrid } from "@/render/mesher/voxel-grid";
import type { AchievementId, AgeBand, BiomeId, BlockId, EpochMs, LessonId } from "@/types/core";
import type { Settings } from "./settings";

/** One learner's saved state. At most 8 profiles per device. */
export interface Profile {
  /** From `newId()` (`./id`), not `crypto.randomUUID()` directly; see the note there. */
  id: string;
  /** A nickname, 1–16 chars, validated by the word-list blocklist. */
  name: string;
  ageBand: AgeBand;
  avatar: { skin: string; hat?: string; pickaxe?: string; cape?: string; pet?: string };
  createdAt: EpochMs;
  settings: Settings;
  progress: {
    lessons: Record<
      LessonId,
      {
        bestStars: 0 | 1 | 2 | 3;
        bestNetWpm: number;
        bestAccuracy: number;
        plays: number;
        lastPlayed: EpochMs;
      }
    >;
    /** Nothing ever re-locks (contracts §6). */
    unlockedBiomes: BiomeId[];
    placement?: { doneAt: EpochMs; startBiome: BiomeId };
  };
  /** Counts finished sessions. Spaced repetition is scheduled in sessions, not days. */
  sessionCounter: number;
  keyStats: Record<string, KeyStat>;
  bigramStats: Record<string, KeyStat>;
  inventory: Record<BlockId, number>;
  island: {
    grid: ReturnType<VoxelGrid["toJSON"]>;
    expansions: number;
    lastEdited: EpochMs;
  } | null;
  cosmetics: { unlocked: string[] };
  /** Achievement id → unlock time. */
  achievements: Record<AchievementId, EpochMs>;
  /** Dates are `"YYYY-MM-DD"`, local. */
  daily: { lastDone?: string; streakDates: string[] };
  /** Newest last. Capped at 500; the oldest are then compacted into `weekly`. */
  history: StoredSummary[];
  weekly: {
    weekStart: string;
    minutes: number;
    sessions: number;
    avgNetWpm: number;
    avgAccuracy: number;
  }[];
  schemaVersion: number;
}

/** A session summary as kept in `Profile.history`: without the per-key detail, plus when it ended. */
export type StoredSummary = Omit<SessionSummary, "perKey" | "bigrams"> & { at: EpochMs };
