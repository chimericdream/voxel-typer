/**
 * Oak tree templates, three original variants (task M2-03). Pure.
 *
 * - `puff`: a short trunk under one round, cloud-like crown.
 * - `spire`: a taller trunk with a crown that narrows in rounded tiers toward the top.
 * - `twin`: a trunk that forks into two leaning arms, each with its own small crown, and a little
 *   tuft between them.
 *
 * Crowns are ellipsoids filled cell by cell, with a few seeded nibbles off the rim so no two trees
 * are quite alike.
 */
import type { Rng } from "@/engine/rng";
import type { Template, TemplateVoxel } from "./types";

export type TreeVariant = "puff" | "spire" | "twin";
export const TREE_VARIANTS: readonly TreeVariant[] = ["puff", "spire", "twin"];

export interface TreeBlocks {
  log: number;
  leaves: number;
}

/** The tallest tree, in cells above the ground (its top voxel has `dy < TREE_MAX_HEIGHT`). */
export const TREE_MAX_HEIGHT = 10;
/** The widest crown reaches this far from the trunk. */
export const TREE_MAX_REACH = 3;

/** Adds an ellipsoid of leaves centered on (cx, cy, cz). Rim cells may be nibbled away. */
function crown(
  out: TemplateVoxel[],
  leaves: number,
  c: { x: number; y: number; z: number },
  r: { x: number; y: number; z: number },
  rng: Rng,
  nibble = 0.25,
): void {
  const rx = Math.ceil(r.x);
  const ry = Math.ceil(r.y);
  const rz = Math.ceil(r.z);
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dz = -rz; dz <= rz; dz++) {
      for (let dx = -rx; dx <= rx; dx++) {
        const d = (dx / r.x) ** 2 + (dy / r.y) ** 2 + (dz / r.z) ** 2;
        if (d > 1) continue;
        // The outer shell is where nibbles happen; the core stays full so the crown never has holes.
        if (d > 0.6 && rng.next() < nibble) continue;
        out.push({ dx: c.x + dx, dy: c.y + dy, dz: c.z + dz, block: leaves });
      }
    }
  }
}

function trunk(out: TemplateVoxel[], log: number, x: number, z: number, y0: number, y1: number) {
  for (let y = y0; y <= y1; y++) out.push({ dx: x, dy: y, dz: z, block: log });
}

/** One oak tree. The trunk stands on the anchor at (0, 0, 0). */
export function oakTree(variant: TreeVariant, blocks: TreeBlocks, rng: Rng): Template {
  const { log, leaves } = blocks;
  const out: TemplateVoxel[] = [];
  if (variant === "puff") {
    const h = rng.int(3, 4);
    trunk(out, log, 0, 0, 0, h);
    crown(out, leaves, { x: 0, y: h + 1, z: 0 }, { x: 2.6, y: 2.1, z: 2.6 }, rng);
  } else if (variant === "spire") {
    const h = rng.int(4, 5);
    trunk(out, log, 0, 0, 0, h + 1);
    crown(out, leaves, { x: 0, y: h, z: 0 }, { x: 2.4, y: 1.4, z: 2.4 }, rng, 0.15);
    crown(out, leaves, { x: 0, y: h + 2, z: 0 }, { x: 1.7, y: 1.2, z: 1.7 }, rng, 0.15);
    crown(out, leaves, { x: 0, y: h + 3, z: 0 }, { x: 0.9, y: 1, z: 0.9 }, rng, 0);
  } else {
    // twin: fork along x or z.
    const alongX = rng.next() < 0.5;
    const at = (a: number): { x: number; z: number } => (alongX ? { x: a, z: 0 } : { x: 0, z: a });
    trunk(out, log, 0, 0, 0, 2);
    for (const side of [-1, 1]) {
      const p1 = at(side);
      const p2 = at(side * 2);
      out.push({ dx: p1.x, dy: 3, dz: p1.z, block: log });
      out.push({ dx: p2.x, dy: 4, dz: p2.z, block: log });
      out.push({ dx: p2.x, dy: 5, dz: p2.z, block: log });
    }
    for (const side of [-1, 1]) {
      const p = at(side * 2);
      crown(out, leaves, { x: p.x, y: 6, z: p.z }, { x: 1.8, y: 1.5, z: 1.8 }, rng);
    }
    crown(out, leaves, { x: 0, y: 4, z: 0 }, { x: 1.1, y: 1, z: 1.1 }, rng, 0);
  }
  return { follow: "anchor", voxels: out };
}
