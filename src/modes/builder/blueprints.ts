/**
 * Builder's blueprint hook (task M4-07; the blueprints themselves are M4-08, in
 * `src/content/blueprints/`).
 *
 * A blueprint's name is a command, the command stamps the grid centered on the cursor
 * (`stampOrigin`), and a stamp the inventory can't pay for answers with what is still missing.
 * Rules every blueprint keeps (`tests/unit/content/blueprints.test.ts` checks them):
 * - `typedName` is lowercase a–z and differs from every block's `typedName`, every direction and
 *   `put` / `dig` / `undo`. A clash is left out and listed in `Vocabulary.conflicts`.
 * - Each blueprint costs at least one block that only Mine loot gives (M4-06 review), so a stamp
 *   can't be paid for by digging up starter terrain alone.
 * - The grid includes its own floor, and fits in 24×32×24.
 */
import { blocks } from "@/content/blocks";
import { blueprintGrid, unlockedBlueprints } from "@/content/blueprints";
import { islandBlocks } from "@/engine/island";
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

/**
 * The blueprints a player may stamp: those whose unlock condition holds (a completed biome or a
 * badge, `src/content/blueprints/`), in listing order. Read once when the island opens.
 */
export function blueprintsFor(profile: Readonly<Profile>): readonly BuilderBlueprint[] {
  const lookup = islandBlocks(blocks);
  return unlockedBlueprints(profile).map((def) => ({
    typedName: def.typedName,
    nameKey: def.nameKey,
    grid: blueprintGrid(def, (id) => lookup.numOf(id)),
  }));
}
