/**
 * Builder mode in a real browser (task M4-07): the card's sequence against the saved island and
 * inventory, the Sprout picture palette, the arrow keys, leaving and coming back, an island that
 * won't open, axe, and the draw-call budget.
 *
 * The card writes the sequence as `oak`, `put`, `east 2`, `put`, `undo`. No block is typed `oak`
 * (the registry has `log` and `planks`), so the block here is `planks`.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expectNoAxeViolations, expectScreen } from "./helpers/slice";
import { collectErrors, ready, state, vt } from "./helpers/vt";

/** Where the cursor starts on a new island: the middle of the clearing, one above the grass. */
const START = { x: 24, y: 5, z: 24 };

interface Saved {
  island: {
    grid: { sx: number; sy: number; sz: number; rle: number[] };
    expansions: number;
  } | null;
  inventory: Record<string, number>;
  found?: Record<string, number>;
  history: { mode: string; keystrokes: number; errors: number }[];
}

function isSaved(v: unknown): v is Saved {
  return typeof v === "object" && v !== null && "island" in v && "inventory" in v && "history" in v;
}

async function profile(page: Page): Promise<Saved> {
  const p = await vt(page, "profile");
  if (!isSaved(p)) throw new Error("no profile");
  return p;
}

/** The block num in cell (x, y, z) of a saved grid: run-length pairs of [block num, count]. */
function cell(p: Saved, x: number, y: number, z: number): number {
  const grid = p.island?.grid;
  if (!grid) throw new Error("no island saved");
  let left = x + grid.sx * (z + grid.sz * y);
  for (let i = 0; i + 1 < grid.rle.length; i += 2) {
    const run = grid.rle[i + 1] ?? 0;
    if (left < run) return grid.rle[i] ?? 0;
    left -= run;
  }
  throw new Error("cell is outside the grid");
}

const hud = (page: Page) => page.locator('[data-builder="hud"]');
const line = (page: Page) => page.locator('[data-builder="line"]');
const armed = (page: Page) => page.locator('[data-builder="armed"]');
const slot = (page: Page, block: string) =>
  page.locator(`[data-builder="palette"] li[data-block="${block}"]`);

async function openIsland(page: Page, fixture: string, extra = ""): Promise<string[]> {
  const errors = collectErrors(page);
  await page.goto(`/?profile=${fixture}&screen=island&nosave=1&seed=1&freeze=1${extra}`);
  await ready(page);
  return errors;
}

