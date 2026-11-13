/**
 * What a Sprout reads on the on-screen keyboard (task M3-FIX-13), in Mine and in Night Defense
 * (which keeps a short keyboard row on a short screen, M4-FIX-4), at 1024×600 and 1280×720 and at
 * text scale 1 and 2:
 * - every char printed on a key is at least 12 px and stays on its key;
 * - Backspace, Caps Lock, Tab, Enter and Shift show an icon of at least 14 px with the key's name;
 * - no key is under the 28-px floor.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, ready } from "./helpers/vt";

interface FaceCheck {
  keys: number;
  icons: number;
  small: string[];
  off: string[];
  badIcons: string[];
  tiny: string[];
}

/** Every key face the keyboard shows right now. */
async function faces(page: Page): Promise<FaceCheck> {
  return page.evaluate(() => {
    const out: FaceCheck = { keys: 0, icons: 0, small: [], off: [], badIcons: [], tiny: [] };
    for (const slot of document.querySelectorAll('[data-hud="keyboard"] [data-code]')) {
      const cap = slot.querySelector("kbd");
      const face = cap?.firstElementChild;
      if (!cap || !face) continue;
      out.keys++;
      const code = slot.getAttribute("data-code") ?? "?";
      const k = cap.getBoundingClientRect();
      if (slot.getBoundingClientRect().height < 27.5) out.tiny.push(code);
      const icon = face.querySelector("svg[data-key-icon]");
      if (icon) {
        out.icons++;
        const r = icon.getBoundingClientRect();
        const name = icon.getAttribute("aria-label") ?? "";
        if (r.width < 13.5 || r.height < 13.5 || name === "") out.badIcons.push(code);
        continue;
      }
      // Each shown char: its size, and its box inside the key cap.
      const walk = document.createTreeWalker(face, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
        const parent = n.parentElement;
        if (!parent || (n.textContent ?? "").trim() === "") continue;
        if (getComputedStyle(parent).display === "none") continue;
        if (Number.parseFloat(getComputedStyle(parent).fontSize) < 12) out.small.push(code);
        const range = document.createRange();
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        const outside =
          r.top < k.top - 0.5 ||
          r.bottom > k.bottom + 0.5 ||
          r.left < k.left - 0.5 ||
          r.right > k.right + 0.5;
        if (outside) out.off.push(code);
      }
    }
    return out;
  });
}

const MODES = [
  { name: "Mine", lesson: "meadow-01" },
  { name: "Night Defense", lesson: "birch-08" },
] as const;
const PROFILES = [
  { profile: "small-text-sprout", scale: 1 },
  { profile: "big-text-sprout", scale: 2 },
] as const;
const VIEWS = [
  { width: 1024, height: 600 },
  { width: 1280, height: 720 },
] as const;

for (const mode of MODES) {
  for (const p of PROFILES) {
    for (const view of VIEWS) {
      test(`${mode.name}, Sprout at text scale ${p.scale}, ${view.width}×${view.height}: key faces are 12 px or more`, async ({
        page,
      }) => {
        test.slow();
        await page.setViewportSize(view);
        await page.emulateMedia({ reducedMotion: "reduce" });
        const errors = collectErrors(page);
        await page.goto(`/?profile=${p.profile}&screen=play&lesson=${mode.lesson}&seed=1&nosave=1`);
        await ready(page);
        const keys = page.locator('[data-hud="keyboard"]');
        await expect(keys.locator("[data-code]").first()).toBeVisible({ timeout: 30_000 });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        // A night lights no key until a key moves the day along (finger-labels.spec does the same).
        if (mode.lesson === "birch-08") {
          const hint = keys.getByText(/^Use your /);
          await expect(async () => {
            await page.keyboard.press("f");
            await expect(hint).toBeVisible({ timeout: 1500 });
          }).toPass({ timeout: 90_000 });
        }
        await expect(keys.locator("[data-next]").first()).toBeVisible({ timeout: 30_000 });

        const check = await faces(page);
        expect(check.keys).toBeGreaterThan(40);
        // Backspace, Tab, Caps Lock, Enter and both Shifts.
        expect(check.icons).toBe(6);
        expect(check.badIcons, "icons under 14 px or without a name").toEqual([]);
        expect(check.small, "chars under 12 px").toEqual([]);
        expect(check.off, "chars that run off their key").toEqual([]);
        expect(check.tiny, "keys under the 28-px floor").toEqual([]);
        expect(errors).toEqual([]);
      });
    }
  }
}
