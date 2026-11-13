/**
 * Shared steps for the M3 sweep (task M3-14): themes for axe, keyboard-only moves, the grown-up
 * gate and a log of what the live regions say.
 */
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { expectNoAxeViolations } from "../helpers/slice";

export const THEMES = ["day", "night", "contrast"] as const;
export type Theme = (typeof THEMES)[number];

/** A theme as `applyTheme` leaves it on an element: its custom properties and color scheme. */
interface ThemeLook {
  scheme: string;
  props: [name: string, value: string][];
}

const looks = new Map<Theme, ThemeLook>();

/**
 * Reads every theme from the UI kit page, where `applyTheme` styles one section per theme
 * (`src/dev/ui-kit.tsx`). Menus only ever get the day or the high-contrast theme
 * (`themeFor(highContrast, "day")`, `src/a11y/page.ts`), so the night theme can't be reached
 * from settings. Copying what `applyTheme` wrote is the same result without a test-only switch
 * in the app. Read once per worker.
 */
async function themeLook(page: Page, theme: Theme): Promise<ThemeLook> {
  const known = looks.get(theme);
  if (known !== undefined) return known;
  const kit = await page.context().newPage();
  await kit.goto("/ui-kit.html", { waitUntil: "domcontentloaded" });
  for (const id of THEMES) {
    const section = kit.locator(`section.theme[data-theme="${id}"]`);
    await expect(section).toHaveCount(1);
    const look = await section.evaluate((el) => {
      if (!(el instanceof HTMLElement)) throw new Error("not an element");
      const props: [string, string][] = [];
      for (const name of Array.from(el.style)) {
        if (name.startsWith("--c-") || name.startsWith("--bevel-")) {
          props.push([name, el.style.getPropertyValue(name)]);
        }
      }
      return { scheme: el.style.colorScheme, props };
    });
    expect(look.props.length, `${id} theme properties`).toBeGreaterThan(20);
    looks.set(id, look);
  }
  await kit.close();
  const look = looks.get(theme);
  if (look === undefined) throw new Error(`no ${theme} theme on the UI kit page`);
  return look;
}

/** Puts `theme` on the page's root, as `applyTheme(document.documentElement, theme)` does. */
export async function useTheme(page: Page, theme: Theme): Promise<void> {
  const look = await themeLook(page, theme);
  await page.evaluate(
    ({ id, scheme, props }) => {
      const el = document.documentElement;
      el.dataset["theme"] = id;
      el.style.colorScheme = scheme;
      for (const [name, value] of props) el.style.setProperty(name, value);
    },
    { id: theme, ...look },
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** Axe on what is on screen now, in `theme`. */
export async function axeIn(page: Page, theme: Theme, where: string): Promise<void> {
  await useTheme(page, theme);
  await expectNoAxeViolations(page, `${where} (${theme})`);
}

/** Presses Tab (or Shift+Tab) until `target` has focus. Keyboard only: never clicks. */
export async function tabTo(page: Page, target: Locator, opts: { back?: boolean } = {}) {
  const key = opts.back === true ? "Shift+Tab" : "Tab";
  // Fail fast when it isn't there at all, instead of tabbing until the test's timeout.
  await expect(target).toBeVisible();
  for (let i = 0; i < 40; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}

/** Types the shown gate word into the focused gate field and presses Enter. */
export async function passGate(page: Page): Promise<void> {
  const word = (await page.locator("[data-gate-word]").textContent())?.trim() ?? "";
  expect(word).toMatch(/^[a-z]{6,8}$/);
  const field = page.getByLabel("Type the word");
  await tabTo(page, field);
  await page.keyboard.type(word);
  await page.keyboard.press("Enter");
}

/** One message as a live region got it, with the page's clock. */
export interface Spoken {
  region: "page" | "toast";
  text: string;
  at: number;
}

/**
 * Logs every text the two live regions get (`src/ui/kit/announce.ts`), from before the first page
 * script runs. Read it with {@link spoken}.
 */
export async function recordAnnouncements(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: { region: string; text: string; at: number }[] = [];
    Reflect.set(window, "vtSpoken", log);
    const ids: Record<string, string> = { "vt-announcer": "page", "vt-announcer-toast": "toast" };
    const watch = (): void => {
      new MutationObserver((records) => {
        for (const r of records) {
          const target = r.target instanceof Element ? r.target : r.target.parentElement;
          const region = target?.closest("#vt-announcer, #vt-announcer-toast");
          if (!region) continue;
          const text = region.textContent ?? "";
          const kind = ids[region.id];
          if (text !== "" && kind !== undefined) log.push({ region: kind, text, at: Date.now() });
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    };
    if (document.body) watch();
    else document.addEventListener("DOMContentLoaded", watch, { once: true });
  });
}

function isSpoken(v: unknown): v is Spoken {
  if (typeof v !== "object" || v === null) return false;
  const region: unknown = Reflect.get(v, "region");
  return (
    (region === "page" || region === "toast") &&
    typeof Reflect.get(v, "text") === "string" &&
    typeof Reflect.get(v, "at") === "number"
  );
}

export async function spoken(page: Page): Promise<Spoken[]> {
  const raw: unknown = await page.evaluate(() => Reflect.get(window, "vtSpoken") ?? []);
  return Array.isArray(raw) ? raw.filter(isSpoken) : [];
}
