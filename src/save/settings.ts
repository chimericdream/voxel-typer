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
}

/**
 * The defaults for an age band (PLAN.md §2).
 *
 * Stub; M1-09 implements it.
 */
export function defaultSettings(band: AgeBand): Settings {
  void band;
  throw new Error("not implemented: defaultSettings");
}
