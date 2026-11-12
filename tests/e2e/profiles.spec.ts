/**
 * Profiles in a real browser (task M3-09): each card shows a still 3D render of the voxel avatar,
 * drawn with the app's one shared renderer (no second WebGL context), plus axe on the screen and
 * its change dialog, and a screenshot baseline (compared on CI's Linux runner only).
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expectNoAxeViolations, expectScreen } from "./helpers/slice";
import { collectErrors } from "./helpers/vt";

/** Counts WebGL contexts made, before any page script runs. */
async function countContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counts = { contexts: 0 };
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
  });
}

const contexts = (page: Page): Promise<number> =>
  page.evaluate(() => Number(Reflect.get(Reflect.get(window, "vtGl") ?? {}, "contexts") ?? 0));

test("profile cards show the 3D avatar from the shared renderer", async ({ page }) => {
  const errors = collectErrors(page);
  await countContexts(page);
  await page.goto("/?profile=fresh-sprout&screen=profiles&freeze=1");
  await expectScreen(page, "profiles");
  const img = page.locator('li button img[data-avatar="3d"]');
  await expect(img).toHaveCount(1);
  // The snapshot is a real picture: opaque in the middle (the face), clear in a top corner.
  const alpha = await img.evaluate((el) => {
    if (!(el instanceof HTMLImageElement)) return null;
    const c = document.createElement("canvas");
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(el, 0, 0);
    const at = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3] ?? -1;
    return { w: el.naturalWidth, mid: at(c.width / 2, c.height / 2), corner: at(1, 1) };
  });
  expect(alpha).toEqual({ w: 160, mid: 255, corner: 0 });
  expect(await contexts(page)).toBe(1);
  await expectNoAxeViolations(page, "profiles");
  await expect(page).toHaveScreenshot("profiles-cards.png");
  expect(errors).toEqual([]);
});

test("change dialog: keyboard only, axe clean, the grown-up check comes first", async ({
  page,
}) => {
  await page.goto("/?profile=fresh-sprout&screen=profiles&freeze=1");
  await expectScreen(page, "profiles");
  await page.getByRole("button", { name: "Change a player" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pick a player to change");
  await expect(page.locator("li button")).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "New name" })).toBeFocused();
  await expectNoAxeViolations(page, "profiles change dialog");
  await page.keyboard.press("Enter");
  // The parent gate (M3-08) opens inside the dialog, its word field focused.
  await expect(dialog.getByLabel("Type the word")).toBeFocused();
  await expect(dialog.locator("[data-gate-word]")).toHaveText(/^[a-z]{6,8}$/);
  await expectNoAxeViolations(page, "profiles parent gate");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("li button")).toBeFocused();
});
