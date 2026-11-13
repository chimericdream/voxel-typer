/**
 * World map in a real browser (task M3-04): the keyboard-only trip map → island → lesson → play →
 * results → back to the map with the node updated; the draw-call budget (≤ 120 at Medium); that
 * the map shares the app's one WebGL context and idles once its moves end; axe; and screenshot
 * baselines (compared on CI's Linux runner only, made by the Update snapshots workflow).
 *
 * M3-FIX-4: a click or tap on an island's model selects it like its label; the labels fit at
 * 1024×600 too; the hint never covers a corner button from 1024 to 1920 px; and on touch one tap
 * on a corner button goes, while a long press shows its words.
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

/** The middle of an island's model on screen (test builds mark it on the label's spot). */
async function islandCenter(page: Page, biome: string): Promise<{ x: number; y: number }> {
  const spot = page.locator(`#app [data-spot="${biome}"]`);
  await expect(spot).toHaveAttribute("data-center", /^-?\d+,-?\d+$/);
  const [x, y] = ((await spot.getAttribute("data-center")) ?? "").split(",").map(Number);
  if (x === undefined || y === undefined) throw new Error(`no centre for ${biome}`);
  return { x, y };
}

/** True when the point is on the 3D picture, not on a label, the heading or a button. */
async function onPicture(page: Page, at: { x: number; y: number }): Promise<boolean> {
  return page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return hit !== null && hit.closest("button, header, [data-nav]") === null;
  }, at);
}

test.describe("the island itself is the target (M3-FIX-4)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("a click on the middle of the Meadow island's model opens its lesson path", async ({
    page,
  }) => {
    await countGl(page);
    const errors = await openMap(page, "fresh-sprout", "&freeze=1");
    await expect(page.locator('#app [data-mode="3d"]')).toBeVisible();
    await expect(island(page, "Meadow Home")).toBeFocused();
    await settle(page);
    const at = await islandCenter(page, "meadow");
    // The click lands on the model, not on its label.
    expect(await onPicture(page, at)).toBe(true);

    // Hovering lights the island and its label, with the hand cursor; then the loop idles again.
    await untilIdle(page);
    const before = (await gl(page)).draws;
    await page.mouse.move(at.x, at.y);
    const map = page.locator("#app [data-mode]").first();
    await expect(map).toHaveAttribute("data-pointing", "island");
    expect(await map.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");
    await expect(island(page, "Meadow Home")).toHaveAttribute("data-hover", "1");
    await expect.poll(async () => (await gl(page)).draws).toBeGreaterThan(before);
    await untilIdle(page);

    await page.mouse.click(at.x, at.y);
    await expect(page.getByRole("heading", { name: "Meadow Home" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Lesson 1: / })).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("a click on an island in the clouds gives the kind line; a second click says it again", async ({
    page,
  }) => {
    const errors = await openMap(page, "fresh-sprout", "&freeze=1");
    await expect(island(page, "Meadow Home")).toBeFocused();
    await settle(page);
    const at = await islandCenter(page, "birch");
    expect(await onPicture(page, at)).toBe(true);
    await page.mouse.click(at.x, at.y);
    const note = page.locator("#app [data-note]");
    await expect(note).toHaveText("Finish Meadow Home to open this island!");
    await expectScreen(page, "map");
    // No glow over an island that is still in the clouds.
    await page.mouse.move(at.x + 1, at.y);
    await expect(island(page, "Birch Forest")).not.toHaveAttribute("data-hover", "1");
    // The same island again: the line goes away for a moment and comes back, so it's read again.
    // Log every text the line shows from now on, then click the same island again.
    await note.evaluate((el) => {
      const seen: string[] = [];
      Reflect.set(window, "vtNoteLog", seen);
      new MutationObserver(() => seen.push(el.textContent ?? "")).observe(el, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    await page.mouse.click(at.x, at.y);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const log: unknown = Reflect.get(window, "vtNoteLog");
          return Array.isArray(log) ? log.map(String) : [];
        }),
      )
      .toContain("");
    await expect(note).toHaveText("Finish Meadow Home to open this island!");
    // A typed letter clears it (M3-FIX-1 review N3).
    await page.keyboard.press("k");
    await expect(note).toHaveText("");
    expect(errors).toEqual([]);
  });
});

test.describe("the heading never covers a corner button (M3-FIX-4 (c), M3-FIX-8)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const scale of [1, 2]) {
    test(`from 1024 to 1920 px wide, text scale ${scale}`, async ({ page }) => {
      test.slow();
      await page.setViewportSize({ width: 1024, height: 720 });
      const errors = await openMap(page, "fresh-sprout", "&freeze=1");
      await expect(island(page, "Meadow Home")).toBeFocused();
      await page.evaluate((s) => {
        document.documentElement.style.setProperty("--text-scale", String(s));
      }, scale);
      const plates = [
        { name: "title", el: page.locator("#app header > h1") },
        { name: "hint", el: page.getByText("Pick an island. Press Enter to go in.") },
      ];
      const corner = page.locator("#app header ~ div button");
      await expect(corner).toHaveCount(5);
      const problems: string[] = [];
      for (const width of [1024, 1100, 1101, 1180, 1280, 1366, 1440, 1536, 1600, 1680, 1920]) {
        await page.setViewportSize({ width, height: 720 });
        await settle(page);
        for (const plate of plates) {
          const h = await plate.el.boundingBox();
          if (h === null) throw new Error(`no ${plate.name}`);
          // Never squeezed into a sliver beside the buttons (M3-FIX-4: it goes below them).
          if (h.width < 100) problems.push(`${width}px: the ${plate.name} is ${h.width} px wide`);
          for (const b of await corner.all()) {
            const c = await b.boundingBox();
            if (c === null) continue;
            const apart =
              h.x + h.width <= c.x ||
              c.x + c.width <= h.x ||
              h.y + h.height <= c.y ||
              c.y + c.height <= h.y;
            if (!apart) {
              problems.push(`${width}px: the ${plate.name} covers ${await b.innerText()}`);
            }
          }
        }
        // Each corner button takes its own clicks: the middle of it is its own (M3-FIX-8).
        for (const b of await corner.all()) {
          const mine = await b.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return hit !== null && el.contains(hit);
          });
          if (!mine) problems.push(`${width}px: something lies over ${await b.innerText()}`);
        }
      }
      expect(problems).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test("the heading never takes a click (M3-FIX-8)", async ({ page }) => {
    const errors = await openMap(page, "fresh-sprout", "&freeze=1");
    await expect(island(page, "Meadow Home")).toBeFocused();
    for (const el of [
      page.locator("#app header"),
      page.getByText("Pick an island. Press Enter to go in."),
    ]) {
      expect(await el.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");
    }
    expect(errors).toEqual([]);
  });
});

