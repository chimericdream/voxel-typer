/**
 * Rendering: the three.js scene, the voxel mesher, the atlas and the models
 * (docs/impl/contracts.md §8).
 *
 * This barrel is NOT pure. Pure code imports `@/render/mesher/voxel-grid` or
 * `@/render/atlas/recipes` directly.
 */
export * from "./atlas/build";
export * from "./atlas/recipes";
export * from "./mesher/voxel-grid";
export * from "./models/types";
export * from "./types";
