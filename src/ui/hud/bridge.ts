/**
 * HUD bridge (docs/impl/contracts.md §10). Modes don't touch Preact: they push state through this
 * typed bridge, and the HUD components read it.
 *
 * Implemented by task M2-14 with `@preact/signals`, **one signal per field**. `set` writes only the
 * fields whose value really changed, so a mode may call it every frame with the whole state and
 * only the HUD parts that read a changed field re-render. "Changed" is by value for `word`,
 * `banner`, `timer` and `custom` (a fresh but equal object is not a change), by `Object.is` for the
 * rest.
 *
 * The wrong-key cue for the on-screen keyboard travels in `custom.wrongKey` (see
 * {@link reportWrongKey}): modes already hold the bridge, and the game events bus is per lesson and
 * not visible to the HUD.
 */
import { batch, computed, signal } from "@preact/signals";
import type { ReadonlySignal, Signal } from "@preact/signals";
import type { TargetView } from "@/engine/types";
import type { MessageKey } from "@/i18n";
import type { Ms } from "@/types/core";

/** Everything the HUD shows during play. */
export interface HudState {
  /** The big word display (sequential modes). */
  word: { text: string; marks: TargetView["marks"]; typed: number } | null;
  /** The hotbar combo meter: 0–9 slots lit, `min(9, floor(streak / 3))`. */
  combo: number;
  /** The lesson progress bar, 0–1. */
  progress01: number;
  /** Drives the on-screen keyboard highlight and the hand overlay. */
  nextKey: string | null;
  /** A short message. Its text comes from `t(key, params)`; `cheer` is the celebratory tone. */
  banner: {
    key: MessageKey;
    params?: Record<string, string | number>;
    tone: "info" | "cheer";
  } | null;
  capsLock: boolean;
  /** Hidden for Sprout and in calm mode. */
  timer: { remainingMs: Ms } | null;
  /** Mode-specific widgets read their own slice. */
  custom: Record<string, unknown>;
}

/** How a mode talks to the HUD. */
export interface HudBridge {
  /** Merges `patch` into the state. Keys left out keep their value. */
  set(patch: Partial<HudState>): void;
  get(): Readonly<HudState>;
}

/** One read-only signal per {@link HudState} field. HUD components read only the ones they show. */
export type HudFields = { readonly [K in keyof HudState]: ReadonlySignal<HudState[K]> };

/** The app's bridge: the contract's {@link HudBridge}, plus what the HUD and the shell need. */
export interface HudStore extends HudBridge {
  /** Field-level signals, for HUD components. */
  readonly fields: HudFields;
  /** The whole state as one signal. Changes whenever any field does; components should use `fields`. */
  readonly state: ReadonlySignal<HudState>;
  /** Back to the empty state (between lessons). Keeps `capsLock`, which is about the keyboard. */
  reset(): void;
}

export function emptyHudState(): HudState {
  return {
    word: null,
    combo: 0,
    progress01: 0,
    nextKey: null,
    banner: null,
    capsLock: false,
    timer: null,
    custom: {},
  };
}

function sameRecord(
  a: Readonly<Record<string, unknown>> | undefined,
  b: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && Object.is(a[k], b[k]));
}

function sameWord(a: HudState["word"], b: HudState["word"]): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.text !== b.text || a.typed !== b.typed || a.marks.length !== b.marks.length) return false;
  return a.marks.every((m, i) => m === b.marks[i]);
}

function sameBanner(a: HudState["banner"], b: HudState["banner"]): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.key === b.key && a.tone === b.tone && sameRecord(a.params, b.params);
}

function sameTimer(a: HudState["timer"], b: HudState["timer"]): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return Object.is(a.remainingMs, b.remainingMs);
}

/** Value equality per field: an equal patch writes nothing. */
const SAME: { [K in keyof HudState]: (a: HudState[K], b: HudState[K]) => boolean } = {
  word: sameWord,
  combo: Object.is,
  progress01: Object.is,
  nextKey: Object.is,
  banner: sameBanner,
  capsLock: Object.is,
  timer: sameTimer,
  custom: sameRecord,
};

/** Every field once (a test checks this matches `emptyHudState()`). */
export const HUD_FIELDS: readonly (keyof HudState)[] = [
  "word",
  "combo",
  "progress01",
  "nextKey",
  "banner",
  "capsLock",
  "timer",
  "custom",
];

type WritableFields = { [K in keyof HudState]: Signal<HudState[K]> };

function writeField<K extends keyof HudState>(
  fields: WritableFields,
  key: K,
  value: HudState[K] | undefined,
): void {
  if (value === undefined) return;
  const sig = fields[key];
  if (SAME[key](sig.peek(), value)) return;
  sig.value = value;
}

