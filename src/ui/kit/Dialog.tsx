/**
 * A modal dialog (task M2-07), built on `<dialog>` opened with `showModal()`, so the page behind it
 * is inert. On top of that it traps focus: Tab and Shift+Tab cycle through its controls and never
 * leave it. Escape closes it. On close, focus goes back to whatever had it before.
 *
 * Escape and Tab are handled here and stopped, so the app's window-level `back`/`next` controls
 * (src/input/) don't fire as well.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** The dialog's visible title and accessible name. Pass `t()` output. */
  title: string;
  /** Text of the close button. Pass `t()` output. */
  closeLabel: string;
  children: ComponentChildren;
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** The elements inside `root` that Tab can reach, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hidden);
}

/** Moves focus around inside `root` for a Tab keydown. Returns true if it handled the key. */
export function trapTab(root: HTMLElement, shift: boolean, active: Element | null): boolean {
  const items = focusables(root);
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) {
    root.focus();
    return true;
  }
  const inside = active instanceof Node && root.contains(active);
  if (shift && (!inside || active === first || active === root)) {
    last.focus();
    return true;
  }
  if (!shift && (!inside || active === last)) {
    first.focus();
    return true;
  }
  return false;
}

export function Dialog({ open, onClose, title, closeLabel, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const root = ref.current;
    if (!root) return undefined;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root.open) {
      if (typeof root.showModal === "function") root.showModal();
      else root.setAttribute("open", "");
    }
    (focusables(root)[0] ?? root).focus();

    // Focus that lands outside anyway (no showModal support) is pulled back in.
    const onFocusIn = (e: FocusEvent): void => {
      if (e.target instanceof Node && !root.contains(e.target)) {
        (focusables(root)[0] ?? root).focus();
      }
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      if (typeof root.close === "function" && root.open) root.close();
      if (before?.isConnected) before.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent): void => {
    const root = ref.current;
    if (!root) return;
    // A key held from the opener keeps repeating once focus lands in here. Swallow repeated
    // Enter/Space so one long press can't close the dialog and reopen it over and over (a flashing
    // backdrop; PLAN §4.6).
    if (e.repeat && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      e.stopPropagation();
      if (trapTab(root, e.shiftKey, document.activeElement)) e.preventDefault();
    }
  };

  return (
    <dialog
      ref={ref}
      class={styles.dialog}
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // The native Escape path (`cancel`) goes through onClose too, so `open` stays the source of truth.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div class={styles.header}>
        <h2 id={titleId} class={styles.title}>
          {title}
        </h2>
        <button type="button" class={styles.close} onClick={onClose}>
          <span aria-hidden="true">✕</span> {closeLabel}
        </button>
      </div>
      <div class={styles.body}>{children}</div>
    </dialog>
  );
}
