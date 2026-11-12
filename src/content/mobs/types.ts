/**
 * Mob content (task M4-03, PLAN.md §7.3). Pure data.
 *
 * Every creature here is original to Voxel Typer (CLAUDE.md, IP rule). A mob never hurts anyone and
 * is never hurt: typing its word makes it pop into sparkles and leave a block behind.
 */
import type { MessageKey } from "@/i18n";
import type { DefenseMob } from "@/modes/defense/director";
import type { BiomeId } from "@/types/core";

/** The wave-1 mobs. Each id is also the model id and the `<id>.model.json` file name. */
export type MobId =
  | "slimeling"
  | "moss-golem"
  | "cave-bat"
  | "frost-pup"
  | "cactus-cat"
  | "lantern-fish"
  | "crystal-crab"
  | "sandstorm-imp";

/**
 * One mob. It is a {@link DefenseMob}, so a list of these goes straight into the wave director.
 *
 * `flavor` is a word-pool tag exactly as the pools carry it (`theme=snow`). The director uses those
 * words when the learner can type at least 8 of them, and the lesson's words otherwise.
 */
export interface MobDef extends DefenseMob {
  readonly id: MobId;
  /** i18n key of the display name. */
  readonly nameKey: MessageKey;
  /** i18n key of a one-line, friendly description. */
  readonly aboutKey: MessageKey;
  /** The biome this mob lives in. */
  readonly home: BiomeId;
  /**
   * The model, as the raw JSON of `<id>.model.json`. Content is a pure zone and can't import the
   * model code, so turn it into a `VoxelModel` with `parseModel(mob.model, mob.id)` from
   * `@/render/models`. Every model has `idle` and `walk` (loops) and `hit` and `defeat` (one-shots).
   */
  readonly model: unknown;
}

/** A creature that only decorates a scene: no word, no lane, nothing to type. */
export interface AmbientDef {
  readonly id: string;
  readonly nameKey: MessageKey;
  readonly home: BiomeId;
  /** Raw model JSON, as in {@link MobDef.model}. It has `idle`, `walk` and its own extras. */
  readonly model: unknown;
}
