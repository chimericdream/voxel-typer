/**
 * Rock templates (task M2-03). Pure.
 *
 * Small, friendly boulders: a low cluster of two to five stones, sometimes with one stacked on
 * top, in a mix of plain and mossy stone.
 */
import type { Rng } from "@/engine/rng";
import type { Template, TemplateVoxel } from "./types";

export interface RockBlocks {
  stone: number;
  mossy: number;
}

/** How far a rock cluster spreads from its anchor. */
export const ROCK_REACH = 1;

export function rockCluster(blocks: RockBlocks, rng: Rng): Template {
  const pick = (): number => (rng.next() < 0.4 ? blocks.mossy : blocks.stone);
  const out: TemplateVoxel[] = [{ dx: 0, dy: 0, dz: 0, block: pick() }];
  const ring = rng.shuffle([
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
  ] as const);
  const extra = rng.int(1, 4);
  for (const [dx, dz] of ring.slice(0, extra)) out.push({ dx, dy: 0, dz, block: pick() });
  if (rng.next() < 0.5) out.push({ dx: 0, dy: 1, dz: 0, block: pick() });
  return { follow: "column", voxels: out };
}
