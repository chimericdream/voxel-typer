/**
 * Voxel models for mobs, the avatar, pets and bosses (docs/impl/contracts.md §8.4).
 *
 * Models are stored as `<id>.model.json` and validated by a JSON schema test.
 */
import type { BlockId } from "@/types/core";

/** A creature built from boxes, with keyframe animations. */
export interface VoxelModel {
  id: string;
  parts: {
    name: string;
    /** The `name` of the part this one is attached to. */
    parent?: string;
    size: [number, number, number];
    pivot: [number, number, number];
    offset: [number, number, number];
    /** A flat color. */
    color?: string;
    /** Or a block face from the atlas. */
    tile?: { blockId: BlockId; face: "top" | "side" | "bottom" };
  }[];
  /** `idle`, `walk`, `hit` and `defeat` are the standard names; a model may add its own. */
  anims: Record<
    // The named members document the standard animations (contracts §8.4, verbatim).
    // oxlint-disable-next-line typescript/no-redundant-type-constituents
    "idle" | "walk" | "hit" | "defeat" | string,
    {
      durationMs: number;
      loop: boolean;
      tracks: {
        /** The `name` of the animated part. */
        part: string;
        prop: "rot" | "pos" | "scale";
        /** `t` is the time of the keyframe in ms. */
        keys: { t: number; v: [number, number, number] }[];
      }[];
    }
  >;
}
