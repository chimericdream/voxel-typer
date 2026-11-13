/**
 * A one-series column chart (task M3-11): minutes practised per day.
 *
 * Columns are at most 24px wide, with a 4px rounded top and a square foot on the baseline, and at
 * least a 2px surface gap between them. A day with nothing draws nothing. Only the highest day
 * carries a direct label; the axis, each column's tooltip and the data table carry the rest.
 */
import { t } from "@/i18n";
import { ChartFrame, LABEL_PX, niceTicks, textWidth } from "./ChartFrame";
import styles from "./charts.module.css";

export interface Bar {
  label: string;
  value: number;
}

export interface BarChartProps {
  bars: readonly Bar[];
  format: (v: number) => string;
  /** The SVG's accessible name: a one-line summary. */
  label: string;
  caption?: string;
  /** Label every n-th bar on the x axis, counted back from the last. */
  labelEvery: number;
  scale: number;
  testId: string;
}

/** A column from the baseline up, with a rounded top: square at the foot (dataviz mark spec). */
export function columnPath(x: number, base: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h);
  const top = base - h;
  return [
    `M${x},${base}`,
    `V${top + rr}`,
    `Q${x},${top} ${x + rr},${top}`,
    `H${x + w - rr}`,
    `Q${x + w},${top} ${x + w},${top + rr}`,
    `V${base}`,
    "Z",
  ].join(" ");
}

export function BarChart(props: BarChartProps) {
  return (
    <ChartFrame
      testId={props.testId}
      {...(props.caption === undefined ? {} : { caption: props.caption })}
    >
      {(width) => <BarChartSvg {...props} width={width} />}
    </ChartFrame>
  );
}

function BarChartSvg(props: BarChartProps & { width: number }) {
  const { width } = props;
  const { bars, format, scale } = props;
  const px = LABEL_PX * scale;
  const ticks = niceTicks(0, Math.max(1, ...bars.map((b) => b.value)));
  const hi = ticks.at(-1) ?? 1;
  const left = Math.ceil(Math.max(...ticks.map((v) => textWidth(format(v), px)))) + 10;
  const right = 8;
  const top = Math.ceil(px * 1.4);
  const bottom = Math.ceil(px * 1.8);
  const height = Math.round(150 + 50 * scale);
  const plotW = Math.max(40, width - left - right);
  const plotH = height - top - bottom;
  const band = plotW / Math.max(1, bars.length);
  const barW = Math.max(2, Math.min(24, band - 2));
  const base = top + plotH;
  const y = (v: number): number => base - (v / hi) * plotH;
  const peak = bars.reduce((best, b, i) => (b.value > (bars[best]?.value ?? 0) ? i : best), 0);
  const n = bars.length;

  return (
    <>
      <svg
        class={styles.svg}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- reason: an SVG chart with drawn marks, named by aria-label; an <img> cannot hold them
        role="img"
        aria-label={props.label}
      >
        <g class={styles.grid} aria-hidden="true">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={left} x2={left + plotW} y1={y(v)} y2={y(v)} />
              <text
                class={styles.tick}
                x={left - 8}
                y={y(v)}
                text-anchor="end"
                dominant-baseline="middle"
              >
                {format(v)}
              </text>
            </g>
          ))}
        </g>
        {bars.map((b, i) => {
          const cx = left + band * i + band / 2;
          const h = base - y(b.value);
          const showX = (n - 1 - i) % props.labelEvery === 0;
          return (
            <g key={i}>
              {b.value > 0 ? (
                <path class={styles.bar} d={columnPath(cx - barW / 2, base, barW, h)} />
              ) : null}
              {/* The whole column height is the hover target, so short days are easy to point at. */}
              <rect class={styles.hit} x={cx - band / 2} y={top} width={band} height={plotH}>
                <title>{t("parent.chart.point", { label: b.label, value: format(b.value) })}</title>
              </rect>
              {showX ? (
                <text
                  class={styles.tick}
                  x={Math.min(
                    Math.max(cx, left + textWidth(b.label, px) / 2),
                    width - textWidth(b.label, px) / 2,
                  )}
                  y={height - px * 0.4}
                  text-anchor="middle"
                  aria-hidden="true"
                >
                  {b.label}
                </text>
              ) : null}
              {i === peak && b.value > 0 ? (
                <text
                  class={styles.endLabel}
                  x={cx}
                  y={y(b.value) - 6}
                  text-anchor="middle"
                  aria-hidden="true"
                >
                  {format(b.value)}
                </text>
              ) : null}
            </g>
          );
        })}
        <line
          class={styles.baseline}
          x1={left}
          x2={left + plotW}
          y1={base}
          y2={base}
          aria-hidden="true"
        />
      </svg>
    </>
  );
}
