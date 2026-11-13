/**
 * Blueprints for Builder (task M4-08): the data (`builds.ts`), and how it becomes a grid, a price
 * and an offer. Pure: block nums come in through `numOf`, the profile as a parameter.
 */
import { VoxelGrid } from "@/render/mesher/voxel-grid";
import type { Profile } from "@/save/schema";
import type { BiomeId, BlockId } from "@/types/core";
import { builds } from "./builds";
import type { BlueprintDef, BlueprintUnlock } from "./types";

export { builds as blueprints };
export type { BlueprintDef, BlueprintUnlock };

/** The air character in a blueprint's layers. */
export const AIR = ".";

/** The badge that marks a biome as completed (M3-10: every lesson of the biome played). */
export const biomeBadgeId = (biome: BiomeId): string => `${biome}-master`;

/**
 * True once the biome is completed. Reads `profile.achievements`, which only grows, so a completed
 * biome stays completed. Expansions (Builder) use the same test.
 */
export function biomeCompleted(profile: Readonly<Profile>, biome: BiomeId): boolean {
  return profile.achievements[biomeBadgeId(biome)] !== undefined;
}

/** True when the unlock condition holds for this profile. */
export function unlocked(unlock: BlueprintUnlock, profile: Readonly<Profile>): boolean {
  return unlock.kind === "biome"
    ? biomeCompleted(profile, unlock.biome)
    : profile.achievements[unlock.achievement] !== undefined;
}

/** The blueprints this profile may stamp, in listing order. */
export function unlockedBlueprints(
  profile: Readonly<Profile>,
  defs: readonly BlueprintDef[] = builds,
): BlueprintDef[] {
  return defs.filter((d) => unlocked(d.unlock, profile));
}

/** The grid's size: x from a row's length, y from the layers, z from the rows. */
export function blueprintSize(def: BlueprintDef): { sx: number; sy: number; sz: number } {
  const first = def.layers[0] ?? [];
  return { sx: first[0]?.length ?? 0, sy: def.layers.length, sz: first.length };
}

/** Every non-air cell: where it is and which block it holds. Throws on a character not in `key`. */
export function blueprintCells(
  def: BlueprintDef,
): { x: number; y: number; z: number; block: BlockId }[] {
  const out: { x: number; y: number; z: number; block: BlockId }[] = [];
  def.layers.forEach((rows, y) => {
    rows.forEach((row, z) => {
      Array.from(row).forEach((ch, x) => {
        if (ch === AIR) return;
        const block = def.key[ch];
        if (block === undefined) throw new Error(`blueprint ${def.id}: no block for "${ch}"`);
        out.push({ x, y, z, block });
      });
    });
  });
  return out;
}

/** What the layers take from the inventory on empty ground, per block. */
export function blueprintCost(def: BlueprintDef): Record<BlockId, number> {
  const cost: Record<BlockId, number> = {};
  for (const c of blueprintCells(def)) cost[c.block] = (cost[c.block] ?? 0) + 1;
  return cost;
}

/**
 * The blueprint as a grid of block nums, for `IslandCommand` `stamp`. Throws when `numOf` doesn't
 * know a block (a test checks every blueprint against the registry).
 */
export function blueprintGrid(
  def: BlueprintDef,
  numOf: (id: BlockId) => number | undefined,
): VoxelGrid {
  const { sx, sy, sz } = blueprintSize(def);
  const grid = new VoxelGrid(sx, sy, sz);
  for (const c of blueprintCells(def)) {
    const n = numOf(c.block);
    if (n === undefined || n === 0)
      throw new Error(`blueprint ${def.id}: unknown block ${c.block}`);
    grid.set(c.x, c.y, c.z, n);
  }
  return grid;
}
