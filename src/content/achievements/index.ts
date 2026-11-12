/**
 * Every achievement, in the order the badge screen shows them (task M3-10). One file per area
 * (docs/impl/contracts.md §0); a new area adds one import and one spread here.
 */
import type { AchievementDef } from "@/engine/achievements";
import { achievements as collect } from "./collect";
import { achievements as progress } from "./progress";
import { achievements as typing } from "./typing";

export const achievements: readonly AchievementDef[] = [...progress, ...typing, ...collect];

export function achievementById(id: string): AchievementDef | null {
  return achievements.find((a) => a.id === id) ?? null;
}
