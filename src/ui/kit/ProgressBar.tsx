/** A progress bar made of separate blocks (task M2-07). */
import styles from "./ProgressBar.module.css";

export interface ProgressBarProps {
  /** 0–1; clamped. */
  value01: number;
  /** Names the bar. Pass `t()` output. */
  label: string;
  /** Spoken instead of the percent, e.g. "3 of 10 words". Pass `t()` output. */
  valueText?: string;
  /** Number of blocks (default 10). */
  segments?: number;
}

/** How many of `segments` blocks are filled for `value01`. A sliver of progress shows one block. */
export function filledSegments(value01: number, segments: number): number {
  const v = Number.isFinite(value01) ? Math.min(1, Math.max(0, value01)) : 0;
  if (v === 0) return 0;
  return Math.max(1, Math.round(v * segments));
}

export function ProgressBar({ value01, label, valueText, segments = 10 }: ProgressBarProps) {
  const n = Math.max(1, Math.floor(segments));
  const filled = filledSegments(value01, n);
  const pct = Math.round((Number.isFinite(value01) ? Math.min(1, Math.max(0, value01)) : 0) * 100);
  return (
    <div
      class={styles.bar}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a native <progress> can't hold the block segments
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={valueText}
    >
      {Array.from({ length: n }, (_, i) => (
        <span key={i} class={styles.block} data-filled={i < filled ? "1" : undefined} />
      ))}
    </div>
  );
}
