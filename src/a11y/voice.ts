/**
 * Is there an English voice on this device? (task M3-07, decision 69)
 *
 * Read-aloud uses only on-device voices (`pickVoice` in `src/audio/speech.ts`); with none, `speak`
 * is silent, so the "hear it again" hint must be hidden. Browsers often fill the voice list late, so
 * this watches `voiceschanged` and keeps a signal current.
 */
import { signal } from "@preact/signals";
import type { ReadonlySignal } from "@preact/signals";
import { pickVoice } from "@/audio/speech";
import type { VoiceLike } from "@/audio/speech";

/** The part of `speechSynthesis` this needs. */
export interface VoiceSource {
  getVoices(): readonly VoiceLike[];
  addEventListener(type: "voiceschanged", fn: () => void): void;
  removeEventListener(type: "voiceschanged", fn: () => void): void;
}

export interface VoiceWatch {
  /** True while a local English voice is available. */
  readonly available: ReadonlySignal<boolean>;
  dispose(): void;
}

export function watchLocalVoice(source: VoiceSource | null): VoiceWatch {
  const has = (): boolean => source !== null && pickVoice(source.getVoices()) !== null;
  const available = signal(has());
  const update = (): void => {
    available.value = has();
  };
  source?.addEventListener("voiceschanged", update);
  return {
    available,
    dispose() {
      source?.removeEventListener("voiceschanged", update);
    },
  };
}

/** The browser's speech synthesis, or null where it's missing. */
export function browserVoices(): VoiceSource | null {
  return typeof speechSynthesis === "undefined" ? null : speechSynthesis;
}
