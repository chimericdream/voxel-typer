/**
 * The big word display (task M2-14, PLAN.md §4.6). One cell per char, each with its engine mark:
 *
 * - `pending`: full ink, not typed yet.
 * - `ok`: typed right; steps back to the muted ink.
 * - `fixed`: typed right after a miss; muted ink and a dotted underline.
 * - `wrong`: the last press here missed; a wavy underline and a hatch pattern, never red alone.
 *
 * The next char (the cursor) has a thick bar under it and a soft tint, and bobs gently when motion
 * is on. Under reduced motion only the bar and tint stay. Nothing here flashes: marks change only
 * when the child presses a key, and a held key that repeats keeps the same mark.
 *
 * All target text uses `--font-body` (Atkinson): M2-08 found the pixel font mirrors b/d and p/q.
 */
import type { TargetView } from "@/engine/types";
import { t } from "@/i18n";
import { Panel } from "@/ui/kit/Panel";
import type { HudState } from "./bridge";
import styles from "./Hud.module.css";

export type Mark = TargetView["marks"][number];

export interface WordCell {
  /** The char to type (`" "` for a space). */
  char: string;
  mark: Mark;
  /** The cursor is here. */
  next: boolean;
}

/** Shown for a space, so the child can see where Space goes. */
export const SPACE_GLYPH = "␣";

/**
 * One cell per char. `marks` has one more entry than `text` while a trailing space is required;
 * that entry becomes a space cell.
 */
export function wordCells(word: NonNullable<HudState["word"]>): WordCell[] {
  const n = Math.max(word.text.length, word.marks.length);
  return Array.from({ length: n }, (_, i) => ({
    char: word.text[i] ?? " ",
    mark: word.marks[i] ?? "pending",
    next: i === word.typed,
  }));
}

/** Size steps: a lone letter is biggest, long words shrink so they fit one line. */
export function sizeOf(length: number): "letter" | "word" | "long" {
  if (length <= 1) return "letter";
  return length <= 10 ? "word" : "long";
}

export function WordDisplay({ word }: { word: HudState["word"] }) {
  if (word === null) return null;
  const cells = wordCells(word);
  const trailingSpace = word.marks.length > word.text.length;
  const label = t(trailingSpace ? "hud.wordSpace" : "hud.word", { word: word.text });
  return (
    <div class={styles.wordRow}>
      <Panel class={styles.wordPlate ?? ""}>
        <div
          class={styles.word}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- reason: the marked chars are one picture of the word, named by aria-label
          role="img"
          aria-label={label}
          data-size={sizeOf(word.text.length)}
          style={{ "--len": Math.max(1, cells.length) }}
        >
          {cells.map((c, i) => (
            <span
              key={i}
              class={styles.char}
              data-mark={c.mark}
              data-next={c.next ? "1" : undefined}
              data-space={c.char === " " ? "1" : undefined}
              aria-hidden="true"
            >
              {c.char === " " ? SPACE_GLYPH : c.char}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}
