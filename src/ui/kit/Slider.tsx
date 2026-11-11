/**
 * A slider (task M2-07): a native range input with a visible label and value, so arrow keys,
 * Home/End and Page Up/Down work as the browser and screen readers expect.
 */
import { useId } from "preact/hooks";
import styles from "./Slider.module.css";

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Visible label. Pass `t()` output. */
  label: string;
  /** Visible and spoken value, e.g. "80%". Pass `t()` output. Defaults to the number. */
  valueText?: (value: number) => string;
  disabled?: boolean;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  valueText,
  disabled = false,
}: SliderProps) {
  const id = useId();
  const text = valueText ? valueText(value) : String(value);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div class={styles.slider}>
      <div class={styles.row}>
        <label class={styles.label} for={id}>
          {label}
        </label>
        <output class={styles.value} for={id} aria-hidden="true">
          {text}
        </output>
      </div>
      <input
        id={id}
        class={styles.input}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={valueText ? text : undefined}
        style={{ "--pct": `${pct}%` }}
        onInput={(e) => onChange(Number(e.currentTarget.value))}
      />
    </div>
  );
}