export function createHudStore(): HudStore {
  const init = emptyHudState();
  const fields: WritableFields = {
    word: signal(init.word),
    combo: signal(init.combo),
    progress01: signal(init.progress01),
    nextKey: signal(init.nextKey),
    banner: signal(init.banner),
    capsLock: signal(init.capsLock),
    timer: signal(init.timer),
    custom: signal(init.custom),
  };
  const state = computed<HudState>(() => ({
    word: fields.word.value,
    combo: fields.combo.value,
    progress01: fields.progress01.value,
    nextKey: fields.nextKey.value,
    banner: fields.banner.value,
    capsLock: fields.capsLock.value,
    timer: fields.timer.value,
    custom: fields.custom.value,
  }));
  const apply = (patch: Partial<HudState>): void => {
    batch(() => {
      for (const key of HUD_FIELDS) writeField(fields, key, patch[key]);
    });
  };
  return {
    fields,
    state,
    // `peek` so a mode calling `get()` inside an effect doesn't subscribe to every field.
    get: () => state.peek(),
    set: apply,
    reset() {
      apply({ ...emptyHudState(), capsLock: fields.capsLock.peek() });
    },
  };
}

/** The `custom` slice that makes a key on the on-screen keyboard wobble. */
export const WRONG_KEY_SLICE = "wrongKey";

/** One wrong press, as the on-screen keyboard takes it (`WrongKey`). `seq` grows with each press. */
export interface WrongKeySlice {
  got: string;
  seq: number;
}

function isWrongKeySlice(v: unknown): v is WrongKeySlice {
  if (typeof v !== "object" || v === null) return false;
  const got: unknown = Reflect.get(v, "got");
  const seq: unknown = Reflect.get(v, "seq");
  return typeof got === "string" && typeof seq === "number";
}

/** The last wrong press in `custom`, or null. Returns the same object until a new press. */
export function wrongKeyOf(custom: Readonly<Record<string, unknown>>): WrongKeySlice | null {
  const v = custom[WRONG_KEY_SLICE];
  return isWrongKeySlice(v) ? v : null;
}

/**
 * Tells the HUD about a wrong key press (the engine's `wrong` event's `got`). Call it for every
 * wrong press, repeats included: the keyboard gates repeats and rate itself (M2-09 `feedWobble`).
 */
export function reportWrongKey(hud: HudBridge, got: string): void {
  const custom = hud.get().custom;
  const seq = (wrongKeyOf(custom)?.seq ?? 0) + 1;
  hud.set({ custom: { ...custom, [WRONG_KEY_SLICE]: { got, seq } } });
}

/** The `custom` slice that fills the hotbar's slots with items (M2-13: the loot found so far). */
export const HOTBAR_SLICE = "hotbar";

/** One item in a hotbar slot. */
export interface HotbarItem {
  /** Accessible name, already through `t()`, e.g. "Oak Log, 3". */
  label: string;
  count: number;
  /** A small picture of the item as a URL (a data URI), or "" for none. */
  icon: string;
}

/** Up to 9 slots, left to right; `null` is an empty slot. */
export interface HotbarSlice {
  slots: readonly (HotbarItem | null)[];
  /**
   * Hide the hotbar while every slot is empty and no combo slot is lit (M4-FIX-4: a night's day
   * shows no empty bar). It keeps its room, so nothing moves when the first item lands.
   */
  hideEmpty?: boolean;
}

function isHotbarItem(v: unknown): v is HotbarItem | null {
  if (v === null) return true;
  if (typeof v !== "object") return false;
  const label: unknown = Reflect.get(v, "label");
  const count: unknown = Reflect.get(v, "count");
  const icon: unknown = Reflect.get(v, "icon");
  return typeof label === "string" && typeof count === "number" && typeof icon === "string";
}

function isHotbarSlice(v: unknown): v is HotbarSlice {
  if (typeof v !== "object" || v === null) return false;
  const slots: unknown = Reflect.get(v, "slots");
  const hideEmpty: unknown = Reflect.get(v, "hideEmpty");
  return (
    Array.isArray(slots) &&
    slots.every(isHotbarItem) &&
    (hideEmpty === undefined || typeof hideEmpty === "boolean")
  );
}

/** The hotbar items in `custom`, or null. Returns the same object until the mode sends a new one. */
export function hotbarOf(custom: Readonly<Record<string, unknown>>): HotbarSlice | null {
  const v = custom[HOTBAR_SLICE];
  return isHotbarSlice(v) ? v : null;
}

/**
 * The `custom` slice a mode uses to ask for the hand overlay without the hands (M4-04): Night
 * Defense needs the stage's height for its lanes. With `"caption"` the keys keep their finger
 * labels and the hint line ("Use your left pinky.") stays; only the two drawn hands go.
 */
export const HANDS_SLICE = "hands";

/** True when a mode asked for the hint line without the drawn hands. */
export function handsCaptionOnly(custom: Readonly<Record<string, unknown>>): boolean {
  return custom[HANDS_SLICE] === "caption";
}

/**
 * The `custom` slice a mode uses to keep the open stage at least this tall, in CSS pixels
 * (M4-FIX-4): Night Defense needs room for its field on a short screen. The HUD caps it at 55 % of
 * the screen and shrinks the on-screen keyboard to fit; the keys, the next-key light and the hint
 * line all stay.
 */
export const STAGE_SLICE = "stage";

export interface StageSlice {
  minPx: number;
}

/** The stage's least height a mode asked for, in CSS pixels, or null. */
export function stageMinOf(custom: Readonly<Record<string, unknown>>): number | null {
  const v = custom[STAGE_SLICE];
  if (typeof v !== "object" || v === null) return null;
  const min: unknown = Reflect.get(v, "minPx");
  return typeof min === "number" && Number.isFinite(min) && min > 0 ? min : null;
}
