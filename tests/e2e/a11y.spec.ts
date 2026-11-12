/**
 * Accessibility features in a real browser (task M3-07, PLAN.md §4.6):
 * - reduced motion (OS preference emulated): the camera doesn't move when a block breaks (no shake,
 *   no drift), and no UI animation keeps running;
 * - high contrast, the dyslexia font and text size 2 from a profile: applied to the page, and axe
 *   finds no violations on the menu screens;
 * - screen-reader announcements for menu changes, in the live region outside #app.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expectNoAxeViolations, expectScreen } from "./helpers/slice";
import { collectErrors, ready, state, vt, waitForLesson } from "./helpers/vt";

interface Pose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

function isPose(v: unknown): v is Pose {
  if (typeof v !== "object" || v === null) return false;
  return ["x", "y", "z", "qx", "qy", "qz", "qw"].every(
    (k) => typeof Reflect.get(v, k) === "number",
  );
}

async function cameraPose(page: Page): Promise<Pose> {
  const pose = await vt(page, "camera");
  if (!isPose(pose)) throw new Error("no camera yet");
  return pose;
}

/** Waits for `n` animation frames in the page (CI's software renderer runs frames slowly). */
async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((done) => {
        let left = count;
        const step = (): void => {
          left -= 1;
          if (left <= 0) done();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    n,
  );
}

/** Types the current word up to and including its last letter, so the block breaks. */
async function breakOneBlock(page: Page): Promise<string> {
  const first = await state(page);
  const text = first.text ?? "";
  expect(text.length).toBeGreaterThan(0);
  for (let now = await state(page); now.text === text && now.next !== null && now.next !== " ";) {
    await page.keyboard.press(now.next);
    await page.waitForTimeout(80);
    now = await state(page);
  }
  // The break is done once the next block (or Results) is up.
  await expect.poll(async () => (await state(page)).text, { timeout: 15_000 }).not.toBe(text);
  return text;
}

function moved(a: Pose, b: Pose): number {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.z - b.z),
    Math.abs(a.qx - b.qx),
    Math.abs(a.qy - b.qy),
    Math.abs(a.qz - b.qz),
    Math.abs(a.qw - b.qw),
  );
}

const MINE = "/?profile=meadow-done-miner&screen=play&lesson=meadow-05&seed=1&nosave=1";

test.describe("reduced motion (prefers-reduced-motion: reduce)", () => {
  test.use({ reducedMotion: "reduce" });

  test("the camera is in the same place before and after a block break: no shake, no drift", async ({
    page,
  }) => {
    test.slow();
    const errors = collectErrors(page);
    await page.goto(MINE);
    await waitForLesson(page);
    await expect(page.locator("html")).not.toHaveAttribute("data-motion", /./);
    await frames(page, 10);
    const before = await cameraPose(page);

    await breakOneBlock(page);
    // Right after the break (when a shake would be strongest) and well after it.
    const during = await cameraPose(page);
    await frames(page, 30);
    const after = await cameraPose(page);

    expect(moved(before, during)).toBeLessThan(1e-6);
    expect(moved(before, after)).toBeLessThan(1e-6);
    expect(errors).toEqual([]);
  });

  test("no UI animation keeps running on the splash", async ({ page }) => {
    await page.goto("/?nosave=1");
    await ready(page);
    await expect(page.locator("#app").getByText("Press any key to start")).toBeVisible();
    const running = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === "running").length,
    );
    expect(running).toBe(0);
  });
});

test.describe("full motion (control)", () => {
  test.use({ reducedMotion: "no-preference" });

  test("a block break shakes the camera when motion is on", async ({ page }) => {
    test.slow();
    await page.goto(MINE);
    await waitForLesson(page);
    await frames(page, 10);
    const before = await cameraPose(page);
    await breakOneBlock(page);
    const during = await cameraPose(page);
    expect(moved(before, during)).toBeGreaterThan(1e-4);
  });
});

test.describe("high contrast, dyslexia font and big letters from the profile", () => {
  test.use({ reducedMotion: "reduce" });

  test("are applied to the page, and axe is clean on the menu screens", async ({ page }) => {
    test.slow();
    const errors = collectErrors(page);
    await page.goto("/?profile=a11y-contrast&screen=map&nosave=1");
    await expectScreen(page, "map");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "contrast");
    await expect(html).toHaveAttribute("data-font", "dyslexic");
    await expect(html).toHaveAttribute("data-motion", "reduced");
    expect(await html.evaluate((el) => getComputedStyle(el).getPropertyValue("--text-scale"))).toBe(
      "2",
    );
    // Decision 74: the root font stays the browser's own size.
    expect(await html.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    await expectNoAxeViolations(page, "world map, high contrast");

    // Escape on the map goes to "Who is playing?" (decision 87), and the change is announced.
    await page.keyboard.press("Escape");
    await expectScreen(page, "profiles");
    await expect(page.locator("#vt-announcer")).toHaveText("Who is playing?");
    await expectNoAxeViolations(page, "profiles, high contrast");

    await page.goto("/?profile=a11y-contrast&screen=lessonIntro&lesson=meadow-02&nosave=1");
    await expectScreen(page, "lessonIntro");
    await expectNoAxeViolations(page, "lesson intro, high contrast");

    await page.goto("/?profile=a11y-contrast&screen=privacy&nosave=1");
    await expectScreen(page, "privacy");
    await expectNoAxeViolations(page, "privacy, high contrast");
    expect(errors).toEqual([]);
  });

  test("the typing target uses the body font, never the pixel font", async ({ page }) => {
    await page.goto("/?profile=fresh-sprout&screen=play&lesson=meadow-01&seed=1&nosave=1");
    await waitForLesson(page);
    const word = page.getByRole("img", { name: /^Type: / });
    await expect(word).toBeVisible();
    const family = await word.evaluate((el) => {
      const cell = el.querySelector("[data-mark]") ?? el;
      return getComputedStyle(cell).fontFamily;
    });
    expect(family).toMatch(/Atkinson/);
    expect(family).not.toMatch(/Pixelify/);
  });
});
