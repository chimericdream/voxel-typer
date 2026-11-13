/**
 * Results on short, wide windows (task M3-FIX-13): at 1024×600 and 1280×720, at text scale 1 and
 * 2, for a Builder and a Sprout, the buttons stand beside the card, and with "Next lesson" focused
 * on arrival the heading, the stars and every button show together, with nothing scrolled. At text
 * scale 1 the whole card shows too. (Before, at text scale 2, the heading scrolled off by up to
 * 308 px.) The badge toast's dock is checked in results-toast.spec.
 */
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { playLesson } from "./helpers/kid";
import { expectScreen } from "./helpers/slice";
import { collectErrors, ready, waitForLesson } from "./helpers/vt";

/** From the World Map: Meadow Home's first lesson, played to Results without a slip. */
async function firstLesson(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Meadow Home/ }).press("Enter");
  await page.getByRole("button", { name: /^Lesson 1: / }).press("Enter");
  await expectScreen(page, "lessonIntro");
  await page.getByRole("button", { name: "Start" }).press("Enter");
  await expectScreen(page, "play");
  await waitForLesson(page);
  await playLesson(page, { wpm: 60, errorRate: 0, seed: 3 });
  await expectScreen(page, "results");
}

async function box(el: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await el.boundingBox();
  if (b === null) throw new Error("no box");
  return b;
}

const PROFILES = [
  { profile: "fresh-builder", scale: 1 },
  { profile: "big-text-builder", scale: 2 },
  { profile: "small-text-sprout", scale: 1 },
  { profile: "big-text-sprout", scale: 2 },
] as const;
const VIEWS = [
  { width: 1024, height: 600 },
  { width: 1280, height: 720 },
] as const;

for (const p of PROFILES) {
  for (const view of VIEWS) {
    test(`Results, ${p.profile} at ${view.width}×${view.height}: heading, stars and buttons fit together`, async ({
      page,
    }) => {
      test.slow();
      await page.setViewportSize(view);
      await page.emulateMedia({ reducedMotion: "reduce" });
      const errors = collectErrors(page);
      await page.goto(`/?profile=${p.profile}&screen=map&seed=1`, {
        waitUntil: "domcontentloaded",
      });
      await ready(page);
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.body).getPropertyValue("--text-scale").trim(),
          ),
        )
        .toBe(String(p.scale));
      await firstLesson(page);

      const main = page.locator("main");
      const heading = page.getByRole("heading", { name: "Lesson done!" });
      const card = page.locator("main h1 + div");
      const stars = card.getByRole("img", { name: /out of 3$/ });
      const next = page.getByRole("button", { name: "Next lesson" });
      await expect(next).toBeFocused();
      expect(await main.evaluate((el) => el.scrollTop), "focusing Next lesson scrolled").toBe(0);
      await expect(heading).toBeInViewport({ ratio: 1 });
      await expect(stars).toBeInViewport({ ratio: 1 });
      const buttons = await main.getByRole("button").all();
      expect(buttons).toHaveLength(3);
      for (const b of buttons) await expect(b).toBeInViewport({ ratio: 1 });
      if (p.scale === 1) await expect(card).toBeInViewport({ ratio: 1 });

      // Side by side: the buttons in a column right of the card, under the heading.
      const c = await box(card);
      const h = await box(heading);
      for (const b of buttons) {
        const r = await box(b);
        expect(r.x, "a button left of the card's right edge").toBeGreaterThanOrEqual(c.x + c.width);
        expect(r.y, "a button over the heading").toBeGreaterThanOrEqual(h.y + h.height);
      }
      expect(errors).toEqual([]);
    });
  }
}
