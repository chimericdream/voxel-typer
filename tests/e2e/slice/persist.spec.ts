/**
 * Slice flow 4 (task M2-15): stars and inventory survive a reload. The save is real IndexedDB,
 * so no `?nosave` or `?profile` here. After the reload the child picks themself on Profiles,
 * which gets its axe check here (it needs a saved player to show).
 */
import { expect, test } from "@playwright/test";
import { collectErrors, ready, state } from "../helpers/vt";
import {
  expectNoAxeViolations,
  expectScreen,
  newPlayerToIntro,
  playFromIntro,
  profileView,
} from "../helpers/slice";

test("a reload keeps the stars and the inventory", async ({ page }) => {
  test.slow();
  const errors = collectErrors(page);
  await newPlayerToIntro(page, "Wren", { seed: 3 });
  await playFromIntro(page, { wpm: 20, errorRate: 0.05, seed: 2 });
  const end = await state(page);
  expect(end.stars).toBeGreaterThanOrEqual(1);
  const before = await profileView(page);
  if (before === null) throw new Error("no profile after the lesson");
  expect(before.stars["meadow-01"]).toBe(end.stars);
  const total = Object.values(before.inventory).reduce((a, n) => a + n, 0);
  expect(total).toBe(end.lootTotal);
  // The save runs before Results shows (M2-10), but give IndexedDB's commit a moment.
  await page.waitForTimeout(500);

  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  expect(await profileView(page)).toBeNull();
  await page.keyboard.press("Enter");
  await expectScreen(page, "profiles");
  const me = page.getByRole("button", { name: /^Wren/ });
  await expect(me).toBeVisible();
  await expectNoAxeViolations(page, "profiles");
  // Keyboard only: the first player has focus on arrival, so Enter picks.
  await expect(me).toBeFocused();
  await page.keyboard.press("Enter");
  await expectScreen(page, "map");

  const after = await profileView(page);
  expect(after).toMatchObject({
    name: "Wren",
    ageBand: "sprout",
    sessionCounter: 1,
    stars: before.stars,
    inventory: before.inventory,
  });
  expect(errors).toEqual([]);
});
