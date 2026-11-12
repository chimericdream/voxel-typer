/**
 * One held key presses a control once (task M3-07, PLAN.md §4.6: tolerate key-repeat).
 *
 * A held Enter auto-repeats, and a browser clicks the focused button (or flips a switch, or picks a
 * tab) on every repeat. Some kit controls guard this themselves (`Button`, `Dialog`, the map). This
 * page-wide guard covers every control, including later ones (M3-08's toggles and tabs): a repeated
 * Enter on a button-like control has its default action cancelled. Space already presses once, on
 * keyup. Typing fields aren't touched.
 */

/** Controls Enter activates. */
const ACTIVATES = "button, a[href], summary, [role='button'], [role='switch'], [role='tab']";

export function isHeldActivation(e: Pick<KeyboardEvent, "repeat" | "key" | "target">): boolean {
  if (!e.repeat || e.key !== "Enter") return false;
  const el = e.target;
  return typeof Element !== "undefined" && el instanceof Element && el.closest(ACTIVATES) !== null;
}

function onKey(e: KeyboardEvent): void {
  if (isHeldActivation(e)) e.preventDefault();
}

/** Installs the guard on `target` (capture phase, before any handler). Returns a remover. */
export function guardHeldActivation(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
): () => void {
  target.addEventListener("keydown", onKey, { capture: true });
  return () => target.removeEventListener("keydown", onKey, { capture: true });
}
