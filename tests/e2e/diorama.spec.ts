import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Brings in the page's `window.vtDiorama` declaration (type only; nothing runs in Node).
import type { DioramaPreviewHooks } from "../../src/dev/diorama-preview";

type Hooks = DioramaPreviewHooks | undefined;

// The diorama preview (M2-03) renders the generated Meadow with the real block registry. Its
// screenshots are the visual baselines for worldgen.

async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`${msg.type()}: ${msg.text()}`);
  });
  await page.goto(`/diorama.html?${query}`);
  await expect(page.locator("#scene")).toHaveAttribute("data-ready", "1");
  return errors;
}

test("meadow diorama, overview (frozen)", async ({ page }) => {
  const errors = await open(page, "seed=1&freeze=1&quality=medium");
  expect(errors).toEqual([]);
  const info = await page.evaluate(() => {
    const d: Hooks = window.vtDiorama;
    if (!d) return null;
    return { stats: d.stats(), meshes: d.meshes(), scheduled: d.handle.loop.scheduled };
  });
  expect(info).not.toBeNull();
  // Card M2-03: at most 60 draw calls for the diorama at Medium. Empty chunks add no mesh.
  expect(info?.stats.calls).toBeGreaterThan(0);
  expect(info?.stats.calls).toBeLessThanOrEqual(60);
  // The water is idle with everything else: no frame pending.
  expect(info?.scheduled).toBe(false);
  await expect(page).toHaveScreenshot("meadow-overview.png");
});

test("meadow diorama, mine view (frozen)", async ({ page }) => {
  const errors = await open(page, "seed=1&freeze=1&quality=medium&preset=mine");
  expect(errors).toEqual([]);
  const calls = await page.evaluate(() => window.vtDiorama?.stats().calls ?? -1);
  expect(calls).toBeGreaterThan(0);
  expect(calls).toBeLessThanOrEqual(60);
  await expect(page).toHaveScreenshot("meadow-mine.png");
});

test("draw calls stay within budget across seeds", async ({ page }) => {
  const errors = await open(page, "seed=1&freeze=1&quality=medium");
  const seeds = [2, 3, 7, 42, 1234];
  for (const seed of seeds) {
    await page.goto(`/diorama.html?seed=${seed}&freeze=1&quality=medium`);
    await expect(page.locator("#scene")).toHaveAttribute("data-ready", "1");
    const calls = await page.evaluate(() => window.vtDiorama?.stats().calls ?? -1);
    expect(calls, `seed ${seed}`).toBeGreaterThan(0);
    expect(calls, `seed ${seed}`).toBeLessThanOrEqual(60);
  }
  expect(errors).toEqual([]);
});

test("the water doesn't keep an idle scene drawing (wobble on)", async ({ page }) => {
  // No ?freeze and no reduced motion, so the wobble is on; ?still turns the camera drift off, so
  // nothing else moves.
  const errors = await open(page, "seed=1&still=1&reducedMotion=0");
  const scheduled = await page.evaluate(async () => {
    const d: Hooks = window.vtDiorama;
    if (!d) return null;
    await d.frame();
    for (let i = 0; i < 5; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
    return d.handle.loop.scheduled;
  });
  expect(scheduled).toBe(false);
  expect(errors).toEqual([]);
});