/** Types a word and waits for the line to take every key. */
async function typeWord(page: Page, word: string): Promise<void> {
  for (const ch of word) await page.keyboard.press(ch === " " ? "Space" : ch);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("planks, put, east 2, put, undo: the island grid and the inventory", async ({ page }) => {
  test.slow();
  const errors = await openIsland(page, "meadow-done-miner");
  await expect(hud(page)).toBeVisible();
  await expect(page.locator("canvas.vt-stage")).toBeVisible();
  // The most-owned block is in hand at the start, and the line says what to try.
  await expect(armed(page)).toHaveAttribute("data-block", "cobble");
  await expect(page.locator("#app").getByText("Type cobble to pick a block.")).toBeVisible();
  await expectNoAxeViolations(page, "builder");

  await typeWord(page, "planks");
  await expect(armed(page)).toHaveAttribute("data-block", "oak-planks");
  await expect(line(page)).toHaveAttribute("data-text", "");
  await typeWord(page, "put");
  await expect(slot(page, "oak-planks")).toHaveAttribute("data-count", "11");
  // A direction waits for its number; the number runs it.
  await typeWord(page, "east");
  await expect(line(page)).toHaveAttribute("data-text", "east");
  await typeWord(page, " 2");
  await expect(line(page)).toHaveAttribute("data-text", "");
  await typeWord(page, "put");
  await expect(slot(page, "oak-planks")).toHaveAttribute("data-count", "10");
  await typeWord(page, "undo");
  await expect(slot(page, "oak-planks")).toHaveAttribute("data-count", "11");

  // The island's chunks, the cursor (2) and the ghost (1), well inside the budget.
  const calls = (await state(page)).calls;
  expect(calls).toBeGreaterThan(3);
  expect(calls).toBeLessThanOrEqual(150);

  // A pause saves. The island and the inventory are written together.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Back to the map" })).toBeVisible();
  await expect.poll(async () => (await profile(page)).island !== null).toBe(true);
  const p = await profile(page);
  expect(p.island?.grid).toMatchObject({ sx: 48, sy: 32, sz: 48 });
  const plank = cell(p, START.x, START.y, START.z);
  // Wood block nums are 100–149 (contracts §17).
  expect(plank).toBeGreaterThanOrEqual(100);
  expect(plank).toBeLessThan(150);
  expect(cell(p, START.x + 2, START.y, START.z)).toBe(0);
  expect(cell(p, START.x, START.y + 1, START.z)).toBe(0);
  expect(cell(p, START.x, START.y - 1, START.z)).not.toBe(0);
  expect(p.inventory).toEqual({ "oak-planks": 11, cobble: 30 });
  // Lifetime finds are written once, from the inventory before the first change.
  expect(p.found).toEqual({ "oak-planks": 12, cobble: 30 });

  // Leaving records the practice session and goes to the map; coming back shows the same island.
  await page.getByRole("button", { name: "Back to the map" }).click();
  await expectScreen(page, "map");
  const after = await profile(page);
  expect(after.history.at(-1)).toMatchObject({ mode: "builder", keystrokes: 22, errors: 0 });
  expect(cell(after, START.x, START.y, START.z)).toBe(plank);
  await page.getByRole("button", { name: "My Island" }).click();
  await expectScreen(page, "play");
  await expect(slot(page, "oak-planks")).toHaveAttribute("data-count", "11");
  expect(errors).toEqual([]);
});

test("a key that doesn't fit gets a gentle hint; Enter, Space, arrows and Ctrl+Z work", async ({
  page,
}) => {
  test.slow();
  const errors = await openIsland(page, "meadow-done-miner");
  await expect(hud(page)).toBeVisible();

  await typeWord(page, "plx");
  await expect(line(page)).toHaveAttribute("data-text", "pl");
  await expect(page.locator("#app").getByText("Keep going: planks")).toBeVisible();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(line(page)).toHaveAttribute("data-text", "");

  // Space on an empty line puts the block in hand; the arrows and Page keys move the cursor.
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("PageUp");
  await expect(page.locator('[data-builder="layer"]')).toContainText("Layer 7");
  await page.keyboard.press("PageDown");
  await page.keyboard.press("Space");
  await expect(slot(page, "cobble")).toHaveAttribute("data-count", "28");
  // Enter runs a direction for one step.
  await typeWord(page, "north");
  await page.keyboard.press("Enter");
  await expect(line(page)).toHaveAttribute("data-text", "");
  await page.keyboard.press("Space");
  await expect(slot(page, "cobble")).toHaveAttribute("data-count", "27");
  await page.keyboard.press("Control+z");
  await expect(slot(page, "cobble")).toHaveAttribute("data-count", "28");
  // The page never scrolled.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // The camera keys turn and zoom without typing anything.
  await page.keyboard.press("]");
  await expect(page.locator('[data-builder="layer"]')).toContainText("East is up");
  await page.keyboard.press("=");
  await expect(line(page)).toHaveAttribute("data-text", "");

  await page.keyboard.press("Escape");
  await expect.poll(async () => (await profile(page)).island !== null).toBe(true);
  const p = await profile(page);
  const cobble = cell(p, START.x, START.y, START.z);
  expect(cobble).not.toBe(0);
  expect(cell(p, START.x + 1, START.y, START.z)).toBe(cobble);
  expect(cell(p, START.x + 1, START.y, START.z - 1)).toBe(0);
  expect(p.inventory["cobble"]).toBe(28);
  // Escape again resumes, and the island still takes keys.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");
  await expect(slot(page, "cobble")).toHaveAttribute("data-count", "27");
  expect(errors).toEqual([]);
});

test("Sprout: dig a block, then arm it with the key caps' letters", async ({ page }) => {
  test.slow();
  const errors = await openIsland(page, "fresh-sprout");
  await expect(hud(page)).toBeVisible();
  await expect(page.locator("#app").getByText("Type dig to pick up a block.")).toBeVisible();
  await expect(page.locator('[data-builder="palette"] li')).toHaveCount(0);

  await typeWord(page, "dig");
  await typeWord(page, "dig");
  // Grass, then the dirt under it, each with its letters as key caps.
  await expect(slot(page, "grass").locator("kbd")).toHaveText(["g", "r", "a", "s"]);
  await expect(slot(page, "dirt").locator("kbd")).toHaveText(["d", "i", "r"]);
  await expect(armed(page)).toHaveAttribute("data-block", "grass");
  await typeWord(page, "dir");
  await expect(armed(page)).toHaveAttribute("data-block", "dirt");
  // The rest of the word is taken quietly.
  await typeWord(page, "t");
  await expect(line(page)).toHaveAttribute("data-text", "");
  await page.keyboard.press("Space");
  await expect(slot(page, "dirt")).toHaveAttribute("data-count", "0");
  await expectNoAxeViolations(page, "builder, sprout");
  // The command line, the palette and the help sit inside the window.
  for (const part of [
    '[data-builder="line"]',
    '[data-builder="palette"]',
    '[data-builder="help"]',
  ]) {
    const box = await page.locator(part).boundingBox();
    expect(box, part).not.toBeNull();
    expect((box?.y ?? -1) >= 0 && (box?.y ?? 0) + (box?.height ?? 0) <= 720, part).toBe(true);
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 1280, part).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("an island that won't open: a calm note, and the saved island is left as it was", async ({
  page,
}) => {
  // The veteran fixture's island is 16×8×16, not the 48×32×48 grid.
  const errors = await openIsland(page, "veteran-builder");
  const note = page.locator('[data-builder="damaged"]');
  await expect(note).toBeVisible();
  await expect(note).toContainText("Your island is resting");
  await expect(note).toContainText("It is safe, just as you left it.");
  await expect(hud(page)).toHaveCount(0);
  await expectNoAxeViolations(page, "builder, island that won't open");
  const before = await profile(page);

  await typeWord(page, "planks");
  await typeWord(page, "put");
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Back to the map" }).click();
  await expectScreen(page, "map");
  const after = await profile(page);
  expect(after.island).toEqual(before.island);
  expect(after.island?.grid).toMatchObject({ sx: 16, sy: 8, sz: 16 });
  expect(after.inventory).toEqual(before.inventory);
  expect(after.history).toEqual(before.history);
  expect(errors).toEqual([]);
});

test.describe("baselines", () => {
  test.use({ colorScheme: "light" });

  test("the Home Island with the cursor, the ghost and the HUD", async ({ page }) => {
    const errors = await openIsland(page, "meadow-done-miner");
    await expect(hud(page)).toBeVisible();
    await typeWord(page, "planks");
    await typeWord(page, "put");
    await typeWord(page, "pl");
    await expect(line(page)).toHaveAttribute("data-text", "pl");
    await expect(page).toHaveScreenshot("builder-miner.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test("the Sprout picture palette", async ({ page }) => {
    const errors = await openIsland(page, "fresh-sprout");
    await expect(hud(page)).toBeVisible();
    await typeWord(page, "dig");
    await typeWord(page, "dig");
    await typeWord(page, "west");
    await page.keyboard.press("Enter");
    await typeWord(page, "dig");
    await expect(slot(page, "dirt")).toHaveAttribute("data-count", "2");
    await expect(page).toHaveScreenshot("builder-sprout.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});
