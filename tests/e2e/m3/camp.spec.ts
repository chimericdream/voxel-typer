/**
 * The remedial practice camp in a real browser (task M3-14; camps from M3-06, offer slots from
 * M3-FIX-11).
 *
 * Camps are offered on session slots: with no camp played yet, sessions 0, 4, 8, 12, … (every 3
 * before M3-FIX-11, so 12 is a slot either way). `pinky-weak` is at session 10, which is not a
 * slot, so it shows no camp. `pinky-weak-camp` is the same child two sessions later, with Meadow
 * lessons 1–4 played, so A and ; are keys they have been taught. A is weak (45 % recent errors), and
 * ; too.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { playLesson } from "../helpers/kid";
import { RESULTS_ARM_MS, expectScreen } from "../helpers/slice";
import { collectErrors, ready, state, waitForLesson } from "../helpers/vt";
import { THEMES, axeIn, tabTo } from "./helpers";

test.use({ reducedMotion: "reduce" });

const CAMP = "Practice camp. Your left pinky wants practice! Practice keys: A and semicolon.";

async function meadowPath(page: Page, profile: string): Promise<string[]> {
  const errors = collectErrors(page);
  await page.goto(`/?profile=${profile}&screen=map&seed=1&nosave=1`, {
    waitUntil: "domcontentloaded",
  });
  await ready(page);
  await expectScreen(page, "map");
  await expect(page.getByRole("button", { name: /^Meadow Home/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Meadow Home" })).toBeVisible();
  return errors;
}

const camp = (page: Page) => page.getByRole("button", { name: /^Practice camp\./ });

test("no camp off an offer slot (pinky-weak, session 10)", async ({ page }) => {
  const errors = await meadowPath(page, "pinky-weak");
  await expect(page.getByRole("button", { name: /^Lesson 2: / })).toBeFocused();
  await expect(camp(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the camp shows for pinky-weak on an offer slot, plays by keyboard, then waits its turn", async ({
  page,
}) => {
  test.slow();
  const errors = await meadowPath(page, "pinky-weak-camp");

  // The camp is a side stop: the cursor and the "next" cue stay on the next curriculum lesson.
  const next = page.getByRole("button", { name: /^Lesson 5: / });
  await expect(next).toBeFocused();
  await expect(next).toHaveAccessibleName(/Play this one next!$/);
  await expect(camp(page)).toHaveAccessibleName(CAMP);
  // The tent's visible word.
  await expect(camp(page)).toContainText("Practice");
  for (const theme of THEMES) await axeIn(page, theme, "lesson path with a camp");

  // Keyboard only: back from the next stone to the camp, then in.
  await tabTo(page, camp(page), { back: true });
  await page.keyboard.press("Enter");
  await expectScreen(page, "lessonIntro");
  await expect(
    page.getByRole("heading", { name: "Your left pinky wants practice!" }),
  ).toBeVisible();
  await expect(page.locator("#app").getByText("Practice keys", { exact: true })).toBeVisible();
  for (const theme of THEMES) await axeIn(page, theme, "camp lesson intro");

  await expect(page.getByRole("button", { name: "Start" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expectScreen(page, "play");
  await waitForLesson(page);
  // A camp is 60 s of Mine on the weak keys.
  const keys = new Set<string>();
  await playLesson(page, { wpm: 25, errorRate: 0.02, seed: 9 }, async () => {
    const text = (await state(page)).text;
    if (text !== null) for (const c of text) keys.add(c);
  });
  expect([...keys].some((c) => c === "a" || c === ";")).toBe(true);
  await expect.poll(async () => (await state(page)).screen, { timeout: 30_000 }).toBe("results");
  await ready(page);
  const result = await state(page);
  expect(result.lessonId).toMatch(/^remedial-/);
  await page.waitForTimeout(RESULTS_ARM_MS + 1500);
  for (const theme of THEMES) await axeIn(page, theme, "camp results");

  // Back on the path, the camp waits for its next slot; lesson 5 is still next.
  await tabTo(page, page.getByRole("button", { name: "Map", exact: true }));
  await page.keyboard.press("Enter");
  await expectScreen(page, "map");
  await expect(page.getByRole("heading", { name: "Meadow Home" })).toBeVisible();
  await expect(camp(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Lesson 5: / })).toHaveAccessibleName(
    /Play this one next!$/,
  );
  expect(errors).toEqual([]);
});
