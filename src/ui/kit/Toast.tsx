/**
 * A short message (task M2-07). It is an `<output>` (role `status`), a polite live region, so screen readers read it without
 * moving focus. Where it sits and how long it stays is up to the caller.
 */
import type { ComponentChildren } from "preact";
import styles from "./Toast.module.css";

export interface ToastProps {
  /** The message. Pass `t()` output. */
  children: ComponentChildren;
  /** `cheer` celebrates; `info` informs. Neither is ever a scolding. */
  tone?: "info" | "cheer";
}

export function Toast({ children, tone = "info" }: ToastProps) {
  return (
    <output class={styles.toast} data-tone={tone} aria-live="polite">
      {tone === "cheer" ? (
        <span class={styles.mark} aria-hidden="true">
          ★
        </span>
      ) : null}
      <span>{children}</span>
    </output>
  );
}
