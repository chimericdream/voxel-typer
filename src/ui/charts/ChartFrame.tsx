/**
 * Shared chart parts (task M3-11): the figure around a chart, its "Show the numbers" table, a
 * width hook and tick maths. Charts are hand-rolled SVG with no chart library.
 *
 * Each chart is drawn at the pixel width its box has (a `ResizeObserver` measures it), with a
 * viewBox of that size, so one SVG unit is one CSS pixel and the labels use the page's real type
 * sizes at every text scale. Without layout (tests) it uses {@link FALLBACK_WIDTH}.
 *
 * Accessibility: the SVG is `role="img"` with a short summary as its name, and every chart has a
 * data table under a native `<details>` ("Show the numbers"), so the numbers never depend on seeing
 * the colors or the shapes.
 */
import type { ComponentChildren, RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { t } from "@/i18n";
import styles from "./charts.module.css";

/** The width used before layout, and in tests. */
export const FALLBACK_WIDTH = 480;

/** Watches an element's content width. */
export function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = (): void => {
      const w = Math.floor(el.clientWidth);
      if (w > 0) setWidth((was) => (was === w ? was : w));
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const sizes = new ResizeObserver(measure);
    sizes.observe(el);
    return () => sizes.disconnect();
  }, []);
  return [ref, width];
}

/** Base label size in px at text scale 1 (`--fs-sm`). */
export const LABEL_PX = 16;

/** Rough width of `text` at `px`: Atkinson averages about 0.58 em per char for digits and words. */
export const textWidth = (text: string, px: number): number => text.length * px * 0.58;

/** A clean step (1, 2 or 5 × 10ⁿ) for about `count` ticks over `span`. */
export function niceStep(span: number, count = 4): number {
  if (!(span > 0)) return 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

/** Ticks from `min` up to a clean max at or above `max`. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const step = niceStep(max - min, count);
  const top = Math.max(min + step, Math.ceil(max / step) * step);
  const out: number[] = [];
  for (let v = min; v <= top + step / 1e6; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export interface TableColumn {
  label: string;
  /** Numbers line up on the right. */
  numeric?: boolean;
}

/** A plain data table, the chart's fallback. Cells are already formatted text. */
export function DataTable(props: {
  caption: string;
  columns: readonly TableColumn[];
  rows: readonly (readonly (string | number)[])[];
}) {
  return (
    <table class={styles.table}>
      <caption class={styles.srOnly}>{props.caption}</caption>
      <thead>
        <tr>
          {props.columns.map((c) => (
            <th key={c.label} scope="col" data-numeric={c.numeric === true ? "1" : undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => {
              const numeric = props.columns[j]?.numeric === true;
              return j === 0 ? (
                <th key={j} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={j} data-numeric={numeric ? "1" : undefined}>
                  {cell}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** "Show the numbers": the table behind a native disclosure, reachable by Tab. */
export function NumbersToggle(props: { children: ComponentChildren; label?: string }) {
  return (
    <details class={styles.numbers}>
      <summary class={styles.summary} data-nav="">
        {props.label ?? t("parent.showNumbers")}
      </summary>
      {/* A scroll area a keyboard can reach and scroll (axe: scrollable-region-focusable). */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- reason: a scroll area must take focus to scroll by keyboard */}
      <div class={styles.tableWrap} tabIndex={0}>
        {props.children}
      </div>
    </details>
  );
}

/** A chart's box: the measured area (its width goes to `children`), then the caption under it. */
export function ChartFrame(props: {
  caption?: string;
  children: (width: number) => ComponentChildren;
  testId: string;
}) {
  const [ref, width] = useWidth();
  return (
    <figure class={styles.figure} data-chart={props.testId}>
      <div class={styles.plot} ref={ref}>
        {props.children(width)}
      </div>
      {props.caption === undefined ? null : (
        <figcaption class={styles.caption}>{props.caption}</figcaption>
      )}
    </figure>
  );
}
