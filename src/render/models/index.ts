/** Voxel models: data checks, animation and three.js builders (task M4-01, contracts.md §8.4). */
export type { VoxelModel } from "./types";
export { MODEL_UNIT, compileRig, restPose, samplePose, sampleTrack } from "./rig";
export type { CompiledAnim, CompiledRig, CompiledTrack, Pose } from "./rig";
export { Animator, CROSSFADE_MS } from "./animator";
export type { AnimatorOptions, PlayOptions } from "./animator";
export { MAX_PARTS, isVoxelModel, modelErrors, parseModel } from "./validate";
export { NO_ATLAS_COLOR, modelMaterial, partGeometry } from "./geometry";
export type { ModelAtlas } from "./geometry";
export { buildModel, buildModelInstanced } from "./build";
export type { Animatable, InstancedModelHandle, ModelHandle, ModelOptions } from "./build";
export { createModelDriver } from "./driver";
export type { ModelDriver } from "./driver";
