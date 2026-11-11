/**
 * Flower patch template (task M2-03). Pure.
 *
 * A loose clump of single flower blocks around the anchor, mostly one kind with the odd flower of
 * a second kind mixed in, the way a wild patch grows.
 */
import type { Rng } from "@/engine/rng";
import type { Template, TemplateVoxel } from "./types";

/** How far a patch spreads from its anchor. */
export const FLOWER_REACH = 2;

export function flowerPatch(kinds: readonly number[], rng: Rng): Template {
  const main = rng.pick(kinds);
  const other = rng.pick(kinds);
  const count = rng.int(3, 6);
  const out: TemplateVoxel[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count * 3 && out.length < count; i++) {
    const dx = rng.int(-FLOWER_REACH, FLOWER_REACH);
    const dz = rng.int(-FLOWER_REACH, FLOWER_REACH);
    // Keep it round: skip the far corners.
    if (Math.abs(dx) + Math.abs(dz) > FLOWER_REACH + 1) continue;
    const k = `${dx},${dz}`;
    if (used.has(k)) continue;
    used.add(k);
    out.push({ dx, dy: 0, dz, block: rng.next() < 0.2 ? other : main });
  }
  return { follow: "column", voxels: out };
}
