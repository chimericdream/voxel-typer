/**
 * 1–3 blocky stars (task M2-07). Earned stars fill in one after another; with reduced motion they
 * are simply full. Empty stars are hollow, so the count reads by shape as well as color.
 */
import styles from "./Stars.module.css";

export interface StarsProps {
  /** Stars earned, 0 to `max`; clamped and rounded down. */
  value: number;
  /** Names the stars, e.g. "2 of 3 stars". Pass `t()` output. */
  label: string;
  max?: number;
  size?: "md" | "lg";
  /** Animate the fill (default true). Reduced motion turns it off anyway. */
  animate?: boolean;
}

/** The star, in art pixels. Original shape, drawn for this game. */
const STAR = [
  "....#....",
  "...###...",
  "...###...",
  "#########",
  ".#######.",
  "..#####..",
  "..#####..",
  ".###.###.",
  ".##...##.",
] as const;

const W = STAR[0].length;
const H = STAR.length;
const PAD = 1;

function filled(x: number, y: number): boolean {
  return STAR[y]?.[x] === "#";
}

/** SVG path of 1×1 squares for every cell where `test` holds (in padded coordinates). */
function cells(test: (x: number, y: number) => boolean): string {
  let d = "";
  for (let y = -PAD; y < H + PAD; y++) {
    for (let x = -PAD; x < W + PAD; x++) {
      if (test(x, y)) d += `M${x + PAD} ${y + PAD}h1v1h-1z`;
    }
  }
  return d;
}

/** The fill, and a 1-pixel outline around it (cells next to the star, including diagonals). */
const FILL = cells(filled);
const EDGE = cells((x, y) => {
  if (filled(x, y)) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) if (filled(x + dx, y + dy)) return true;
  }
  return false;
});
/** The fill shrunk by one pixel: the hollow inside of an empty star. */
const CORE = cells((x, y) => {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) if (!filled(x + dx, y + dy)) return false;
  }
  return true;
});
const VIEW = `0 0 ${W + PAD * 2} ${H + PAD * 2}`;

export function Stars({ value, label, max = 3, size = "md", animate = true }: StarsProps) {
  const n = Math.max(1, Math.floor(max));
  const got = Math.min(n, Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)));
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- several SVG stars named as one picture
    <span class={styles.stars} role="img" aria-label={label} data-size={size} data-value={got}>
      {Array.from({ length: n }, (_, i) => (
        <svg
          key={i}
          class={styles.star}
          viewBox={VIEW}
          aria-hidden="true"
          shape-rendering="crispEdges"
          data-earned={i < got ? "1" : undefined}
          data-animate={animate ? "1" : undefined}
          style={{ "--i": i }}
        >
          <path class={styles.edge} d={EDGE} />
          <path class={styles.empty} d={FILL} />
          <path class={styles.hollow} d={CORE} />
          <path class={styles.fill} d={FILL} />
        </svg>
      ))}
    </span>
  );
}
