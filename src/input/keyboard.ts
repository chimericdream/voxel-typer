/**
 * Keyboard input normalization (docs/impl/contracts.md §9; PLAN.md §6.5 made exact).
 *
 * Rules:
 * - Ignore `e.repeat`, `e.isComposing`, `key === 'Dead'`, `key === 'Process'`, and any event with
 *   `ctrlKey | metaKey | altKey`. Two exceptions: `Ctrl+Z` or `Cmd+Z` in Builder is delivered as
 *   `typed` with key `'Undo'`, and `AltGr` combos (`getModifierState('AltGraph')` is true) pass, because they
 *   are real chars on some layouts.
 * - `Escape` → `pause` in play, `back` in menus.
 * - `Enter` → `confirm` in menus. In play it is delivered as `typed` only if the mode declared it
 *   wants it (none does in v1, so it is ignored).
 * - `Tab` → `next`, `Shift+Tab` → `prev` in menus; ignored in play.
 * - Arrows → `up` / `down` / `left` / `right`.
 * - `F1`, or `` ` `` (Backquote) in the Sprout band → `hearAgain`.
 * - In play, `preventDefault` for every key that becomes `typed`, plus Space, `'`, `/`, Backspace
 *   and Tab.
 * - Single printable chars pass through as-is; Space is `' '`. Typographic apostrophes and quotes
 *   from some keyboards (`’ ‘ “ ”`) normalize to `'` and `"`.
 * - Window `blur` and `visibilitychange → hidden` produce `pause` immediately.
 *
 * The band- and mode-specific exceptions (undo, Backquote, Enter in play) read the optional
 * {@link InputCtx} fields. Each one defaults to off, so a caller that passes only `{ inPlay }`
 * gets the plain rules.
 */
import type { Clock } from "@/app/clock";
import type { KeyInput } from "@/engine/types";
import type { AgeBand, Ms } from "@/types/core";

/** A key that drives the app, not the typing engine. */
export type ControlInput = {
  kind: "control";
  action:
    | "pause"
    | "confirm"
    | "back"
    | "next"
    | "prev"
    | "up"
    | "down"
    | "left"
    | "right"
    | "hearAgain";
  t: Ms;
};

/** A key for the typing engine. */
export type TypedInput = { kind: "typed"; input: KeyInput };

/** What the app is doing right now, as far as key handling cares. */
export type InputCtx = {
  /** A mode scene is running (as opposed to a menu screen). */
  inPlay: boolean;
  /** The profile's age band. `'sprout'` turns `` ` `` (Backquote) into `hearAgain`. */
  band?: AgeBand;
  /** The current mode offers undo (Builder): `Ctrl+Z` / `Cmd+Z` become a `typed` key `'Undo'`. */
  undo?: boolean;
  /** The current mode wants `Enter` in play, as a `typed` key `'Enter'`. None does in v1. */
  wantsEnter?: boolean;
};

const ARROWS: Readonly<Record<string, ControlInput["action"]>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const SMART_QUOTES: Readonly<Record<string, string>> = {
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
};

/** Keys whose browser default is cancelled in play even when the game ignores the event. */
const PLAY_GUARDED = new Set([" ", "'", "/", "Backspace", "Tab"]);

function control(action: ControlInput["action"], t: Ms): ControlInput {
  return { kind: "control", action, t };
}

function typed(e: KeyboardEvent, key: string, t: Ms): TypedInput {
  const input: KeyInput = { key, t, shift: e.shiftKey };
  if (e.code !== "") input.code = e.code;
  return { kind: "typed", input };
}

/** One printable char (by code point), with smart quotes folded; otherwise `null`. */
function printable(key: string): string | null {
  // One code point, as the engine matches (contracts.md §3.1).
  const cp = key.codePointAt(0);
  if (cp === undefined || String.fromCodePoint(cp).length !== key.length) return null;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return null;
  return SMART_QUOTES[key] ?? key;
}

function altGraph(e: KeyboardEvent): boolean {
  return e.getModifierState("AltGraph");
}

/** Plain Ctrl+Z, or plain Cmd+Z (Meta) for Mac families. The Shift variants are not redo. */
function isUndoChord(e: KeyboardEvent): boolean {
  if (e.altKey || e.shiftKey || e.ctrlKey === e.metaKey) return false;
  return e.key === "z" || e.key === "Z";
}

/** The normalization itself, with no side effects. */
function classify(e: KeyboardEvent, t: Ms, ctx: InputCtx): TypedInput | ControlInput | null {
  if (e.repeat || e.isComposing || e.key === "Dead" || e.key === "Process") return null;

  if (e.ctrlKey || e.metaKey || e.altKey) {
    if (ctx.undo === true && isUndoChord(e)) return typed(e, "Undo", t);
    // AltGr arrives as Ctrl+Alt on Windows; only a real char it produces passes.
    if (!altGraph(e)) return null;
    const ch = printable(e.key);
    return ch === null ? null : typed(e, ch, t);
  }

  const key = e.key;
  if (key === "Escape") return control(ctx.inPlay ? "pause" : "back", t);
  if (key === "Enter") {
    if (!ctx.inPlay) return control("confirm", t);
    return ctx.wantsEnter === true ? typed(e, "Enter", t) : null;
  }
  if (key === "Tab") {
    if (ctx.inPlay) return null;
    return control(e.shiftKey ? "prev" : "next", t);
  }
  const arrow = ARROWS[key];
  if (arrow !== undefined) return control(arrow, t);
  if (key === "F1") return control("hearAgain", t);
  // By `key`, not `code`: the Backquote position types other chars on some layouts.
  if (ctx.band === "sprout" && key === "`") return control("hearAgain", t);
  if (key === "Backspace") return typed(e, "Backspace", t);

  const ch = printable(key);
  return ch === null ? null : typed(e, ch, t);
}

/**
 * Turns a DOM key event into a typed or control input, by the rules above. `null` means "ignore
 * this event". In play it also calls `e.preventDefault()` for every `typed` result and for Space,
 * `'`, `/`, Backspace and Tab (repeats included, so a held key never scrolls the page or opens
 * quick-find), except during IME composition.
 */
export function normalizeKeyEvent(
  e: KeyboardEvent,
  t: Ms,
  ctx: InputCtx,
): TypedInput | ControlInput | null {
  const out = classify(e, t, ctx);
  if (ctx.inPlay && !e.isComposing) {
    const guarded = PLAY_GUARDED.has(printable(e.key) ?? e.key);
    if (guarded || out?.kind === "typed") e.preventDefault();
  }
  return out;
}

/**
 * Listens for keys on `target` and calls `handler` with each normalized input. Also turns window
 * `blur` and `visibilitychange → hidden` into `pause`. Returns the detach function.
 */
export function attachKeyboard(
  target: Window,
  clock: Clock,
  handler: (i: TypedInput | ControlInput) => void,
  getCtx: () => InputCtx,
): () => void {
  const doc = target.document;
  const onKey = (e: KeyboardEvent): void => {
    const out = normalizeKeyEvent(e, clock.now(), getCtx());
    if (out !== null) handler(out);
  };
  const onBlur = (): void => {
    handler(control("pause", clock.now()));
  };
  const onVisibility = (): void => {
    if (doc.visibilityState === "hidden") handler(control("pause", clock.now()));
  };
  target.addEventListener("keydown", onKey);
  target.addEventListener("blur", onBlur);
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    target.removeEventListener("keydown", onKey);
    target.removeEventListener("blur", onBlur);
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}

/** True when Caps Lock is on for this event. */
export function capsLockOn(e: KeyboardEvent): boolean {
  return e.getModifierState("CapsLock");
}
