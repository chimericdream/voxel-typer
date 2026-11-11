import { expect, test } from "@playwright/test";

// The atlas preview (M1-14) is a developer page in the e2e build. Its screenshot is the visual
// baseline for the procedural textures: it changes whenever a painter, palette or sample changes.
test("atlas preview at seed 1", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/atlas.html?seed=1");
  const root = page.locator("#atlas");
  await expect(root).toHaveAttribute("data-ready", "1");
  expect(errors).toEqual([]);

  const tiles = Number(await root.getAttribute("data-tiles"));
  expect(tiles).toBeGreaterThan(1);
  // One card per tile, plus 10 crack stages.
  await expect(page.locator("figure.card")).toHaveCount(tiles + 10);

  // The 8× tiles are hard-edged: every 8×8 block of a zoomed tile is one color.
  const blurred = await page.evaluate(() => {
    let bad = 0;
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>("canvas.tile")) {
      const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!data) return -1;
      for (let i = 0; i < data.length; i += 4) {
        const p = i / 4;
        const x = p % canvas.width;
        const y = Math.floor(p / canvas.width);
        const j = ((y - (y % 8)) * canvas.width + (x - (x % 8))) * 4;
        if (data[i] !== data[j] || data[i + 3] !== data[j + 3]) bad++;
      }
    }
    return bad;
  });
  expect(blurred).toBe(0);

  await expect(page).toHaveScreenshot("atlas.png", { fullPage: true });
});
