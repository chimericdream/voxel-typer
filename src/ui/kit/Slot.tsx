/**
 * An inventory cell (task M2-07): a sunken square with an item icon and a count badge.
 *
 * - With `onClick` it is a button (selectable inventory); `selected` shows as `aria-pressed`.
 * - With a `label` but no `onClick` it is an image with that name (HUD hotbar).
 * - With neither it is empty decoration, hidden from assistive tech.
 *
 * The badge is visual; put the count in `label` too (`t()` output, e.g. "Oak planks, 12").
 */
import type { ComponentChildren } from "preact";
import styles from "./Slot.module.css";

export interface SlotProps {
  /** Accessible name. Pass `t()` output. Leave out for an empty slot. */
  label?: string;
  /** The item picture: an `<img alt="">`, a canvas, or any small element. */
  icon?: ComponentChildren;
  /** Shown as a badge when it is 2 or more. */
  count?: number;
  selected?: boolean;
  /** Lit as part of the hotbar combo meter. */
  lit?: boolean;
  onClick?: () => void;
}

export function Slot({ label, icon, count, selected = false, lit = false, onClick }: SlotProps) {
  const inner = (
    <>
      {icon ? (
        <span class={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {lit ? <span class={styles.gem} aria-hidden="true" /> : null}
      {count !== undefined && count > 1 ? (
        <span class={styles.badge} aria-hidden="true">
          {count > 999 ? "999+" : count}
        </span>
      ) : null}
    </>
  );
  const data = {
    "data-selected": selected ? "1" : undefined,
    "data-lit": lit ? "1" : undefined,
  };
  if (onClick && label) {
    return (
      <button
        type="button"
        class={styles.slot}
        {...data}
        aria-label={label}
        aria-pressed={selected}
        onClick={onClick}
      >
        {inner}
      </button>
    );
  }
  if (label) {
    return (
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the icon, badge and glow together are one picture
      <span class={styles.slot} {...data} role="img" aria-label={label}>
        {inner}
      </span>
    );
  }
  return (
    <span class={styles.slot} {...data} aria-hidden="true">
      {inner}
    </span>
  );
}
