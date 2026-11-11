/**
 * Keyboard helpers shared by the screens (task M2-11).
 *
 * The app's input router (M2-10) listens on `window` and hands each key to the screen's
 * `onInput` handler as a normalized control or typed input. Two DOM facts matter here:
 *
 * - The router never sees `defaultPrevented`. A kit component that already used a key (`Tabs`
 *   moves on Left/Right and calls `preventDefault`) would get it a second time as a control.
 *   {@link useScreenInput} drops controls whose keydown a component already handled: a
 *   `document` listener runs before the router's `window` listener, so it can record the flag.
 * - Tab and Enter keep their browser defaults (focus moves, buttons click). A screen must not
 *   also act on `next` or `confirm` while a control has focus ({@link focusOnControl}).
 *
 * Key repeats never reach the handler: `normalizeKeyEvent` drops them, so a held key can't act
 * twice through here. The kit `Button` and `Dialog` ignore repeats on their own.
 */
import { useEffect, useRef } from "preact/hooks";
import type { ScreenInputHandler, AppApi } from "@/app/types";

let lastKeyHandled = false;
let listening = 0;

const onDocKeyDown = (e: KeyboardEvent): void => {
  lastKeyHandled = e.defaultPrevented;
};

function listen(): () => void {
  if (listening === 0) document.addEventListener("keydown", onDocKeyDown);
  listening += 1;
  return () => {
    listening -= 1;
    if (listening === 0) document.removeEventListener("keydown", onDocKeyDown);
    lastKeyHandled = false;
  };
}

/** True while the current keydown was already used by a component (`preventDefault`). */
export const keyAlreadyHandled = (): boolean => lastKeyHandled;

/**
 * Registers `handler` as the screen's key handler while the component is mounted. Controls that
 * a component already handled are dropped before `handler` sees them (they count as used, so an
 * unhandled `back` rule doesn't fire either). The latest `handler` is always used.
 */
export function useScreenInput(app: AppApi, handler: ScreenInputHandler): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const stop = listen();
    const off = app.onInput((i) => {
      if (i.kind === "control" && keyAlreadyHandled()) return true;
      return ref.current(i);
    });
    return () => {
      off();
      stop();
    };
  }, [app]);
}

/**
 * A one-at-a-time guard for an action that must not run twice at once (a save, a load). Keep one
 * per component with `useState(createLatch)`.
 */
export interface Latch {
  /** True (and now held) when it was free. */
  take(): boolean;
  release(): void;
}

export function createLatch(): Latch {
  let held = false;
  return {
    take() {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
  };
}

const CONTROL_SELECTOR = "button, input, select, textarea, a[href], [role='tab'], [role='radio']";

/** True when keyboard focus is on a button, field, link, tab or radio. */
export function focusOnControl(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.matches(CONTROL_SELECTOR);
}

/** True when focus is in a text field (keys belong to the field). */
export function focusInField(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement
    ? el.type === "text" || el.type === "search"
    : el instanceof HTMLTextAreaElement;
}

const FOCUSABLE = "button, input, select, textarea, a[href]";

/** The focus targets of the `[data-nav]` marks in `root`: the element, or its first control. */
export function navItems(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-nav]")]
    .map((el) => (el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE)))
    .filter(
      (el): el is HTMLElement =>
        el !== null && !el.hidden && !(el instanceof HTMLButtonElement && el.disabled),
    );
}

/**
 * Moves focus to the previous or next `[data-nav]` target inside `root` ({@link navItems}),
 * wrapping around. With nothing focused there, it focuses the first one. Returns true when it
 * moved focus.
 */
export function moveFocus(root: HTMLElement | null, step: 1 | -1): boolean {
  if (!root) return false;
  const items = navItems(root);
  if (items.length === 0) return false;
  const at = items.findIndex((el) => el === document.activeElement);
  const next = at === -1 ? items[0] : items[(at + step + items.length) % items.length];
  next?.focus();
  return next !== undefined;
}

/** Arrow keys as a focus step: up/left go back, down/right go forward. */
export function arrowStep(action: string): 1 | -1 | null {
  if (action === "up" || action === "left") return -1;
  if (action === "down" || action === "right") return 1;
  return null;
}

/** The user (or the profile) asked for reduced motion. */
export function prefersReducedMotion(setting: boolean | "system" | undefined): boolean {
  if (setting === true) return true;
  if (setting === false) return false;
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}
