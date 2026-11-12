/**
 * Slice flow 3 (task M2-15): a pause doesn't change the summary's WPM. A kid plays a lesson with
 * a long pause in the middle that arrives as several window blurs and a visibility change (pause
 * must stay idempotent). Paused time is not active time, so the summary's WPM is the WPM of the
 * typing alone, not of the wall time. Axe runs on the pause overlay.
 *
 * Two plays of the same lesson are not compared: on a loaded machine the per-key overhead of
 * Playwright swings the wall time by more than the pause itself.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { playLesson } from "../helpers/kid";
import type { KidOptions } from "../helpers/kid";
import { collectErrors, state, waitForLesson } from "../helpers/vt";
import { expectNoAxeViolations, expectScreen } from "../helpers/slice";

const LESSON = "/?profile=meadow-done-miner&screen=play&lesson=meadow-05&seed=1";
const KID: KidOptions = { wpm: 30, errorRate: 0.05, seed: 5 };
const PAUSE_MS = 8000;

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
}

test("pause, blur and resume leave the summary WPM alone", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);

  await page.goto(LESSON, { waitUntil: "domcontentloaded" });
  await waitForLesson(page);
  let pausedFor = 0;
  const pausedPlay = await playLesson(page, KID, async (i) => {
    if (i !== 20) return;
    const started = Date.now();
    await blur(page);
    await blur(page);
    const dialog = page.getByRole("dialog", { name: "Paused" });
    await expect(dialog).toBeVisible();
    const at = await state(page);
    expect(at.paused).toBe(true);
    await expectNoAxeViolations(page, "pause");
    await page.waitForTimeout(PAUSE_MS / 2);
    // More blurs while paused change nothing: one overlay, and the clock stays stopped.
    await blur(page);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(PAUSE_MS / 2);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const still = await state(page);
    expect(still.paused).toBe(true);
    expect(still.elapsedMs).toBe(at.elapsedMs);
    // Typed keys while paused are dropped.
    await page.keyboard.press(at.next === " " ? "Space" : (at.next ?? "f"));
    expect((await state(page)).typed).toBe(at.typed);
    // "Keep playing" has focus, so Enter resumes.
    await expect(page.getByRole("button", { name: "Keep playing" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    pausedFor = Date.now() - started;
    const back = await state(page);
    expect(back.paused).toBe(false);
    expect(back.elapsedMs).toBe(at.elapsedMs);
  });
  await expectScreen(page, "results");
  const paused = await state(page);

  expect(pausedFor).toBeGreaterThanOrEqual(PAUSE_MS);
  expect(paused.correct).toBe(pausedPlay.keys);
  // Active time is the typing time: the wall time from first key to last, minus the pause. The
  // wall brackets include Playwright's overhead around the keys and the pause, so they read high
  // by a second or two on CI; the bound that matters is the upper one. Had the pause counted,
  // active time would be a whole pause (8 s+) above the typing time.
  const typingMs = pausedPlay.wallMs - pausedFor;
  expect(paused.activeMs).toBeLessThan(typingMs + 1000);
  expect(paused.activeMs).toBeGreaterThan(typingMs - 5000);
  // So the summary WPM is at least the typing's WPM (formula in src/engine/stats.ts), and well
  // above the WPM the wall time would give if the pause counted.
  const typingWpm = paused.correct / 5 / (typingMs / 60_000);
  const wallWpm = paused.correct / 5 / (pausedPlay.wallMs / 60_000);
  expect(paused.netWpm).toBeGreaterThan(typingWpm * 0.97);
  expect(paused.netWpm).toBeGreaterThan(wallWpm * 1.08);
  test.info().annotations.push({
    type: "wpm",
    description: `summary ${paused.netWpm.toFixed(1)} wpm in ${Math.round(paused.activeMs)} ms; typing ${typingWpm.toFixed(1)}; wall ${wallWpm.toFixed(1)} (paused ${pausedFor} ms)`,
  });
  expect(errors).toEqual([]);
});
