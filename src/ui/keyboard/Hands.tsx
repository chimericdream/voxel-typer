/**
 * Hand overlay (task M2-09, PLAN.md §4.1): two blocky pixel-art hands under the keyboard. Each
 * fingertip wears its finger zone's color and pattern, so the hands match the keys. The finger for
 * the next key is raised and lit; so is the opposite pinky when Shift is needed.
 *
 * Original art, drawn here from rectangles on a 24 × 22 pixel grid. The right hand is the left hand
 * mirrored, which also mirrors the pointer finger's stripes, as on the keys.
 */
import { useId } from "preact/hooks";
import { t } from "@/i18n";
import type { Finger } from "@/types/core";
import { zoneOf } from "./model";
import type { ZoneId } from "./model";
import styles from "./Hands.module.css";

export interface HandsProps {
  /** The finger for the next key, or null when nothing is lit. */
  finger: Finger | null;
  /** The pinky that holds Shift, or null. */
  shiftFinger: Finger | null;
}

/** Art-pixel rectangle: x, y, width, height. */
type Rect = readonly [x: number, y: number, w: number, h: number];

interface Digit {
  /** The left hand's finger; the right hand uses the mirror (`L5` ↔ `R5`). */
  left: Finger;
  body: Rect;
  /** The fingertip, drawn in the zone color and pattern. */
  tip: Rect;
}

export const HAND_W = 24;
export const HAND_H = 22;

/** The left hand: pinky to pointer, then the thumb sticking out toward the middle. */
const DIGITS: readonly Digit[] = [
  { left: "L5", body: [1, 7, 3, 7], tip: [1, 7, 3, 3] },
  { left: "L4", body: [5, 3, 3, 11], tip: [5, 3, 3, 3] },
  { left: "L3", body: [9, 1, 3, 13], tip: [9, 1, 3, 3] },
  { left: "L2", body: [13, 3, 3, 11], tip: [13, 3, 3, 3] },
  { left: "T", body: [16, 13, 4, 4], tip: [19, 10, 3, 4] },
];
const PALM: Rect = [1, 11, 16, 10];

const MIRROR: Readonly<Record<Finger, Finger>> = {
  L5: "R5",
  L4: "R4",
  L3: "R3",
  L2: "R2",
  R2: "L2",
  R3: "L3",
  R4: "L4",
  R5: "L5",
  T: "T",
};

/** Pattern tiles (art pixels drawn in the pattern ink), matching the key patterns. */
const PATTERNS: Readonly<Record<Exclude<ZoneId, "thumb">, { size: number; px: readonly Rect[] }>> =
  {
    pinky: {
      size: 2,
      px: [
        [0, 0, 1, 1],
        [1, 1, 1, 1],
      ],
    },
    ring: { size: 2, px: [[0, 0, 1, 1]] },
    middle: { size: 2, px: [[0, 0, 2, 1]] },
    index: {
      size: 3,
      px: [
        [0, 2, 1, 1],
        [1, 1, 1, 1],
        [2, 0, 1, 1],
      ],
    },
  };

/** The rectangle grown by `by` art pixels on each side (outlines and the lit glow). */
function grow([x, y, w, h]: Rect, by: number): Rect {
  return [x - by, y - by, w + 2 * by, h + 2 * by];
}

function Box({
  r,
  class: cls,
  fill,
}: {
  r: Rect;
  class: string | undefined;
  fill?: string | undefined;
}) {
  return <rect x={r[0]} y={r[1]} width={r[2]} height={r[3]} class={cls} fill={fill} />;
}

function Hand({
  side,
  lit,
  uid,
}: {
  side: "left" | "right";
  lit: ReadonlySet<Finger>;
  uid: string;
}) {
  return (
    <svg
      class={styles.hand}
      data-side={side}
      viewBox={`-1 -3 ${HAND_W + 2} ${HAND_H + 4}`}
      shape-rendering="crispEdges"
      aria-hidden="true"
    >
      <defs>
        {Object.entries(PATTERNS).map(([zone, p]) => (
          <pattern
            key={zone}
            id={`${uid}-${zone}`}
            width={p.size}
            height={p.size}
            patternUnits="userSpaceOnUse"
          >
            {p.px.map((r, i) => (
              <Box key={i} r={r} class={styles.patternInk} />
            ))}
          </pattern>
        ))}
      </defs>
      <g transform={side === "right" ? `translate(${HAND_W} 0) scale(-1 1)` : undefined}>
        {DIGITS.map((d) => {
          const finger = side === "left" ? d.left : MIRROR[d.left];
          const zone = zoneOf(finger);
          const on = lit.has(finger);
          return (
            <g
              key={finger}
              class={styles.digit}
              data-finger={finger}
              data-zone={zone}
              data-lit={on ? "1" : undefined}
            >
              {on ? <Box r={grow(d.body, 2)} class={styles.glow} /> : null}
              {on ? <Box r={grow(d.tip, 2)} class={styles.glow} /> : null}
              <Box r={grow(d.body, 1)} class={styles.outline} />
              <Box r={grow(d.tip, 1)} class={styles.outline} />
              <Box r={d.body} class={styles.glove} />
              <Box r={d.tip} class={styles.tip} />
              {zone === "thumb" ? null : (
                <Box r={d.tip} class={styles.tipPattern} fill={`url(#${uid}-${zone})`} />
              )}
            </g>
          );
        })}
        <Box r={grow(PALM, 1)} class={styles.outline} />
        <Box r={PALM} class={styles.glove} />
        {/* Knuckle shading: one darker row under the fingers. */}
        <Box r={[PALM[0], PALM[1], 15, 1]} class={styles.knuckle} />
      </g>
    </svg>
  );
}

export function Hands({ finger, shiftFinger }: HandsProps) {
  const uid = useId();
  const lit = new Set<Finger>();
  if (finger) lit.add(finger);
  if (shiftFinger) lit.add(shiftFinger);
  return (
    <div class={styles.hands}>
      <div class={styles.pair}>
        <Hand side="left" lit={lit} uid={uid} />
        <Hand side="right" lit={lit} uid={uid} />
      </div>
      {finger ? (
        <p class={styles.caption}>
          <span>{t("keyboard.useFinger", { finger: t(`keyboard.finger.${finger}`) })}</span>
          {shiftFinger ? (
            <span>{t("keyboard.holdShift", { finger: t(`keyboard.finger.${shiftFinger}`) })}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
