/**
 * My Blocks in a real browser (task M4-09):
 * - the grid draws isometric cube icons on the shared renderer, and axe is clean in the day,
 *   night and high-contrast themes;
 * - a keyboard moves through the grid by slot, row and page in the real layout;
 * - when the grid scrolls, the cut edge fades and "More blocks below" shows, with Back and a whole
 *   row still on screen at 1024×600 and text scale 2;
 * - the World Map's corner opens it.
 * Screenshot baselines (a rich bag and a new player's empty one) are made on CI's Linux runner
 * only, by the Update snapshots workflow.
 */
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { THEMES, themeProperties } from "../../src/ui/theme/themes";
import { expectNoAxeViolations, expectScreen } from "./helpers/slice";
import { collectErrors, ready } from "./helpers/vt";

async function open(page: Page, profile: string, screen: string): Promise<string[]> {
  const errors = collectErrors(page);
  await page.goto(`/?profile=${profile}&screen=${screen}&seed=1&freeze=1`, {
    waitUntil: "domcontentloaded",
  });
  await ready(page);
  return errors;
}

const grid = (page: Page): Locator => page.getByRole("listbox", { name: "Your blocks" });
const slots = (page: Page): Locator => grid(page).getByRole("option");
const cue = (page: Page): Locator => page.getByTestId("inventory-more");

/** The focused slot's place in the grid. */
const focusedIndex = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el instanceof HTMLElement ? Number(el.dataset["index"] ?? -1) : -1;
  });

/** How many slots share the first row. */
const columns = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const tops = [...document.querySelectorAll<HTMLElement>("[data-index]")].map((el) =>
      Math.round(el.getBoundingClientRect().top),
    );
    return tops.filter((t) => t === tops[0]).length;
  });

/** Waits for fonts, layout and the cue's hops to settle before a screenshot. */
async function still(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
}

