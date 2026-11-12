/**
 * World map in a real browser (task M3-04): the keyboard-only trip map → island → lesson → play →
 * results → back to the map with the node updated; the draw-call budget (≤ 120 at Medium); that
 * the map shares the app's one WebGL context and idles once its moves end; axe; and screenshot
 * baselines (compared on CI's Linux runner only, made by the Update snapshots workflow).
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { playLesson } from "./helpers/kid";
import { RESULTS_ARM_MS, expectNoAxeViolations, expectScreen } from "./helpers/slice";
import { collectErrors, ready, state, waitForLesson } from "./helpers/vt";

const MAP_DRAW_CALL_BUDGET = 120;

/** Counts WebGL contexts made and draw calls issued, before any page script runs. */
async function countGl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counts = { contexts: 0, draws: 0 };
    Reflect.set(window, "vtGl", counts);
    const getContext: unknown = Reflect.get(HTMLCanvasElement.prototype, "getContext");
    Reflect.set(
      HTMLCanvasElement.prototype,
      "getContext",
      function patched(this: HTMLCanvasElement, ...args: unknown[]): unknown {
        if (typeof getContext !== "function") return null;
        const ctx: unknown = Reflect.apply(getContext, this, args);
        if (ctx !== null && String(args[0]).startsWith("webgl")) counts.contexts += 1;
        return ctx;
      },
    );
    const proto: unknown = Reflect.get(window, "WebGL2RenderingContext")?.prototype;
    if (typeof proto !== "object" || proto === null) return;
    for (const name of [
      "drawElements",
      "drawArrays",
      "drawElementsInstanced",
      "drawArraysInstanced",
    ]) {
      const original: unknown = Reflect.get(proto, name);
      if (typeof original !== "function") continue;
      Reflect.set(proto, name, function patched(this: unknown, ...args: unknown[]): unknown {
        counts.draws += 1;
        return Reflect.apply(original, this, args);
      });
    }
  });
}

async function gl(page: Page): Promise<{ contexts: number; draws: number }> {
  return page.evaluate(() => {
    const c: unknown = Reflect.get(window, "vtGl");
    const n = (k: string): number =>
      typeof c === "object" && c !== null ? Number(Reflect.get(c, k)) : 0;
    return { contexts: n("contexts"), draws: n("draws") };
  });
}

/** Waits until no WebGL draw call has been issued for `quietMs`: the render loop is idle. */
async function untilIdle(page: Page, quietMs = 600): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = (await gl(page)).draws;
        await page.waitForTimeout(quietMs);
        return (await gl(page)).draws - before;
      },
      { timeout: 45_000 },
    )
    .toBe(0);
}

async function openMap(page: Page, profile: string, extra = ""): Promise<string[]> {
  const errors = collectErrors(page);
  await page.goto(`/?profile=${profile}&screen=map&seed=1${extra}`, {
    waitUntil: "domcontentloaded",
  });
  await ready(page);
  await expect(page.getByRole("heading", { name: "World Map" })).toBeVisible();
  await expect(page.locator("canvas.vt-stage")).toBeVisible();
  return errors;
}

