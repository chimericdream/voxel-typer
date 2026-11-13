/**
 * Blueprint data types (task M4-08, PLAN.md §3.2.4). Pure.
 *
 * A blueprint is a small build a child stamps onto their Home Island by typing its name. It is
 * written as text layers so a reviewer can read the shape:
 *
 * - `layers[0]` is the bottom layer (y = 0). Each layer is a list of rows, north (−z) first; each
 *   row is a string of cells, west (−x) first. Every layer has the same rows and row length.
 * - A character is looked up in `key`; `.` is air. Air leaves the island alone when stamped.
 * - Stamping puts the grid's (0, 0, 0) at `stampOrigin(cursor)`: centered on the cursor's column,
 *   standing on the cursor's layer (`src/modes/builder/logic.ts`).
 */
import type { MessageKey } from "@/i18n";
import type { AchievementId, BiomeId, BlockId } from "@/types/core";

/**
 * When a blueprint is offered. Both kinds read only `profile.achievements`, which only ever grows,
 * so a blueprint never goes away again.
 * - `biome`: the biome is completed, which is its badge (`<biome>-master`, M3-10): every lesson of
 *   the biome played.
 * - `badge`: any achievement.
 */
export type BlueprintUnlock =
  | { kind: "biome"; biome: BiomeId }
  | { kind: "badge"; achievement: AchievementId };

export interface BlueprintDef {
  /** Stable id, kebab-case. */
  id: string;
  /** What the child types: lowercase a–z, a short real word. */
  typedName: string;
  /** Display name (`blueprints.<id>`). */
  nameKey: MessageKey;
  /** Layers, bottom first; rows north first; cells west first. */
  layers: readonly (readonly string[])[];
  /** Cell character → block id. `.` is always air and is not listed. */
  key: Readonly<Record<string, BlockId>>;
  /**
   * What one stamp on empty ground takes from the inventory, per block. Written out so the price
   * reads with the shape; a test checks it against the layers.
   */
  cost: Readonly<Record<BlockId, number>>;
  unlock: BlueprintUnlock;
}
