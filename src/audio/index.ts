/** Audio: synth, sound effects and generated music (docs/impl/contracts.md §12). */
export * from "./types";
export { createAudio, MAX_VOICES, volumeToGain } from "./engine";
export type { AudioEngine, AudioOptions } from "./engine";
export { chimeFrequency, MATERIAL_LIST, recipeFor } from "./recipes";
export { SPEECH_RATE } from "./speech";
