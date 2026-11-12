/**
 * The placement test as a lesson record (task M3-05), so the play host can run it like any other
 * lesson. It is not in the curriculum: no lesson file lists it, the map never shows it, and its
 * result never goes into `progress.lessons` (`applyPlacement` handles it instead).
 */
import type { Lesson } from "@/content/lessons/types";
import { PLACEMENT_TIERS } from "@/engine/placement";

/** The route's `lesson` while the test plays: `{ id: "play", lesson: PLACEMENT_LESSON_ID }`. */
export const PLACEMENT_LESSON_ID = "placement";

export const PLACEMENT_LESSON: Lesson = {
  id: PLACEMENT_LESSON_ID,
  // The test is mined in the Meadow, the first place every player sees.
  biome: "meadow",
  order: 0,
  titleKey: "placement.title",
  newKeys: [...(PLACEMENT_TIERS[0]?.newKeys ?? [])],
  reviewKeys: [],
  kind: "letters",
  length: { seconds: 90 },
  mode: "placement",
  // No stars: the test has no pass mark.
  targets: { accuracy: 0 },
  // A slip never moves the cursor on, for every band: the test asks for the right key.
  policy: { sprout: "stay", miner: "stay", builder: "stay" },
  bandScale: { sprout: 1, miner: 1, builder: 1 },
};

/** What a placement result carries in `extra`: the highest rung the test opened (a number). */
export const PLACEMENT_TIER_EXTRA = "placementTier";

export const isPlacementLesson = (lesson: Pick<Lesson, "mode">): boolean =>
  lesson.mode === "placement";
