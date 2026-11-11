/**
 * Text to speech for `AudioApi.speak` (contracts.md §12): the Web Speech API at a slower,
 * kid-friendly rate, with the first English voice. Everything stays on the device; the game never
 * asks for a network voice.
 */

export interface VoiceLike {
  readonly lang: string;
  readonly name: string;
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

/** The first voice whose language is English (`en`, `en-US`, `en_GB`, …), or null. */
export function pickVoice(voices: readonly VoiceLike[]): VoiceLike | null {
  return voices.find((v) => /^en(?:[-_]|$)/i.test(v.lang)) ?? null;
}

/**
 * Speaks `text`, replacing anything still being spoken. Returns false when it did nothing: the
 * text is blank, or the voices have loaded and none is English. If the voice list is still empty
 * (Chrome loads it late), it asks for `en-US` and lets the browser pick.
 */
export function speakWith(deps: SpeechDeps, text: string, volume: number): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  const voices = deps.synth.getVoices();
  const voice = pickVoice(voices);
  if (voices.length > 0 && voice === null) return false;
  const u = deps.utterance(trimmed);
  u.rate = SPEECH_RATE;
  u.volume = volume;
  u.lang = voice?.lang ?? "en-US";
  if (voice) u.voice = voice;
  deps.synth.cancel();
  deps.synth.speak(u);
  return true;
}
