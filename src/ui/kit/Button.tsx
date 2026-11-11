/**
 * A chunky bevelled button (task M2-07).
 *
 * It looks pressed while the mouse is down (`:active`) and while Enter or Space is held on it. The
 * pressed look is visual only: the native `<button>` fires `onClick`, and the app's input layer
 * (src/input/) still owns global key routing.
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import styles from "./Button.module.css";

export interface ButtonProps {
  children: ComponentChildren;
  onClick?: () => void;
  /** `primary` for the one main action on a screen. */
  variant?: "primary" | "secondary";
  size?: "md" | "lg";
  disabled?: boolean;
  type?: "button" | "submit";
  /** Accessible name, needed only when the visible content isn't text. Pass `t()` output. */
  label?: string;
  class?: string;
}

const PRESS_KEYS = new Set(["Enter", " "]);

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  disabled = false,
  type = "button",
  label,
  class: extra,
}: ButtonProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type={type}
      class={extra ? `${styles.button} ${extra}` : styles.button}
      data-variant={variant}
      data-size={size}
      data-pressed={pressed ? "1" : undefined}
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      onKeyDown={(e) => {
        // A held Enter auto-repeats and would fire onClick on every repeat (PLAN §4.6: tolerate
        // key-repeat). Only the first press clicks. Space already clicks once, on keyup.
        if (e.repeat && e.key === "Enter") e.preventDefault();
        if (PRESS_KEYS.has(e.key)) setPressed(true);
      }}
      onKeyUp={(e) => {
        if (PRESS_KEYS.has(e.key)) setPressed(false);
      }}
      onBlur={() => setPressed(false)}
    >
      <span class={styles.content}>{children}</span>
    </button>
  );
}
