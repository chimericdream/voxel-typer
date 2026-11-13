/**
 * M4 acceptance (task M4-10, PLAN.md §8 Phase 4, the island round trip): a Builder session stamps
 * a blueprint and places a block, and after a reload the island opens just as it was left. This
 * runs on the real IndexedDB store: the `island-builder` fixture (badges for `well`, `house` and
 * `tower`, a bag that pays for a house, and Birch completed, so the island grows a ring) is put
 * into the store, then picked on the Players screen like a returning child.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expectScreen } from "../helpers/slice";
import { collectErrors } from "../helpers/vt";
import { comeBackAs, pickPlayer, storedRecord } from "./helpers";

interface Stored {
  island: { grid: unknown; expansions: number; palette?: string[] } | null;
  inventory: Record<string, number>;
  history: unknown[];
}

const isStored = (v: unknown): v is Stored =>
  typeof v === "object" && v !== null && "island" in v && "inventory" in v && "history" in v;

async function stored(page: Page, id: string): Promise<Stored> {
  const v = await storedRecord(page, id);
  if (!isStored(v)) throw new Error("the player is not in the store");
  return v;
}

const hud = (page: Page) => page.locator('[data-builder="hud"]');
const slot = (page: Page, block: string) =>
  page.locator(`[data-builder="palette"] li[data-block="${block}"]`);

async function typeWord(page: Page, word: string): Promise<void> {
  for (const ch of word) await page.keyboard.press(ch === " " ? "Space" : ch);
}

async function openIsland(page: Page): Promise<void> {
  await page.getByRole("button", { name: "My Island" }).click();
  await expectScreen(page, "play");
  await expect(hud(page)).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  // The ring and the stamp show at once.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("a Builder session places a blueprint, and the island persists after a reload", async ({
  page,
}) => {
  test.slow();
  const errors = collectErrors(page);
  const id = await comeBackAs(page, "island-builder", /^Ivy/);
  const start = await stored(page, id);
  expect(start.island).toBeNull();

  await openIsland(page);
  await expect(page.locator("#app").getByText("Your island grew!")).toBeVisible();
  await expect(page.locator('[data-builder="plans"]')).toHaveAttribute(
    "data-text",
    "well house tower",
  );
  // The blueprint: a house, paid for from the bag.
  await typeWord(page, "house");
  await expect(page.locator("#app").getByText("You built a House!")).toBeVisible();
  // And one block by hand, east of it.
  await typeWord(page, "east 6");
  await typeWord(page, "glass put");
  await expect(slot(page, "glass")).toHaveAttribute("data-count", "1");

  // Leaving saves the island, the bag and the practice session together.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Back to the map" }).click();
  await expectScreen(page, "map");
  await expect.poll(async () => (await stored(page, id)).island?.expansions).toBe(1);
  const left = await stored(page, id);
  expect(left.inventory).toMatchObject({ cobble: 20, clay: 8, glass: 1, "oak-planks": 14 });
  expect(left.history).toHaveLength(start.history.length + 1);

  // The next day: a reload, the Players screen, and the island again.
  await pickPlayer(page, /^Ivy/);
  await openIsland(page);
  await expect(page.locator('[data-builder="damaged"]')).toHaveCount(0);
  await expect(slot(page, "glass")).toHaveAttribute("data-count", "1");
  await expect(slot(page, "cobble")).toHaveAttribute("data-count", "20");
  // The ring was added once: it does not grow again.
  await expect(page.locator("#app").getByText("Your island grew!")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Back to the map" }).click();
  await expectScreen(page, "map");
  // Opening and leaving changed nothing: the island and the bag are exactly as they were left.
  const back = await stored(page, id);
  expect(back.island?.grid).toEqual(left.island?.grid);
  expect(back.island?.expansions).toBe(1);
  expect(back.inventory).toEqual(left.inventory);
  expect(errors).toEqual([]);
});
