/**
 * Builder as a lesson record (task M4-07), so the play host can run it like any other mode, the
 * way the placement test does. It is not in the curriculum: no lesson file lists it, the map's
 * paths never show it, and its result never goes into `progress.lessons`.
 *
 * Also here: what Builder and the play host say to each other about saving. The island is saved
 * **while** the mode runs (every 30 s, and on a pause), which no other mode needs, so it travels
 * on the run's bus as a namespaced event (contracts §7.2). The last save rides in the result's
 * `extra`, so leaving writes the island and the practice session in one save.
 *
 * Everything in this file is light and pure: the app's first bundle imports it.
 */
import type { Lesson } from "@/content/lessons/types";
import { foundBlocks } from "@/engine/achievements";
import type { Profile } from "@/save/schema";
import type { BlockId } from "@/types/core";

/** The route's `lesson` while Builder runs: `{ id: "play", lesson: BUILDER_LESSON_ID }`. */
export const BUILDER_LESSON_ID = "builder";

export const BUILDER_LESSON: Lesson = {
  id: BUILDER_LESSON_ID,
  // The Home Island starts as a piece of the Meadow.
  biome: "meadow",
  order: 0,
  titleKey: "builder.title",
  newKeys: [],
  reviewKeys: [],
  kind: "words",
  // Free play: it ends when the child leaves.
  length: { chars: 0 },
  mode: "builder",
  // No stars.
  targets: { accuracy: 0 },
};

export const isBuilderLesson = (lesson: Pick<Lesson, "mode">): boolean => lesson.mode === "builder";

/** The island and the inventory as the editor has them now. They are always written together. */
export interface IslandPatch {
  island: NonNullable<Profile["island"]>;
  inventory: Record<BlockId, number>;
}

/** The bus event Builder emits to save the island while it runs. Its payload: {@link IslandPatch}. */
export const BUILDER_SAVE_EVENT = "builder:save";
/** Where a Builder result carries its last {@link IslandPatch} (absent when nothing changed). */
export const BUILDER_ISLAND_EXTRA = "builderIsland";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

function isIsland(v: unknown): v is IslandPatch["island"] {
  if (!isRecord(v) || !isCount(v["expansions"]) || typeof v["lastEdited"] !== "number") {
    return false;
  }
  const grid = v["grid"];
  return (
    isRecord(grid) &&
    isCount(grid["sx"]) &&
    isCount(grid["sy"]) &&
    isCount(grid["sz"]) &&
    Array.isArray(grid["rle"]) &&
    grid["rle"].every(isCount)
  );
}

/** Narrows a bus payload or a result's `extra` value. Null for anything malformed. */
export function islandPatchOf(v: unknown): IslandPatch | null {
  if (!isRecord(v)) return null;
  const { island, inventory } = v;
  if (!isIsland(island) || !isRecord(inventory)) return null;
  const counts: Record<BlockId, number> = {};
  for (const [id, n] of Object.entries(inventory)) {
    if (!isCount(n)) return null;
    counts[id] = n;
  }
  return { island, inventory: counts };
}

/**
 * The profile with the island and inventory of a patch. Everything else is kept as it is.
 *
 * `found` (lifetime finds, M3-10) is never changed by building. A profile from before that field
 * existed gets it written here, from the inventory as it was **before** this first island change:
 * afterwards the inventory moves with every block placed or dug, and would no longer say what the
 * player found.
 */
export function withIslandPatch(profile: Readonly<Profile>, patch: IslandPatch): Profile {
  return {
    ...profile,
    island: patch.island,
    inventory: { ...patch.inventory },
    ...(profile.found === undefined && { found: foundBlocks(profile) }),
  };
}

/** The profile with a Builder result's last island save, or the same object when it has none. */
export function withBuilderIsland(
  profile: Profile,
  result: { extra?: Record<string, unknown> },
): Profile {
  const patch = islandPatchOf(result.extra?.[BUILDER_ISLAND_EXTRA]);
  return patch === null ? profile : withIslandPatch(profile, patch);
}
