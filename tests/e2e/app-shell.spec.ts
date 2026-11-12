import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const NOT_AFFILIATED =
  "Voxel Typer is an independent game and is not affiliated with Mojang or Microsoft.";

/** Calls `window.__vt[name]()` in the page (awaiting promises) and returns the JSON result. */
async function vt(page: Page, name: string): Promise<unknown> {
  return page.evaluate(async (fn) => {
    const hooks: unknown = Reflect.get(window, "__vt");
    if (typeof hooks !== "object" || hooks === null) throw new Error("no test hooks");
    const method: unknown = Reflect.get(hooks, fn);
    if (typeof method !== "function") throw new Error(`no hook ${fn}`);
    const out: unknown = await Reflect.apply(method, hooks, []);
    return out ?? null;
  }, name);
}

test("splash: friendly panel, disclaimer footer, test hooks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "1");
  await vt(page, "ready");
  await expect(page.locator("footer")).toHaveText(NOT_AFFILIATED);
  await expect(page.locator("h1")).toHaveText("Voxel Typer");
  expect(await vt(page, "screen")).toBe("splash");
  expect(await vt(page, "profile")).toBeNull();
  expect(await vt(page, "lastResult")).toBeNull();
  expect(await vt(page, "drawCalls")).toBeNull();
  // The shared canvas exists but stays hidden outside play.
  await expect(page.locator("canvas.vt-stage")).toBeHidden();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("deep links, fixture profiles, and the footer on privacy only", async ({ page }) => {
  await page.goto("/?profile=fresh-sprout&screen=privacy", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "1");
  await expect(page.locator("footer")).toHaveText(NOT_AFFILIATED);
  expect(await vt(page, "profile")).toMatchObject({ name: "Pip", ageBand: "sprout" });

  await page.goto("/?screen=map", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "1");
  expect(await vt(page, "screen")).toBe("map");
  await expect(page.locator("footer")).toHaveCount(0);
  // Escape in a menu goes back (here, with no history: to splash).
  await page.keyboard.press("Escape");
  await expect.poll(() => vt(page, "screen")).toBe("splash");
});
