/**
 * Results and the badge toast on short windows (task M3-FIX-12):
 * - the whole Results screen, heading first, fits 1024×600 and 1280×720 with nothing scrolled, at
 *   text scale 1 (Builder) and 1.5 (Sprout's default);
 * - a badge toast never covers the heading, the card or the buttons, at either size and at text
 *   scale 2. It shows under the buttons, compact, when it fits there whole (a Sprout at 1024×600
 *   with three stars and two rows of finds included), and otherwise waits;
 * - a badge that waits never shows on Lesson Intro, whose corner holds the lesson card: it waits
 *   for the World Map (review B2);
 * - toasts wait for the stars to fill in, and with reduced motion there is nothing to wait for.
 */
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { playLesson } from "./helpers/kid";
import { RESULTS_ARM_MS, expectScreen } from "./helpers/slice";
import { collectErrors, ready, waitForLesson } from "./helpers/vt";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function apart(a: Box, b: Box): boolean {
  return (
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
  );
}

async function box(el: Locator): Promise<Box> {
  const b = await el.boundingBox();
  if (b === null) throw new Error("no box");
  return b;
}

/** From the World Map: Settings → Look → letter size, then back to the map. */
async function setScale(page: Page, scale: number): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expectScreen(page, "settings");
  await page.getByRole("tab", { name: "Look" }).click();
  await page.getByLabel("Letter size", { exact: true }).evaluate((el, v) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("not a slider");
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, scale);
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--text-scale").trim()),
    )
    .toBe(String(scale));
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectScreen(page, "map");
}

/** From the World Map: Meadow Home's first lesson, played to Results without a slip. */
async function firstLesson(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Meadow Home/ }).press("Enter");
  await page.getByRole("button", { name: /^Lesson 1: / }).press("Enter");
  await expectScreen(page, "lessonIntro");
  await page.getByRole("button", { name: "Start" }).press("Enter");
  await expectScreen(page, "play");
  await waitForLesson(page);
  await playLesson(page, { wpm: 60, errorRate: 0, seed: 3 });
  await expectScreen(page, "results");
}

const heading = (page: Page): Locator => page.getByRole("heading", { name: "Lesson done!" });
const card = (page: Page): Locator => page.locator("main h1 + div");
const toast = (page: Page): Locator => page.getByTestId("badge-toast");

/** The heading, the card and every button: what a toast must never cover. */
async function keepOut(page: Page): Promise<{ name: string; box: Box }[]> {
  const out = [
    { name: "heading", box: await box(heading(page)) },
    { name: "card", box: await box(card(page)) },
  ];
  for (const b of await page.locator("main").getByRole("button").all()) {
    out.push({ name: await b.innerText(), box: await box(b) });
  }
  return out;
}

/**
 * Watches Results for `ms`: every time a badge toast is up, it is clear of the heading, the card
 * and the buttons, and wholly on screen. Returns whether one showed.
 */
async function watchToast(page: Page, view: { width: number; height: number }, ms: number) {
  let shown = false;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // (boundingBox waits for an element that isn't there, so count first.)
    const t = (await toast(page).count()) > 0 ? await toast(page).boundingBox() : null;
    if (t !== null) {
      shown = true;
      for (const other of await keepOut(page)) {
        expect(apart(t, other.box), `the toast covers ${other.name}`).toBe(true);
      }
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y + t.height).toBeLessThanOrEqual(view.height);
      expect(t.x + t.width).toBeLessThanOrEqual(view.width);
    }
    await page.waitForTimeout(150);
  }
  return shown;
}

/**
 * From Results: "Next lesson" to Lesson Intro, where no badge toast shows for `ms`; then back to
 * the World Map, where the waiting badge shows.
 */
async function waitsPastLessonIntro(page: Page, ms: number): Promise<void> {
  await page.getByRole("button", { name: "Next lesson" }).click();
  await expectScreen(page, "lessonIntro");
  const end = Date.now() + ms;
  while (Date.now() < end) {
    expect(await toast(page).count(), "a badge toast on Lesson Intro").toBe(0);
    await page.waitForTimeout(150);
  }
  await page.getByRole("button", { name: "Back to the map", exact: true }).click();
  await expectScreen(page, "map");
  // The map comes back with the island's lesson path open, and while it is open the corner (the
  // toast's place) isn't drawn, so the badge still waits. Escape closes the path.
  const corner = page.locator("[data-toast-corner]");
  await expect(toast(page)).toHaveCount(0);
  if ((await corner.count()) === 0) await page.keyboard.press("Escape");
  await expect(corner).toBeVisible();
  await expect(toast(page)).toBeVisible({ timeout: 15_000 });
}

const CASES = [
  // Sprout reads at 1.5 by default: three stars and two rows of finds, and the compact toast fits.
  { profile: "fresh-sprout", width: 1024, height: 600, onResults: true },
  { profile: "fresh-sprout", width: 1280, height: 720, onResults: true },
  { profile: "fresh-builder", width: 1024, height: 600, onResults: true },
  { profile: "fresh-builder", width: 1280, height: 720, onResults: true },
] as const;

