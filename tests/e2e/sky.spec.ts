import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Brings in the page's `window.vtScene` declaration (type only; nothing runs in Node).
import type { ScenePreviewHooks } from "../../src/dev/scene-preview";

type Hooks = ScenePreviewHooks | undefined;

// Sky, clouds and day/night (M2-02) on the scene preview page. The frozen screenshots at the four
// times of day are the visual baselines for the sky dome, fog, sun and moon, clouds and the
// per-time lighting. `overview` shows the lit diorama over the lower sky; `mine` looks up at the
// horizon, sun or moon and clouds.

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

const TIMES = ["day", "dusk", "night", "dawn"] as const;

for (const tod of TIMES) {
  for (const preset of ["overview", "mine"] as const) {
    test(`meadow at ${tod}, ${preset} (frozen)`, async ({ page }) => {
      const errors = await open(page, `seed=1&freeze=1&tod=${tod}&preset=${preset}`);
      expect(errors).toEqual([]);
      const info = await page.evaluate(() => {
        const s: Hooks = window.vtScene;
        return s?.sky
          ? {
              scheduled: s.handle.loop.scheduled,
              drifting: s.sky.drifting,
              fading: s.sky.fading,
              calls: s.stats().calls,
            }
          : null;
      });
      // Frozen: no drift, no fade, the loop idles.
      expect(info).not.toBeNull();
      expect(info?.scheduled).toBe(false);
      expect(info?.drifting).toBe(false);
      expect(info?.fading).toBe(false);
      expect(info?.calls).toBeGreaterThan(0);
      expect(info?.calls).toBeLessThanOrEqual(60);
      const name = preset === "overview" ? `sky-${tod}.png` : `sky-${tod}-mine.png`;
      await expect(page).toHaveScreenshot(name);
    });
  }
}

test("clouds drift while the scene is live, and only then", async ({ page }) => {
  const errors = await open(page, "seed=1&reducedMotion=0");
  const live = await page.evaluate(async () => {
    const s: Hooks = window.vtScene;
    if (!s?.sky) return null;
    const before = s.sky.clouds.offset;
    await s.frame();
    await s.frame();
    return { drifting: s.sky.drifting, moved: s.sky.clouds.offset !== before };
  });
  expect(live).toEqual({ drifting: true, moved: true });

  // Drift off: the scene goes idle (camera drift is also off here, so nothing else runs).
  const off = await page.evaluate(async () => {
    const s: Hooks = window.vtScene;
    if (!s?.sky) return null;
    s.handle.camera.setDrift(false);
    s.sky.setDrift(false);
    for (let i = 0; i < 6; i++) await s.frame();
    const before = s.sky.clouds.offset;
    await s.frame();
    return { scheduled: s.handle.loop.scheduled, moved: s.sky.clouds.offset !== before };
  });
  expect(off).toEqual({ scheduled: false, moved: false });
  expect(errors).toEqual([]);
});

test("reduced motion: no cloud drift and an idle loop", async ({ page }) => {
  const errors = await open(page, "seed=1&reducedMotion=1");
  const info = await page.evaluate(async () => {
    const s: Hooks = window.vtScene;
    if (!s?.sky) return null;
    for (let i = 0; i < 6; i++) await s.frame();
    const before = s.sky.clouds.offset;
    await s.frame();
    return {
      drifting: s.sky.drifting,
      moved: s.sky.clouds.offset !== before,
      scheduled: s.handle.loop.scheduled,
    };
  });
  expect(info).toEqual({ drifting: false, moved: false, scheduled: false });
  expect(errors).toEqual([]);
});

test("setEnvironment cross-fades over about 2 s, then idles", async ({ page }) => {
  const errors = await open(page, "seed=1&reducedMotion=1");
  const result = await page.evaluate(async () => {
    const s: Hooks = window.vtScene;
    if (!s?.sky) return null;
    const sky = s.sky;
    const startZenith = sky.mix.zenith.getHex();
    const start = performance.now();
    s.handle.setEnvironment({ biome: "meadow", timeOfDay: "night" });
    await s.frame();
    await new Promise((r) => setTimeout(r, 300));
    const mid = { fading: sky.fading, scheduled: s.handle.loop.scheduled };
    const midZenith = sky.mix.zenith.getHex();
    // The fade counts frame time, clamped to 50 ms a frame, so a slow software renderer (CI's
    // SwiftShader) takes longer than 2 s of wall time. Poll for its end.
    while (sky.fading && performance.now() - start < 30_000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const elapsed = performance.now() - start;
    await s.frame();
    return {
      mid,
      midChanged: midZenith !== startZenith,
      elapsed,
      end: { fading: sky.fading, scheduled: s.handle.loop.scheduled },
      sunIntensity: s.handle.lights.sun.intensity,
      lightState: s.handle.lights.state.sunIntensity,
    };
  });
  expect(result?.mid).toEqual({ fading: true, scheduled: true });
  expect(result?.midChanged).toBe(true);
  expect(result?.end).toEqual({ fading: false, scheduled: false });
  // At least about 2 s (frame time can only run slower than the wall clock, never faster).
  expect(result?.elapsed).toBeGreaterThanOrEqual(1900);
  // The light rig ends on the night values exactly.
  expect(result?.sunIntensity).toBeCloseTo(result?.lightState ?? -1, 5);
  expect(errors).toEqual([]);
});
