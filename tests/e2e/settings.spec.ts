/**
 * Settings and the parent gate in a real browser (task M3-08):
 * - every setting survives a reload (real IndexedDB, so no `?nosave` or `?profile`);
 * - the Grown-ups tab and its danger zone need the gate word;
 * - axe is clean on each tab and on the gate.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expectNoAxeViolations, expectScreen } from "./helpers/slice";
import { collectErrors, ready, vt } from "./helpers/vt";

/** Splash → New player → name → Skip the placement test → the world map. */
async function newPlayerToMap(page: Page, name: string): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.keyboard.press("k");
  await expectScreen(page, "profileCreate");
  await page.getByRole("textbox").fill(name);
  await page.keyboard.press("Enter");
  await expectScreen(page, "placement");
  await page.getByRole("button", { name: "Skip" }).click();
  await expectScreen(page, "map");
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expectScreen(page, "settings");
}

async function setSlider(page: Page, label: string, value: number): Promise<void> {
  await page.getByLabel(label, { exact: true }).evaluate((el, v) => {
    if (!(el instanceof HTMLInputElement)) throw new Error("not a slider");
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function settings(page: Page): Promise<Record<string, unknown>> {
  const p = await vt(page, "profile");
  if (typeof p !== "object" || p === null) throw new Error("no profile");
  const s: unknown = Reflect.get(p, "settings");
  if (typeof s !== "object" || s === null) throw new Error("no settings");
  return { ...s };
}

async function passGate(page: Page): Promise<void> {
  const word = (await page.locator("[data-gate-word]").textContent())?.trim() ?? "";
  expect(word).toMatch(/^[a-z]{6,8}$/);
  const field = page.getByLabel("Type the word");
  await expect(field).toBeFocused();
  await page.keyboard.type(word);
  await page.keyboard.press("Enter");
}

test("every setting survives a reload, and the look changes at once", async ({ page }) => {
  test.slow();
  const errors = collectErrors(page);
  await newPlayerToMap(page, "Juniper");
  await openSettings(page);
  // Keyboard first: Down from the selected tab reaches the first control.
  await page.getByRole("tab", { name: "Play" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("switch", { name: "Show the keyboard" })).toBeFocused();
  await expectNoAxeViolations(page, "settings: play");

  await page.getByRole("switch", { name: "Show the hands" }).click();
  await page.getByRole("switch", { name: "Finger names on the keys" }).click();
  await page.getByRole("radio", { name: "UK keyboard" }).check();
  await page.getByRole("switch", { name: /Calm mode/ }).click();
  await setSlider(page, "Break time", 20);

  await page.getByRole("tab", { name: "Look" }).click();
  await expectNoAxeViolations(page, "settings: look");
  const scale = (): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--text-scale").trim());
  const before = await scale();
  await setSlider(page, "Letter size", 2);
  await expect.poll(scale).not.toBe(before);
  await page.getByRole("radio", { name: "Easy read" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-font", "dyslexic");
  await page.getByRole("switch", { name: "Strong colors" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
  await page.getByRole("radio", { name: "Keep still" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.getByRole("radio", { name: "Fast" }).check();
  await expectNoAxeViolations(page, "settings: look, high contrast");

  await page.getByRole("tab", { name: "Sound" }).click();
  await expectNoAxeViolations(page, "settings: sound");
  await setSlider(page, "All sound", 60);
  await setSlider(page, "Music", 20);
  await setSlider(page, "Sounds", 40);
  await setSlider(page, "Voice", 90);
  await page.getByRole("switch", { name: "Read words out loud" }).click();

  const want = await settings(page);
  expect(want).toMatchObject({
    showHands: false,
    fingerLabels: false,
    layout: "en-GB",
    calmMode: false,
    breakReminderMin: 20,
    textScale: 2,
    font: "dyslexic",
    highContrast: true,
    reducedMotion: true,
    quality: "low",
    volume: { master: 0.6, music: 0.2, sfx: 0.4, voice: 0.9 },
    tts: false,
  });
  // Give IndexedDB's commit a moment.
  await page.waitForTimeout(500);

  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  await page.keyboard.press("Enter");
  await expectScreen(page, "profiles");
  await expect(page.getByRole("button", { name: /^Juniper/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expectScreen(page, "map");
  expect(await settings(page)).toEqual(want);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");

  await openSettings(page);
  await expect(page.getByRole("switch", { name: "Show the hands" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await page.getByRole("tab", { name: "Look" }).click();
  await expect(page.getByRole("radio", { name: "Easy read" })).toBeChecked();
  expect(errors).toEqual([]);
});

test("the danger zone needs the grown-up word", async ({ page }) => {
  test.slow();
  const errors = collectErrors(page);
  await newPlayerToMap(page, "Basil");
  await openSettings(page);
  await page.getByRole("tab", { name: "Grown-ups" }).click();

  // The gate, and nothing behind it yet.
  await expect(page.getByText("Grown-ups only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Basil" })).toHaveCount(0);
  await expectNoAxeViolations(page, "settings: parent gate");

  // A wrong word: a kind note, and still no danger zone.
  await page.keyboard.type("pebbles");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/That's not quite it/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Basil" })).toHaveCount(0);

  await passGate(page);
  const remove = page.getByRole("button", { name: "Delete Basil" });
  await expect(remove).toBeVisible();
  await expect(page.locator("[data-slot='import-export']")).toBeVisible();
  await expectNoAxeViolations(page, "settings: grown-ups");

  await remove.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectNoAxeViolations(page, "settings: delete confirm");
  await dialog.getByRole("button", { name: "Yes, delete" }).click();
  await expectScreen(page, "profiles");
  await expect(page.getByRole("button", { name: /^Basil/ })).toHaveCount(0);

  // Gone for good: after a reload, the first key goes to New player.
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  await page.keyboard.press("k");
  await expectScreen(page, "profileCreate");
  expect(errors).toEqual([]);
});
