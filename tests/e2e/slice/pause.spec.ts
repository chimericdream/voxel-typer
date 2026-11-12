/**
 * Slice flow 3 (task M2-15): a pause doesn't change the summary's WPM. A kid plays a lesson with
 * a long pause in the middle that arrives as several window blurs and a visibility change (pause
 * must stay idempotent). Paused time is not active time, so the summary's WPM is the WPM of the
 * typing alone. Axe runs on the pause overlay.
 *
 * Times are taken in the page, on the clock the app uses (`performance.now()`): keydowns and
 * blurs are stamped by an init script. Timing from the test runner (wall clock around Playwright
 * calls) was off by one to two seconds either way on CI.
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

/** Stamps every keydown and window blur with `performance.now()`, before the app's own listeners. */
function stampInput(): void {
  const keys: [string, number][] = [];
  const blurs: number[] = [];
  Reflect.set(window, "vtStamps", { keys, blurs });
  window.addEventListener("keydown", (e) => keys.push([e.key, performance.now()]), true);
  window.addEventListener("blur", () => blurs.push(performance.now()), true);
}

interface Stamps {
  keys: [string, number][];
  blurs: number[];
}

async function stamps(page: Page): Promise<Stamps> {
  return page.evaluate(() => {
    const s: unknown = Reflect.get(window, "vtStamps");
    const keys: unknown = typeof s === "object" && s !== null ? Reflect.get(s, "keys") : null;
    const blurs: unknown = typeof s === "object" && s !== null ? Reflect.get(s, "blurs") : null;
    return {
      keys: Array.isArray(keys)
        ? keys.map((k): [string, number] => [String(k[0]), Number(k[1])])
        : [],
      blurs: Array.isArray(blurs) ? blurs.map(Number) : [],
    };
  });
}

test("pause, blur and resume leave the summary WPM alone", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.addInitScript(stampInput);

  await page.goto(LESSON, { waitUntil: "domcontentloaded" });
  await waitForLesson(page);
  let resumeAt = -1;
  const pausedPlay = await playLesson(page, KID, async (i) => {
    if (i !== 20) return;
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
    resumeAt = (await stamps(page)).keys.length - 1;
    const back = await state(page);
    expect(back.paused).toBe(false);
    expect(back.elapsedMs).toBe(at.elapsedMs);
  });
  await expectScreen(page, "results");
  const paused = await state(page);

  expect(paused.correct).toBe(pausedPlay.keys);

  // The engine counts active time from its start to the last key, minus the pause: from the
  // first blur to the Enter that resumed. The start is the summary's own `startedAtT` (the mode
  // starts the clock when the first block is up, a moment after the first key; see
  // docs/handoffs/M2-15.md); the other three are page stamps on the same clock.
  const st = await stamps(page);
  const first = paused.startedAtT;
  expect(first).toBeGreaterThanOrEqual(st.keys[0]?.[1] ?? Infinity);
  const last = st.keys.at(-1)?.[1];
  const resume = st.keys[resumeAt];
  const pauseAt = st.blurs[0];
  if (last === undefined || resume === undefined || pauseAt === undefined) {
    throw new Error("missing input stamps");
  }
  expect(resume[0]).toBe("Enter");
  const pauseMs = resume[1] - pauseAt;
  expect(pauseMs).toBeGreaterThanOrEqual(PAUSE_MS);
  const typingMs = last - first - pauseMs;
  // The app reads the clock a moment after these listeners, so allow a little slack. Had the
  // pause counted, active time would be a whole pause (8 s+) more.
  expect(Math.abs(paused.activeMs - typingMs)).toBeLessThan(250);
  // So the summary WPM is the typing's WPM (formula in src/engine/stats.ts), not the WPM of the
  // wall time with the pause in it.
  const typingWpm = paused.correct / 5 / (typingMs / 60_000);
  const wallWpm = paused.correct / 5 / ((last - first) / 60_000);
  expect(Math.abs(paused.netWpm - typingWpm) / typingWpm).toBeLessThan(0.02);
  expect(paused.netWpm).toBeGreaterThan(wallWpm * 1.08);
  test.info().annotations.push({
    type: "wpm",
    description: `summary ${paused.netWpm.toFixed(1)} wpm in ${Math.round(paused.activeMs)} ms; typing ${typingWpm.toFixed(1)} in ${Math.round(typingMs)} ms; with the pause ${wallWpm.toFixed(1)} (paused ${Math.round(pauseMs)} ms)`,
  });
  expect(errors).toEqual([]);
});
