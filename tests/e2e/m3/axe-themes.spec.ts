/**
 * Axe on every menu screen in all three themes: day, night and high contrast (task M3-14).
 *
 * Each screen is opened from a fixture with a deep link, then each theme is put on the page in
 * turn (`useTheme`, which copies what `applyTheme` writes). Menus never pick the night theme by
 * themselves (`themeFor(…, "day")`), so this is the only way it gets checked on them. The high
 * contrast theme through the real setting is covered too: `a11y.spec.ts`, `settings.spec.ts`
 * and the keyboard flow here.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { playLesson } from "../helpers/kid";
import { RESULTS_ARM_MS, expectScreen } from "../helpers/slice";
import { collectErrors, ready, waitForLesson } from "../helpers/vt";
import { THEMES, axeIn, passGate, tabTo } from "./helpers";

test.use({ reducedMotion: "reduce" });

async function open(page: Page, profile: string, screen: string, extra = ""): Promise<void> {
  await page.goto(`/?profile=${profile}&screen=${screen}&seed=1&freeze=1&nosave=1${extra}`, {
    waitUntil: "domcontentloaded",
  });
  await ready(page);
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test("splash, players, new player, placement and the placement outcome", async ({ page }) => {
      test.slow();
      const errors = collectErrors(page);
      await open(page, "fresh-sprout", "splash");
      await expect(page.locator("#app").getByText("Press any key to start")).toBeVisible();
      await axeIn(page, theme, "splash");

      await open(page, "fresh-sprout", "profiles");
      await expectScreen(page, "profiles");
      await axeIn(page, theme, "players");

      await open(page, "fresh-sprout", "profileCreate");
      await expectScreen(page, "profileCreate");
      await axeIn(page, theme, "new player");
      // With a name typed (the preview and the Create button change).
      await page.keyboard.type("Ivy");
      await axeIn(page, theme, "new player, name typed");

      await open(page, "fresh-sprout", "placement");
      await expectScreen(page, "placement");
      await expect(page.getByRole("button", { name: "Let's dig!" })).toBeVisible();
      await axeIn(page, theme, "placement");

      // veteran-builder took the placement test.
      await open(page, "veteran-builder", "placement", "&lesson=placement");
      await expectScreen(page, "placement");
      await expect(page.getByRole("button", { name: "Go to the map" })).toBeVisible();
      await axeIn(page, theme, "placement outcome");
      expect(errors).toEqual([]);
    });

    test("world map, a lesson path, a lesson intro, My Badges and My Blocks", async ({ page }) => {
      test.slow();
      const errors = collectErrors(page);
      await open(page, "fresh-sprout", "map");
      await expectScreen(page, "map");
      await expect(page.getByRole("button", { name: /^Meadow Home/ })).toBeFocused();
      await axeIn(page, theme, "world map, new player");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Meadow Home" })).toBeVisible();
      await axeIn(page, theme, "lesson path");

      await open(page, "veteran-builder", "map");
      await expectScreen(page, "map");
      await axeIn(page, theme, "world map, all open");

      await open(page, "fresh-sprout", "lessonIntro", "&lesson=meadow-02");
      await expectScreen(page, "lessonIntro");
      await axeIn(page, theme, "lesson intro");

      await open(page, "veteran-builder", "achievements");
      await expectScreen(page, "achievements");
      await axeIn(page, theme, "my badges");

      // My Blocks (M4-09) took the last route the coming-soon panel stood in for; no route
      // shows that panel now (the unit test in screens.test.tsx still checks it).
      await open(page, "collector-miner", "inventory");
      await expectScreen(page, "inventory");
      await expect(page.getByRole("heading", { name: "My Blocks" })).toBeVisible();
      await axeIn(page, theme, "my blocks");
      await open(page, "fresh-sprout", "inventory");
      await expectScreen(page, "inventory");
      await axeIn(page, theme, "my blocks, nothing found yet");

      await open(page, "fresh-sprout", "privacy");
      await expectScreen(page, "privacy");
      await axeIn(page, theme, "privacy");
      expect(errors).toEqual([]);
    });

    test("settings: every tab, the gate, the grown-ups tab and the delete dialog", async ({
      page,
    }) => {
      test.slow();
      const errors = collectErrors(page);
      await open(page, "fresh-sprout", "settings");
      await expectScreen(page, "settings");
      const play = page.getByRole("tab", { name: "Play" });
      await expect(play).toBeFocused();
      await axeIn(page, theme, "settings: play");
      for (const tab of ["Look", "Sound", "Grown-ups"]) {
        await page.keyboard.press("ArrowRight");
        await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
        await axeIn(page, theme, `settings: ${tab.toLowerCase()}`);
      }
      await expect(page.getByText("Grown-ups only")).toBeVisible();
      await passGate(page);
      const remove = page.getByRole("button", { name: "Delete Pip" });
      await expect(remove).toBeVisible();
      await axeIn(page, theme, "settings: grown-ups, open");

      await tabTo(page, remove);
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await axeIn(page, theme, "settings: delete dialog");
      // Escape closes it and deletes nothing.
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(remove).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("a lesson's pause overlay and Results", async ({ page }) => {
      test.slow();
      const errors = collectErrors(page);
      await open(page, "fresh-sprout", "play", "&lesson=meadow-01");
      await waitForLesson(page);
      let paused = false;
      await playLesson(page, { wpm: 40, errorRate: 0, seed: 5 }, async (i) => {
        if (i !== 4 || paused) return;
        paused = true;
        await page.keyboard.press("Escape");
        const dialog = page.getByRole("dialog", { name: "Paused" });
        await expect(dialog).toBeVisible();
        await axeIn(page, theme, "pause");
        await expect(page.getByRole("button", { name: "Keep playing" })).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(dialog).toHaveCount(0);
      });
      expect(paused).toBe(true);
      await expectScreen(page, "results");
      await expect(page.getByRole("heading", { name: "Lesson done!" })).toBeVisible();
      // The stars and loot fill in, and any badge toast pops in, before axe looks.
      await page.waitForTimeout(RESULTS_ARM_MS + 2500);
      await axeIn(page, theme, "results");
      expect(errors).toEqual([]);
    });
  });
}

test("the theme copy matches what the app itself puts on the page", async ({ page }) => {
  // Day from the app, then the copied day theme: every color token the same.
  await open(page, "fresh-sprout", "map");
  const read = (): Promise<Record<string, string>> =>
    page.evaluate(() => {
      const el = document.documentElement;
      const out: Record<string, string> = {};
      for (const name of Array.from(el.style)) {
        if (name.startsWith("--c-")) out[name] = el.style.getPropertyValue(name);
      }
      return out;
    });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
  const app = await read();
  expect(Object.keys(app).length).toBeGreaterThan(20);
  await axeIn(page, "day", "world map");
  expect(await read()).toEqual(app);
});
