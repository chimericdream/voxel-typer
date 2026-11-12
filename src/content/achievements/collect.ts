/**
 * Collecting achievements (task M3-10). Pure data. Loot rarity follows streak and accuracy, never
 * speed (contracts §18), so every one of these is open to a slow typist.
 */
import type { AchievementContext, AchievementDef } from "@/engine/achievements";
import { blocks } from "@/content/blocks";

export const BLOCKS_FOR_HUNDRED = 100;
export const KINDS_FOR_COLLECTOR = 5;
export const FLOWERS = ["red-blooms", "sunny-flowers", "bluebells", "purple-puffs"] as const;

const ORES: ReadonlySet<string> = new Set(
  blocks.filter((b) => b.tags.includes("ore")).map((b) => b.id),
);
const RARE: ReadonlySet<string> = new Set(
  blocks.filter((b) => b.rarity === "rare" || b.rarity === "epic").map((b) => b.id),
);

/** Blocks the player holds now, or found in the session just played. */
function has(ctx: AchievementContext, id: string): boolean {
  return (ctx.profile.inventory[id] ?? 0) > 0 || (ctx.result?.loot[id] ?? 0) > 0;
}

const held = (ctx: AchievementContext): string[] =>
  Object.entries(ctx.profile.inventory)
    .filter(([, n]) => n > 0)
    .map(([id]) => id);

export const achievements: AchievementDef[] = [
  {
    id: "first-ore",
    nameKey: "achievements.firstOre.name",
    descKey: "achievements.firstOre.desc",
    icon: { block: "copper-ore" },
    check: (ctx) => [...ORES].some((id) => has(ctx, id)),
  },
  {
    id: "lucky-find",
    nameKey: "achievements.luckyFind.name",
    descKey: "achievements.luckyFind.desc",
    icon: { block: "purple-puffs" },
    check: (ctx) => Object.entries(ctx.result?.loot ?? {}).some(([id, n]) => n > 0 && RARE.has(id)),
  },
  {
    id: "gem-finder",
    nameKey: "achievements.gemFinder.name",
    descKey: "achievements.gemFinder.desc",
    icon: { block: "meadowstone" },
    check: (ctx) => has(ctx, "meadowstone"),
  },
  {
    id: "flower-friend",
    nameKey: "achievements.flowerFriend.name",
    descKey: "achievements.flowerFriend.desc",
    icon: { block: "bluebells" },
    check: (ctx) => FLOWERS.every((id) => has(ctx, id)),
  },
  {
    id: "collector",
    nameKey: "achievements.collector.name",
    descKey: "achievements.collector.desc",
    icon: { block: "blue-wool" },
    check: (ctx) => held(ctx).length >= KINDS_FOR_COLLECTOR,
  },
  {
    id: "hundred-blocks",
    nameKey: "achievements.hundredBlocks.name",
    descKey: "achievements.hundredBlocks.desc",
    icon: { block: "stone" },
    check: (ctx) =>
      Object.values(ctx.profile.inventory).reduce((n, c) => n + Math.max(0, c), 0) >=
      BLOCKS_FOR_HUNDRED,
  },
];
