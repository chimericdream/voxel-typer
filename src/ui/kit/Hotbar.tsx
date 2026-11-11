/**
 * The 9-slot hotbar (task M2-07; PLAN.md §3.4). In play it doubles as the combo meter: the first
 * `lit` slots glow (`HudState.combo`, 0–9).
 */
import { Slot } from "./Slot";
import type { SlotProps } from "./Slot";
import styles from "./Hotbar.module.css";

export const HOTBAR_SLOTS = 9;

export interface HotbarProps {
  /** Names the hotbar for assistive tech. Pass `t()` output (include the combo if it matters). */
  label: string;
  /** Up to 9 slots; missing ones are empty. Extra ones are ignored. */
  slots?: readonly SlotProps[];
  /** How many slots are lit, from the left (0–9). */
  lit?: number;
  /** Index of the selected slot. */
  selected?: number;
}

export function Hotbar({ label, slots = [], lit = 0, selected }: HotbarProps) {
  const cells = Array.from({ length: HOTBAR_SLOTS }, (_, i) => i);
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a <fieldset> needs a visible legend; the HUD has none
    <div class={styles.hotbar} role="group" aria-label={label} data-lit={lit}>
      {cells.map((i) => (
        <Slot key={i} {...slots[i]} lit={i < lit} selected={i === selected} />
      ))}
    </div>
  );
}
