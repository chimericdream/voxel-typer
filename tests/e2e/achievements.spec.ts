/**
 * My Badges and the badge toast in a real browser (task M3-FIX-8):
 * - while badges are out of sight below, the list's bottom fades and "More badges below" shows,
 *   at 1280×720, at text scale 2, and with strong colors (screenshot baselines, made on CI's Linux
 *   runner only by the Update snapshots workflow);
 * - a keyboard reaches every badge (the list takes focus and scrolls), and the cue goes at the end;
 * - at text scale 2 a badge toast on the World Map stays clear of the corner buttons.
 */
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { playLesson } from "./helpers/kid";
import { RESULTS_ARM_MS, expectNoAxeViolations, expectScreen } from "./helpers/slice";
import { collectErrors, ready, waitForLesson } from "./helpers/vt";

async function open(page: Page, profile: string, screen: string): Promise<string[]> {
  const errors = collectErrors(page);
  await page.goto(`/?profile=${profile}&screen=${screen}&seed=1&freeze=1`, {
    waitUntil: "domcontentloaded",
  });
  await ready(page);
  return errors;
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

/**
 * The map's My Badges button, by keyboard. At text scale 2 on 1280×720 the map's hint lies over
 * this button and takes its clicks (reported in docs/handoffs/M3-FIX-8.md; WorldMap is not this
 * task's), so a click would hang.
 */
async function openBadges(page: Page): Promise<void> {
  await page.getByRole("button", { name: "My Badges", exact: true }).press("Enter");
  await expectScreen(page, "achievements");
}

const list = (page: Page): Locator => page.getByRole("region", { name: "All badges" });
const cue = (page: Page): Locator => page.getByTestId("badges-more");

/** The cue shows, the list's bottom is faded, and the last badge is out of sight. */
async function expectCue(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "My Badges" })).toBeVisible();
  await expect(list(page)).toHaveAttribute("data-below", "1");
  await expect(cue(page)).toBeVisible();
  await expect(cue(page)).toHaveText("More badges below");
  await expect(page.locator("[data-badge]").last()).not.toBeInViewport();
  // The cue and Back are both on screen, below the list.
  for (const el of [cue(page), page.getByRole("button", { name: "Back", exact: true })]) {
    await expect(el).toBeInViewport({ ratio: 1 });
  }
}

/**
 * At text scale 2: one wide column, and the first card is whole, status line and all, above the
 * fade (`--fade` is min(3rem × scale, 20 % of the list), Achievements.module.css).
 */
async function expectWholeCard(page: Page, scale: number): Promise<void> {
  const cards = page.locator("[data-badge]");
  const xs = new Set<number>();
  for (const card of (await cards.all()).slice(0, 4)) {
    const b = await card.boundingBox();
    if (b !== null) xs.add(Math.round(b.x));
  }
  expect(xs.size, "columns").toBe(1);
  const box = await list(page).boundingBox();
  const first = await cards.first().boundingBox();
  if (box === null || first === null) throw new Error("no list or card box");
  const fade = Math.min(48 * scale, 0.2 * box.height);
  expect(first.y).toBeGreaterThanOrEqual(box.y);
  expect(first.y + first.height, "first card ends above the fade").toBeLessThanOrEqual(
    box.y + box.height - fade,
  );
}

/** Waits for fonts, layout and the arrow's hops to settle before a screenshot. */
async function still(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
}

