/**
 * A keyboard key drawn as a chunky block (task M2-07), for lesson intros and hints. `bump` draws
 * the F/J home-row bump.
 */
import type { ComponentChildren } from "preact";
import styles from "./KeyCap.module.css";

export interface KeyCapProps {
  /**
   * What is printed on the key: a letter, a symbol, `t()` output for named keys ("Space"), or a
   * drawing (the on-screen keyboard's key icons, M3-FIX-13).
   */
  glyph: ComponentChildren;
  /** Spoken name when the glyph alone is unclear (";" → "semicolon"). Pass `t()` output. */
  label?: string;
  size?: "md" | "lg";
  bump?: boolean;
  /** Draw it pushed down (a hint animation, or the key just typed). */
  pressed?: boolean;
  /** Wider key (Space, Shift). */
  wide?: boolean;
}

export function KeyCap({
  glyph,
  label,
  size = "md",
  bump = false,
  pressed = false,
  wide = false,
}: KeyCapProps) {
  return (
    <kbd
      class={styles.key}
      data-size={size}
      data-pressed={pressed ? "1" : undefined}
      data-wide={wide ? "1" : undefined}
      aria-label={label}
      role={label ? "img" : undefined}
    >
      <span class={styles.glyph}>{glyph}</span>
      {bump ? <span class={styles.bump} aria-hidden="true" /> : null}
    </kbd>
  );
}
