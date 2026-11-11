/**
 * Keyboard layout lookups (docs/impl/contracts.md §16). Pure.
 *
 * The data is `./<id>.json`. Each file is read as `unknown` and checked by {@link isLayoutDef} at
 * import time, so a bad edit fails loudly at startup and in the unit tests.
 *
 * Rows hold only keys that type a char (plus Space). Tab, Caps Lock, Shift, Enter and Backspace
 * are not keys of the data; the `x` offsets leave room for them, so an on-screen keyboard draws
 * them in the gaps.
 */
import type { Finger } from "@/types/core";
import enGbJson from "./en-GB.json";
import enUsJson from "./en-US.json";
import type { LayoutDef } from "./types";

type LayoutKey = LayoutDef["rows"][number]["keys"][number];

const FINGERS: ReadonlySet<string> = new Set<Finger>([
  "L5",
  "L4",
  "L3",
  "L2",
  "R2",
  "R3",
  "R4",
  "R5",
  "T",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinger(value: unknown): value is Finger {
  return typeof value === "string" && FINGERS.has(value);
}

/** One char: a single code point. */
function isOneChar(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const cp = value.codePointAt(0);
  return cp !== undefined && value.length === (cp > 0xffff ? 2 : 1);
}

function isLayoutKey(value: unknown): value is LayoutKey {
  if (!isRecord(value)) return false;
  const { code, base, shift, finger, x, w } = value;
  return (
    typeof code === "string" &&
    code.length > 0 &&
    isOneChar(base) &&
    (shift === undefined || isOneChar(shift)) &&
    isFinger(finger) &&
    typeof x === "number" &&
    Number.isFinite(x) &&
    x >= 0 &&
    (w === undefined || (typeof w === "number" && Number.isFinite(w) && w > 0))
  );
}

/**
 * Structural check for a layout file: the §16 shape, one-char `base`/`shift`, a known finger, every
 * `code` and every char used once, and every home code present in the rows.
 */
export function isLayoutDef(value: unknown): value is LayoutDef {
  if (!isRecord(value)) return false;
  const { id, name, rows, homeCodes } = value;
  if (typeof id !== "string" || id.length === 0) return false;
  if (typeof name !== "string" || name.length === 0) return false;
  if (!Array.isArray(rows) || !Array.isArray(homeCodes)) return false;
  const codes = new Set<string>();
  const chars = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row) || !Array.isArray(row.keys)) return false;
    for (const key of row.keys) {
      if (!isLayoutKey(key) || codes.has(key.code)) return false;
      codes.add(key.code);
      for (const char of key.shift === undefined ? [key.base] : [key.base, key.shift]) {
        if (chars.has(char)) return false;
        chars.add(char);
      }
    }
  }
  return homeCodes.every((code) => typeof code === "string" && codes.has(code));
}

function checked(json: unknown, file: string): LayoutDef {
  if (!isLayoutDef(json)) throw new Error(`invalid keyboard layout: src/content/layouts/${file}`);
  return json;
}

/** US QWERTY (ANSI). */
export const EN_US: LayoutDef = checked(enUsJson, "en-US.json");
/** UK QWERTY (ISO): `"`/`@` swapped, `£` on 3, a `#`/`~` key by Enter, `\`/`|` left of Z. */
export const EN_GB: LayoutDef = checked(enGbJson, "en-GB.json");

/** Every shipped layout, `en-US` first. */
export const LAYOUTS: readonly LayoutDef[] = [EN_US, EN_GB];

/** The shipped layout with this id, or `null`. */
export function layoutById(id: string): LayoutDef | null {
  return LAYOUTS.find((layout) => layout.id === id) ?? null;
}

interface CharEntry {
  code: string;
  shift: boolean;
  finger: Finger;
}

const indexes = new WeakMap<LayoutDef, ReadonlyMap<string, CharEntry>>();

/** char → key, built once per layout object. A base char wins over the same char on Shift. */
function charIndex(layout: LayoutDef): ReadonlyMap<string, CharEntry> {
  const cached = indexes.get(layout);
  if (cached !== undefined) return cached;
  const index = new Map<string, CharEntry>();
  for (const row of layout.rows) {
    for (const key of row.keys) {
      index.set(key.base, { code: key.code, shift: false, finger: key.finger });
    }
  }
  for (const row of layout.rows) {
    for (const key of row.keys) {
      if (key.shift !== undefined && !index.has(key.shift)) {
        index.set(key.shift, { code: key.code, shift: true, finger: key.finger });
      }
    }
  }
  indexes.set(layout, index);
  return index;
}

/** The finger that types `char` on this layout, or `null` if the layout can't type it. */
export function fingerFor(layout: LayoutDef, char: string): Finger | null {
  return charIndex(layout).get(char)?.finger ?? null;
}

/** The key that types `char` and whether it needs Shift, or `null` if the layout can't type it. */
export function codeFor(layout: LayoutDef, char: string): { code: string; shift: boolean } | null {
  const entry = charIndex(layout).get(char);
  return entry === undefined ? null : { code: entry.code, shift: entry.shift };
}

export * from "./types";
