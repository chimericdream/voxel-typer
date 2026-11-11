/**
 * Structure templates for diorama worldgen (task M2-03). Pure.
 *
 * A template is a list of voxels relative to an anchor column. Templates never overwrite a solid
 * cell: the placer writes a voxel only into air, in the order given, so put trunks before leaves.
 */

export interface TemplateVoxel {
  dx: number;
  /** Height above the ground: 0 is the first air cell over the column's top block. */
  dy: number;
  dz: number;
  /** Numeric block id. */
  block: number;
}

export interface Template {
  /**
   * `anchor`: every `dy` counts from the anchor column's ground (trees keep their shape on a
   * slope). `column`: each voxel's `dy` counts from its own column's ground (flowers, rocks and
   * fences hug the terrain).
   */
  follow: "anchor" | "column";
  voxels: readonly TemplateVoxel[];
}
