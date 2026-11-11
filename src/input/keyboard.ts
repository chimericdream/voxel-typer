/**
 * Keyboard input normalization (docs/impl/contracts.md §9; PLAN.md §6.5 made exact).
 *
 * Rules:
 * - Ignore `e.repeat`, `e.isComposing`, `key === 'Dead'`, `key === 'Process'`, and any event with
 *   `ctrlKey | metaKey | altKey`. Two exceptions: `Ctrl+Z` in Builder is delivered as `typed` with
 *   key `'Undo'`, and `AltGr` combos (`getModifierState('AltGraph')` is true) pass, because they
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
 * Stubs only; M1-08 implements them.
 */
import type { Clock } from "@/app/clock";
import type { KeyInput } from "@/engine/types";
import type { Ms } from "@/types/core";

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

/**
 * Turns a DOM key event into a typed or control input, by the rules above. `null` means "ignore
 * this event".
 */
export function normalizeKeyEvent(
  e: KeyboardEvent,
  t: Ms,
  ctx: { inPlay: boolean },
): TypedInput | ControlInput | null {
  void [e, t, ctx];
  throw new Error("not implemented: normalizeKeyEvent");
}

/**
 * Listens for keys on `target` and calls `handler` with each normalized input. Also turns window
 * `blur` and `visibilitychange → hidden` into `pause`. Returns the detach function.
 */
export function attachKeyboard(
  target: Window,
  clock: Clock,
  handler: (i: TypedInput | ControlInput) => void,
  getCtx: () => { inPlay: boolean },
): () => void {
  void [target, clock, handler, getCtx];
  throw new Error("not implemented: attachKeyboard");
}

/** True when Caps Lock is on for this event. */
export function capsLockOn(e: KeyboardEvent): boolean {
  void e;
  throw new Error("not implemented: capsLockOn");
}
