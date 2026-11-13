/**
 * A one-series line chart (task M3-11): speed or accuracy over sessions or weeks.
 *
 * Marks follow the dataviz rules: a 2px line with round joins, 8px dots with a 2px ring in the
 * surface color, hairline solid gridlines, one y-axis. Only the newest point carries a direct
 * label; the axis carries the rest, and each dot's native tooltip (`<title>`) and the data table
 * give every value. One series, so no legend: the panel heading names it.
 */
import { t } from "@/i18n";
import { ChartFrame, LABEL_PX, niceTicks, textWidth } from "./ChartFrame";
import styles from "./charts.module.css";

export interface LinePoint {
  /** The x label (a date or a week). */
  label: string;
  value: number;
}

export interface LineChartProps {
  points: readonly LinePoint[];
  /** Formats a value for labels and tooltips: `"34"`, `"97%"`. */
  format: (v: number) => string;
  /** The SVG's accessible name: a one-line summary. */
  label: string;
  /** Lowest y value; the axis starts here. Default 0. */
  min?: number;
  /** Highest y value the axis must reach (100 for percent). Default: from the data. */
  max?: number;
  /** Plain-language caption under the chart. */
  caption?: string;
  /** The page's text scale (1–2), for label room. */
  scale: number;
  testId: string;
}

export function LineChart(props: LineChartProps) {
  return (
    <ChartFrame
      testId={props.testId}
      {...(props.caption === undefined ? {} : { caption: props.caption })}
    >
      {(width) => <LineChartSvg {...props} width={width} />}
    </ChartFrame>
  );
}

function LineChartSvg(props: LineChartProps & { width: number }) {
  const { width } = props;
  const { points, format, scale } = props;
  const px = LABEL_PX * scale;
  const values = points.map((p) => p.value);
  const dataMax = Math.max(0, ...values);
  const floor = props.min ?? 0;
  const ticks = niceTicks(floor, Math.max(props.max ?? dataMax, floor + 1));
  // The axis runs from the first tick to the last, so every point is inside the plot.
  const lo = ticks[0] ?? floor;
  const hi = ticks.at(-1) ?? lo + 1;

  const last = points.at(-1);
  const endLabel = last === undefined ? "" : format(last.value);
  const left = Math.ceil(Math.max(...ticks.map((v) => textWidth(format(v), px)))) + 10;
  const right = Math.ceil(textWidth(endLabel, px)) + 14;
  const top = Math.ceil(px * 0.8);
  const bottom = Math.ceil(px * 1.8);
  const height = Math.round(150 + 50 * scale);
  const plotW = Math.max(40, width - left - right);
  const plotH = height - top - bottom;

  const x = (i: number): number =>
    points.length <= 1 ? left + plotW : left + (i / (points.length - 1)) * plotW;
  const y = (v: number): number => top + plotH - ((v - lo) / (hi - lo)) * plotH;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  const first = points[0];

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
        {first === undefined || last === undefined ? null : (
          <g aria-hidden="true">
            <text class={styles.tick} x={left} y={height - px * 0.4} text-anchor="start">
              {first.label}
            </text>
            {points.length > 1 ? (
              <text class={styles.tick} x={left + plotW} y={height - px * 0.4} text-anchor="end">
                {last.label}
              </text>
            ) : null}
          </g>
        )}
        <path class={styles.line} d={path} />
        {points.map((p, i) => (
          <g key={i} class={styles.dot}>
            <circle class={styles.mark} cx={x(i)} cy={y(p.value)} r={4} />
            {/* A hit target bigger than the dot, with the value as a native tooltip. */}
            <circle class={styles.hit} cx={x(i)} cy={y(p.value)} r={12}>
              <title>{t("parent.chart.point", { label: p.label, value: format(p.value) })}</title>
            </circle>
          </g>
        ))}
        {last === undefined ? null : (
          <text
            class={styles.endLabel}
            x={x(points.length - 1) + 8}
            y={y(last.value)}
            dominant-baseline="middle"
            aria-hidden="true"
          >
            {endLabel}
          </text>
        )}
      </svg>
    </>
  );
}