/**
 * Touches a button through the browser's own touch input, held for `holdMs`, and then (with
 * `until`) for as long as it takes `until` to come true, at most 10 s more. On CI's software
 * renderer a slow frame can hold the page's long-press timer back past a fixed hold, and the lift
 * then runs first and cancels it (M3-14: the long-press flake). Holding until the tip is open
 * tests the same thing, a press that stays down, without racing the timer.
 */
async function touch(
  page: Page,
  name: string,
  opts: { holdMs?: number; cancel?: boolean; until?: () => Promise<boolean> } = {},
): Promise<void> {
  const box = await page.getByRole("button", { name }).boundingBox();
  if (box === null) throw new Error(`${name} not on screen`);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  if (opts.holdMs !== undefined) await page.waitForTimeout(opts.holdMs);
  if (opts.until !== undefined) await expect.poll(opts.until, { timeout: 10_000 }).toBe(true);
  await cdp.send("Input.dispatchTouchEvent", {
    type: opts.cancel === true ? "touchCancel" : "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}

test.describe("corner buttons on touch, narrow window (M3-FIX-4 (a), (b))", () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 720 } });

  test("a long press shows the words and stays; a cancelled touch leaves nothing; one tap goes", async ({
    page,
  }) => {
    const errors = await openMap(page, "fresh-sprout", "&freeze=1");
    await expect(island(page, "Meadow Home")).toBeFocused();
    const words = page.getByRole("button", { name: "Settings" }).getByText("Settings");

    // A long press: the words show, and lifting the finger doesn't leave the map.
    const shown = async (): Promise<boolean> => ((await words.boundingBox())?.width ?? 0) > 40;
    await touch(page, "Settings", { holdMs: 900, until: shown });
    await expect.poll(shown).toBe(true);
    await page.waitForTimeout(300);
    await expectScreen(page, "map");

    // A touch the system takes back (a scroll) sets nothing: the next tap goes at once.
    await touch(page, "Change player", { cancel: true });
    await expectScreen(page, "map");
    await page.getByRole("button", { name: "Change player" }).tap();
    await expectScreen(page, "profiles");
    expect(errors).toEqual([]);
  });

  test("one tap on My Island goes straight there", async ({ page }) => {
    const errors = await openMap(page, "fresh-sprout", "&freeze=1");
    await expect(island(page, "Meadow Home")).toBeFocused();
    await page.getByRole("button", { name: "My Island" }).tap();
    // My Island is played as the Builder lesson.
    await expectScreen(page, "play");
    expect(errors).toEqual([]);
  });
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

  for (const [width, height, scales] of [
    [1024, 720, [1.5, 2]],
    [1280, 720, [1.5, 2]],
    // A small tablet or netbook: the labels need three rows (M3-FIX-1 review N1, M3-FIX-4 (d)).
    [1024, 600, [2]],
  ] as const) {
    for (const scale of scales) {
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
          // The 3D map, not the flat fallback, where labels sit in a grid and pass trivially
          // (M3-FIX-1 review N2); and every label has been placed under its island.
          await expect(page.locator('#app [data-mode="3d"]')).toBeVisible();
          await expect(page.locator("#app [data-spot]")).toHaveCount(9);
          await expect(page.locator("#app [data-spot][data-placed]")).toHaveCount(9);
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

  test("the narrow corner: pictures, no overlap with the hint, and a button's words as a tip on focus (M4-FIX-1)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    const errors = await openMap(page, "fresh-sprout", "&freeze=1");
    await expect(island(page, "Meadow Home")).toBeFocused();
    const home = page.getByRole("button", { name: "My Island" });
    const words = home.getByText("My Island");
    // At 1100 px or less the words are only for screen readers until the button is focused.
    expect((await words.boundingBox())?.width ?? 0).toBeLessThan(2);
    // The hint wraps under the title rather than covering the first corner button (M4-FIX-1).
    const hint = await page.getByText("Pick an island. Press Enter to go in.").boundingBox();
    const players = await page.getByRole("button", { name: "Change player" }).boundingBox();
    if (hint === null || players === null) throw new Error("hint or corner button not on screen");
    const apart =
      hint.x + hint.width <= players.x ||
      players.x + players.width <= hint.x ||
      hint.y + hint.height <= players.y ||
      players.y + players.height <= hint.y;
    expect(apart).toBe(true);
    await home.focus();
    await expect(home).toBeFocused();
    await expect.poll(async () => (await words.boundingBox())?.width ?? 0).toBeGreaterThan(40);
    await settle(page);
    await expect(page).toHaveScreenshot("map-narrow-corner.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});
