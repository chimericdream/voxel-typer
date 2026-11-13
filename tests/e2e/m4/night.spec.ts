/**
 * M4 acceptance (task M4-10, PLAN.md §8 Phase 4): a Night Defense night on a Miner fixture,
 * played like a child at 15 WPM (`typeLikeAKid`'s rhythm and slips), finishes at dawn and reaches
 * Results with its loot. Then My Blocks shows that loot in the bag.
 *
 * A Miner's night is not calm, so it ends by itself: its waves run out, or the band's cap (5 min of
 * game time for a Miner, M4-FIX-3) is reached and the running wave finishes. A child at 15 WPM
 * never has to type every word for the sun to come up.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createKid } from "../helpers/kid";
import { expectScreen } from "../helpers/slice";
import { collectErrors, ready, state, vt } from "../helpers/vt";
import { night } from "./helpers";

const DAWN = "The sun is up! The camp is safe!";

test("a Miner's night at 15 WPM, like a child, finishes at dawn", async ({ page }, info) => {
  // Game time follows frames, and CI's software renderer draws them slowly, so game time runs
  // behind the wall clock; a 15 WPM child also sends visitors home slower than M4-04's 300 ms a
  // key. The night is at most ~5.5 min of game time; this allows for the slow frames.
  test.setTimeout(900_000);
  const errors = collectErrors(page);
  await page.goto("/?profile=meadow-done-miner&screen=play&lesson=birch-08&seed=1");
  await ready(page);
  const app = page.locator("#app");
  await expect(app.getByText("Night is coming!")).toBeVisible({ timeout: 30_000 });
  // The day moves along on a key once it has been seen for 1.5 s of game time.
  const dusk = app.getByText(/on the way!$/);
  await expect(async () => {
    await page.keyboard.press("f");
    await expect(dusk).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 90_000 });

  const press = createKid(page, { wpm: 15, errorRate: 0.06, seed: 15 });
  const started = Date.now();
  let keys = 0;
  let slips = 0;
  let sawDawn = false;
  for (let now = await state(page); now.screen === "play"; now = await state(page)) {
    if (!sawDawn && (await app.getByText(DAWN).isVisible())) sawDawn = true;
    const s = await night(page);
    if (s.next === null) {
      await page.waitForTimeout(200);
      continue;
    }
    slips += await press(s.next);
    keys++;
  }
  info.annotations.push({
    type: "night at 15 WPM",
    description: `${keys} keys, ${slips} slips, ${Math.round((Date.now() - started) / 1000)} s`,
  });

  await expect.poll(async () => (await state(page)).screen, { timeout: 30_000 }).toBe("results");
  expect(sawDawn, "the night ended without a dawn").toBe(true);
  const end = await state(page);
  expect(end.lessonId).toBe("birch-08");
  expect(end.stars).toBeGreaterThanOrEqual(1);
  expect(end.done).toBeGreaterThan(3);
  expect(end.lootTotal).toBeGreaterThanOrEqual(end.done);

  // The loot is in the bag, and My Blocks (M4-09) shows it: every block the night dropped, with
  // the bag's count, the fixture's blocks plus the night's.
  const loot = await nightLoot(page);
  const bag = await bagOf(page);
  expect(Object.keys(loot).length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expectScreen(page, "map");
  await page.getByRole("button", { name: "My Blocks" }).click();
  await expectScreen(page, "inventory");
  await ready(page);
  const grid = page.getByRole("listbox", { name: "Your blocks" });
  for (const [block, n] of Object.entries(loot)) {
    const slot = grid.locator(`[data-block="${block}"]`);
    await expect(slot).toHaveAttribute("data-state", "owned");
    expect(bag[block]).toBe((FIXTURE_BAG[block] ?? 0) + n);
    await expect(slot.locator("[data-count]")).toHaveAttribute("data-count", String(bag[block]));
  }
  expect(errors).toEqual([]);
});

/** What `meadow-done-miner` starts with. */
const FIXTURE_BAG: Readonly<Record<string, number>> = { "oak-planks": 12, cobble: 30 };

const counts = (v: unknown): Record<string, number> =>
  typeof v === "object" && v !== null
    ? Object.fromEntries(
        Object.entries(v).flatMap(([k, n]) => (typeof n === "number" ? [[k, n]] : [])),
      )
    : {};

/** The last result's loot, through `window.__vt`. */
async function nightLoot(page: Page): Promise<Record<string, number>> {
  const result = await vt(page, "lastResult");
  return counts(typeof result === "object" && result !== null ? Reflect.get(result, "loot") : null);
}

/** The player's bag, through `window.__vt`. */
async function bagOf(page: Page): Promise<Record<string, number>> {
  const p = await vt(page, "profile");
  return counts(typeof p === "object" && p !== null ? Reflect.get(p, "inventory") : null);
}