for (const c of CASES) {
  test(`Results at ${c.width}×${c.height} (${c.profile}): it fits, and the toast covers nothing`, async ({
    page,
  }) => {
    test.slow();
    const view = { width: c.width, height: c.height };
    await page.setViewportSize(view);
    const errors = collectErrors(page);
    await page.goto(`/?profile=${c.profile}&screen=map&seed=1`, { waitUntil: "domcontentloaded" });
    await ready(page);
    await firstLesson(page);

    // The whole screen fits, heading first: focusing "Next lesson" scrolled nothing.
    await expect(page.getByRole("button", { name: "Next lesson" })).toBeFocused();
    expect(await page.locator("main").evaluate((el) => el.scrollTop)).toBe(0);
    await expect(heading(page)).toBeInViewport({ ratio: 1 });
    await expect(card(page)).toBeInViewport({ ratio: 1 });
    for (const b of await page.locator("main").getByRole("button").all()) {
      await expect(b).toBeInViewport({ ratio: 1 });
    }

    const shown = await watchToast(page, view, 6000);
    expect(shown, "a badge toast on Results").toBe(c.onResults);
    expect(errors).toEqual([]);
  });
}

test("Sprout at 1024×600: a badge left on Results waits past Lesson Intro for the map", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1024, height: 600 });
  const errors = collectErrors(page);
  await page.goto("/?profile=fresh-sprout&screen=map&seed=1", { waitUntil: "domcontentloaded" });
  await ready(page);
  await firstLesson(page);
  // "Next lesson" as soon as it takes presses, before the first toast's turn on Results.
  await page.waitForTimeout(RESULTS_ARM_MS + 100);
  expect(await toast(page).count()).toBe(0);
  await waitsPastLessonIntro(page, 6000);
  expect(errors).toEqual([]);
});

for (const view of [
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
]) {
  test(`at text scale 2, ${view.width}×${view.height}: the toast never covers Results`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize(view);
    const errors = collectErrors(page);
    await page.goto("/?profile=fresh-builder&screen=map&seed=1", { waitUntil: "domcontentloaded" });
    await ready(page);
    await setScale(page, 2);
    await firstLesson(page);
    await page.waitForTimeout(RESULTS_ARM_MS);
    // No room under the buttons at this size: it never shows on Results, nor on Lesson Intro.
    expect(await watchToast(page, view, 6000), "a badge toast on Results").toBe(false);
    await waitsPastLessonIntro(page, 5000);
    expect(errors).toEqual([]);
  });
}

interface Seen {
  holdOn: number | null;
  holdOff: number | null;
  toastOn: number | null;
}

/** Starts noting when Results' toast hold comes and goes, and when a badge toast first shows. */
async function noteHold(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: Seen = { holdOn: null, holdOff: null, toastOn: null };
    Reflect.set(window, "__hold", seen);
    const check = (): void => {
      const now = performance.now();
      const held = document.querySelector("[data-toast-hold]") !== null;
      if (held && seen.holdOn === null) seen.holdOn = now;
      if (!held && seen.holdOn !== null && seen.holdOff === null) seen.holdOff = now;
      if (seen.toastOn === null && document.querySelector('[data-testid="badge-toast"]') !== null) {
        seen.toastOn = now;
      }
    };
    new MutationObserver(check).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-toast-hold"],
    });
  });
}

async function seenHold(page: Page): Promise<Seen> {
  return page.evaluate(() => {
    const seen: unknown = Reflect.get(window, "__hold");
    const get = (k: string): number | null => {
      const v: unknown = typeof seen === "object" && seen !== null ? Reflect.get(seen, k) : null;
      return typeof v === "number" ? v : null;
    };
    return { holdOn: get("holdOn"), holdOff: get("holdOff"), toastOn: get("toastOn") };
  });
}

for (const reduced of [false, true]) {
  test(`toasts wait for the stars${reduced ? ", and with reduced motion nothing waits" : ""}`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: 1280, height: 720 });
    if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = collectErrors(page);
    await page.goto("/?profile=fresh-builder&screen=map&seed=1", {
      waitUntil: "domcontentloaded",
    });
    await ready(page);
    await noteHold(page);
    await firstLesson(page);
    await expect(toast(page)).toBeVisible({ timeout: 15_000 });
    const seen = await seenHold(page);
    if (reduced) {
      expect(seen.holdOn, "a hold with reduced motion").toBeNull();
    } else {
      // The stars filled in while the toast waited; it came only after the hold let go.
      if (seen.holdOn === null || seen.holdOff === null || seen.toastOn === null) {
        throw new Error(`no hold, or no toast: ${JSON.stringify(seen)}`);
      }
      expect(seen.holdOff - seen.holdOn).toBeGreaterThan(800);
      expect(seen.toastOn).toBeGreaterThanOrEqual(seen.holdOff);
    }
    expect(errors).toEqual([]);
  });
}
