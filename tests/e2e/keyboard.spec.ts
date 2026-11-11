import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// The on-screen keyboard preview (M2-09) is a developer page in the e2e build. Each theme is checked
// with axe and kept as a screenshot baseline (next key Shift+F, so the right Shift lights too, and
// finger labels on). Text scale 2 must not overflow at 1280 or 1024 px.
const THEMES = ["day", "night", "contrast"] as const;

test.use({ colorScheme: "light" });

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/keyboard.html?${query}`);
  await expect(page.locator("#keyboard")).toHaveAttribute("data-ready", "1");
}

for (const theme of THEMES) {
  test(`keyboard, ${theme} theme`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, `theme=${theme}&next=F&labels=1`);
    await expect(page.locator(`[data-theme="${theme}"]`)).toHaveCount(1);

    await expect(page.locator('[data-next="key"]')).toHaveAttribute("data-code", "KeyF");
    await expect(page.locator('[data-next="shift"]')).toHaveAttribute("data-code", "ShiftRight");
    await expect(page.getByRole("img", { name: /Next key: F/ })).toBeVisible();
    expect(errors).toEqual([]);

    const axe = await new AxeBuilder({ page }).analyze();
    expect(
      axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    ).toEqual([]);

    await expect(page).toHaveScreenshot(`keyboard-${theme}.png`);
  });
}

test("keyboard, en-GB layout", async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "layout=en-GB&next=@");
  await expect(page.locator('[data-next="key"]')).toHaveAttribute("data-code", "Quote");
  await expect(page.locator('[data-next="shift"]')).toHaveAttribute("data-code", "ShiftLeft");
  await expect(page.locator('[data-code="Enter"]')).toHaveCount(2);
  await expect(page.locator('[data-code="IntlBackslash"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

for (const width of [1280, 1024]) {
  test(`keyboard at text scale 2 fits ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "scale=2&next=F&labels=1");
    const fit = await page.evaluate(() => {
      const frame = document.querySelector("[data-layout]")?.parentElement;
      const box = frame?.getBoundingClientRect();
      const glyphs = [...document.querySelectorAll<HTMLElement>("[data-code] > kbd > span")];
      // Each glyph's box stays inside its key's box, both ways. (Not scrollWidth: the lit keys'
      // ring is a pseudo-element over the bevel border, which counts as scroll overflow.)
      const outside = (axis: "x" | "y") =>
        glyphs
          .filter((g) => {
            const kbd = g.parentElement?.getBoundingClientRect();
            const r = g.getBoundingClientRect();
            if (!kbd) return true;
            return axis === "x"
              ? r.left < kbd.left - 1 || r.right > kbd.right + 1
              : r.top < kbd.top - 1 || r.bottom > kbd.bottom + 1;
          })
          .map((g) => g.parentElement?.parentElement?.dataset["code"]);
      const overflowing = outside("y");
      const wide = outside("x");
      const caption = document.querySelector("p:last-of-type")?.getBoundingClientRect();
      return {
        pageWider: document.documentElement.scrollWidth > window.innerWidth,
        frameLeft: box?.left ?? -1,
        frameRight: box?.right ?? Infinity,
        captionRight: caption?.right ?? 0,
        overflowing,
        wide,
      };
    });
    expect(fit.pageWider).toBe(false);
    expect(fit.frameLeft).toBeGreaterThanOrEqual(0);
    expect(fit.frameRight).toBeLessThanOrEqual(width);
    expect(fit.captionRight).toBeLessThanOrEqual(width);
    expect(fit.overflowing).toEqual([]);
    expect(fit.wide).toEqual([]);
  });
}

test("wrong key: an outline only under reduced motion, a wobble with motion on", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "next=f");
  const k = page.locator('[data-code="KeyK"]');
  await page.keyboard.press("k");
  await expect(k).toHaveAttribute("data-wobble", "1");
  const reduced = await k.locator("kbd").evaluate((el) => {
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle, duration: s.animationDuration };
  });
  expect(reduced).toEqual({ outline: "dashed", duration: "0s" });
  await expect(k).not.toHaveAttribute("data-wobble", "1");

  await open(page, "next=f&motion=full");
  await page.keyboard.press("k");
  await expect(k).toHaveAttribute("data-wobble", "1");
  const full = await k.locator("kbd").evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, duration: s.animationDuration };
  });
  // CSS modules hash the keyframes name (`_wobble_<hash>`).
  expect(full.name).toMatch(/wobble/);
  expect(full.duration).toBe("0.42s");
});
