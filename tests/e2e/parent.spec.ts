/**
 * The Parent Dashboard in a real browser (task M3-11):
 * - behind the parent gate on a direct visit, and reachable from Settings → Grown-ups;
 * - charts from the `veteran-builder` fixture, at 1280×720, at 1024×600 with text scale 2, and
 *   with strong colors (screenshot baselines, made on CI's Linux runner only by the Update
 *   snapshots workflow); an empty profile shows friendly empty states;
 * - axe is clean, nothing runs off the side, and "Download CSV" is a local file whose numbers are
 *   the ones on the page. No request leaves the page's own origin.
 *
 * The clock is pinned (2026-12-10 noon, UTC) so "the last 28 days" is the same on every run.
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { parseCsv } from "../../src/app/csv";
import { expectNoAxeViolations, expectScreen } from "./helpers/slice";
import { collectErrors, ready } from "./helpers/vt";

const NOW = new Date("2026-12-10T12:00:00Z");

test.use({ timezoneId: "UTC", colorScheme: "light" });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function open(page: Page, profile: string, screen: string): Promise<string[]> {
  const errors = collectErrors(page);
  await page.goto(`/?profile=${profile}&screen=${screen}&seed=1&freeze=1`, {
    waitUntil: "domcontentloaded",
  });
  await ready(page);
  return errors;
}

async function passGate(page: Page): Promise<void> {
  const word = (await page.locator("[data-gate-word]").textContent())?.trim() ?? "";
  await page.getByLabel("Type the word").fill(word);
  await page.keyboard.press("Enter");
}

async function setSlider(page: Page, label: string, value: number): Promise<void> {
  await page.getByLabel(label, { exact: true }).evaluate((el, v) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("not a slider");
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/** Settings → Look (size, strong colors) → Grown-ups → gate → "See … progress". */
async function viaSettings(page: Page, look: { scale: number; contrast?: boolean }): Promise<void> {
  await expectScreen(page, "settings");
  await page.getByRole("tab", { name: "Look" }).click();
  await setSlider(page, "Letter size", look.scale);
  if (look.contrast === true) {
    await page.getByRole("switch", { name: "Strong colors" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
  }
  await page.getByRole("tab", { name: "Grown-ups" }).click();
  await passGate(page);
  await page.getByRole("button", { name: /^See .+'s progress$/ }).click();
  await expectScreen(page, "parent");
  await expect(page.locator("[data-gate]")).toHaveCount(0);
}

/**
 * A panel taller than the window can't be shot whole inside the page's scroll area, so panel
 * shots use a tall window of the same width (panels don't depend on the window's height).
 */
async function tall(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 1280;
  await page.setViewportSize({ width, height: 2000 });
  await still(page);
}

async function still(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
}

/** Nothing on the dashboard is wider than the window. */
async function expectNoSideScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-parent] *")]
      .filter((el) => el.getBoundingClientRect().right > vw + 1)
      .map((el) => `${el.tagName}.${el.getAttribute("class") ?? ""}`)
      .slice(0, 5);
  });
  expect(over).toEqual([]);
}

test.describe("Parent Dashboard", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("a direct visit asks the gate; the charts draw from the fixture", async ({ page }) => {
    const errors = await open(page, "veteran-builder", "parent");
    await expect(page.locator("[data-gate='parentDashboard']")).toBeVisible();
    await expect(page.locator("[data-parent]")).toHaveCount(0);
    await passGate(page);
    await expect(page.getByRole("heading", { name: "Captain Quill's progress" })).toBeVisible();
    for (const id of ["speed-recent", "accuracy-recent", "minutes", "keys"]) {
      await expect(page.locator(`[data-chart='${id}'] svg[role='img']`)).toBeVisible();
    }
    await expectNoSideScroll(page);
    await expectNoAxeViolations(page, "parent dashboard");
    await still(page);
    await expect(page).toHaveScreenshot("parent-1280.png", { timeout: 30_000 });
    await tall(page);
    const panels = page.locator("[data-parent] section");
    for (const [i, name] of ["trend", "minutes", "keys", "pairs", "lessons"].entries()) {
      await expect(panels.nth(i)).toHaveScreenshot(`parent-1280-${name}.png`, { timeout: 30_000 });
    }
    expect(errors).toEqual([]);
  });

  test("the CSV is a local file with the numbers on the page", async ({ page }) => {
    const outside: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (!["http:", "https:"].includes(url.protocol)) return;
      if (url.origin !== new URL(page.url() || "http://localhost").origin) outside.push(r.url());
    });
    const errors = await open(page, "veteran-builder", "parent");
    await passGate(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("voxel-typer-sessions-captain-quill-2026-12-10.csv");
    const path = await download.path();
    const csv = parseCsv(await readFile(path, "utf8"));
    expect(csv[0]).toEqual([
      "Player",
      "Date",
      "Time",
      "Activity",
      "Minutes",
      "Speed (WPM)",
      "Accuracy (%)",
    ]);
    const rows = await page.locator("[data-sessions] tbody tr").all();
    const last = csv.slice(-rows.length).toReversed();
    for (const [i, row] of rows.entries()) {
      const cells = await row.locator("th, td").allTextContents();
      const [player, , time, activity, minutes, wpm, accuracy] = last[i] ?? [];
      expect(player).toBe("Captain Quill");
      expect(cells[0]).toContain(time);
      expect(cells.slice(1)).toEqual([activity, minutes, wpm, `${accuracy}%`]);
    }
    expect(outside).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("an empty profile gets friendly empty states", async ({ page }) => {
    const errors = await open(page, "fresh-sprout", "parent");
    await passGate(page);
    for (const id of ["trend", "minutes", "keys", "sessions"]) {
      await expect(page.locator(`[data-empty='${id}']`)).toBeVisible();
    }
    await expectNoAxeViolations(page, "parent dashboard, empty");
    await still(page);
    await expect(page).toHaveScreenshot("parent-empty.png", { timeout: 30_000 });
    expect(errors).toEqual([]);
  });
});

test.describe("Parent Dashboard at text scale 2", () => {
  test("1024×600: one column, nothing runs off the side", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    const errors = await open(page, "veteran-builder", "settings");
    await viaSettings(page, { scale: 2 });
    await expectNoSideScroll(page);
    await expectNoAxeViolations(page, "parent dashboard, text scale 2");
    await still(page);
    await expect(page).toHaveScreenshot("parent-1024x600-scale2.png", { timeout: 30_000 });
    await tall(page);
    await expect(page.locator("[data-parent] section").nth(2)).toHaveScreenshot(
      "parent-1024x600-scale2-keys.png",
      { timeout: 30_000 },
    );
    expect(errors).toEqual([]);
  });

  test("strong colors: charts and the heat map still read", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const errors = await open(page, "veteran-builder", "settings");
    await viaSettings(page, { scale: 2, contrast: true });
    await expectNoSideScroll(page);
    await expectNoAxeViolations(page, "parent dashboard, strong colors");
    await tall(page);
    for (const [i, name] of ["trend", "minutes", "keys"].entries()) {
      await expect(page.locator("[data-parent] section").nth(i)).toHaveScreenshot(
        `parent-contrast-scale2-${name}.png`,
        { timeout: 30_000 },
      );
    }
    expect(errors).toEqual([]);
  });
});
