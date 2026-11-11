/**
 * Atlas builder (docs/impl/contracts.md §8.3). Uses the DOM, so it is NOT pure.
 *
 * Textures use `NearestFilter` and no mipmaps. Each tile gets a 1-px gutter of duplicated edge
 * pixels to stop bleeding.
 *
 * Stub only; M1-14 implements it.
 */
import type * as THREE from "three";
import type { BlockDef } from "@/content/blocks/types";
import type { BlockId } from "@/types/core";
import type { AtlasLookup } from "../mesher/voxel-grid";
import type { Palette } from "./recipes";

/** The packed texture atlas, plus the lookups the mesher needs. */
export interface Atlas extends AtlasLookup {
  texture: THREE.Texture;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** The tile index of a block face. */
  tileOf(blockId: BlockId, face: "top" | "bottom" | "side"): number;
}

/**
 * Paints every block face with `paintTile` and packs the tiles into a canvas atlas. A PNG at
 * `assets/textures/src/<blockId>_<face>.png` overrides the painted tile.
 */
export function buildAtlas(
  blocks: readonly BlockDef[],
  palette: Palette,
  seed: number,
): Promise<Atlas> {
  void [blocks, palette, seed];
  throw new Error("not implemented: buildAtlas");
}
