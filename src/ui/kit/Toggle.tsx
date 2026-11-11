/**
 * An on/off switch (task M2-07): a native button with `role="switch"`, so Space and Enter flip it.
 * The knob slides and shows ✓ or ✕, so the state doesn't rely on color.
 */
import styles from "./Toggle.module.css";

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible label and accessible name. Pass `t()` output. */
  label: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      class={styles.toggle}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span class={styles.track} aria-hidden="true">
        <span class={styles.knob}>{checked ? "✓" : "✕"}</span>
      </span>
      <span class={styles.label}>{label}</span>
    </button>
  );
}
