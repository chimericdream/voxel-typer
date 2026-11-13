/**
 * On-screen keyboard (task M2-09, PLAN.md §4.1, §4.6).
 *
 * Draws any `LayoutDef` with the UI kit's `KeyCap`. Each finger zone has a color, a pattern
 * (checks, dots, stripes, mirrored diagonals, solid) and a tiny finger label (on hover, on the lit
 * keys, or on every key with `labels`), so color is never the only cue. The next key lights up with
 * a thick ring and a lift; when it needs Shift, the opposite hand's Shift lights up too. F and J
 * have bumps. A wrong key gets a gentle wobble and a short dashed outline; with reduced motion,
 * only the outline. Sizes follow `--text-scale` but never overflow the container.
 *
 * Finger labels are never smaller than 12 px (M3-FIX-12). A label wider than its key is hidden
 * (`data-label-off`, measured), so labels never run into each other; the hint line under the hands
 * still names the finger, and the zone keeps its color and pattern.
 *
 * Nothing printed on a key is smaller than 12 px either (M3-FIX-13). Backspace, Caps Lock, Tab,
 * Enter and Shift show an icon (named through `t()`), not a word. A key with two chars (digits and
 * symbols) shows both when two lines of 12 px fit on it; on a smaller key (`data-face-tight`,
 * measured) it shows one: the char to type when the key is lit with Shift, else the plain char.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { allowFlash } from "@/a11y/flashes";
import type { LayoutDef } from "@/content/layouts/types";
import { t } from "@/i18n";
import { KeyCap } from "@/ui/kit/KeyCap";
import type { Ms } from "@/types/core";
import { Hands } from "./Hands";
import { KeyIcon } from "./KeyIcon";
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
  /** With `hands`: only the hint line, not the two drawn hands (a mode that needs the room). */
  handsCaptionOnly?: boolean;
  /** Show the finger label on every key, not only on hover and on the lit keys. */
  labels?: boolean;
  /** The last wrong key. A held key that repeats is gated (see `feedWobble`). */
  wrong?: WrongKey | null;
  /** Clock for the wobble gate. Defaults to `performance.now`. */
  now?: () => Ms;
}

function glyphOf(key: BoardKey): ComponentChildren {
  const face = faceOf(key);
  if (face.kind === "blank") return "";
  if (face.kind === "named") {
    return face.name === "space" ? t("keyboard.key.space") : <KeyIcon name={face.name} />;
  }
  if (face.kind === "dual") {
    // Two lines; on a small key (`data-face-tight`) the CSS shows one of the two.
    return (
      <>
        <span data-dual="top">{face.top}</span>
        {"\n"}
        <span data-dual="bottom">{face.bottom}</span>
      </>
    );
  }
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
    if (!fed.wobble || !allowFlash()) return;
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

/**
 * Marks each key whose finger label is wider than the key (`data-label-off`). Keys not laid out
 * (no width yet) are left alone.
 */
export function fitLabels(board: Element): void {
  for (const slot of board.querySelectorAll("[data-code]")) {
    const text = slot.querySelector("[data-finger-label] > span");
    const room = slot.getBoundingClientRect().width;
    if (text === null || room === 0) continue;
    slot.toggleAttribute("data-label-off", text.getBoundingClientRect().width > room);
  }
  fitFaces(board);
}

const px = (v: string): number => Number.parseFloat(v) || 0;

/** Line height of a key's two chars (`.slot[data-face="dual"]` in the CSS). */
const DUAL_LINE = 1.05;

/**
 * Marks each two-char key too short for its two lines (`data-face-tight`); the CSS then shows one
 * char. The room is the key cap less its outer outline (one bevel unit a side) and the lift that
 * clears a finger label. It is read from the key cap, whose size and padding `data-face-tight`
 * doesn't change, so a fit never undoes itself. Runs after the labels are fitted: a hidden label
 * gives its lift back.
 */
export function fitFaces(board: Element): void {
  for (const slot of board.querySelectorAll('[data-face="dual"]')) {
    const cap = slot.querySelector("kbd");
    const height = cap?.getBoundingClientRect().height ?? 0;
    if (!cap || height === 0) continue;
    const css = getComputedStyle(cap);
    const edge = px(css.getPropertyValue("--bevel-unit")) || 3;
    const room = height - 2 * edge - px(css.paddingTop) - px(css.paddingBottom);
    slot.toggleAttribute("data-face-tight", 2 * px(css.fontSize) * DUAL_LINE > room);
  }
}

/**
 * Keeps `fitLabels` true: after the keys are drawn, when the board changes size (the key unit
 * follows the window and the text scale), when fonts finish loading, and when the lit key or the
 * labels change (a lit key lifts its glyph clear of its label, which leaves less room).
 */
function useLabelFit(
  board: { current: HTMLElement | null },
  layoutId: string,
  show: boolean,
  lit: { nextKey: string | null; labels: boolean },
): void {
  useLayoutEffect(() => {
    if (show && board.current) fitLabels(board.current);
  }, [board, show, lit.nextKey, lit.labels]);
  useLayoutEffect(() => {
    const el = board.current;
    if (!show || !el) return undefined;
    const fit = (): void => fitLabels(el);
    fit();
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    sizes?.observe(el);
    const doc = el.ownerDocument;
    const fonts = "fonts" in doc ? doc.fonts : null;
    fonts?.addEventListener("loadingdone", fit);
    return () => {
      sizes?.disconnect();
      fonts?.removeEventListener("loadingdone", fit);
    };
  }, [board, layoutId, show]);
}

export function OnScreenKeyboard({
  layout,
  nextKey,
  show = true,
  hands = false,
  handsCaptionOnly = false,
  labels = false,
  wrong = null,
  now = defaultNow,
}: OnScreenKeyboardProps) {
  const wobble = useWobble(layout, nextKey, wrong, now);
  const board = useRef<HTMLDivElement>(null);
  useLabelFit(board, layout.id, show, { nextKey, labels });
  if (!show) return null;
  const keys = boardKeys(layout);
  const target = targetFor(layout, nextKey);
  return (
    <div class={styles.root} data-labels={labels ? "1" : undefined}>
      <div class={styles.frame}>
        <div
          ref={board}
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
            // Lit for its Shift char: a small two-char key shows that char (see `fitFaces`).
            const shifted = target?.code === k.code && target.shiftCode !== null;
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
                data-shifted={shifted ? "1" : undefined}
                data-wobble={wobble === k.code ? "1" : undefined}
                style={{ "--x": k.x, "--w": k.w, "--r": k.row }}
              >
                <KeyCap glyph={glyphOf(k)} bump={k.bump} />
                <span class={styles.label} data-finger-label aria-hidden="true">
                  <span>{t(`keyboard.zone.${zone}`)}</span>
                </span>
              </div>
            );
          })}
        </div>
        {hands ? (
          <Hands
            finger={target?.finger ?? null}
            shiftFinger={target?.shiftFinger ?? null}
            captionOnly={handsCaptionOnly}
          />
        ) : null}
      </div>
    </div>
  );
}
