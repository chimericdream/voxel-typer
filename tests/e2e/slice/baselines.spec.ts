/**
 * Slice flow 5 (task M2-15): screenshot baselines at a fixed seed under `?freeze`: splash, lesson
 * intro, mid-word and Results. Compared only on CI's Linux runner (playwright.config.ts); the
 * baselines are made there by the Update snapshots workflow. Reduced motion makes Results draw its
 * stars and loot at once, and the kid types with no slips, so every run reaches the same screen.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createKid, playLesson } from "../helpers/kid";
import { collectErrors, ready, state, waitForLesson } from "../helpers/vt";
import { expectScreen } from "../helpers/slice";

test.use({ colorScheme: "light" });

const STEADY = { wpm: 30, errorRate: 0, seed: 1 } as const;

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // At rest: the break's burst, chips and loot flight run on frame time (M2-13), about 75
    // frames of 16 ms under ?freeze. Count frames, not wall time: CI's SwiftShader is slow.
    for (let i = 0; i < 150; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("splash", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/?seed=1&freeze=1", { waitUntil: "domcontentloaded" });
  await ready(page);
  await expect(page.locator("#app").getByText("Press any key to start")).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot("splash.png");
  expect(errors).toEqual([]);
});

test("lesson intro", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/?profile=fresh-sprout&screen=lessonIntro&lesson=meadow-01&seed=1&freeze=1", {
    waitUntil: "domcontentloaded",
  });
  await ready(page);
  await expect(page.getByRole("button", { name: "Start" })).toBeFocused();
  await settle(page);
  await expect(page).toHaveScreenshot("lesson-intro.png");
  expect(errors).toEqual([]);
});

test("mid-word", async ({ page }) => {
  test.slow();
  const errors = collectErrors(page);
  await page.goto("/?profile=meadow-done-miner&screen=play&lesson=meadow-05&seed=1&freeze=1", {
    waitUntil: "domcontentloaded",
  });
  await waitForLesson(page);
  const press = createKid(page, STEADY);
  const word = (await state(page)).text ?? "";
  expect(word.length).toBeGreaterThan(1);
  // Stop inside the word: some letters typed, the cursor on the next one.
  const half = Math.floor(word.length / 2);
  for (const c of Array.from(word).slice(0, half)) await press(c);
  expect((await state(page)).typed).toBe(half);
  await settle(page);
  await expect(page).toHaveScreenshot("mid-word.png", { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("results", async ({ page }) => {
  test.slow();
  const errors = collectErrors(page);
  await page.goto("/?profile=fresh-sprout&screen=play&lesson=meadow-01&seed=1&freeze=1", {
    waitUntil: "domcontentloaded",
  });
  await waitForLesson(page);
  await playLesson(page, STEADY);
  await expectScreen(page, "results");
  // No history and no slips: three stars every time.
  expect((await state(page)).stars).toBe(3);
  await expect(page.locator("#app").getByText("Wow! Three stars!")).toBeVisible();
  await settle(page);
  // Every button and the focus ring around it (4 px ring, 3 px halo) fit inside the visible part
  // of the screen at 1280×720, with nothing scrolled (M2-FIX-3).
  const main = await page.locator("main").boundingBox();
  if (main === null) throw new Error("no main");
  expect(await page.locator("main").evaluate((el) => el.scrollTop)).toBe(0);
  const ring = 7;
  const buttons = page.locator("main").getByRole("button");
  await expect(buttons).toHaveCount(3);
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    if (box === null) throw new Error("a button has no box");
    expect(box.y - ring).toBeGreaterThanOrEqual(main.y);
    expect(box.y + box.height + ring).toBeLessThanOrEqual(main.y + main.height);
  }
  await expect(page.getByRole("button", { name: "Next lesson" })).toBeFocused();
  // A first lesson earns badges (M3-10). Their toasts show one at a time on Results; the
  // baseline is the screen once they are done.
  const toast = page.getByTestId("badge-toast");
  await expect(toast.getByText("New badge: First Steps!")).toBeVisible({ timeout: 30_000 });
  await expect(toast).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Next lesson" })).toBeFocused();
  await expect(page).toHaveScreenshot("results.png", { timeout: 30_000 });
  expect(errors).toEqual([]);
});
