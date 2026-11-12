/**
 * Small accessibility rules the HUD and the shell share (task M3-07, PLAN.md §4.6).
 */
import type { Settings } from "@/save/settings";
import type { AgeBand } from "@/types/core";

/**
 * Settings with the requested finger-label field (M3-07 contract change request: an optional
 * `Settings.fingerLabels`). Until it lands, `Settings` has no such field and the band default
 * applies.
 */
export type FingerLabelSettings = Pick<Settings, "showKeyboard"> & {
  readonly fingerLabels?: boolean;
};

/**
 * Finger labels on every key of the on-screen keyboard. A keyboard-only child never hovers, so the
 * labels are a setting for every band (M2-09 N3). Unset, they're on for Sprout only (M2-14).
 */
export function fingerLabelsOn(s: Readonly<FingerLabelSettings>, band: AgeBand): boolean {
  return s.fingerLabels ?? band === "sprout";
}

/**
 * The key that asks for the word again (`src/input/keyboard.ts`): `` ` `` for Sprout, F1 for
 * everyone.
 */
export function hearAgainKey(band: AgeBand): string {
  return band === "sprout" ? "`" : "F1";
}

/**
 * Whether to show the "hear it again" hint: read-aloud is on and the device has an English voice of
 * its own. Speech never uses a cloud voice (decision 69), so without one the hint stays hidden.
 */
export function hearAgainShown(s: Pick<Settings, "tts">, localVoice: boolean): boolean {
  return s.tts && localVoice;
}
