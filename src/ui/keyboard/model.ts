/**
 * On-screen keyboard model (task M2-09, PLAN.md §4.1, §4.6): the keys to draw for a `LayoutDef`,
 * which key and finger a char needs, and the gate that keeps the wrong-key wobble gentle.
 *
 * No DOM here, so the table tests run fast. Time comes in as a parameter.
 */
import { codeFor, fingerFor } from "@/content/layouts";
import type { LayoutDef } from "@/content/layouts/types";
import type { Finger, Ms } from "@/types/core";

/** Every layout is drawn 15 key units wide: the ANSI and ISO main block. */
export const BOARD_UNITS = 15;

/** A finger type. Both hands share a zone color; the pattern of the pointer zone is mirrored. */
export type ZoneId = "pinky" | "ring" | "middle" | "index" | "thumb";
export type Hand = "left" | "right";

/** Keys that type no char. The data leaves gaps for them (M1-11); the board draws them there. */
export type NamedKey = "space" | "shift" | "tab" | "caps" | "enter" | "backspace";

export const FINGERS: readonly Finger[] = ["L5", "L4", "L3", "L2", "R2", "R3", "R4", "R5", "T"];

const ZONE: Readonly<Record<Finger, ZoneId>> = {
  L5: "pinky",
  L4: "ring",
  L3: "middle",
  L2: "index",
  R2: "index",
  R3: "middle",
  R4: "ring",
  R5: "pinky",
  T: "thumb",
};

export function zoneOf(finger: Finger): ZoneId {
  return ZONE[finger];
}

/** The hand a finger belongs to. The thumb (Space) counts as either; this says `left`. */
export function handOf(finger: Finger): Hand {
  return finger.startsWith("R") ? "right" : "left";
}

/** One key to draw. Positions are in key units; `row` 0 is the number row. */
export interface BoardKey {
  /** Unique on the board (ISO Enter is two pieces: `Enter#top` and `Enter`). */
  id: string;
  /** `KeyboardEvent.code`. Shift keys are `ShiftLeft` and `ShiftRight`. */
  code: string;
  row: number;
  x: number;
  w: number;
  finger: Finger;
  /** The char typed without and with Shift. Named keys have neither. */
  base?: string;
  shift?: string;
  /** Named keys (and Space) get a `t()` label. */
  name?: NamedKey;
  /** F and J: the home-row bumps. */
  bump: boolean;
  /** The lower piece of ISO Enter: drawn, but its name is printed on the top piece only. */
  blank?: boolean;
}

/** The smallest gap (key units) worth a modifier key. */
const MIN_GAP = 0.5;

/** Modifier keys drawn in the gap left of a row's first key, by row. */
const LEFT_GAP: readonly (Omit<BoardKey, "row" | "x" | "w" | "bump"> | null)[] = [
  null,
  { id: "Tab", code: "Tab", finger: "L5", name: "tab" },
  { id: "CapsLock", code: "CapsLock", finger: "L5", name: "caps" },
  { id: "ShiftLeft", code: "ShiftLeft", finger: "L5", name: "shift" },
];

/** Modifier keys drawn in the gap right of a row's last key, by row. */
const RIGHT_GAP: readonly (Omit<BoardKey, "row" | "x" | "w" | "bump"> | null)[] = [
  { id: "Backspace", code: "Backspace", finger: "R5", name: "backspace" },
  // Only ISO layouts leave a gap here: the top half of their tall Enter key.
  { id: "Enter#top", code: "Enter", finger: "R5", name: "enter" },
  { id: "Enter", code: "Enter", finger: "R5", name: "enter" },
  { id: "ShiftRight", code: "ShiftRight", finger: "R5", name: "shift" },
];

const boardCache = new WeakMap<LayoutDef, readonly BoardKey[]>();

/**
 * Every key to draw for `layout`: the data keys, plus Tab, Caps Lock, both Shifts, Enter and
 * Backspace in the gaps the data leaves. Cached per layout object.
 */
export function boardKeys(layout: LayoutDef): readonly BoardKey[] {
  const cached = boardCache.get(layout);
  if (cached) return cached;
  const home = new Set(layout.homeCodes);
  const out: BoardKey[] = [];
  layout.rows.forEach((row, r) => {
    const keys = row.keys.toSorted((a, b) => a.x - b.x);
    const first = keys[0];
    const last = keys.at(-1);
    if (!first || !last) return;
    const isSpaceRow = keys.every((k) => k.code === "Space");
    const left = isSpaceRow ? null : LEFT_GAP[r];
    if (left && first.x >= MIN_GAP) out.push({ ...left, row: r, x: 0, w: first.x, bump: false });
    for (const k of keys) {
      const key: BoardKey = {
        id: k.code,
        code: k.code,
        row: r,
        x: k.x,
        w: k.w ?? 1,
        finger: k.finger,
        base: k.base,
        bump: home.has(k.code),
      };
      if (k.shift !== undefined) key.shift = k.shift;
      if (k.code === "Space") key.name = "space";
      out.push(key);
    }
    const end = last.x + (last.w ?? 1);
    const right = isSpaceRow ? null : RIGHT_GAP[r];
    if (right && BOARD_UNITS - end >= MIN_GAP) {
      const key: BoardKey = { ...right, row: r, x: end, w: BOARD_UNITS - end, bump: false };
      if (right.id === "Enter" && out.some((k) => k.id === "Enter#top")) key.blank = true;
      out.push(key);
    }
  });
  boardCache.set(layout, out);
  return out;
}

