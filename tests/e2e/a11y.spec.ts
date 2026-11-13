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

/**
 * Records the camera on every frame in the page while one block is broken, and returns the
 * biggest jump from one frame to the next before the block's last letter and after it. Drift
 * moves the camera a hair each frame; a shake jumps it far, so the two numbers tell them apart
 * (M3-07 review N5 (a)).
 */
async function jumpsAroundABreak(page: Page): Promise<{ before: number; after: number }> {
  await page.evaluate(() => {
    const poses: number[][] = [];
    const marks = { last: -1, stop: false };
    Reflect.set(window, "vtPoses", { poses, marks });
    const step = (): void => {
      const hooks: unknown = Reflect.get(window, "__vt");
      const read: unknown =
        typeof hooks === "object" && hooks !== null ? Reflect.get(hooks, "camera") : null;
      const p: unknown = typeof read === "function" ? Reflect.apply(read, hooks, []) : null;
      if (typeof p === "object" && p !== null) {
        poses.push(["x", "y", "z", "qx", "qy", "qz", "qw"].map((k) => Number(Reflect.get(p, k))));
      }
      if (!marks.stop) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await frames(page, 20);
  const text = (await state(page)).text ?? "";
  expect(text.length).toBeGreaterThan(0);
  for (let now = await state(page); now.text === text && now.next !== null && now.next !== " ";) {
    // Mark the frame just before the letter that breaks the block.
    if (now.typed === Array.from(text).length - 1) {
      await page.evaluate(() => {
        const rec: unknown = Reflect.get(window, "vtPoses");
        if (typeof rec !== "object" || rec === null) return;
        const marks: unknown = Reflect.get(rec, "marks");
        const poses: unknown = Reflect.get(rec, "poses");
        if (typeof marks === "object" && marks !== null && Array.isArray(poses)) {
          Reflect.set(marks, "last", poses.length);
        }
      });
    }
    await page.keyboard.press(now.next);
    await page.waitForTimeout(80);
    now = await state(page);
  }
  await expect.poll(async () => (await state(page)).text, { timeout: 15_000 }).not.toBe(text);
  await frames(page, 20);
  return page.evaluate(() => {
    const rec: unknown = Reflect.get(window, "vtPoses");
    if (typeof rec !== "object" || rec === null) throw new Error("no recording");
    const marks: unknown = Reflect.get(rec, "marks");
    const poses: unknown = Reflect.get(rec, "poses");
    if (typeof marks !== "object" || marks === null || !Array.isArray(poses)) {
      throw new Error("no recording");
    }
    Reflect.set(marks, "stop", true);
    const last = Number(Reflect.get(marks, "last"));
    const split = last >= 0 ? last : Math.floor(poses.length / 2);
    const jump = (from: number, to: number): number => {
      let most = 0;
      for (let i = Math.max(1, from); i < to; i++) {
        const a: unknown = poses[i - 1];
        const b: unknown = poses[i];
        if (!Array.isArray(a) || !Array.isArray(b)) continue;
        for (let k = 0; k < a.length; k++) {
          most = Math.max(most, Math.abs(Number(a[k]) - Number(b[k])));
        }
      }
      return most;
    };
    return { before: jump(1, split), after: jump(split + 1, poses.length) };
  });
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

  test("a block break shakes the camera when motion is on: a jump far bigger than drift", async ({
    page,
  }) => {
    test.slow();
    await page.goto(MINE);
    await waitForLesson(page);
    const { before, after } = await jumpsAroundABreak(page);
    // Drift alone (decision 71) moves the camera a hair per frame; the shake jumps it.
    expect(after).toBeGreaterThan(1e-3);
    expect(after).toBeGreaterThan(5 * before);
  });
});

test.describe("reduced motion switched on in the OS during a lesson (M3-07 review N5 (b))", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the camera stops: no drift and no shake from then on", async ({ page }) => {
    test.slow();
    const errors = collectErrors(page);
    await page.goto(MINE);
    await waitForLesson(page);
    // Motion on first: the camera drifts.
    const start = await cameraPose(page);
    await frames(page, 30);
    expect(moved(start, await cameraPose(page))).toBeGreaterThan(1e-6);

    // The child's grown-up turns on "reduce motion" in the OS settings mid-lesson.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await frames(page, 10);
    const before = await cameraPose(page);
    const { before: still, after } = await jumpsAroundABreak(page);
    const end = await cameraPose(page);
    expect(still).toBeLessThan(1e-6);
    expect(after).toBeLessThan(1e-6);
    expect(moved(before, end)).toBeLessThan(1e-6);
    expect(errors).toEqual([]);
  });
});

test.describe('"Hear it again" at text scale 2 (M3-07 review N1)', () => {
  test.use({ reducedMotion: "reduce" });

  for (const [width, height] of [
    [1024, 720],
    [1024, 600],
    [1280, 720],
  ] as const) {
    test(`${width}×${height}: the hint shows whole, in the window, and the progress bar keeps room`, async ({
      page,
    }) => {
      // CI has no voices: give the page one English voice of its own, as a laptop has.
      await page.addInitScript(() => {
        const voice = { lang: "en-US", name: "Test voice", localService: true, default: true };
        const synth = {
          getVoices: () => [voice],
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          speak: () => undefined,
          cancel: () => undefined,
          pause: () => undefined,
          resume: () => undefined,
          speaking: false,
          pending: false,
          paused: false,
        };
        Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
      });
      await page.setViewportSize({ width, height });
      const errors = collectErrors(page);
      // Rowan: Miner, read-aloud on, text size 2.
      await page.goto("/?profile=voice-miner&screen=play&lesson=meadow-05&seed=1&nosave=1");
      await waitForLesson(page);
      const hint = page.locator("#app p", { has: page.locator("kbd", { hasText: "F1" }) });
      await expect(hint).toBeVisible();
      await expect(hint).toContainText("Hear it again");
      const box = await hint.boundingBox();
      if (box === null) throw new Error("no hint box");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      // Nothing in the hint is cut off: its words fit their box.
      const clipped = await hint.evaluate((el) => {
        const outer = el.getBoundingClientRect();
        return (
          el.scrollWidth > el.clientWidth + 1 ||
          [...el.children].some((c) => c.getBoundingClientRect().right > outer.right + 1)
        );
      });
      expect(clipped).toBe(false);
      // The progress bar beside it still has room to be read.
      const bar = await page.getByRole("progressbar").first().boundingBox();
      expect(bar?.width ?? 0).toBeGreaterThanOrEqual(100);
      expect(errors).toEqual([]);
    });
  }
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
