/**
 * Escape just after "Back to the map" (task M3-FIX-13). Pressed before the map had loaded, no
 * screen took it, so it went back one step in the app's history, to Lesson Intro (1 in 3 runs).
 * Now an Escape no screen takes waits for nothing: until the route's screen is up, it is dropped.
 *
 * The map's code is held back here, so the press always lands before the map is up.
 */
import { expect, test } from "@playwright/test";
import { expectScreen } from "./helpers/slice";
import { collectErrors, ready, state } from "./helpers/vt";

/** The World Map's own chunk in the build (`assets/WorldMap-<hash>.js`) or the dev server. */
const MAP_CODE = /\/WorldMap[-.][^/]*\.(?:js|tsx)(?:\?.*)?$/;
const HOLD_MS = 1500;

test("Escape right after 'Back to the map' stays on the map", async ({ page }) => {
  test.slow();
  const errors = collectErrors(page);
  let held = 0;
  await page.route(MAP_CODE, async (r) => {
    held += 1;
    await new Promise((done) => setTimeout(done, HOLD_MS));
    await r.continue();
  });
  // Straight into Lesson Intro, so the map's code isn't loaded yet.
  await page.goto("/?profile=fresh-sprout&screen=lessonIntro&lesson=meadow-01&seed=1", {
    waitUntil: "domcontentloaded",
  });
  await ready(page);
  await expectScreen(page, "lessonIntro");
  const back = page.getByRole("button", { name: "Back to the map", exact: true });
  await expect(back).toBeVisible();

  await back.click();
  await page.keyboard.press("Escape");
  expect((await state(page)).screen).toBe("map");

  await expect(page.getByRole("heading", { name: "World Map" })).toBeAttached({ timeout: 15_000 });
  expect(held, "the map's code was held back, so Escape came first").toBeGreaterThan(0);
  // Nothing went back once the map came up, either.
  await page.waitForTimeout(500);
  expect((await state(page)).screen).toBe("map");
  expect(errors).toEqual([]);
});
