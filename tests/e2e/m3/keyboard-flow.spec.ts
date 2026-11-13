/**
 * The M3 trip on the keyboard alone (task M3-14): new player → placement test → world map → a
 * Birch Forest lesson → My Badges → Settings → the Parent Dashboard → back to the map. No clicks,
 * real IndexedDB (no `?profile`, no `?nosave`), axe on each screen on the way.
 *
 * Also here:
 * - settings persistence: two players each keep their own settings through a reload;
 * - screen-reader order: a badge toast that arrives with a route change is read after it
 *   (`TOAST_AFTER_PAGE_MS`, M3-FIX-4 review S2, PR #189).
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { playLesson, typeLikeAKid } from "../helpers/kid";
import { RESULTS_ARM_MS, expectNoAxeViolations, expectScreen } from "../helpers/slice";
import { collectErrors, ready, state, vt, waitForLesson } from "../helpers/vt";
import { passGate, recordAnnouncements, spoken, tabTo } from "./helpers";
import type { Spoken } from "./helpers";

/** `TOAST_AFTER_PAGE_MS` in `src/ui/kit/announce.ts`, less a little for clock rounding. */
const TOAST_GAP_MS = 950;

/**
 * Every toast is read at least {@link TOAST_GAP_MS} after the page message before it. Returns the
 * gap for each toast (Infinity when no page message came first).
 */
function toastGaps(log: readonly Spoken[]): number[] {
  const gaps: number[] = [];
  let lastPage = Number.NEGATIVE_INFINITY;
  for (const m of log) {
    if (m.region === "page") lastPage = m.at;
    else gaps.push(m.at - lastPage);
  }
  for (const gap of gaps)
    expect(gap, "a toast read too soon after a route change").toBeGreaterThanOrEqual(TOAST_GAP_MS);
  return gaps;
}

async function settings(page: Page): Promise<Record<string, unknown>> {
  const p = await vt(page, "profile");
  if (typeof p !== "object" || p === null) throw new Error("no profile");
  const s: unknown = Reflect.get(p, "settings");
  if (typeof s !== "object" || s === null) throw new Error("no settings");
  return { ...s };
}

/** On the map: arrow keys move the cursor until `name`'s island has it. */
async function arrowToIsland(page: Page, name: string): Promise<void> {
  const target = page.getByRole("button", { name: new RegExp(`^${name}`) });
  for (let i = 0; i < 12; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("ArrowRight");
  }
  await expect(target).toBeFocused();
}

/** Splash → New player → the name, typed like a child → Enter. Ends on the placement screen. */
async function newPlayer(page: Page, name: string, seed: number): Promise<void> {
  await page.keyboard.press("k");
  await expectScreen(page, "profileCreate");
  await expect(page.getByRole("textbox")).toBeFocused();
  await typeLikeAKid(page, name, { wpm: 20, errorRate: 0.1, seed, fix: "backspace" });
  await expect(page.getByRole("textbox")).toHaveValue(name);
  await page.keyboard.press("Enter");
  await expectScreen(page, "placement");
}

