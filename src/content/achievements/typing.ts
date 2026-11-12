/**
 * Typing achievements (task M3-10). Pure data. None of them asks for speed: each one can be
 * earned by a slow, careful typist (PLAN.md §3.3).
 */
import type { AchievementDef } from "@/engine/achievements";
import { fingerFor, layoutById, EN_US } from "@/content/layouts";

/** The home row's eight finger keys on the shipped layouts (en-US and en-GB agree). */
export const HOME_ROW_KEYS = ["a", "s", "d", "f", "j", "k", "l", ";"] as const;
/** "Most of them right" for Home Row Hero: Sprout's 2-star bar (decision 80). */
export const HOME_ROW_ACCURACY = 0.85;
export const PINKY_PRESSES = 50;
export const CLEAN_MINUTE_MS = 60_000;
export const CLEAN_WORDS = 10;
export const STREAK_SHORT = 25;
export const STREAK_LONG = 100;

export const achievements: AchievementDef[] = [
  {
    id: "first-word",
    nameKey: "achievements.firstWord.name",
    descKey: "achievements.firstWord.desc",
    icon: { block: "oak-planks" },
    live: true,
    check: (ctx) => ctx.events.wordsCompleted >= 1,
  },
  {
    id: "neat-ten",
    nameKey: "achievements.neatTen.name",
    descKey: "achievements.neatTen.desc",
    icon: { block: "brick" },
    live: true,
    check: (ctx) => ctx.events.bestCleanWordRun >= CLEAN_WORDS,
  },
  {
    id: "steady-hands",
    nameKey: "achievements.steadyHands.name",
    descKey: "achievements.steadyHands.desc",
    icon: { block: "cobble" },
    live: true,
    check: (ctx) => ctx.events.longestStreak >= STREAK_SHORT,
  },
  {
    id: "hundred-hop",
    nameKey: "achievements.hundredHop.name",
    descKey: "achievements.hundredHop.desc",
    icon: { block: "lantern" },
    live: true,
    check: (ctx) => ctx.events.longestStreak >= STREAK_LONG,
  },
  {
    id: "clean-minute",
    nameKey: "achievements.cleanMinute.name",
    descKey: "achievements.cleanMinute.desc",
    icon: { block: "glass" },
    live: true,
    check: (ctx) => ctx.events.bestCleanMs >= CLEAN_MINUTE_MS,
  },
  {
    id: "not-one-slip",
    nameKey: "achievements.notOneSlip.name",
    descKey: "achievements.notOneSlip.desc",
    icon: { block: "meadowstone" },
    // A whole lesson, start to end, with every key right. Single-letter lessons count.
    check: (ctx) =>
      ctx.lesson !== null &&
      ctx.result !== null &&
      ctx.result.summary.errors === 0 &&
      ctx.result.summary.targetsCompleted >= 5,
  },
  {
    id: "home-row-hero",
    nameKey: "achievements.homeRowHero.name",
    descKey: "achievements.homeRowHero.desc",
    icon: { block: "grass" },
    check: (ctx) => {
      const perKey = ctx.result?.summary.perKey;
      if (perKey === undefined) return false;
      let attempts = 0;
      let errors = 0;
      for (const k of HOME_ROW_KEYS) {
        const agg = perKey[k];
        if (agg === undefined || agg.attempts === 0) return false;
        attempts += agg.attempts;
        errors += agg.errors;
      }
      return (attempts - errors) / attempts >= HOME_ROW_ACCURACY;
    },
  },
  {
    id: "pinky-power",
    nameKey: "achievements.pinkyPower.name",
    descKey: "achievements.pinkyPower.desc",
    icon: { block: "red-blooms" },
    // Lifetime right presses of keys the little fingers type, on the player's own layout.
    check: (ctx) => {
      const layout = layoutById(ctx.profile.settings.layout) ?? EN_US;
      let right = 0;
      for (const [char, stat] of Object.entries(ctx.profile.keyStats)) {
        const finger = fingerFor(layout, char);
        if (finger === "L5" || finger === "R5") right += Math.max(0, stat.attempts - stat.errors);
      }
      return right >= PINKY_PRESSES;
    },
  },
];
