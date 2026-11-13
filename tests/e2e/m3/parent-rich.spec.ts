/**
 * The Parent Dashboard with uneven data (task M3-14, from the M3-11 review):
 * - `uneven-builder` has key mistakes in all five heat steps, letter pairs over the 10-try floor,
 *   and a three-week break, so the heat map, the pair list and "Weeks with practice" all have
 *   something to show (N2, N6);
 * - a key's percent label is at least 11 px in the half-width panel at 1280 px (N4);
 * - the trend panel at 1024×600 and text scale 2, the narrowest chart (N10);
 * - axe in all three themes.
 * Screenshot baselines are made on CI's Linux runner only (Update snapshots workflow).
 *
 * The clock is pinned (2026-12-10 noon, UTC), as in `parent.spec.ts`.
 */
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { expectScreen } from "../helpers/slice";
import { collectErrors, ready } from "../helpers/vt";
import { THEMES, axeIn, passGate, useTheme } from "./helpers";

const NOW = new Date("2026-12-10T12:00:00Z");

test.use({ timezoneId: "UTC", colorScheme: "light", viewport: { width: 1280, height: 720 } });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

/** The dashboard for `uneven-builder`, through the gate on a direct visit. */
async function open(page: Page): Promise<string[]> {
  const errors = collectErrors(page);
  await page.goto("/?profile=uneven-builder&screen=parent&seed=1&freeze=1&nosave=1", {
    waitUntil: "domcontentloaded",
  });
  await ready(page);
  await passGate(page);
  await expectScreen(page, "parent");
  await expect(page.getByRole("heading", { name: "Juno's progress" })).toBeVisible();
  return errors;
}

const panel = (page: Page, title: string): Locator =>
  page
    .locator("[data-parent] section")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });

/** A taller window of the same width, so a whole panel fits in one shot (see `parent.spec.ts`). */
async function tall(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 1280;
  await page.setViewportSize({ width, height: 2000 });
  await still(page);
}

async function still(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
}

test("every heat step, the letter pairs and big enough key labels at 1280 px", async ({ page }) => {
  const errors = await open(page);
  const keys = panel(page, "Keys to practice");
  const bins = await keys
    .locator("[data-key]")
    .evaluateAll((els) =>
      [...new Set(els.map((el) => el.getAttribute("data-bin") ?? ""))].toSorted(),
    );
  expect(bins).toEqual(["0", "1", "2", "3", "4"]);
  // The keys that stand out, worst first: Z (28 %), ; (24 %), Q (21 %).
  const weak = keys.locator("[data-weak-keys] li");
  await expect(weak.first()).toHaveText("Z: 28% mistakes");
  await expect(weak.nth(1)).toHaveText(";: 24% mistakes");

  const sizes = await keys
    .locator("[data-key] text:nth-of-type(2)")
    .evaluateAll((els) => els.map((el) => Number.parseFloat(getComputedStyle(el).fontSize)));
  expect(sizes.length).toBeGreaterThan(20);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);

  // Letter pairs (Builder only): QU first; "zz" has too few tries to count.
  const pairs = panel(page, "Letter pairs to practice");
  await expect(pairs.locator("[data-weak-pairs] li").first()).toHaveText(/^QU: 30% mistakes$/i);
  await expect(pairs).not.toContainText(/zz/i);

  for (const theme of THEMES) await axeIn(page, theme, "parent dashboard, uneven data");
  await useTheme(page, "day");
  await tall(page);
  await expect(keys).toHaveScreenshot("uneven-keys.png", { timeout: 30_000 });
  await expect(pairs).toHaveScreenshot("uneven-pairs.png", { timeout: 30_000 });
  await useTheme(page, "contrast");
  await still(page);
  await expect(keys).toHaveScreenshot("uneven-contrast-keys.png", { timeout: 30_000 });
  await expect(pairs).toHaveScreenshot("uneven-contrast-pairs.png", { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("weeks with practice: the tab says what it draws, and its table lists only those weeks", async ({
  page,
}) => {
  const errors = await open(page);
  const trend = panel(page, "Speed and accuracy");
  const weeks = trend.getByRole("tab", { name: "Weeks with practice" });
  // Arrow keys move between tabs and select (kit Tabs).
  await trend.getByRole("tab", { name: /^Last \d+ sessions$/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(weeks).toHaveAttribute("aria-selected", "true");
  await expect(trend.locator("[data-chart='speed-weekly'] svg[role='img']")).toBeVisible();
  // The break (12 Oct to 1 Nov) has no rows: those weeks are left out, not drawn as zero.
  const table = trend.locator("[data-chart='speed-weekly'] table");
  const rows = await table.locator("tbody tr th, tbody tr td:first-child").allTextContents();
  expect(rows.join(" ")).not.toMatch(/Oct 1[2-9]|Oct 2[0-9]/);
  await axeIn(page, "day", "parent dashboard, weeks with practice");
  await tall(page);
  await expect(trend).toHaveScreenshot("uneven-trend-weeks.png", { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("1024×600 at text scale 2: the trend panel, the narrowest chart", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  const errors = collectErrors(page);
  await page.goto("/?profile=uneven-builder&screen=settings&seed=1&freeze=1&nosave=1", {
    waitUntil: "domcontentloaded",
  });
  await ready(page);
  await page.getByRole("tab", { name: "Look" }).click();
  await page.getByLabel("Letter size", { exact: true }).evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("not a slider");
    el.value = "2";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByRole("tab", { name: "Grown-ups" }).click();
  await passGate(page);
  await page.getByRole("button", { name: "See Juno's progress" }).click();
  await expectScreen(page, "parent");
  const trend = panel(page, "Speed and accuracy");
  await expect(trend.locator("[data-chart='speed-recent'] svg[role='img']")).toBeVisible();
  // Nothing on the page is wider than the window.
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-parent] *")].filter(
      (el) => el.getBoundingClientRect().right > vw + 1,
    ).length;
  });
  expect(over).toBe(0);
  for (const theme of THEMES) await axeIn(page, theme, "parent dashboard, 1024×600, text scale 2");
  await useTheme(page, "day");
  await tall(page);
  await expect(trend).toHaveScreenshot("uneven-1024-scale2-trend.png", { timeout: 30_000 });
  expect(errors).toEqual([]);
});
