/**
 * Shared primitive types (docs/impl/contracts.md §1).
 *
 * Orchestrator-owned after M1-01: request changes in your handoff note (docs/impl/README.md §4.3).
 */

/** Milliseconds on the monotonic clock (`performance.now()` or a test clock). Never wall-clock time. */
export type Ms = number;

/** Wall-clock milliseconds since the Unix epoch (`Date.now()`). For save timestamps only. */
export type EpochMs = number;

/** Age band of a profile: `sprout` is the youngest, `builder` the oldest (PLAN.md §2). */
export type AgeBand = "sprout" | "miner" | "builder";

/** A biome of the world map. Curriculum order is {@link BIOME_ORDER}. */
export type BiomeId =
  | "meadow"
  | "birch"
  | "shore"
  | "frosty"
  | "mines"
  | "marsh"
  | "caverns"
  | "sparkstone"
  | "citadel";

/** A game mode. Resolve one to its module with `resolveMode` from `@/modes/registry`. */
export type GameModeId =
  | "mine"
  | "defense"
  | "minecart"
  | "builder"
  | "boss"
  | "daily"
  | "practice"
  | "placement";

/** `"<biome>-<2-digit order>"`, e.g. `"meadow-03"`. Remedial lessons use `"remedial-<hash>"`. */
export type LessonId = string;

/** Kebab-case slug, e.g. `"oak-planks"`. */
export type BlockId = string;

/** Kebab-case slug. */
export type AchievementId = string;

/** Render quality tier. */
export type QualityLevel = "low" | "medium" | "high";

/** Phase of the day/night cycle. */
export type TimeOfDay = "day" | "dusk" | "night" | "dawn";

/**
 * A finger: `L`/`R` is the hand, the digit is the finger (5 = pinky … 2 = index). `T` is either
 * thumb.
 */
export type Finger = "L5" | "L4" | "L3" | "L2" | "R2" | "R3" | "R4" | "R5" | "T";

/**
 * What a block is made of. It picks the break and place sounds (`AudioApi.sfx`, contracts §12) and
 * is part of every `BlockDef` (contracts §17).
 *
 * It is defined here, not in `src/audio/types.ts`, because the pure `src/content/blocks/types.ts`
 * needs it. `src/audio/types.ts` re-exports it, so both paths work.
 */
export type Material =
  | "dirt"
  | "stone"
  | "wood"
  | "glass"
  | "wool"
  | "sand"
  | "snow"
  | "crystal"
  | "metal"
  | "leaf";

/** The biomes in curriculum order. A biome's `mastery` lesson unlocks the next one (contracts §6). */
export const BIOME_ORDER: readonly BiomeId[] = [
  "meadow",
  "birch",
  "shore",
  "frosty",
  "mines",
  "marsh",
  "caverns",
  "sparkstone",
  "citadel",
];
