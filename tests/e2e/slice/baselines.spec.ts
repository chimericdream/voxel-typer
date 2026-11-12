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
  await expect(page.getByText("Press any key to start")).toBeVisible();
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
  await expect(page.getByText("Wow! Three stars!")).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot("results.png", { timeout: 30_000 });
  expect(errors).toEqual([]);
});
