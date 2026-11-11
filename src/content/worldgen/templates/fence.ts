/**
 * Fence template (task M2-03). Pure.
 *
 * Log posts two blocks tall every few cells, joined by a single plank rail at the posts' top
 * height, with open gaps underneath so it reads as a fence rather than a wall. Each column
 * follows its own ground.
 */
import type { Template, TemplateVoxel } from "./types";

export interface FenceBlocks {
  post: number;
  rail: number;
}

/** Cells between posts. */
export const FENCE_SPAN = 3;

/** A straight fence of `length` cells from the anchor along +x (`axis: "x"`) or +z. */
export function fence(
  length: number,
  axis: "x" | "z",
  blocks: FenceBlocks,
): Template {
  const out: TemplateVoxel[] = [];
  for (let i = 0; i < length; i++) {
    const dx = axis === "x" ? i : 0;
    const dz = axis === "z" ? i : 0;
    const post = i % FENCE_SPAN === 0 || i === length - 1;
    if (post) {
      out.push({ dx, dy: 0, dz, block: blocks.post });
      out.push({ dx, dy: 1, dz, block: blocks.post });
    } else {
      out.push({ dx, dy: 1, dz, block: blocks.rail });
    }
  }
  return { follow: "column", voxels: out };
}
