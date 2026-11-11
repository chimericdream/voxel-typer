/**
 * Text to speech for `AudioApi.speak` (contracts.md §12): the Web Speech API at a slower,
 * kid-friendly rate.
 *
 * Child privacy: only voices the browser marks `localService` are used. Remote voices (Chrome's
 * "Google US English", Edge's "… Online (Natural)", …) send the text to a server, so they are
 * never picked. The browser's default voice is never used either, since it may be remote. With no
 * local English voice, `speak` does nothing.
 */

export interface VoiceLike {
  readonly lang: string;
  readonly name: string;
  /** True when the voice runs on the device; false when the browser sends text to a server. */
  readonly localService: boolean;
}

export interface UtteranceLike {
  rate: number;
  volume: number;
  lang: string;
  voice: VoiceLike | null;
}

export interface SynthLike {
  getVoices(): readonly VoiceLike[];
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  addEventListener(type: "voiceschanged", listener: () => void): void;
}

export interface SpeechDeps {
  synth: SynthLike;
  utterance(text: string): UtteranceLike;
}

/** Slower than normal (1), so early readers can follow. */
export const SPEECH_RATE = 0.85;

/** The browser's speech synthesis, or null where it is missing. */
export function defaultSpeech(): SpeechDeps | null {
  if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
    return null;
  }
  return { synth: speechSynthesis, utterance: (text) => new SpeechSynthesisUtterance(text) };
}

/**
 * The first voice that runs on the device and speaks English (`en`, `en-US`, `en_GB`, …), or null.
 * Remote voices are skipped even when they come first.
 */
export function pickVoice(voices: readonly VoiceLike[]): VoiceLike | null {
  return voices.find((v) => v.localService && /^en(?:[-_]|$)/i.test(v.lang)) ?? null;
}

export interface Speaker {
  /**
   * Speaks `text` with a local English voice, replacing anything still being spoken. Returns
   * false when it did not speak now: the text is blank, or there is no local English voice.
   */
  speak(text: string, volume: number): boolean;
  /** Stops speech and forgets a word waiting for the voice list. */
  cancel(): void;
}

/**
 * Wraps the synth. Browsers often load the voice list late (Chrome returns `[]` at first). If
 * `speak` finds no local English voice, it keeps that one word, and the next `voiceschanged` either
 * speaks it with a local English voice or drops it. It never falls back to the default voice.
 */
export function createSpeaker(deps: SpeechDeps): Speaker {
  let pending: { text: string; volume: number } | null = null;

  const say = (voice: VoiceLike, text: string, volume: number): void => {
    const u = deps.utterance(text);
    u.rate = SPEECH_RATE;
    u.volume = volume;
    u.lang = voice.lang;
    u.voice = voice;
    deps.synth.cancel();
    deps.synth.speak(u);
  };

  deps.synth.addEventListener("voiceschanged", () => {
    const waiting = pending;
    pending = null;
    if (!waiting) return;
    const voice = pickVoice(deps.synth.getVoices());
    if (voice) say(voice, waiting.text, waiting.volume);
  });
  // Asking once starts the browser loading its voices.
  deps.synth.getVoices();

  return {
    speak(text: string, volume: number): boolean {
      const trimmed = text.trim();
      if (trimmed === "") return false;
      const voice = pickVoice(deps.synth.getVoices());
      if (!voice) {
        pending = { text: trimmed, volume };
        return false;
      }
      pending = null;
      say(voice, trimmed, volume);
      return true;
    },
    cancel(): void {
      pending = null;
      deps.synth.cancel();
    },
  };
}
