import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Brings in the page's `window.vtScene` declaration (type only; nothing runs in Node).
import type { ScenePreviewHooks } from "../../src/dev/scene-preview";

type Hooks = ScenePreviewHooks | undefined;

// The scene preview (M2-01) is a developer page in the e2e build. It renders a seeded random test
// grid through the render core. Its screenshot is the visual baseline for chunk meshing, AO and
// lighting.

async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto(`/scene.html?${query}`);
  await expect(page.locator("#scene")).toHaveAttribute("data-ready", "1");
  return errors;
}

test("scene preview at seed 1 (frozen)", async ({ page }) => {
  const errors = await open(page, "seed=1&freeze=1");
  expect(errors).toEqual([]);

  const info = await page.evaluate(() => {
    const s: Hooks = window.vtScene;
    if (!s) return null;
    const canvas = s.handle.three.renderer.domElement;
    return {
      stats: s.stats(),
      // Idle under ?freeze: no drift, no subscribers, so no frame is pending.
      scheduled: s.handle.loop.scheduled,
      width: canvas.width,
      height: canvas.height,
    };
  });
  expect(info).not.toBeNull();
  expect(info?.width).toBe(1280);
  expect(info?.height).toBe(720);
  expect(info?.scheduled).toBe(false);
  // 18 chunks with up to 3 materials each, plus the sun's shadow pass when on. Well inside the
  // 150-call budget (contracts.md §14).
  expect(info?.stats.calls).toBeGreaterThan(0);
  expect(info?.stats.calls).toBeLessThanOrEqual(60);

  // The scene is drawn: the frame is not just the sky color.
  const distinct = await page.evaluate(() => {
    const src = window.vtScene?.handle.three.renderer.domElement;
    if (!src) return 0;
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext("2d");
    if (!ctx) return 0;
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 7) {
      colors.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
    }
    return colors.size;
  });
  expect(distinct).toBeGreaterThan(200);

  await expect(page).toHaveScreenshot("scene.png");
});

test("dispose() frees geometries, textures and programs", async ({ page }) => {
  const errors = await open(page, "seed=1&freeze=1");
  const result = await page.evaluate(async () => {
    const s: Hooks = window.vtScene;
    if (!s) return null;
    const loaded = s.stats();
    await s.reload(3);
    const reloaded = s.stats();
    s.dispose();
    return { baseline: s.baseline, loaded, reloaded, disposed: s.stats() };
  });
  expect(errors).toEqual([]);
  expect(result).not.toBeNull();
  if (!result) return;
  const { baseline, loaded, reloaded, disposed } = result;
  expect(loaded.geometries).toBeGreaterThan(baseline.geometries);
  expect(loaded.textures).toBeGreaterThan(baseline.textures);
  // Reloading the diorama doesn't leak.
  expect(reloaded.geometries).toBe(loaded.geometries);
  expect(reloaded.textures).toBe(loaded.textures);
  // Back to the counts before anything was loaded.
  expect(disposed.geometries).toBe(baseline.geometries);
  expect(disposed.textures).toBe(baseline.textures);
  expect(disposed.programs).toBe(baseline.programs);
});

test("mine preset and high quality render without errors", async ({ page }) => {
  const errors = await open(page, "seed=1&freeze=1&preset=mine&quality=high");
  expect(errors).toEqual([]);
  const calls = await page.evaluate(() => window.vtScene?.stats().calls ?? 0);
  expect(calls).toBeGreaterThan(0);
});
