import { expect, test } from "@playwright/test";

interface PixelStats {
  width: number;
  height: number;
  background: number[];
  cubePixels: number;
  distinctCubeColors: number;
  equalPairs: number;
  sharpPairs: number;
  softPairs: number;
}

// Neighbouring cube pixels must be identical (same texel, max channel diff <= EQUAL)
// or differ sharply (texel edge, >= SHARP). Anything in between is blur.
const EQUAL = 2;
const SHARP = 24;

test("hello voxel: frozen cube with hard texel edges", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/?freeze=1&seed=1");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "1");
  const canvas = page.locator("#app canvas");
  await expect(canvas).toBeVisible();

  const stats = await page.evaluate(
    ({ equal, sharp }): PixelStats => {
      const gl = document.querySelector("#app canvas");
      if (!(gl instanceof HTMLCanvasElement)) throw new Error("no canvas");
      const { width, height } = gl;
      const c2d = document.createElement("canvas");
      c2d.width = width;
      c2d.height = height;
      const ctx = c2d.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(gl, 0, 0);
      const px = ctx.getImageData(0, 0, width, height).data;
      const at = (x: number, y: number): number => (y * width + x) * 4;
      const bg = [px[0] ?? 0, px[1] ?? 0, px[2] ?? 0];
      const diff = (i: number, j: number): number =>
        Math.max(
          Math.abs((px[i] ?? 0) - (px[j] ?? 0)),
          Math.abs((px[i + 1] ?? 0) - (px[j + 1] ?? 0)),
          Math.abs((px[i + 2] ?? 0) - (px[j + 2] ?? 0)),
        );
      const isCube = (i: number): boolean =>
        Math.max(
          Math.abs((px[i] ?? 0) - (bg[0] ?? 0)),
          Math.abs((px[i + 1] ?? 0) - (bg[1] ?? 0)),
          Math.abs((px[i + 2] ?? 0) - (bg[2] ?? 0)),
        ) > 30;

      let cubePixels = 0;
      let equalPairs = 0;
      let sharpPairs = 0;
      let softPairs = 0;
      const colors = new Set<number>();
      const pair = (i: number, j: number): void => {
        if (!isCube(j)) return;
        const d = diff(i, j);
        if (d <= equal) equalPairs++;
        else if (d >= sharp) sharpPairs++;
        else softPairs++;
      };
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = at(x, y);
          if (!isCube(i)) continue;
          cubePixels++;
          colors.add(((px[i] ?? 0) << 16) | ((px[i + 1] ?? 0) << 8) | (px[i + 2] ?? 0));
          if (x + 1 < width) pair(i, at(x + 1, y));
          if (y + 1 < height) pair(i, at(x, y + 1));
        }
      }
      return {
        width,
        height,
        background: bg,
        cubePixels,
        distinctCubeColors: colors.size,
        equalPairs,
        sharpPairs,
        softPairs,
      };
    },
    { equal: EQUAL, sharp: SHARP },
  );

  console.log("hello-voxel pixel stats", JSON.stringify(stats));

  // Sky-blue background (#87ceeb), within rounding.
  expect(stats.background[0]).toBeCloseTo(135, -1);
  expect(stats.background[1]).toBeCloseTo(206, -1);
  expect(stats.background[2]).toBeCloseTo(235, -1);
  // The cube fills a good part of the frame.
  expect(stats.cubePixels).toBeGreaterThan(stats.width * stats.height * 0.1);
  // 2 tones × 3 visible faces. Any texture filtering would create hundreds of in-between colors.
  expect(stats.distinctCubeColors).toBeLessThanOrEqual(12);
  const pairs = stats.equalPairs + stats.sharpPairs + stats.softPairs;
  // Most neighbours sit inside one texel and are identical...
  expect(stats.equalPairs / pairs).toBeGreaterThan(0.85);
  // ...there are plenty of texel edges...
  expect(stats.sharpPairs).toBeGreaterThan(1000);
  // ...and almost nothing in between (only the lines where two faces meet).
  expect(stats.softPairs / pairs).toBeLessThan(0.01);

  await expect(page).toHaveScreenshot("hello-voxel.png");
  expect(errors).toEqual([]);
});
