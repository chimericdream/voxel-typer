/**
 * Sprout's finger labels on the on-screen keyboard (task M3-FIX-12), in Mine and in Night Defense,
 * which share the keyboard, at 1024×600 and 1280×720: every label that shows is at least 12 px,
 * inside its own key, and clear of every other label. The hint line still names the finger.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, ready } from "./helpers/vt";

interface LabelCheck {
  shown: number;
  hidden: number;
  small: string[];
  outside: string[];
  overlaps: string[];
}

/** Every finger label the keyboard shows right now. */
async function labels(page: Page): Promise<LabelCheck> {
  return page.evaluate(() => {
    const out: LabelCheck = { shown: 0, hidden: 0, small: [], outside: [], overlaps: [] };
    const seen: { code: string; r: DOMRect }[] = [];
    for (const slot of document.querySelectorAll('[data-hud="keyboard"] [data-code]')) {
      const label = slot.querySelector("[data-finger-label]");
      const text = label?.firstElementChild;
      if (!label || !text) continue;
      if (getComputedStyle(label).visibility !== "visible") {
        out.hidden++;
        continue;
      }
      out.shown++;
      const code = slot.getAttribute("data-code") ?? "?";
      if (Number.parseFloat(getComputedStyle(text).fontSize) < 12) out.small.push(code);
      const r = text.getBoundingClientRect();
      const k = slot.getBoundingClientRect();
      if (r.left < k.left - 0.5 || r.right > k.right + 0.5) out.outside.push(code);
      for (const o of seen) {
        const hit =
          r.left < o.r.right - 0.5 &&
          o.r.left < r.right - 0.5 &&
          r.top < o.r.bottom - 0.5 &&
          o.r.top < r.bottom - 0.5;
        if (hit) out.overlaps.push(`${o.code}/${code}`);
      }
      seen.push({ code, r });
    }
    return out;
  });
}

const MODES = [
  { name: "Mine", lesson: "meadow-01" },
  { name: "Night Defense", lesson: "birch-08" },
] as const;

for (const mode of MODES) {
  for (const view of [
    { width: 1024, height: 600 },
    { width: 1280, height: 720 },
  ]) {
    test(`${mode.name}, Sprout, ${view.width}×${view.height}: finger labels are 12 px or hidden`, async ({
      page,
    }) => {
      test.slow();
      await page.setViewportSize(view);
      await page.emulateMedia({ reducedMotion: "reduce" });
      const errors = collectErrors(page);
      await page.goto(`/?profile=fresh-sprout&screen=play&lesson=${mode.lesson}&seed=1&nosave=1`);
      await ready(page);
      const keys = page.locator('[data-hud="keyboard"]');
      await expect(keys.locator("[data-code]").first()).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      // The hint line names the finger, whatever the labels do.
      await expect(keys.getByText(/^Use your /)).toBeVisible({ timeout: 30_000 });

      const check = await labels(page);
      expect(check.shown + check.hidden).toBeGreaterThan(40);
      expect(check.small, "labels under 12 px").toEqual([]);
      expect(check.outside, "labels wider than their key").toEqual([]);
      expect(check.overlaps, "labels that run into each other").toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
