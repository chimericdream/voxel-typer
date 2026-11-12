/**
 * Slice flow 2 (task M2-15): a Miner plays Meadow lessons 1–6 back to back, from each Results
 * screen's "Next lesson" to the next intro, with the keyboard alone. The app keeps one scene for
 * its lifetime (M2-10), so six lessons make exactly one WebGL context (M2-10 review N4). Draw
 * calls and FPS are read and logged (soft: SwiftShader is far from a real GPU).
 */
import { expect, test } from "@playwright/test";
import { collectErrors, ready, state } from "../helpers/vt";
import { RESULTS_ARM_MS, expectScreen, logPerf, playFromIntro } from "../helpers/slice";

const LESSONS = ["meadow-01", "meadow-02", "meadow-03", "meadow-04", "meadow-05", "meadow-06"];

test("Meadow lessons 1–6 back to back on one scene", async ({ page }) => {
  test.setTimeout(600_000);
  // Count the canvases that get a WebGL context, before any app code runs.
  await page.addInitScript(() => {
    const seen = new WeakSet<HTMLCanvasElement>();
    let count = 0;
    const real = HTMLCanvasElement.prototype.getContext;
    const patched = function (this: HTMLCanvasElement, ...args: unknown[]): unknown {
      const ctx: unknown = Reflect.apply(real, this, args);
      const kind = String(args[0]);
      if (ctx !== null && kind.startsWith("webgl") && !seen.has(this)) {
        seen.add(this);
        count++;
        Reflect.set(window, "vtWebglContexts", count);
      }
      return ctx;
    };
    Reflect.set(HTMLCanvasElement.prototype, "getContext", patched);
  });
  const errors = collectErrors(page);
  await page.goto("/?profile=meadow-done-miner&screen=lessonIntro&lesson=meadow-01&seed=1", {
    waitUntil: "domcontentloaded",
  });
  await ready(page);

  const stars: number[] = [];
  for (const [i, id] of LESSONS.entries()) {
    await expectScreen(page, "lessonIntro");
    const played = await playFromIntro(page, { wpm: 45, errorRate: 0.03, seed: 10 + i });
    const end = await state(page);
    const lessonId = await page.evaluate(() => {
      const hooks: unknown = Reflect.get(window, "__vt");
      const fn: unknown =
        typeof hooks === "object" && hooks !== null ? Reflect.get(hooks, "lastResult") : null;
      const result: unknown = typeof fn === "function" ? Reflect.apply(fn, hooks, []) : null;
      const summary: unknown =
        typeof result === "object" && result !== null ? Reflect.get(result, "summary") : null;
      return typeof summary === "object" && summary !== null
        ? String(Reflect.get(summary, "lessonId"))
        : null;
    });
    expect(lessonId).toBe(id);
    expect(end.correct).toBe(played.keys);
    expect(end.stars).toBeGreaterThanOrEqual(1);
    stars.push(end.stars);
    logPerf(id, end.fps, played.peakCalls);
    expect.soft(played.peakCalls, `${id}: draw calls`).toBeLessThanOrEqual(150);

    if (i === LESSONS.length - 1) break;
    // Results ignore presses for their first 700 ms; then "Next lesson" has focus.
    await page.waitForTimeout(RESULTS_ARM_MS + 200);
    await expect(page.getByRole("button", { name: "Next lesson" })).toBeFocused();
    await page.keyboard.press("Enter");
  }

  test.info().annotations.push({ type: "stars", description: stars.join(", ") });
  expect(await page.locator("canvas").count()).toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, "vtWebglContexts"))).toBe(1);
  expect(errors).toEqual([]);
});
