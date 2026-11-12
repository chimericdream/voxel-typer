/**
 * Per-profile settings (docs/impl/contracts.md §15).
 *
 * Orchestrator-owned: to add a field, request it in your handoff note.
 */
import type { Bus } from "@/audio/types";
import type { AgeBand, QualityLevel } from "@/types/core";

/** What a learner (or their grown-up) can change. */
export interface Settings {
  /** 1.0–2.0. */
  textScale: number;
  showKeyboard: boolean;
  showHands: boolean;
  /** No timers anywhere. */
  calmMode: boolean;
  /** `'system'` follows `prefers-reduced-motion`. */
  reducedMotion: boolean | "system";
  highContrast: boolean;
  /** Body text. Headings stay pixel unless this is `'dyslexic'`. */
  font: "pixel" | "clean" | "dyslexic";
  /** Read words aloud. */
  tts: boolean;
  /** 0–1 per bus. */
  volume: Record<Bus, number>;
  quality: QualityLevel | "auto";
  /** Minutes of play before a break reminder. 0 = off; default 15. */
  breakReminderMin: number;
  /** Keyboard layout id. Default `'en-US'`. */
  layout: string;
  /**
   * Finger labels on the on-screen keyboard (decision 93, additive). Missing means on for Sprout
   * only (`fingerLabelsOn` in `src/a11y/options.ts`), so older saves need no migration.
   */
  fingerLabels?: boolean;
}

/** What changes between bands (PLAN.md §2: text size, keyboard overlay, timer pressure). */
const BAND_DEFAULTS: Record<
  AgeBand,
  Pick<Settings, "textScale" | "showKeyboard" | "showHands" | "calmMode" | "tts">
> = {
  // Big letters, keyboard with finger colors, read-aloud, zero time pressure.
  sprout: {
    textScale: 1.5,
    showKeyboard: true,
    showHands: true,
    calmMode: true,
    tts: true,
  },
  // Light timers; the keyboard still helps.
  miner: {
    textScale: 1.25,
    showKeyboard: true,
    showHands: false,
    calmMode: false,
    tts: false,
  },
  // Can type and wants speed.
  builder: {
    textScale: 1,
    showKeyboard: false,
    showHands: false,
    calmMode: false,
    tts: false,
  },
};

/**
 * The defaults for an age band (PLAN.md §2). Returns a new object each call, so callers may
 * change it.
 */
export function defaultSettings(band: AgeBand): Settings {
  return {
    ...BAND_DEFAULTS[band],
    reducedMotion: "system",
    // PLAN.md §4.6: pixel is the default font; clean and dyslexic are opt-in.
    font: "pixel",
    highContrast: false,
    volume: { master: 0.8, music: 0.5, sfx: 0.8, voice: 1 },
    quality: "auto",
    breakReminderMin: 15,
    layout: "en-US",
  };
}
