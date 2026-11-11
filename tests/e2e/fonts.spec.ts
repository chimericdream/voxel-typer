import { expect, test } from "@playwright/test";

/**
 * M2-08: every font is self-hosted. The page loads each face, and request interception proves
 * that no request (font or otherwise) leaves the app's own origin.
 */
const FACES = [
  { family: "Pixelify Sans", weight: 400, file: "/fonts/PixelifySans-wght.woff2" },
  { family: "Pixelify Sans", weight: 700, file: "/fonts/PixelifySans-wght.woff2" },
  {
    family: "Atkinson Hyperlegible",
    weight: 400,
    file: "/fonts/AtkinsonHyperlegible-Regular.woff2",
  },
  { family: "Atkinson Hyperlegible", weight: 700, file: "/fonts/AtkinsonHyperlegible-Bold.woff2" },
  { family: "OpenDyslexic", weight: 400, file: "/fonts/OpenDyslexic-Regular.woff2" },
  { family: "OpenDyslexic", weight: 700, file: "/fonts/OpenDyslexic-Bold.woff2" },
] as const;

test("fonts load from the app's origin and nothing goes off-origin", async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1:4173").origin;
  const offOrigin: string[] = [];
  const fontRequests: string[] = [];

  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.resourceType() === "font" || /\.(woff2?|ttf|otf)(\?|$)/.test(url)) {
      fontRequests.push(url);
    }
    if (/^(data|blob):/.test(url) || new URL(url).origin === origin) {
      await route.continue();
    } else {
      offOrigin.push(url);
      await route.abort("blockedbyclient");
    }
  });

  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "1");

  for (const face of FACES) {
    const loaded = await page.evaluate(
      async ({ family, weight }) => {
        const faces = await document.fonts.load(`${weight} 24px "${family}"`, "adbqlI1");
        return faces.length > 0 && document.fonts.check(`${weight} 24px "${family}"`, "adbqlI1");
      },
      { family: face.family, weight: face.weight },
    );
    expect(loaded, `${face.family} ${face.weight}`).toBe(true);
  }

  const paths = new Set(fontRequests.map((u) => new URL(u).pathname));
  for (const face of FACES) expect(paths).toContain(face.file);
  for (const u of fontRequests) expect(new URL(u).origin).toBe(origin);
  expect(offOrigin).toEqual([]);
});

test("each font file is served as WOFF2", async ({ request }) => {
  for (const file of new Set(FACES.map((f) => f.file))) {
    const res = await request.get(file);
    expect(res.status(), file).toBe(200);
    const magic = (await res.body()).subarray(0, 4).toString("latin1");
    expect(magic, file).toBe("wOF2");
  }
});
