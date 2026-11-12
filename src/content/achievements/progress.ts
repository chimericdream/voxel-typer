/**
 * Progress achievements (task M3-10): lessons, stars, badges for each biome, and play days. Pure
 * data. Lessons the placement test let a player skip ("tested out", `plays: 0`) are not played
 * lessons here; a biome badge asks for every lesson really played.
 */
import type { AchievementContext, AchievementDef } from "@/engine/achievements";
import { localDayNumber, localHour } from "@/engine/achievements";
import type { BiomeId } from "@/types/core";

export const LESSONS_FOR_TEN = 10;
export const PLAYS_FOR_PRACTICE = 3;
export const PLAY_DAYS = 3;
/** Early Bird: a session that starts from 5 am up to (not including) 9 am, local time. */
export const EARLY_FROM_HOUR = 5;
export const EARLY_TO_HOUR = 9;

const played = (ctx: AchievementContext) =>
  Object.values(ctx.profile.progress.lessons).filter((l) => l.plays >= 1);

/** Every lesson of the biome has been played at least once (and it has lessons). */
export function biomeDone(ctx: AchievementContext, biome: BiomeId): boolean {
  const inBiome = ctx.lessons.filter((l) => l.biome === biome);
  return (
    inBiome.length > 0 &&
    inBiome.every((l) => (ctx.profile.progress.lessons[l.id]?.plays ?? 0) >= 1)
  );
}

function biomeBadge(
  biome: BiomeId,
  keys: Pick<AchievementDef, "nameKey" | "descKey">,
  block: string,
): AchievementDef {
  return {
    id: `${biome}-master`,
    ...keys,
    icon: { block },
    check: (ctx) => biomeDone(ctx, biome),
  };
}

export const achievements: AchievementDef[] = [
  {
    id: "first-lesson",
    nameKey: "achievements.firstLesson.name",
    descKey: "achievements.firstLesson.desc",
    icon: { block: "dirt" },
    check: (ctx) => played(ctx).length >= 1,
  },
  {
    id: "star-catcher",
    nameKey: "achievements.starCatcher.name",
    descKey: "achievements.starCatcher.desc",
    icon: { block: "sunny-flowers" },
    check: (ctx) => played(ctx).some((l) => l.bestStars === 3),
  },
  {
    id: "practice-pal",
    nameKey: "achievements.practicePal.name",
    descKey: "achievements.practicePal.desc",
    icon: { block: "oak-log" },
    check: (ctx) => played(ctx).some((l) => l.plays >= PLAYS_FOR_PRACTICE),
  },
  {
    id: "ten-trips",
    nameKey: "achievements.tenTrips.name",
    descKey: "achievements.tenTrips.desc",
    icon: { block: "mossy-cobble" },
    check: (ctx) => played(ctx).reduce((n, l) => n + l.plays, 0) >= LESSONS_FOR_TEN,
  },
  biomeBadge(
    "meadow",
    { nameKey: "achievements.meadowBadge.name", descKey: "achievements.meadowBadge.desc" },
    "grass",
  ),
  biomeBadge(
    "birch",
    { nameKey: "achievements.birchBadge.name", descKey: "achievements.birchBadge.desc" },
    "birch-log",
  ),
  biomeBadge(
    "shore",
    { nameKey: "achievements.shoreBadge.name", descKey: "achievements.shoreBadge.desc" },
    "sand",
  ),
  // No Frosty Peaks blocks yet: glass stands in for ice until that biome's blocks land.
  biomeBadge(
    "frosty",
    { nameKey: "achievements.frostyBadge.name", descKey: "achievements.frostyBadge.desc" },
    "glass",
  ),
  {
    id: "three-days",
    nameKey: "achievements.threeDays.name",
    descKey: "achievements.threeDays.desc",
    icon: { block: "oak-leaves" },
    // Any three days, not in a row: missing a day never costs anything.
    check: (ctx) => {
      if (ctx.when === null) return false;
      const tz = ctx.when.tzOffsetMin;
      const days = new Set(ctx.profile.history.map((h) => localDayNumber(h.at, tz)));
      return days.size >= PLAY_DAYS;
    },
  },
  {
    id: "early-bird",
    nameKey: "achievements.earlyBird.name",
    descKey: "achievements.earlyBird.desc",
    icon: { block: "yellow-wool" },
    // A surprise, purely for fun, so nobody is nudged to get up early for it.
    hidden: true,
    check: (ctx) => {
      if (ctx.when === null || ctx.result === null) return false;
      const hour = localHour(ctx.when.startedAt, ctx.when.tzOffsetMin);
      return hour >= EARLY_FROM_HOUR && hour < EARLY_TO_HOUR;
    },
  },
];
