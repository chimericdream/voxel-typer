/**
 * Puts a profile's look settings on the page (task M3-07, PLAN.md §4.6): theme (high contrast),
 * letter size, reduced motion and font. The shell calls {@link applyPageSettings} on `<html>` at
 * start and on every settings change, so a change shows at once (M3-08's live preview relies on it).
 *
 * Letter size: `--text-scale` only. `:root[data-theme]` keeps `font-size: 100%`, so `1rem` stays
 * 16 px and each kit size multiplies by the scale once (decision 74). Never scale the root font.
 *
 * Fonts (`Settings.font`), set as overrides of the `tokens.css` font tokens on the element:
 * - `pixel` (default): the `tokens.css` stacks. Since M3-FIX-2 `--font-pixel` is Atkinson too,
 *   because Pixelify's capitals and digits misread (B as G or 8, C as O), so this looks like `clean`.
 * - `clean`: Atkinson everywhere, headings too.
 * - `dyslexic`: OpenDyslexic everywhere.
 * Typing targets always use `--font-body` (decision 68: Pixelify mirrors b/d and p/q), so no
 * setting can put Pixelify on a typing target: `--font-body` is never set to the pixel font.
 */
import type { Settings } from "@/save/settings";
import { applyMotion, applyTextScale, applyTheme, themeFor } from "@/ui/theme/themes";
import { setMotionSetting } from "./motion";

export type FontSetting = Settings["font"];

/** The OpenDyslexic stack (self-hosted in `fonts.css`). */
export const DYSLEXIC_STACK = '"OpenDyslexic", "Atkinson Hyperlegible", system-ui, sans-serif';

/**
 * The font-token overrides for a font setting: `[property, value]`, where null removes the override
 * (the `tokens.css` value applies).
 */
export function fontOverrides(font: FontSetting): [prop: string, value: string | null][] {
  switch (font) {
    case "dyslexic":
      return [
        ["--font-body", DYSLEXIC_STACK],
        ["--font-pixel", DYSLEXIC_STACK],
      ];
    case "clean":
      return [
        ["--font-body", null],
        // Resolved on the same element, so it picks up tokens.css's body stack.
        ["--font-pixel", "var(--font-body)"],
      ];
    default:
      return [
        ["--font-body", null],
        ["--font-pixel", null],
      ];
  }
}

/** Sets the font tokens and `data-font` on `el`. */
export function applyFont(el: HTMLElement, font: FontSetting): void {
  for (const [prop, value] of fontOverrides(font)) {
    if (value === null) el.style.removeProperty(prop);
    else el.style.setProperty(prop, value);
  }
  el.dataset["font"] = font;
}

export type PageSettings = Pick<Settings, "highContrast" | "textScale" | "reducedMotion" | "font">;

/** Theme, letter size, motion (CSS and the shared flag) and font, all at once. */
export function applyPageSettings(el: HTMLElement, s: Readonly<PageSettings>): void {
  applyTheme(el, themeFor(s.highContrast, "day"));
  applyTextScale(el, s.textScale);
  applyMotion(el, s.reducedMotion);
  setMotionSetting(s.reducedMotion);
  applyFont(el, s.font);
}
