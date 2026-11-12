/**
 * Builder's convenience keys (task M4-07): the arrows move the cursor and PageUp / PageDown
 * change its layer.
 *
 * Why a listener of its own: the app's keyboard layer (contracts §9) turns arrows into menu
 * `control` inputs, which never reach a running mode, and it drops PageUp and PageDown. Typed
 * keys still come through `ModeInstance.input` like in every mode.
 *
 * No key is handled twice (the M2-11 rule): this acts only while Builder is live (the caller's
 * `live()`), so the pause dialog and menus keep their arrows; it skips an event something else
 * already handled (`defaultPrevented`) and anything with Ctrl, Alt or Meta; and the app's own
 * listener drops arrows during live play. A held key repeats on purpose: holding an arrow walks
 * the cursor.
 */

export type NavKey = "left" | "right" | "away" | "near" | "up" | "down";

const NAV: Readonly<Record<string, NavKey>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "away",
  ArrowDown: "near",
  PageUp: "up",
  PageDown: "down",
};

/** The parts of a key event this needs; tests pass plain objects. */
export interface NavEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly isComposing?: boolean;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
}

/** The nav key of an event, or null when Builder should leave it alone. */
export function navKeyOf(e: NavEvent): NavKey | null {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing === true) {
    return null;
  }
  return NAV[e.key] ?? null;
}

/** Where key events come from: `window`, or a fake in tests. */
export interface NavTarget {
  addEventListener(type: "keydown", fn: (e: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", fn: (e: KeyboardEvent) => void): void;
}

/**
 * Listens for the nav keys while `live()` is true. A handled key's default (scrolling the page) is
 * cancelled. Returns the detach function.
 */
export function attachNavKeys(
  target: NavTarget | null,
  live: () => boolean,
  onNav: (key: NavKey) => void,
): () => void {
  if (target === null) return () => undefined;
  const onKey = (e: KeyboardEvent): void => {
    if (!live()) return;
    const nav = navKeyOf(e);
    if (nav === null) return;
    e.preventDefault();
    onNav(nav);
  };
  target.addEventListener("keydown", onKey);
  return () => target.removeEventListener("keydown", onKey);
}
