/**
 * Icons for the on-screen keyboard's long-named keys (task M3-FIX-13): Backspace, Caps Lock, Tab,
 * Enter and Shift. Their names were 8 to 10 px on a Sprout's keyboard, under the 12-px floor; an
 * icon reads at any key size. Each has its key's name through `t()` as its accessible name. Space
 * keeps its word, since the space bar has room for it.
 */
import { t } from "@/i18n";
import type { NamedKey } from "./model";

export type IconKey = Exclude<NamedKey, "space">;

/** Strokes on a 16×16 grid, drawn 2 units thick. */
const PATHS: Readonly<Record<IconKey, readonly string[]>> = {
  // A key-shaped arrow pointing left, with a cross: rub out the letter before.
  backspace: ["M6 3h8v10H6L2 8z", "M8 5.5l4 5", "M12 5.5l-4 5"],
  // An up arrow over a bar: capitals stay on.
  caps: ["M8 2L2 8h3v3h6V8h3z", "M5 14h6"],
  // An up arrow: one capital.
  shift: ["M8 2L2 9h3v5h6V9h3z"],
  // An arrow to a wall: jump ahead.
  tab: ["M1 8h10", "M8 4.5L11.5 8 8 11.5", "M14 3v10"],
  // An arrow down and back: a new line.
  enter: ["M14 2v7H3", "M6 5.5L2.5 9 6 12.5"],
};

export function KeyIcon({ name }: { name: IconKey }) {
  return (
    <svg
      viewBox="0 0 16 16"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- reason: an inline drawing in the key's own color, named as one picture
      role="img"
      aria-label={t(`keyboard.key.${name}`)}
      data-key-icon={name}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="miter"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
