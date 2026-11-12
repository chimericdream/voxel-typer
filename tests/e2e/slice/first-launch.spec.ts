/**
 * Slice flow 1 (task M2-15): a fresh launch, a new Sprout made by typing, lesson 1 played to
 * Results with the keyboard alone. Axe runs on splash, New player, the lesson intro and Results.
 * The save is real IndexedDB (each test gets a clean browser context).
 */
import { expect, test } from "@playwright/test";
import { collectErrors, state } from "../helpers/vt";
import {
  expectNoAxeViolations,
  logPerf,
  newPlayerToIntro,
  playFromIntro,
  profileView,
} from "../helpers/slice";

test("fresh launch → new Sprout → lesson 1 → Results, keyboard only", async ({ page }) => {
  test.slow();
  const errors = collectErrors(page);
  await newPlayerToIntro(page, "Moss", { axe: true });
  expect(await profileView(page)).toMatchObject({ name: "Moss", ageBand: "sprout" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoAxeViolations(page, "lesson intro");

  const played = await playFromIntro(page, { wpm: 12, errorRate: 0.08, seed: 1 });
  const end = await state(page);
  logPerf("meadow-01 (Sprout)", end.fps, played.peakCalls);
  expect(end.stars).toBeGreaterThanOrEqual(1);
  expect(end.correct).toBe(played.keys);
  expect(end.errors).toBe(played.slips);
  expect(end.lootTotal).toBeGreaterThanOrEqual(1);
  await expectNoAxeViolations(page, "results");
  // The result is folded into the profile once.
  expect(await profileView(page)).toMatchObject({ sessionCounter: 1 });
  expect((await profileView(page))?.stars["meadow-01"]).toBe(end.stars);
  expect(errors).toEqual([]);
});