/** What to light up for the next char. */
export interface KeyTarget {
  /** The key that types the char. */
  code: string;
  finger: Finger;
  /**
   * The Shift key to hold, or null. Taught as the opposite hand's Shift: a left-hand char uses the
   * right Shift (right pinky), and the other way round.
   */
  shiftCode: "ShiftLeft" | "ShiftRight" | null;
  shiftFinger: "L5" | "R5" | null;
}

/** The key, finger and Shift for `char` on `layout`, or null when the layout can't type it. */
export function targetFor(layout: LayoutDef, char: string | null): KeyTarget | null {
  if (char === null) return null;
  const hit = codeFor(layout, char);
  const finger = fingerFor(layout, char);
  if (!hit || !finger) return null;
  if (!hit.shift) return { code: hit.code, finger, shiftCode: null, shiftFinger: null };
  const rightShift = handOf(finger) === "left";
  return {
    code: hit.code,
    finger,
    shiftCode: rightShift ? "ShiftRight" : "ShiftLeft",
    shiftFinger: rightShift ? "R5" : "L5",
  };
}

/** What a key prints: one glyph, or the Shift char over the base char (number row, symbols). */
export type KeyFace =
  | { kind: "blank" }
  | { kind: "glyph"; glyph: string }
  | { kind: "dual"; top: string; bottom: string }
  | { kind: "named"; name: NamedKey };

/**
 * Letter keys print their capital, like a real keyboard. Keys with a different Shift char print
 * both, Shift char on top.
 */
export function faceOf(key: BoardKey): KeyFace {
  if (key.blank) return { kind: "blank" };
  if (key.name) return { kind: "named", name: key.name };
  const base = key.base ?? "";
  const shift = key.shift;
  if (shift === undefined || shift === base) return { kind: "glyph", glyph: base };
  if (shift === base.toUpperCase() && shift !== base.toLowerCase()) {
    return { kind: "glyph", glyph: shift };
  }
  return { kind: "dual", top: shift, bottom: base };
}

// ---- Wrong-key wobble ----

/** How long one wobble (and its outline) lasts. */
export const WOBBLE_MS: Ms = 420;
/**
 * The shortest time between two wobbles. Keeps the outline cue under 2 a second, well below the
 * 3-a-second flash limit (PLAN.md §4.6).
 */
export const WOBBLE_GAP_MS: Ms = 600;
/**
 * A repeat of the same wrong key wobbles again only after this much quiet. A held key auto-repeats
 * every 30–50 ms, so holding a key never sets off a wobble per repeat (PLAN.md §4.6: tolerate
 * key-repeat).
 */
export const WOBBLE_QUIET_MS: Ms = 400;

export interface WobbleGate {
  /** The last wrong-key signal, wobbling or not. */
  lastCode: string | null;
  lastAt: Ms;
  /** When the last wobble started. */
  wobbleAt: Ms;
}

export const WOBBLE_IDLE: WobbleGate = {
  lastCode: null,
  lastAt: Number.NEGATIVE_INFINITY,
  wobbleAt: Number.NEGATIVE_INFINITY,
};

/**
 * Feeds one wrong-key signal for the key `code` at time `now`. Returns the new gate state and
 * whether this signal starts a wobble.
 */
export function feedWobble(
  gate: WobbleGate,
  code: string,
  now: Ms,
): { gate: WobbleGate; wobble: boolean } {
  const sameKeyTooSoon = code === gate.lastCode && now - gate.lastAt < WOBBLE_QUIET_MS;
  const wobble = !sameKeyTooSoon && now - gate.wobbleAt >= WOBBLE_GAP_MS;
  return {
    gate: { lastCode: code, lastAt: now, wobbleAt: wobble ? now : gate.wobbleAt },
    wobble,
  };
}

/** The key to wobble for a wrong char: the key the child pressed, else the key they needed. */
export function wobbleCode(layout: LayoutDef, got: string, expected: string | null): string | null {
  return (
    codeFor(layout, got)?.code ??
    (expected === null ? null : codeFor(layout, expected)?.code) ??
    null
  );
}