test("keyboard only: new player → placement → map → a Birch lesson → My Badges → Settings → Parent Dashboard → map", async ({
  page,
}) => {
  // The placement test runs 90 s and a lesson about a minute, on CI's software renderer.
  test.setTimeout(360_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await recordAnnouncements(page);
  const errors = collectErrors(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ready(page);
  await expect(page.locator("#app").getByText("Press any key to start")).toBeVisible();
  await expectNoAxeViolations(page, "splash");

  // 1. A new player (Sprout, the default group).
  await newPlayer(page, "Hazel", 11);

  // 2. The placement test: "Let's dig!" has focus. A steady child at about 16 WPM with no slips
  //    climbs past the home row and starts at Birch Forest (12–17 WPM), or Sandy Shore if the
  //    run comes out a little faster. Either way Birch Forest is open.
  const dig = page.getByRole("button", { name: "Let's dig!" });
  await expect(dig).toBeFocused();
  await expectNoAxeViolations(page, "placement");
  await page.keyboard.press("Enter");
  await expectScreen(page, "play");
  await waitForLesson(page);
  await playLesson(page, { wpm: 16, errorRate: 0, seed: 21 });
  // The test ends on its 90 s clock, then shows where the child starts.
  await expect.poll(async () => (await state(page)).screen, { timeout: 120_000 }).toBe("placement");
  await ready(page);
  const outcome = page.locator("#app").getByText(/^You start at /);
  await expect(outcome).toBeVisible();
  await expect(outcome).toHaveText(/^You start at (Birch Forest|Sandy Shore)!$/);
  await expectNoAxeViolations(page, "placement outcome");
  const toMap = page.getByRole("button", { name: "Go to the map" });
  await tabTo(page, toMap);
  await page.keyboard.press("Enter");

  // 3. The map: Birch Forest is open. Arrow to it, open its path, and play its next lesson.
  await expectScreen(page, "map");
  const birch = page.getByRole("button", { name: /^Birch Forest/ });
  await expect(birch).not.toHaveAttribute("aria-disabled", "true");
  await arrowToIsland(page, "Birch Forest");
  await expectNoAxeViolations(page, "world map");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Birch Forest" })).toBeVisible();
  const stone = page.getByRole("button", { name: /^Lesson \d+: / });
  await expect(stone.first()).toBeVisible();
  // The cursor sits on a lesson stone (the next one, or the first when they're all tested out).
  await expect(page.locator(":focus")).toHaveAccessibleName(/^Lesson \d+: /);
  await expectNoAxeViolations(page, "birch lesson path");
  await page.keyboard.press("Enter");
  await expectScreen(page, "lessonIntro");
  await expectNoAxeViolations(page, "birch lesson intro");
  await expect(page.getByRole("button", { name: "Start" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expectScreen(page, "play");
  await waitForLesson(page);
  await playLesson(page, { wpm: 25, errorRate: 0.03, seed: 31 });
  await expectScreen(page, "results");
  const played = await state(page);
  expect(played.lessonId).toMatch(/^birch-\d\d$/);
  expect(played.stars).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(RESULTS_ARM_MS + 1500);
  await expectNoAxeViolations(page, "results");
  const mapButton = page.getByRole("button", { name: "Map", exact: true });
  await tabTo(page, mapButton);
  await page.keyboard.press("Enter");
  await expectScreen(page, "map");
  await expect(page.getByRole("heading", { name: "Birch Forest" })).toBeVisible();
  // Escape: from the lesson path back out to the whole map.
  await page.keyboard.press("Escape");
  await expect(birch).toBeFocused();

  // 4. My Badges, then Back.
  await tabTo(page, page.getByRole("button", { name: "My Badges", exact: true }));
  await page.keyboard.press("Enter");
  await expectScreen(page, "achievements");
  await expect(page.getByRole("heading", { name: "My Badges" })).toBeVisible();
  await expectNoAxeViolations(page, "my badges");
  await page.keyboard.press("Escape");
  await expectScreen(page, "map");

  // 5. Settings: Play has focus; End jumps to Grown-ups and its gate.
  await tabTo(page, page.getByRole("button", { name: "Settings", exact: true }));
  await page.keyboard.press("Enter");
  await expectScreen(page, "settings");
  await expect(page.getByRole("tab", { name: "Play" })).toBeFocused();
  await expectNoAxeViolations(page, "settings");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Grown-ups" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Grown-ups only")).toBeVisible();
  await passGate(page);

  // 6. The Parent Dashboard, from the Grown-ups tab (the pass is handed on, no second gate).
  const progress = page.getByRole("button", { name: "See Hazel's progress" });
  await tabTo(page, progress);
  await expectNoAxeViolations(page, "settings: grown-ups");
  await page.keyboard.press("Enter");
  await expectScreen(page, "parent");
  await expect(page.getByRole("heading", { name: /Hazel/ }).first()).toBeVisible();
  await expect(page.getByText("Grown-ups only")).toHaveCount(0);
  await expectNoAxeViolations(page, "parent dashboard");
  // Up and Down step through its controls.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName ?? ""))
    .not.toBe("BODY");

  // 7. Back: the dashboard → Settings → the map.
  await page.keyboard.press("Escape");
  await expectScreen(page, "settings");
  await page.keyboard.press("Escape");
  await expectScreen(page, "map");
  await expect(page.locator("#vt-announcer")).toHaveText("World Map");

  // Screen-reader order on the whole trip: no toast was read within a second of a route change.
  toastGaps(await spoken(page));
  expect(errors).toEqual([]);
});

/**
 * Badge toasts open `BADGE_SETTLE_MS` (1.5 s) after a screen settles (`src/app/App.tsx`), and
 * the toast region then waits for `TOAST_AFTER_PAGE_MS` (1 s) after the last page message. Either
 * way Results is read first and the toast after it.
 */
test("a badge toast that comes with Results is read a second after Results is", async ({
  page,
}) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await recordAnnouncements(page);
  const errors = collectErrors(page);
  // A first lesson earns badges, and their toasts open with Results.
  await page.goto("/?profile=fresh-sprout&screen=play&lesson=meadow-01&seed=1&nosave=1", {
    waitUntil: "domcontentloaded",
  });
  await waitForLesson(page);
  await playLesson(page, { wpm: 30, errorRate: 0, seed: 3 });
  await expectScreen(page, "results");
  await expect(page.getByTestId("badge-toast")).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await spoken(page)).some((m) => m.region === "toast")).toBe(true);

  const log = await spoken(page);
  const results = log.findLast((m) => m.region === "page");
  expect(results?.text).toMatch(/^Lesson done!/);
  const toast = log.find((m) => m.region === "toast" && m.at >= (results?.at ?? 0));
  if (results === undefined || toast === undefined) throw new Error("no results and toast pair");
  // They came together, and the toast waited its second.
  const gap = toast.at - results.at;
  expect(gap).toBeGreaterThanOrEqual(TOAST_GAP_MS);
  expect(gap).toBeLessThan(3000);
  toastGaps(log);
  expect(errors).toEqual([]);
});

