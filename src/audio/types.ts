/**
 * Audio interfaces (docs/impl/contracts.md §12). All sound is synthesized; nothing is sampled from
 * another game.
 */
import type { BiomeId, Material, TimeOfDay } from "@/types/core";

// `Material` is defined in `src/types/core.ts` so pure content code can use it; see there.
export type { Material } from "@/types/core";

/** A sound effect. */
export type SfxName =
  | "break"
  | "chip"
  | "chime"
  | "thud"
  | "pop"
  | "click"
  | "whoosh"
  | "levelUp"
  | "star"
  | "shield"
  | "cart"
  | "place"
  | "undo";

/** A volume bus. */
export type Bus = "master" | "music" | "sfx" | "voice";

/** What modes and the app may ask of the audio engine. */
export interface AudioApi {
  /** Browsers start audio only after a user gesture. Call this on the first one. */
  unlock(): Promise<void>;
  /**
   * Plays a sound effect. `chime` with `pitchStep` walks a pentatonic ladder (C D E G A), wrapping
   * up octaves, capped at 2 octaves. `material` picks the timbre of `break`, `chip` and `place`.
   */
  sfx(name: SfxName, opts?: { pitchStep?: number; material?: Material; gain?: number }): void;
  music: {
    setScene(biome: BiomeId | "menu", tod: TimeOfDay): void;
    setIntensity(v01: number): void;
    stop(): void;
  };
  /** Reads `text` aloud with the Web Speech API. A no-op if it is unavailable or disabled. */
  speak(text: string): void;
  setVolume(bus: Bus, v01: number): void;
}
