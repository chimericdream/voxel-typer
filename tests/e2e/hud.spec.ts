import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// The in-play HUD (M2-14) on its developer page, over a stand-in sky. Axe and a screenshot baseline
// per theme, with all four marks on screen. At text scale 2 the HUD with keyboard and hands must
// fit 1280×720 and 1024×720 without scrolling.
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
  await page.goto(`/hud.html?${query}`);
  await expect(page.locator("#hud")).toHaveAttribute("data-ready", "1");
}

for (const theme of THEMES) {
  test(`hud, ${theme} theme`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // salad: s ok, a fixed, l wrong (the cursor stays on it), a d pending, then the space.
    await open(page, `theme=${theme}&words=salad&marks=ofwppp&banner=1&band=miner`);
    const word = page.getByRole("img", { name: "Type: salad, then space" });
    await expect(word).toBeVisible();
    const marks = await word
      .locator("span")
      .evaluateAll((els) => els.map((e) => `${e.dataset["mark"]}${e.dataset["next"] ? "*" : ""}`));
    expect(marks).toEqual(["ok", "fixed", "wrong*", "pending", "pending", "pending"]);
    await expect(page.getByText("0:42")).toBeVisible();
    expect(errors).toEqual([]);

    const axe = await new AxeBuilder({ page }).analyze();
    expect(
      axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    ).toEqual([]);

    await expect(page).toHaveScreenshot(`hud-${theme}.png`);
  });
}

test("wrong char: wavy underline and a pattern, not color alone; no animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page, "words=salad&marks=ofwppp&motion=full");
  const styleOf = (i: number) =>
    page
      .getByRole("img", { name: /Type: salad/ })
      .locator("span")
      .nth(i)
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          line: s.textDecorationLine,
          style: s.textDecorationStyle,
          pattern: s.backgroundImage.includes("repeating-linear-gradient"),
          animation: s.animationName,
        };
      });
  expect(await styleOf(0)).toMatchObject({ line: "none", pattern: false });
  expect(await styleOf(1)).toMatchObject({ line: "underline", style: "dotted" });
  // The wrong char is also the next one here: it bobs (the cursor), but the mark itself is static.
  expect(await styleOf(2)).toMatchObject({ line: "underline", style: "wavy", pattern: true });
  expect(await styleOf(3)).toMatchObject({ line: "none", pattern: false, animation: "none" });
});

test("next char bobs with motion on and keeps a static cue under reduced motion", async ({
  page,
}) => {
  const next = () => page.locator("[data-next='1']");
  await open(page, "words=salad&motion=full");
  const full = await next().evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, duration: s.animationDuration };
  });
  expect(full.name).not.toBe("none");
  expect(full.duration).not.toBe("0s");

  await open(page, "words=salad&motion=reduced");
  const reduced = await next().evaluate((el) => {
    const s = getComputedStyle(el);
    const bar = getComputedStyle(el, "::after");
    return {
      duration: s.animationDuration,
      translate: s.translate,
      barHeight: Number.parseFloat(bar.height),
      tint: s.backgroundColor,
    };
  });
  expect(reduced.duration).toBe("0s");
  expect(["none", "0px"]).toContain(reduced.translate);
  expect(reduced.barHeight).toBeGreaterThanOrEqual(4);
  expect(reduced.tint).not.toBe("rgba(0, 0, 0, 0)");
});

test("typing: right keys advance, a wrong key marks the char and wobbles its key once", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "words=fj,jaf");
  await expect(page.getByRole("img", { name: "Type: fj" })).toBeVisible();
  await page.keyboard.press("f");
  await page.keyboard.press("k");
  const word = page.getByRole("img", { name: "Type: fj" });
  await expect(word.locator("span").nth(1)).toHaveAttribute("data-mark", "wrong");
  await expect(page.locator('[data-code="KeyK"]')).toHaveAttribute("data-wobble", "1");
  await page.keyboard.press("j");
  await expect(word.locator("span").nth(1)).toHaveAttribute("data-mark", "fixed");
  await page.keyboard.press(" ");
  await expect(page.getByRole("img", { name: "Type: jaf" })).toBeVisible();
});

test("Caps Lock hint wins over the banner; no timer for Sprout", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "band=sprout&caps=1&banner=1");
  // Scoped to the HUD: the hint is also read out through the toast live region (M3-FIX-4), so a
  // page-wide text match can find two elements, depending on timing.
  await expect(
    page.locator("#hud").getByText("Caps Lock is on! Tap it to turn it off."),
  ).toBeVisible();
  await expect(page.locator("output")).toHaveCount(1);
  await expect(page.getByText("0:42")).toHaveCount(0);
});

for (const width of [1280, 1024]) {
  for (const band of ["sprout", "miner"] as const) {
    test(`text scale 2, ${band}: the HUD fits ${width}×720 without scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page, `scale=2&band=${band}&words=salad&caps=1`);
      const fit = await page.evaluate(() => {
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- reason: runs in the page, where the test module scope is not visible
        const rect = (el: Element | null | undefined) => {
          const r = el?.getBoundingClientRect();
          return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
        };
        const board = document.querySelector("[data-layout]");
        return {
          scrollH: document.documentElement.scrollHeight,
          scrollW: document.documentElement.scrollWidth,
          progress: rect(document.querySelector('[role="progressbar"]')),
          combo: rect(document.querySelector('[role="group"]')),
          word: rect(document.querySelector('[role="img"][aria-label^="Type"]')?.parentElement),
          message: rect(document.querySelector("output")),
          frame: rect(board?.parentElement),
          caption: rect(board?.parentElement?.querySelector("p")),
        };
      });
      expect(fit.scrollH).toBeLessThanOrEqual(720);
      expect(fit.scrollW).toBeLessThanOrEqual(width);
      const parts = [fit.progress, fit.combo, fit.word, fit.message, fit.frame];
      for (const r of parts) {
        expect(r).not.toBeNull();
        if (!r) continue;
        expect(r.top).toBeGreaterThanOrEqual(0);
        expect(r.bottom).toBeLessThanOrEqual(720);
        expect(r.left).toBeGreaterThanOrEqual(0);
        expect(r.right).toBeLessThanOrEqual(width);
      }
      if (band === "sprout") expect(fit.caption?.bottom ?? Infinity).toBeLessThanOrEqual(720);
      // Stacked top to bottom, never overlapping: top row, word, message, keyboard.
      const top = Math.max(fit.progress?.bottom ?? 0, fit.combo?.bottom ?? 0);
      expect(fit.word?.top ?? 0).toBeGreaterThanOrEqual(top);
      expect(fit.message?.top ?? 0).toBeGreaterThanOrEqual(fit.word?.bottom ?? Infinity);
      expect(fit.frame?.top ?? 0).toBeGreaterThanOrEqual(fit.message?.bottom ?? Infinity);
    });
  }
}
