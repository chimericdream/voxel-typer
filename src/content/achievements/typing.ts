/**
 * Typing achievements (task M3-10). Pure data. None of them asks for speed: each one can be
 * earned by a slow, careful typist (PLAN.md §3.3).
 */
import type { AchievementDef } from "@/engine/achievements";
import { fingerFor, layoutById, EN_US } from "@/content/layouts";
import type { AgeBand } from "@/types/core";

/** The home row's eight finger keys on the shipped layouts (en-US and en-GB agree). */
export const HOME_ROW_KEYS = ["a", "s", "d", "f", "j", "k", "l", ";"] as const;
export const PINKY_PRESSES = 50;
export const CLEAN_MINUTE_MS = 60_000;

/**
 * Counts that depend on the age band, so each badge can be earned in the lessons that ship today
 * (shorter for Sprouts: their lessons are about 0.6× as long). A unit test plays every shipped
 * lesson perfectly, for each band, and checks each count is reached.
 */
export const STREAK_SHORT: Readonly<Record<AgeBand, number>> = {
  sprout: 15,
  miner: 25,
  builder: 25,
};
export const STREAK_LONG: Readonly<Record<AgeBand, number>> = {
  sprout: 25,
  miner: 40,
  builder: 50,
};
export const CLEAN_WORDS: Readonly<Record<AgeBand, number>> = { sprout: 5, miner: 8, builder: 10 };

const count = (table: Readonly<Record<AgeBand, number>>) => (band: AgeBand) => ({
  count: table[band],
});

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
    id: "neat-words",
    nameKey: "achievements.neatWords.name",
    descKey: "achievements.neatWords.desc",
    descParams: count(CLEAN_WORDS),
    icon: { block: "brick" },
    live: true,
    check: (ctx) => ctx.events.bestCleanWordRun >= CLEAN_WORDS[ctx.profile.ageBand],
  },
  {
    id: "steady-hands",
    nameKey: "achievements.steadyHands.name",
    descKey: "achievements.steadyHands.desc",
    descParams: count(STREAK_SHORT),
    icon: { block: "cobble" },
    live: true,
    check: (ctx) => ctx.events.longestStreak >= STREAK_SHORT[ctx.profile.ageBand],
  },
  {
    id: "long-hop",
    nameKey: "achievements.longHop.name",
    descKey: "achievements.longHop.desc",
    descParams: count(STREAK_LONG),
    icon: { block: "lantern" },
    live: true,
    check: (ctx) => ctx.events.longestStreak >= STREAK_LONG[ctx.profile.ageBand],
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
    // "Use" means each of the 8 keys was pressed right at least once in the lesson. No accuracy
    // bar: the card says nothing about one.
    check: (ctx) => {
      const perKey = ctx.result?.summary.perKey;
      if (perKey === undefined) return false;
      return HOME_ROW_KEYS.every((k) => {
        const agg = perKey[k];
        return agg !== undefined && agg.attempts - agg.errors >= 1;
      });
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