const island = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}`) });

test("keyboard only: map → island → lesson → play → results → map, with the node updated", async ({
  page,
}) => {
  test.slow();
  await countGl(page);
  const errors = await openMap(page, "fresh-sprout");

  // The map opens with the cursor on the island to play next.
  const meadow = island(page, "Meadow Home");
  await expect(meadow).toBeFocused();
  await expect(meadow).toHaveAccessibleName(
    "Meadow Home, 0 of 14 lessons done, 0 stars. Go here next!",
  );
  await expect(island(page, "Birch Forest")).toHaveAttribute("aria-disabled", "true");
  await expectNoAxeViolations(page, "world map");

  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Meadow Home" })).toBeVisible();
  const first = page.getByRole("button", { name: /^Lesson 1: / });
  await expect(first).toBeFocused();
  await expect(first).toHaveAccessibleName("Lesson 1: Find F and J. Play this one next!");
  await expectNoAxeViolations(page, "lesson path");

  await page.keyboard.press("Enter");
  await expectScreen(page, "lessonIntro");
  await expect(page.getByRole("button", { name: "Start" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expectScreen(page, "play");
  await waitForLesson(page);
  await playLesson(page, { wpm: 20, errorRate: 0, seed: 3 });
  await expectScreen(page, "results");
  const stars = (await state(page)).stars;
  expect(stars).toBeGreaterThanOrEqual(1);

  // Results: Next lesson has focus; Tab reaches Map.
  await page.waitForTimeout(RESULTS_ARM_MS + 100);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Map", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expectScreen(page, "map");

  // Back on the same island: lesson 1 has its stars, and lesson 2 is next, with the cursor on it.
  await expect(page.getByRole("heading", { name: "Meadow Home" })).toBeVisible();
  const plural = stars === 1 ? "star" : "stars";
  await expect(page.getByRole("button", { name: /^Lesson 1: / })).toHaveAccessibleName(
    `Lesson 1: Find F and J. ${stars} ${plural} out of 3.`,
  );
  const second = page.getByRole("button", { name: /^Lesson 2: / });
  await expect(second).toHaveAccessibleName("Lesson 2: Hello, D and K. Play this one next!");
  await expect(second).toBeFocused();
  await expect(
    page.locator("#app").getByText("1 of 14 lessons done", { exact: true }),
  ).toBeVisible();

  // Escape: back out to the whole map, then the island button says the same.
  await page.keyboard.press("Escape");
  await expect(island(page, "Meadow Home")).toBeFocused();
  await expect(island(page, "Meadow Home")).toHaveAccessibleName(
    `Meadow Home, 1 of 14 lessons done, ${stars} ${plural}. Go here next!`,
  );

  // One canvas and one WebGL context for the map, the lesson and the map again.
  await expect(page.locator("canvas")).toHaveCount(1);
  expect((await gl(page)).contexts).toBe(1);
  expect(errors).toEqual([]);
});

for (const profile of ["fresh-sprout", "veteran-builder"] as const) {
  test(`draw calls stay under ${MAP_DRAW_CALL_BUDGET} and the loop idles (${profile})`, async ({
    page,
  }) => {
    test.slow();
    await countGl(page);
    const errors = await openMap(page, profile, "&quality=medium");

    // The glide onto the overview ends, and then nothing is drawn any more.
    await untilIdle(page);
    const overview = (await state(page)).calls;
    expect(overview).toBeGreaterThan(9);
    expect(overview).toBeLessThanOrEqual(MAP_DRAW_CALL_BUDGET);

    // Moving the cursor lifts an island for a moment; going in glides the camera. Both end.
    if (profile === "veteran-builder") {
      await page.keyboard.press("ArrowRight");
      await expect(island(page, "Birch Forest")).toBeFocused();
      await untilIdle(page);
    }
    const before = (await gl(page)).draws;
    await page.keyboard.press("Enter");
    await expect(page.locator("#app").getByRole("heading", { level: 2 })).toBeVisible();
    await expect.poll(async () => (await gl(page)).draws).toBeGreaterThan(before);
    await untilIdle(page);
    const close = (await state(page)).calls;
    expect(close).toBeLessThanOrEqual(MAP_DRAW_CALL_BUDGET);

    await page.keyboard.press("Escape");
    await untilIdle(page);
    expect((await state(page)).calls).toBeLessThanOrEqual(MAP_DRAW_CALL_BUDGET);

    test.info().annotations.push({
      type: "perf",
      description: `${profile}: map draw calls ${overview} (overview), ${close} (island)`,
    });
    // oxlint-disable-next-line no-console -- reason: the draw-call reading is meant to be seen in the run log
    console.log(`map draw calls, ${profile}: overview ${overview}, island ${close}`);
    expect(errors).toEqual([]);
  });
}

/** Fonts loaded and a few frames drawn: the map is at rest (reduced motion snaps every move). */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
}

interface Box {
  name: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The on-screen boxes of the island labels, the heading and the corner button. */
async function labelBoxes(page: Page): Promise<{ labels: Box[]; fixed: Box[] }> {
  return page.evaluate(() => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- reason: this runs in the page, so it can't use helpers from the test's scope
    const box = (el: Element, name: string) => {
      const r = el.getBoundingClientRect();
      return { name, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const labels = [...document.querySelectorAll("#app [data-spot] button")].map((el) => {
      // The "Go here next!" tag sticks out above the button.
      const tag = el.querySelector("[data-tag]");
      const b = box(el, el.closest("[data-spot]")?.getAttribute("data-spot") ?? "?");
      if (tag) b.top = Math.min(b.top, tag.getBoundingClientRect().top);
      return b;
    });
    const fixed = [
      ...document.querySelectorAll(
        "#app header > h1, #app header > p, #app header > output:not(:empty)",
      ),
    ]
      .map((el) => box(el, "heading"))
      .concat(
        [...document.querySelectorAll("#app header ~ div button")].map((el) => box(el, "corner")),
      );
    return { labels, fixed };
  });
}

/** Problems with the label layout: a label off screen, or two boxes overlapping. */
function layoutProblems(
  { labels, fixed }: { labels: Box[]; fixed: Box[] },
  width: number,
  height: number,
): string[] {
  // The focus ring reaches 7 px outside a button; keep it on screen too.
  const ring = 7;
  const out: string[] = [];
  const crosses = (a: Box, b: Box): boolean =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const [i, a] of labels.entries()) {
    if (a.left < ring || a.top < ring || a.right > width - ring || a.bottom > height - ring) {
      out.push(`${a.name} is clipped: ${JSON.stringify(a)}`);
    }
    for (const b of labels.slice(i + 1))
      if (crosses(a, b)) out.push(`${a.name} overlaps ${b.name}`);
    for (const f of fixed) if (crosses(a, f)) out.push(`${a.name} overlaps the ${f.name}`);
  }
  return out;
}

test.describe("labels fit at large text", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const [width, height] of [
    [1024, 720],
    [1280, 720],
  ] as const) {
    for (const scale of [1.5, 2]) {
      for (const profile of ["fresh-sprout", "veteran-builder"] as const) {
        test(`${width}×${height}, text scale ${scale}, ${profile}: no label clipped or overlapping`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height });
          const errors = await openMap(page, profile, "&freeze=1");
          await expect(island(page, "Meadow Home")).toBeFocused();
          await page.evaluate((s) => {
            document.documentElement.style.setProperty("--text-scale", String(s));
          }, scale);
          await settle(page);
          await expect
            .poll(async () => layoutProblems(await labelBoxes(page), width, height), {
              timeout: 10_000,
            })
            .toEqual([]);
          // The focused label is drawn on top: its middle is its own.
          for (const name of ["Meadow Home", "Crystal Caverns", "Sparkstone Factory"]) {
            const button = island(page, name);
            if ((await button.getAttribute("aria-disabled")) === "true") continue;
            await button.focus();
            const mine = await button.evaluate((el) => {
              const r = el.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
              return hit !== null && el.contains(hit);
            });
            expect(mine, name).toBe(true);
          }
          expect(errors).toEqual([]);
        });
      }
    }
  }
});

test.describe("baselines", () => {
  test.use({ colorScheme: "light" });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("a new player's map: Meadow Home open, the rest in the clouds", async ({ page }) => {
    const errors = await openMap(page, "fresh-sprout", "&freeze=1");
    await expect(island(page, "Meadow Home")).toBeFocused();
    await settle(page);
    await expect(page).toHaveScreenshot("map-new-player.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test("the whole archipelago open", async ({ page }) => {
    const errors = await openMap(page, "veteran-builder", "&freeze=1");
    await expect(island(page, "Meadow Home")).toBeFocused();
    await settle(page);
    await expect(page).toHaveScreenshot("map-all-open.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test("an island's lesson path", async ({ page }) => {
    const errors = await openMap(page, "pinky-weak", "&freeze=1");
    await expect(island(page, "Meadow Home")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /^Lesson 2: / })).toBeFocused();
    await settle(page);
    await expect(page).toHaveScreenshot("map-lesson-path.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});
