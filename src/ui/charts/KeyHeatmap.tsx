/**
 * The weak-keys heat map (task M3-11): the keyboard layout, each key filled by its recent mistake
 * rate, with the rate printed on the key, so color is never the only cue.
 *
 * One hue, light to dark (dark to light on the dark themes), in five steps (`HEAT_BINS`). The
 * lightest step means "hardly any mistakes" and is meant to sit back near the surface. A key with
 * too few presses to tell has no fill, a dashed edge and a dash for its number. The legend under
 * the map names each step's range.
 */
import { t } from "@/i18n";
import { HEAT_BINS, heatBin, roundPct } from "@/ui/screens/parent-logic";
import type { HeatKey } from "@/ui/screens/parent-logic";
import { ChartFrame } from "./ChartFrame";
import styles from "./charts.module.css";

/** Keyboard width in key units (the en-US and en-GB data reach 15). */
const UNITS = 15;
const ROWS = 5;
const GAP = 4;

/** What a key shows: the letter in capitals, or a name for Space. */
export function keyCapLabel(char: string): string {
  return char === " " ? t("parent.keys.space") : char.toUpperCase();
}

/** The rate printed on a key: `"7%"`, or a dash when there's too little to tell. */
export const ratePctLabel = (rate: number | null): string =>
  rate === null ? "–" : `${roundPct(rate)}%`;

export interface KeyHeatmapProps {
  keys: readonly HeatKey[];
  /** The SVG's accessible name. */
  label: string;
  caption?: string;
  testId: string;
}

export function KeyHeatmap(props: KeyHeatmapProps) {
  return (
    <ChartFrame
      testId={props.testId}
      {...(props.caption === undefined ? {} : { caption: props.caption })}
    >
      {(width) => <KeyHeatmapSvg {...props} width={width} />}
    </ChartFrame>
  );
}

function KeyHeatmapSvg(props: KeyHeatmapProps & { width: number }) {
  const { width } = props;
  const unit = Math.max(24, Math.min(64, Math.floor(width / UNITS)));
  const w = unit * UNITS;
  const h = unit * ROWS;
  const big = Math.round(unit * 0.36);
  const small = Math.round(unit * 0.28);

  return (
    <>
      <svg
        class={styles.svg}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- reason: an SVG chart with drawn marks, named by aria-label; an <img> cannot hold them
        role="img"
        aria-label={props.label}
      >
        {props.keys.map((k) => {
          const bin = k.rate === null ? "none" : String(heatBin(k.rate));
          const x = k.x * unit + GAP / 2;
          const y = k.row * unit + GAP / 2;
          const kw = k.w * unit - GAP;
          const kh = unit - GAP;
          const cap = keyCapLabel(k.char);
          return (
            <g key={k.code} class={styles.heatKey} data-bin={bin} data-key={k.code}>
              <rect x={x} y={y} width={kw} height={kh} rx={4} />
              <text
                x={x + kw / 2}
                y={y + kh * 0.4}
                text-anchor="middle"
                dominant-baseline="middle"
                font-size={big}
                aria-hidden="true"
              >
                {cap}
              </text>
              <text
                class={styles.heatPct}
                x={x + kw / 2}
                y={y + kh * 0.76}
                text-anchor="middle"
                dominant-baseline="middle"
                font-size={small}
                aria-hidden="true"
              >
                {ratePctLabel(k.rate)}
              </text>
              <title>
                {k.rate === null
                  ? t("parent.keys.tipFew", { key: cap })
                  : t("parent.keys.tip", { key: cap, pct: roundPct(k.rate) })}
              </title>
            </g>
          );
        })}
      </svg>
      <HeatLegend />
    </>
  );
}

/** The five steps and "not enough yet", each with its range in words and numbers. */
export function HeatLegend() {
  const edges = HEAT_BINS.map((b) => roundPct(b));
  const ranges = [
    t("parent.keys.under", { pct: edges[0] ?? 0 }),
    ...edges.slice(0, -1).map((lo, i) => t("parent.keys.range", { lo, hi: edges[i + 1] ?? lo })),
    t("parent.keys.over", { pct: edges.at(-1) ?? 0 }),
  ];
  return (
    <ul class={styles.legend} aria-label={t("parent.keys.legend")}>
      {ranges.map((r, i) => (
        <li key={i} class={styles.legendItem}>
          <span class={styles.swatch} data-bin={String(i)} aria-hidden="true" />
          {r}
        </li>
      ))}
      <li class={styles.legendItem}>
        <span class={styles.swatch} data-bin="none" aria-hidden="true" />
        {t("parent.keys.few")}
      </li>
    </ul>
  );
}