test("settings persist: two players each keep their own after a reload (keyboard only)", async ({
  page,
}) => {
  test.slow();
  const errors = collectErrors(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ready(page);

  // Player one: skip the test, then Settings → Look: bigger letters and strong colors.
  await newPlayer(page, "Moss", 41);
  await tabTo(page, page.getByRole("button", { name: "Skip" }));
  await page.keyboard.press("Enter");
  await expectScreen(page, "map");
  await tabTo(page, page.getByRole("button", { name: "Settings", exact: true }));
  await page.keyboard.press("Enter");
  await expectScreen(page, "settings");
  await expect(page.getByRole("tab", { name: "Play" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Look" })).toHaveAttribute("aria-selected", "true");
  const size = page.getByLabel("Letter size", { exact: true });
  await tabTo(page, size);
  const before = Number(await size.inputValue());
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Number(await size.inputValue())).toBeGreaterThan(before);
  const scale = Number(await size.inputValue());
  const strong = page.getByRole("switch", { name: "Strong colors" });
  await tabTo(page, strong);
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
  const moss = await settings(page);
  expect(moss).toMatchObject({ textScale: scale, highContrast: true });
  await page.keyboard.press("Escape");
  await expectScreen(page, "map");

  // Player two, from "Who is playing?": the defaults, not player one's.
  await page.keyboard.press("Escape");
  await expectScreen(page, "profiles");
  await tabTo(page, page.getByRole("button", { name: "New player" }));
  await page.keyboard.press("Enter");
  await expectScreen(page, "profileCreate");
  await typeLikeAKid(page, "Fern", { wpm: 20, errorRate: 0, seed: 42, fix: "backspace" });
  await page.keyboard.press("Enter");
  await expectScreen(page, "placement");
  await tabTo(page, page.getByRole("button", { name: "Skip" }));
  await page.keyboard.press("Enter");
  await expectScreen(page, "map");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
  const fern = await settings(page);
  expect(fern).toMatchObject({ highContrast: false });
  expect(fern["textScale"]).not.toBe(scale);
  // Give IndexedDB's commit a moment.
  await page.waitForTimeout(500);

  // A reload: each player gets their own settings back.
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  await page.keyboard.press("Enter");
  await expectScreen(page, "profiles");
  await tabTo(page, page.getByRole("button", { name: /^Moss/ }));
  await page.keyboard.press("Enter");
  await expectScreen(page, "map");
  expect(await settings(page)).toEqual(moss);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue("--text-scale").trim(),
    ),
  ).toBe(String(scale));
  await expectNoAxeViolations(page, "world map, Moss's settings");

  await page.keyboard.press("Escape");
  await expectScreen(page, "profiles");
  await tabTo(page, page.getByRole("button", { name: /^Fern/ }));
  await page.keyboard.press("Enter");
  await expectScreen(page, "map");
  expect(await settings(page)).toEqual(fern);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
  expect(errors).toEqual([]);
});
