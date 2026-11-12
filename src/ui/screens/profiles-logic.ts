/**
 * Rules behind "Who is playing?" (task M3-09), kept out of the component so they can be tested
 * on their own.
 */
import type { Profile } from "@/save/schema";
import { defaultSettings } from "@/save/settings";
import type { Settings } from "@/save/settings";
import { MAX_PROFILES } from "@/save/store";
import type { AgeBand } from "@/types/core";

/**
 * How many of the {@link MAX_PROFILES} slots are taken: every listed profile, plus every profile
 * that is stored but not listed (damaged, or written by a newer build). Each id counts once.
 */
export function usedSlots(
  listed: readonly { id: string }[],
  damaged: ReadonlySet<string>,
  readOnly: ReadonlySet<string>,
): number {
  return new Set([...listed.map((p) => p.id), ...damaged, ...readOnly]).size;
}

/** True when a new profile would be a 9th. */
export function gameIsFull(
  listed: readonly { id: string }[],
  damaged: ReadonlySet<string>,
  readOnly: ReadonlySet<string>,
): boolean {
  return usedSlots(listed, damaged, readOnly) >= MAX_PROFILES;
}

const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");

/**
 * True when `typed` names the player, to confirm a delete. Case and spaces at the ends don't
 * matter (a child may not find Shift), but every letter must be there.
 */
export function nameMatches(typed: string, name: string): boolean {
  return norm(typed) !== "" && norm(typed) === norm(name);
}

const BAND_KEYS = ["textScale", "showKeyboard", "showHands", "calmMode", "tts"] as const;

/**
 * Settings after a move from one age band to another. A setting the band decides (text size,
 * keyboard, hands, calm mode, read-aloud) follows the new band only while it still has the old
 * band's default; one a grown-up changed stays as they set it.
 */
export function settingsForBand(
  settings: Readonly<Settings>,
  from: AgeBand,
  to: AgeBand,
): Settings {
  const was = defaultSettings(from);
  const now = defaultSettings(to);
  const out: Settings = { ...settings, volume: { ...settings.volume } };
  for (const k of BAND_KEYS) {
    if (settings[k] === was[k]) Object.assign(out, { [k]: now[k] });
  }
  return out;
}

/** `p` in the age band `to`, with {@link settingsForBand}. */
export function withBand(p: Readonly<Profile>, to: AgeBand): Profile {
  if (p.ageBand === to) return { ...p };
  return { ...p, ageBand: to, settings: settingsForBand(p.settings, p.ageBand, to) };
}
