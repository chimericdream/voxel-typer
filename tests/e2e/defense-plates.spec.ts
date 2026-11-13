/**
 * Night Defense word plates keep off other mobs' heads (M4-FIX-7, #213 review N3: the "shade"
 * plate sat over the head of the "rugs" mob behind it, and a child reads a covered mob as gone).
 *
 * Visitors are left to gather untyped, so several share the field, and the plates are checked
 * every 250 ms. Each plate carries its mob's box as `data-mob="x head feet"` (`plates.ts`); a
 * mob's head is the top 40 % of it, 70 % of its height wide (`mobHead` in `logic.ts`). A plate
 * may lie on another mob's head only when there was no free spot, and then it is faded
 * (`data-covers`). Plates never overlap each other.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, ready } from "./helpers/vt";

/** `HEAD_SHARE` and `HEAD_WIDTH_SHARE` in `src/modes/defense/logic.ts`. */
const HEAD = { share: 0.4, width: 0.7 };

interface Sample {
  plates: number;
  /** Plates on another mob's head that are not marked as covering it. */
  unmarked: string[];
  /** Plates marked as covering a head (faded). */
  covers: number;
  /** Pairs of plates that overlap. */
  overlaps: number;
}

async function sample(page: Page): Promise<Sample> {
  return page.evaluate((head) => {
    const els = [...document.querySelectorAll<HTMLElement>(".vt-defense-plate[data-mob]")];
    const boxes = els.map((el) => {
      const [x = 0, top = 0, feet = 0] = (el.dataset["mob"] ?? "").split(" ").map(Number);
      const h = feet - top;
      return {
        word: el.dataset["word"] ?? "",
        plate: el.getBoundingClientRect(),
        head: {
          left: x - (h * head.width) / 2,
          right: x + (h * head.width) / 2,
          top,
          bottom: top + h * head.share,
        },
        covers: el.dataset["covers"] === "1",
      };
    });
    // One pixel of slack: `data-mob` is rounded to whole pixels.
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- reason: this runs in the page; page.evaluate sends only the function it is given
    const hit = (
      a: { left: number; right: number; top: number; bottom: number },
      b: { left: number; right: number; top: number; bottom: number },
    ): boolean =>
      a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const unmarked: string[] = [];
    let overlaps = 0;
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        if (hit(a.plate, b.head) && !a.covers) unmarked.push(`${a.word} over ${b.word}`);
        if (a.word < b.word && hit(a.plate, b.plate)) overlaps++;
      }
    }
    return {
      plates: els.length,
      unmarked,
      covers: boxes.filter((b) => b.covers).length,
      overlaps,
    };
  }, HEAD);
}

const CASES = [
  ["meadow-done-miner", 1.25, 1024, 600],
  ["voice-miner", 2, 1024, 600],
  ["voice-miner", 2, 1280, 720],
] as const;

for (const [profile, scale, width, height] of CASES) {
  test(`${width}×${height}, ${profile} (text scale ${scale}): plates keep off other mobs' heads`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height });
    const errors = collectErrors(page);
    await page.goto(`/?profile=${profile}&screen=play&lesson=birch-08&seed=1&nosave=1`);
    await ready(page);
    const app = page.locator("#app");
    await expect(app.getByText("Night is coming!")).toBeVisible({ timeout: 30_000 });
    const dusk = app.getByText(/on the way!$/);
    await expect(async () => {
      await page.keyboard.press("f");
      await expect(dusk).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 90_000 });
    await expect(page.locator(".vt-defense-plate[data-mob]").first()).toBeVisible({
      timeout: 60_000,
    });

    // Nobody types: the visitors gather. Watch until several have shared the field a while.
    let crowded = 0;
    let peak = 0;
    let covers = 0;
    const unmarked = new Set<string>();
    for (let i = 0; i < 240 && crowded < 30; i++) {
      const s = await sample(page);
      peak = Math.max(peak, s.plates);
      covers = Math.max(covers, s.covers);
      if (s.plates >= 2) crowded++;
      for (const u of s.unmarked) unmarked.add(u);
      expect(s.overlaps, "two word plates overlap").toBe(0);
      await page.waitForTimeout(250);
    }
    info.annotations.push({ type: "most plates at once", description: String(peak) });
    info.annotations.push({ type: "faded plates (most at once)", description: String(covers) });
    await info.attach(`${profile}-${width}x${height}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    expect(crowded, "never two visitors on the field together").toBeGreaterThan(0);
    expect([...unmarked], "a plate covers another mob's head").toEqual([]);
    expect(errors).toEqual([]);
  });
}
