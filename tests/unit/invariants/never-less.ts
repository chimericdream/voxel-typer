/**
 * The no-failure rule (PLAN.md §1 pillar 2), as one check every invariant test shares (task
 * M4-10). Between a profile `before` and any profile the game later writes for the same player:
 *
 * - no block in the inventory goes down (Builder is the one exception: it moves blocks between
 *   the bag and the island, so there the island plus the bag is what holds, see {@link totals});
 * - no lifetime find (`found`) goes down;
 * - no unlocked biome is locked again;
 * - no lesson's best stars, best speed, best accuracy or play count goes down, and no lesson
 *   record disappears;
 * - no badge is taken away.
 */
import { expect } from "vitest";
import { blocks } from "../../../src/content/blocks";
import { foundBlocks } from "../../../src/engine/achievements";
import { countBlocks, islandBlocks } from "../../../src/engine/island";
import { VoxelGrid } from "../../../src/render/mesher/voxel-grid";
import type { Profile } from "../../../src/save/schema";
import type { BlockId } from "../../../src/types/core";

const lookup = islandBlocks(blocks);

export interface NeverLessOptions {
  /** Builder ran: the bag may go down, as long as the island plus the bag doesn't (per block). */
  building?: boolean;
  /** Shown in a failure, to tell runs apart. */
  label?: string;
}

/** Fails when anything the child earned is less in `after` than in `before`. */
export function expectNeverLess(
  before: Readonly<Profile>,
  after: Readonly<Profile>,
  opts: NeverLessOptions = {},
): void {
  const at = (what: string): string => (opts.label === undefined ? what : `${opts.label}: ${what}`);
  if (opts.building === true) {
    const was = totals(before);
    const now = totals(after);
    for (const [block, n] of Object.entries(was)) {
      expect(now[block] ?? 0, at(`island + bag of ${block}`)).toBeGreaterThanOrEqual(n);
    }
  } else {
    for (const [block, n] of Object.entries(before.inventory)) {
      expect(after.inventory[block] ?? 0, at(`inventory ${block}`)).toBeGreaterThanOrEqual(n);
    }
  }
  for (const n of Object.values(after.inventory)) {
    expect(Number.isInteger(n) && n >= 0, at(`inventory count ${n}`)).toBe(true);
  }
  const foundNow = foundBlocks(after);
  for (const [block, n] of Object.entries(foundBlocks(before))) {
    expect(foundNow[block] ?? 0, at(`found ${block}`)).toBeGreaterThanOrEqual(n);
  }
  for (const biome of before.progress.unlockedBiomes) {
    expect(after.progress.unlockedBiomes, at(`biome ${biome}`)).toContain(biome);
  }
  for (const [id, was] of Object.entries(before.progress.lessons)) {
    const now = after.progress.lessons[id];
    expect(now, at(`lesson record ${id}`)).toBeDefined();
    if (now === undefined) continue;
    expect(now.bestStars, at(`best stars ${id}`)).toBeGreaterThanOrEqual(was.bestStars);
    expect(now.bestNetWpm, at(`best wpm ${id}`)).toBeGreaterThanOrEqual(was.bestNetWpm);
    expect(now.bestAccuracy, at(`best accuracy ${id}`)).toBeGreaterThanOrEqual(was.bestAccuracy);
    expect(now.plays, at(`plays ${id}`)).toBeGreaterThanOrEqual(was.plays);
  }
  for (const id of Object.keys(before.achievements)) {
    expect(after.achievements[id], at(`badge ${id}`)).toBeDefined();
  }
}

/**
 * The island's blocks plus the bag, per block id, zero counts left out. A profile with no island
 * yet counts only its bag (a fresh island is made from starter terrain on the first visit).
 */
export function totals(profile: Pick<Profile, "island" | "inventory">): Record<BlockId, number> {
  const out: Record<BlockId, number> =
    profile.island === null
      ? {}
      : { ...countBlocks(VoxelGrid.fromJSON(profile.island.grid), lookup) };
  for (const [id, n] of Object.entries(profile.inventory)) out[id] = (out[id] ?? 0) + n;
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n !== 0));
}

/** The same per-block totals for a live grid and a bag (an editor's state mid-visit). */
export function liveTotals(
  grid: VoxelGrid,
  inventory: Readonly<Record<BlockId, number>>,
): Record<BlockId, number> {
  const out: Record<BlockId, number> = { ...countBlocks(grid, lookup) };
  for (const [id, n] of Object.entries(inventory)) out[id] = (out[id] ?? 0) + n;
  return Object.fromEntries(Object.entries(out).filter(([, n]) => n !== 0));
}
