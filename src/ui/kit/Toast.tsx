/**
 * A short message (task M2-07). It is an `<output>` (role `status`), so it can be found by
 * browsing, but it is not itself live: the text is read out through the page's one persistent
 * live region (`announce.ts`), because a live region that mounts with its text inside is often
 * not announced (M2-07 review N5). Where it sits and how long it stays is up to the caller.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { announce } from "./announce";
import styles from "./Toast.module.css";

export interface ToastProps {
  /** The message. Pass `t()` output. */
  children: ComponentChildren;
  /** `cheer` celebrates; `info` informs. Neither is ever a scolding. */
  tone?: "info" | "cheer";
}

/** What each toast's text element last read out, and how to cancel it if it goes first. */
const spoken = new WeakMap<Element, { text: string; cancel: () => void }>();

export function Toast({ children, tone = "info" }: ToastProps) {
  const text = useRef<HTMLSpanElement>(null);
  // After every render: read the text out if it changed (a keyed new toast always has).
  useEffect(() => {
    const el = text.current;
    if (!el) return;
    const now = el.textContent ?? "";
    const last = spoken.get(el);
    if (last?.text === now) return;
    last?.cancel();
    spoken.set(el, { text: now, cancel: announce(el.ownerDocument, now) });
  });
  useEffect(() => {
    const el = text.current;
    return () => {
      if (el) spoken.get(el)?.cancel();
    };
  }, []);
  return (
    <output class={styles.toast} data-tone={tone} aria-live="off">
      {tone === "cheer" ? (
        <span class={styles.mark} aria-hidden="true">
          ★
        </span>
      ) : null}
      <span ref={text}>{children}</span>
    </output>
  );
}
