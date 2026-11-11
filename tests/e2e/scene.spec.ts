import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Brings in the page's `window.vtScene` declaration (type only; nothing runs in Node).
import type { ScenePreviewHooks } from "../../src/dev/scene-preview";

type Hooks = ScenePreviewHooks | undefined;

// The scene preview (M2-01) is a developer page in the e2e build. It renders a seeded random test
// grid through the render core. Its screenshot is the visual baseline for chunk meshing, AO and
// lighting.

/**
 * Opens the page; the returned list collects page errors, console errors and any WebGL context
 * message (Chrome's "too many active WebGL contexts" warning, three.js's "Context Lost" log).
 * Driver performance notes such as "GPU stall due to ReadPixels" are not errors and are ignored.
 */
async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" || /context lost|webgl contexts/i.test(text)) {
      errors.push(`${msg.type()}: ${text}`);
    }
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
    // A biome change rebuilds the atlas with the new palette; the old texture must be freed.
    const before = s.handle.atlas();
    s.handle.setEnvironment({ biome: "frosty", timeOfDay: "day" });
    for (let i = 0; i < 300 && s.handle.atlas() === before; i++) await s.frame();
    const swapped = s.handle.atlas() !== before;
    await s.frame();
    const rebiomed = s.stats();
    s.dispose();
    return {
      baseline: s.baseline,
      loaded,
      reloaded,
      swapped,
      rebiomed,
      disposed: s.stats(),
      contextLost: s.handle.three.renderer.getContext().isContextLost(),
    };
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
  // Swapping the atlas for another biome doesn't leak either.
  expect(result.swapped).toBe(true);
  expect(result.rebiomed.textures).toBe(loaded.textures);
  expect(result.rebiomed.geometries).toBe(loaded.geometries);
  // Back to the counts before anything was loaded.
  expect(disposed.geometries).toBe(baseline.geometries);
  expect(disposed.textures).toBe(baseline.textures);
  expect(disposed.programs).toBe(baseline.programs);
  // dispose() also gives the WebGL context back.
  expect(result.contextLost).toBe(true);
});

test("20 scenes made and disposed in a row: idle by default, contexts released", async ({
  page,
}) => {
  const errors = await open(page, "seed=1&freeze=1");
  const result = await page.evaluate(async () => {
    const s: Hooks = window.vtScene;
    return s ? s.cycle(20) : null;
  });
  // With default options (no drift, no subscribers) every loaded scene stops requesting frames.
  expect(result).toEqual({ idle: 20, contextLost: 20 });
  // No "too many active WebGL contexts" warning, no lost-context log, no errors.
  expect(errors).toEqual([]);
  // The page's own scene still draws after all that.
  const calls = await page.evaluate(async () => {
    const s: Hooks = window.vtScene;
    if (!s) return 0;
    await s.frame();
    return s.stats().calls;
  });
  expect(calls).toBeGreaterThan(0);
});

test("dropping quality from high frees the shadow map", async ({ page }) => {
  const errors = await open(page, "seed=1&freeze=1&quality=high");
  const result = await page.evaluate(async () => {
    const s: Hooks = window.vtScene;
    if (!s) return null;
    const sun = s.handle.lights.sun;
    const high = { textures: s.stats().textures, map: sun.shadow.map !== null };
    s.handle.setQuality("medium");
    await s.frame();
    const medium = { textures: s.stats().textures, map: sun.shadow.map !== null };
    s.handle.setQuality("high");
    await s.frame();
    const again = { textures: s.stats().textures, map: sun.shadow.map !== null };
    return { high, medium, again };
  });
  expect(errors).toEqual([]);
  expect(result?.high.map).toBe(true);
  expect(result?.medium.map).toBe(false);
  expect(result?.medium.textures).toBeLessThan(result?.high.textures ?? 0);
  // Back on high, the shadow map comes back.
  expect(result?.again).toEqual(result?.high);
});

test("placing or removing a lamp block updates the point lights", async ({ page }) => {
  const errors = await open(page, "seed=1&freeze=1");
  const result = await page.evaluate(() => {
    const s: Hooks = window.vtScene;
    const g = s?.handle.grid();
    if (!s || !g) return null;
    const lamps = (): string[] =>
      s.handle.lights.lamps
        .map((l) => `${l.position.x},${l.position.y},${l.position.z}`)
        .toSorted();
    // An air cell right above the Mine target block.
    const t = s.handle.camera.pose().target;
    const x = Math.floor(t.x);
    const z = Math.floor(t.z);
    let y = Math.floor(t.y);
    while (g.get(x, y, z) !== 0) y++;
    const before = lamps();
    s.handle.setVoxel(x, y, z, s.blocks.lamp);
    const placed = lamps();
    s.handle.setVoxel(x, y, z, 0);
    const removed = lamps();
    // Direct grid edits followed by markDirty are picked up too.
    g.set(x, y, z, s.blocks.lamp);
    s.handle.markDirty(x, y, z);
    const marked = lamps();
    return { before, placed, removed, marked, cell: `${x + 0.5},${y + 0.5},${z + 0.5}` };
  });
  expect(errors).toEqual([]);
  expect(result).not.toBeNull();
  if (!result) return;
  // Medium allows 4 point lights; the test grid has 2 lamps.
  expect(result.before).toHaveLength(2);
  expect(result.placed).toHaveLength(3);
  expect(result.placed).toContain(result.cell);
  expect(result.removed).toEqual(result.before);
  expect(result.marked).toEqual(result.placed);
});

test("mine preset and high quality render without errors", async ({ page }) => {
  const errors = await open(page, "seed=1&freeze=1&preset=mine&quality=high");
  expect(errors).toEqual([]);
  const calls = await page.evaluate(() => window.vtScene?.stats().calls ?? 0);
  expect(calls).toBeGreaterThan(0);
});