test.describe("My Badges shows that it scrolls", () => {
  test.use({ viewport: { width: 1280, height: 720 }, colorScheme: "light" });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("1280×720: the cue shows while badges are hidden", async ({ page }) => {
    const errors = await open(page, "veteran-builder", "achievements");
    await expectCue(page);
    await expectNoAxeViolations(page, "my badges, scrolled to the top");
    await still(page);
    await expect(page).toHaveScreenshot("badges-1280.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test("1280×720 at text scale 2: the cue still shows, with Back on screen", async ({ page }) => {
    const errors = await open(page, "veteran-builder", "map");
    await setLook(page, { scale: 2 });
    await openBadges(page);
    await expectCue(page);
    await expectWholeCard(page, 2);
    await still(page);
    await expect(page).toHaveScreenshot("badges-1280-scale2.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test("1024×600 at text scale 2: a whole card, the cue and Back all fit", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    const errors = await open(page, "veteran-builder", "map");
    await setLook(page, { scale: 2 });
    await openBadges(page);
    await expectCue(page);
    await expectWholeCard(page, 2);
    await expect(page.getByRole("heading", { name: "My Badges" })).toBeInViewport({ ratio: 1 });
    await still(page);
    await expect(page).toHaveScreenshot("badges-1024x600-scale2.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test("strong colors at text scale 2: the cue still reads", async ({ page }) => {
    const errors = await open(page, "veteran-builder", "map");
    await setLook(page, { scale: 2, contrast: true });
    await openBadges(page);
    await expectCue(page);
    await expectWholeCard(page, 2);
    await expectNoAxeViolations(page, "my badges, strong colors, text scale 2");
    await still(page);
    await expect(page).toHaveScreenshot("badges-contrast-scale2.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test("a keyboard reaches every badge, and the cue goes at the end", async ({ page }) => {
    const errors = await open(page, "veteran-builder", "achievements");
    await expectCue(page);
    const back = page.getByRole("button", { name: "Back", exact: true });
    await expect(back).toBeFocused();
    // Shift+Tab from Back lands on the list (the cue is not a Tab stop).
    await page.keyboard.press("Shift+Tab");
    await expect(list(page)).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.locator("[data-badge]").last()).toBeInViewport();
    await expect(list(page)).not.toHaveAttribute("data-below", "1");
    await expect(list(page)).toHaveAttribute("data-above", "1");
    await expect(cue(page)).toBeHidden();
    // Arrow keys and Home work too.
    await page.keyboard.press("Home");
    await expect(page.locator("[data-badge]").first()).toBeInViewport();
    await expect(cue(page)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => list(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // A click on the cue scrolls the list down.
    await page.keyboard.press("Home");
    await expect.poll(() => list(page).evaluate((el) => el.scrollTop)).toBe(0);
    await cue(page).click();
    await expect.poll(() => list(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  });
});

test.describe("badge toast on the World Map", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("at text scale 2 it stays clear of the corner buttons", async ({ page }) => {
    test.slow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = collectErrors(page);
    await page.goto("/?profile=fresh-sprout&screen=map&seed=1", {
      waitUntil: "domcontentloaded",
    });
    await ready(page);
    await setLook(page, { scale: 2 });

    // A first lesson earns several badges; leave Results before the first toast opens.
    await page.getByRole("button", { name: /^Meadow Home/ }).click();
    await page.getByRole("button", { name: /^Lesson 1: / }).click();
    await expectScreen(page, "lessonIntro");
    await page.getByRole("button", { name: "Start" }).click();
    await expectScreen(page, "play");
    await waitForLesson(page);
    await playLesson(page, { wpm: 30, errorRate: 0, seed: 3 });
    await expectScreen(page, "results");
    await page.waitForTimeout(RESULTS_ARM_MS + 100);
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expectScreen(page, "map");
    await page.keyboard.press("Escape");
    const corner = page.locator("[data-toast-clear]");
    await expect(corner).toBeVisible();

    const toast = page.getByTestId("badge-toast");
    await expect(toast).toBeVisible({ timeout: 15_000 });
    const box = await toast.boundingBox();
    if (box === null) throw new Error("the toast has no box");
    for (const button of await corner.getByRole("button").all()) {
      const b = await button.boundingBox();
      if (b === null) continue;
      const apart =
        box.x + box.width <= b.x ||
        b.x + b.width <= box.x ||
        box.y + box.height <= b.y ||
        b.y + b.height <= box.y;
      expect(apart, await button.innerText()).toBe(true);
    }
    // And on screen.
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    expect(errors).toEqual([]);
  });
});