async function setSlider(page: Page, label: string, value: number): Promise<void> {
  await page.getByLabel(label, { exact: true }).evaluate((el, v) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("not a slider");
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/** From the World Map: Settings → Look → letter size (and strong colors), then back to the map. */
async function setLook(page: Page, look: { scale: number; contrast?: boolean }): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expectScreen(page, "settings");
  await page.getByRole("tab", { name: "Look" }).click();
  await setSlider(page, "Letter size", look.scale);
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--text-scale").trim()),
    )
    .toBe(String(look.scale));
  if (look.contrast === true) {
    await page.getByRole("switch", { name: "Strong colors" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
  }
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectScreen(page, "map");
}

/** The map's My Blocks corner button, by keyboard. */
async function openFromMap(page: Page): Promise<void> {
  await page.getByRole("button", { name: "My Blocks", exact: true }).press("Enter");
  await expectScreen(page, "inventory");
}

test.describe("My Blocks", () => {
  test.use({ viewport: { width: 1280, height: 720 }, colorScheme: "light" });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("a rich bag: cube icons, counts, kind notes, axe clean", async ({ page }) => {
    const errors = await open(page, "collector-miner", "inventory");
    await expect(page.getByRole("heading", { name: "My Blocks" })).toBeVisible();
    await expect(page.getByText("23 of 26 blocks found")).toBeVisible();
    // The icons are drawn on the shared WebGL renderer (SwiftShader here); flowers stay flat.
    await expect.poll(() => page.locator('[data-icon="cube"]').count()).toBeGreaterThan(10);
    await expect(slots(page).first()).toBeFocused();
    await expect(page.locator('[data-block="glass"]')).toHaveAttribute(
      "aria-label",
      "Glass, 0. All on your island",
    );
    // A rare block's ring never covers its count: the badge stacks above the ring (review of #205).
    const order = await page.locator('[data-block="lantern"]').evaluate((slot) => ({
      ring: getComputedStyle(slot, "::after").zIndex,
      badge: getComputedStyle(slot.querySelector("[data-count]") ?? slot).zIndex,
    }));
    expect(order).toEqual({ ring: "auto", badge: "1" });
    await expect(page.getByTestId("inventory-details")).toContainText("Found in lessons.");
    await expectNoAxeViolations(page, "my blocks, day");
    await still(page);
    await expect(page).toHaveScreenshot("inventory-rich.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test("a new player: every block a ? to find, axe clean", async ({ page }) => {
    const errors = await open(page, "fresh-sprout", "inventory");
    await expect(page.getByText("0 of 26 blocks found")).toBeVisible();
    await expect(page.locator('[data-state="unknown"]')).toHaveCount(26);
    await expect(page.getByTestId("inventory-details")).toContainText("Not found yet");
    await expectNoAxeViolations(page, "my blocks, empty");
    await still(page);
    await expect(page).toHaveScreenshot("inventory-empty.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test("axe clean in the night theme", async ({ page }) => {
    const errors = await open(page, "collector-miner", "inventory");
    // Menus use the day theme; put the night one on to check this screen's colors in it too.
    const props = themeProperties(THEMES.night);
    await page.evaluate((list) => {
      const html = document.documentElement;
      html.dataset["theme"] = "night";
      html.style.colorScheme = "dark";
      for (const [name, value] of list) html.style.setProperty(name, value);
    }, props);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    await expectNoAxeViolations(page, "my blocks, night");
    expect(errors).toEqual([]);
  });

  test("the keyboard moves by slot, row and page, once per press", async ({ page }) => {
    await open(page, "collector-miner", "inventory");
    await expect(slots(page).first()).toBeFocused();
    const cols = await columns(page);
    expect(cols).toBeGreaterThan(1);
    const n = await slots(page).count();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => focusedIndex(page)).toBe(1);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedIndex(page)).toBe(1 + cols);
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => focusedIndex(page)).toBe(1);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => focusedIndex(page)).toBe(0);
    await page.keyboard.press("End");
    await expect.poll(() => focusedIndex(page)).toBe(n - 1);
    await expect(slots(page).last()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect.poll(() => focusedIndex(page)).toBe(0);
    await page.keyboard.press("PageDown");
    await expect.poll(() => focusedIndex(page)).toBeGreaterThanOrEqual(cols);
    expect((await focusedIndex(page)) % cols).toBe(0);
    await page.keyboard.press("PageUp");
    await expect.poll(() => focusedIndex(page)).toBe(0);
    // The details follow the choice.
    await page.keyboard.press("ArrowRight");
    const name = await slots(page).nth(1).getAttribute("aria-label");
    await expect(page.getByTestId("inventory-details")).toContainText(
      (name ?? "").split(",")[0] ?? "",
    );
    // Tab leaves the grid in one step (one Tab stop), to the details or Back.
    await page.keyboard.press("Tab");
    await expect(grid(page).locator(":focus")).toHaveCount(0);
  });

  test("1024×600 at text scale 2: the cue, a whole row, the panel and Back all fit", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    const errors = await open(page, "collector-miner", "map");
    await setLook(page, { scale: 2 });
    await openFromMap(page);
    await expect(page.getByRole("heading", { name: "My Blocks" })).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-testid="inventory-more"]')).toBeVisible();
    await expect(cue(page)).toHaveText("More blocks below");
    for (const el of [cue(page), page.getByRole("button", { name: "Back", exact: true })]) {
      await expect(el).toBeInViewport({ ratio: 1 });
    }
    await expect(page.getByTestId("inventory-details")).toBeInViewport();
    // The first row is whole, above the fade.
    const box = await page.locator("[data-index]").first().boundingBox();
    const scroll = await grid(page).locator("xpath=..").boundingBox();
    if (box === null || scroll === null) throw new Error("no slot or grid box");
    const fade = Math.min(48 * 2, 0.2 * scroll.height);
    expect(box.y + box.height).toBeLessThanOrEqual(scroll.y + scroll.height - fade + 1);
    expect(await columns(page)).toBeGreaterThanOrEqual(1);
    // No page-wide horizontal scroll.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await still(page);
    await expect(page).toHaveScreenshot("inventory-1024x600-scale2.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test("high contrast at text scale 2: axe clean", async ({ page }) => {
    const errors = await open(page, "collector-miner", "map");
    await setLook(page, { scale: 2, contrast: true });
    await openFromMap(page);
    await expectNoAxeViolations(page, "my blocks, strong colors, text scale 2");
    // Escape goes back to the map.
    await page.keyboard.press("Escape");
    await expectScreen(page, "map");
    expect(errors).toEqual([]);
  });
});
