/**
 * Results shows its lines as soon as the lesson ends (M4-FIX-7). The screen's code is fetched as
 * the lesson starts, so a slow fetch at the end can't leave the child looking at an empty page.
 * Before, one fetch of the Results chunk stalled 10 s and Results stayed blank that long.
 *
 * With motion, the lines must show within 1.5 s of the route change; under reduced motion, at
 * once (nothing animates them in). In both cases they come in the same render as the heading.
 * Night Defense's motion case is in `defense.spec.ts`, on the night it already plays.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { night } from "./m4/helpers";
import { resultsTiming, watchResults } from "./helpers/results-timing";
import { collectErrors, ready, state, waitForLesson } from "./helpers/vt";

/** Under reduced motion "at once" means a frame or two, with room for CI's slow renderer. */
const AT_ONCE_MS = 500;
const SOON_MS = 1500;
/** How long the Mine cases hold back the Results chunk. */
const SLOW_CHUNK_MS = 2500;

/** Waits for Results, then checks when the heading and the lines came. */
async function expectResultsBy(page: Page, limitMs: number): Promise<void> {
  await expect.poll(async () => (await state(page)).screen, { timeout: 30_000 }).toBe("results");
  await expect(page.getByRole("heading", { name: "Lesson done!" })).toBeVisible();
  await expect
    .poll(async () => (await resultsTiming(page)).lines, { timeout: 5000 })
    .not.toBe(null);
  const t = await resultsTiming(page);
  test.info().annotations.push({
    type: "Results lines after the route change",
    description: `${t.lines} ms`,
  });
  expect(t.heading, "the Results heading").not.toBe(null);
  expect(t.lines ?? Infinity, "the Results lines").toBeLessThanOrEqual(limitMs);
  // The lines never trail the heading: they are drawn with it.
  expect(t.lines).toBe(t.heading);
}

test.describe("Night Defense, reduced motion", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 1024, height: 600 } });

  test("the night's Results lines show at once", async ({ page }) => {
    // A whole night on CI's software renderer (see defense.spec.ts).
    test.setTimeout(480_000);
    const errors = collectErrors(page);
    await page.goto("/?profile=meadow-done-miner&screen=play&lesson=birch-08&seed=1&nosave=1");
    await ready(page);
    const app = page.locator("#app");
    await expect(app.getByText("Night is coming!")).toBeVisible({ timeout: 30_000 });
    const dusk = app.getByText(/on the way!$/);
    await expect(async () => {
      await page.keyboard.press("f");
      await expect(dusk).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 90_000 });
    await watchResults(page, ["sent home", "Best streak"]);
    for (let now = await state(page); now.screen === "play"; now = await state(page)) {
      const s = await night(page);
      if (s.next === null) {
        await page.waitForTimeout(150);
        continue;
      }
      await page.keyboard.press(s.next);
      await page.waitForTimeout(70);
    }
    await expectResultsBy(page, AT_ONCE_MS);
    expect(errors).toEqual([]);
  });
});

for (const [name, viewport, motion, limit] of [
  ["1280×720", { width: 1280, height: 720 }, "no-preference", SOON_MS],
  ["1024×600, reduced motion", { width: 1024, height: 600 }, "reduce", AT_ONCE_MS],
] as const) {
  test.describe(`Mine, ${name}`, () => {
    test.use({ reducedMotion: motion, viewport });

    test("the Results lines show with the heading", async ({ page }) => {
      test.slow();
      const errors = collectErrors(page);
      // A slow server: the Results chunk takes 2.5 s to come. Fetched as the lesson starts, it is
      // here long before the end; fetched only at the end, Results would be 2.5 s late.
      await page.route(/\/Results-[^/]*\.js$/, async (route) => {
        await new Promise((r) => setTimeout(r, SLOW_CHUNK_MS));
        await route.continue();
      });
      await page.goto("/?profile=meadow-done-miner&screen=play&lesson=meadow-01&seed=1&nosave=1");
      await waitForLesson(page);
      // A Miner's Results has the aim line (a Sprout's shows stars only).
      await watchResults(page, ["Great aim"]);
      for (let now = await state(page); now.next !== null; now = await state(page)) {
        await page.keyboard.press(now.next === " " ? "Space" : now.next);
        await page.waitForTimeout(40);
      }
      await expectResultsBy(page, limit);
      expect(errors).toEqual([]);
    });
  });
}
