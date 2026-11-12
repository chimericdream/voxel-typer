/**
 * On-screen keyboard (task M2-09, PLAN.md §4.1, §4.6).
 *
 * Draws any `LayoutDef` with the UI kit's `KeyCap`. Each finger zone has a color, a pattern
 * (checks, dots, stripes, mirrored diagonals, solid) and a tiny finger label (on hover, on the lit
 * keys, or on every key with `labels`), so color is never the only cue. The next key lights up with
 * a thick ring and a lift; when it needs Shift, the opposite hand's Shift lights up too. F and J
 * have bumps. A wrong key gets a gentle wobble and a short dashed outline; with reduced motion,
 * only the outline. Sizes follow `--text-scale` but never overflow the container.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { allowFlash } from "@/a11y/flashes";
import type { LayoutDef } from "@/content/layouts/types";
import { t } from "@/i18n";
import { KeyCap } from "@/ui/kit/KeyCap";
import type { Ms } from "@/types/core";
import { Hands } from "./Hands";
import {
  WOBBLE_IDLE,
  WOBBLE_MS,
  boardKeys,
  faceOf,
  feedWobble,
  handOf,
  targetFor,
  wobbleCode,
  zoneOf,
} from "./model";
import type { BoardKey, KeyTarget, WobbleGate } from "./model";
import styles from "./OnScreenKeyboard.module.css";

/** One wrong key press. Pass a new `seq` for each press (the engine's `wrong` event). */
export interface WrongKey {
  /** The char the child typed. */
  got: string;
  seq: number;
}

export interface OnScreenKeyboardProps {
  layout: LayoutDef;
  /** `HudState.nextKey`: the char to type next. */
  nextKey: string | null;
  /** `settings.showKeyboard`. When false nothing renders, not even the hands. */
  show?: boolean;
  /** `settings.showHands`: the hand overlay under the keys. */
  hands?: boolean;
  /** Show the finger label on every key, not only on hover and on the lit keys. */
  labels?: boolean;
  /** The last wrong key. A held key that repeats is gated (see `feedWobble`). */
  wrong?: WrongKey | null;
  /** Clock for the wobble gate. Defaults to `performance.now`. */
  now?: () => Ms;
}

function glyphOf(key: BoardKey): string {
  const face = faceOf(key);
  if (face.kind === "blank") return "";
  if (face.kind === "named") return t(`keyboard.key.${face.name}`);
  if (face.kind === "dual") return `${face.top}\n${face.bottom}`;
  return face.glyph;
}

/** How the next char is spoken: its key name for Space, the char itself otherwise. */
function spokenKey(char: string): string {
  return char === " " ? t("keyboard.key.space") : char;
}

function ariaLabel(next: string | null, target: KeyTarget | null): string {
  if (next === null || !target) return t("keyboard.label");
  const finger = t(`keyboard.finger.${target.finger}`);
  const key = spokenKey(next);
  if (!target.shiftFinger) return t("keyboard.next", { key, finger });
  return t("keyboard.nextShift", {
    key,
    finger,
    shiftFinger: t(`keyboard.finger.${target.shiftFinger}`),
  });
}

function useWobble(
  layout: LayoutDef,
  nextKey: string | null,
  wrong: WrongKey | null | undefined,
  now: () => Ms,
): string | null {
  // The code of the key that wobbles. WOBBLE_GAP_MS > WOBBLE_MS, so the attribute is always gone
  // before the next wobble sets it again, and the CSS animation restarts.
  const [wobble, setWobble] = useState<string | null>(null);
  const gateRef = useRef<WobbleGate>(WOBBLE_IDLE);
  const seqRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Only a new wrong press (a new seq) feeds the gate, not a re-render with the same press.
    if (!wrong || wrong.seq === seqRef.current) return;
    seqRef.current = wrong.seq;
    const code = wobbleCode(layout, wrong.got, nextKey);
    if (code === null) return;
    const fed = feedWobble(gateRef.current, code, now());
    gateRef.current = fed.gate;
    // The outline blinks on: the page-wide flash guard has the last word (≤ 3 a second).
    if (!fed.wobble || !allowFlash(now())) return;
    setWobble(code);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setWobble(null);
    }, WOBBLE_MS);
  }, [wrong, layout, nextKey, now]);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  return wobble;
}

const defaultNow = (): Ms => performance.now();

export function OnScreenKeyboard({
  layout,
  nextKey,
  show = true,
  hands = false,
  labels = false,
  wrong = null,
  now = defaultNow,
}: OnScreenKeyboardProps) {
  const wobble = useWobble(layout, nextKey, wrong, now);
  if (!show) return null;
  const keys = boardKeys(layout);
  const target = targetFor(layout, nextKey);
  return (
    <div class={styles.root} data-labels={labels ? "1" : undefined}>
      <div class={styles.frame}>
        <div
          class={styles.board}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- reason: the keys and their labels together are one picture, named by aria-label
          role="img"
          aria-label={ariaLabel(nextKey, target)}
          data-layout={layout.id}
          style={{ "--rows": layout.rows.length }}
        >
          {keys.map((k) => {
            const zone = zoneOf(k.finger);
            const next =
              target?.code === k.code ? "key" : target?.shiftCode === k.code ? "shift" : undefined;
            const face = faceOf(k);
            return (
              <div
                key={k.id}
                class={styles.slot}
                data-code={k.code}
                data-finger={k.finger}
                data-zone={zone}
                data-hand={handOf(k.finger)}
                data-face={face.kind}
                data-next={next}
                data-wobble={wobble === k.code ? "1" : undefined}
                style={{ "--x": k.x, "--w": k.w, "--r": k.row }}
              >
                <KeyCap glyph={glyphOf(k)} bump={k.bump} />
                <span class={styles.label} aria-hidden="true">
                  <span>{t(`keyboard.zone.${zone}`)}</span>
                </span>
              </div>
            );
          })}
        </div>
        {hands ? (
          <Hands finger={target?.finger ?? null} shiftFinger={target?.shiftFinger ?? null} />
        ) : null}
      </div>
    </div>
  );
}
