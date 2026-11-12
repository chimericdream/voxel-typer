/**
 * Builder's blueprint hook (task M4-07; the blueprints themselves are M4-08).
 *
 * Builder already knows what to do with a blueprint: its name is a command, the command stamps
 * the grid centered on the cursor (`stampOrigin`), and a stamp the inventory can't pay for answers
 * with what is still missing. What it doesn't have yet is any blueprint.
 *
 * **M4-08:** return the player's unlocked blueprints from {@link blueprintsFor}, built from
 * `src/content/blueprints/`. Nothing else in Builder needs to change. Rules that card must keep:
 * - `typedName` is lowercase a–z and differs from every block's `typedName`, every direction and
 *   `put` / `dig` / `undo`. A clash is left out and listed in `Vocabulary.conflicts`.
 * - Each blueprint costs at least one block that only Mine loot gives (M4-06 review), so a stamp
 *   can't be paid for by digging up starter terrain alone.
 * - The grid includes its own floor, and fits in 24×32×24.
 */
import type { MessageKey } from "@/i18n";
import type { VoxelGrid } from "@/render/mesher/voxel-grid";
import type { Profile } from "@/save/schema";

export interface BuilderBlueprint {
  /** What the child types, e.g. `house`. */
  typedName: string;
  /** Its display name, for "You built a house!". */
  nameKey: MessageKey;
  /** Block nums; air cells leave the island alone (see `IslandCommand` `stamp`). */
  grid: VoxelGrid;
}

/** The blueprints a player may stamp. None until M4-08. */
export function blueprintsFor(_profile: Readonly<Profile>): readonly BuilderBlueprint[] {
  return [];
}
