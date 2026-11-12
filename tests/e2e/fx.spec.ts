import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Brings in the page's `window.vtScene` declaration (type only; nothing runs in Node).
import type { ScenePreviewHooks } from "../../src/dev/scene-preview";

type Hooks = ScenePreviewHooks | undefined;

// Effects (M2-05) in real WebGL, on the scene preview: the particle shader compiles, a burst is
// one extra draw call, float text sits over the canvas, and the loop idles once everything dies.

async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    // three.js reports shader compile and link failures with console.error.
    if (msg.type() === "error") {
      errors.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  await page.goto(`/scene.html?${query}`);
  await expect(page.locator("#scene")).toHaveAttribute("data-ready", "1");
  return errors;
}

/** Waits `n` animation frames in the page. */
const frames = (page: Page, n: number): Promise<void> =>
  page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }, n);

test("a block break draws particles and float text, then the loop idles", async ({ page }) => {
  // About 75 frames of software rendering: CI's SwiftShader took 9–11 s (M2-15).
  test.slow();
  const errors = await open(page, "seed=1&freeze=1&preset=mine&fx=1");
  const before = await page.evaluate(() => {
    const s: Hooks = window.vtScene;
    return s ? s.stats().calls : -1;
  });

  await page.evaluate(() => {
    const s: Hooks = window.vtScene;
    s?.breakBlock(5);
    s?.chip("b");
  });
  await frames(page, 12);

  const mid = await page.evaluate(() => {
    const s: Hooks = window.vtScene;
    if (!s) return null;
    const labels = [...document.querySelectorAll<HTMLElement>(".vt-fx-text span")];
    return {
      calls: s.stats().calls,
      fx: s.fx.stats(),
      scheduled: s.handle.loop.scheduled,
      labels: labels.map((l) => ({
        text: l.textContent,
        font: l.style.fontFamily,
        shown: l.style.display !== "none",
      })),
    };
  });
  expect(mid).not.toBeNull();
  expect(mid?.fx.particles).toBeGreaterThan(0);
  expect(mid?.fx.particles).toBeLessThanOrEqual(mid?.fx.maxParticles ?? 0);
  // All particles are one instanced draw call.
  expect(mid?.calls).toBe(before + 1);
  expect(mid?.scheduled).toBe(true);
  expect(mid?.labels).toEqual([
    { text: "+1", font: expect.stringContaining("var(--font-pixel"), shown: true },
    { text: "b", font: expect.stringContaining("var(--font-body"), shown: true },
  ]);

  // Everything dies within 1.2 s of frozen time (16 ms frames); then no frame is pending.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s: Hooks = window.vtScene;
          return s ? s.handle.loop.scheduled : true;
        }),
      { timeout: 45_000 },
    )
    .toBe(false);
  const after = await page.evaluate(() => {
    const s: Hooks = window.vtScene;
    return s ? { fx: s.fx.stats() } : null;
  });
  expect(after?.fx).toMatchObject({ particles: 0, floatTexts: 0, holding: false });
  expect(errors).toEqual([]);
});

test("reduced motion: six particles, no hit-stop", async ({ page }) => {
  const errors = await open(page, "seed=1&freeze=1&preset=mine&fx=1&reducedMotion=1");
  const stats = await page.evaluate(() => {
    const s: Hooks = window.vtScene;
    s?.breakBlock(20, 40);
    return s?.fx.stats() ?? null;
  });
  expect(stats).toMatchObject({ particles: 6, holding: false });
  await frames(page, 4);
  expect(errors).toEqual([]);
});
