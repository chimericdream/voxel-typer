/**
 * A silent {@link AudioApi} (docs/impl/contracts.md §12). The shell uses it until the synth
 * (M2-06) is wired in `main.ts`, and tests use it everywhere.
 */
import type { AudioApi } from "@/audio/types";

export function createSilentAudio(): AudioApi {
  return {
    unlock: () => Promise.resolve(),
    sfx: () => undefined,
    music: { setScene: () => undefined, setIntensity: () => undefined, stop: () => undefined },
    speak: () => undefined,
    setVolume: () => undefined,
  };
}
