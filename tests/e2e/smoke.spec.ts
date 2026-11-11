import { expect, test } from "@playwright/test";

test("loads / and mounts #app", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");
  const app = page.locator("#app");
  await expect(app).toBeAttached();
  await expect(app).toHaveAttribute("data-ready", "1");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(errors).toEqual([]);
});
