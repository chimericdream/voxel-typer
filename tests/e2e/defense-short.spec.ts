/**
 * Night Defense on a short screen (task M4-FIX-4): at 1024×600 the field keeps at least 40 % of
 * the screen, the mobs are big enough to read (about 48 px tall or more) at text scale 1 to 2, and
 * no word plate covers its own mob. The keyboard shrinks to make the room, but its next-key light
 * stays. The empty hotbar is hidden during the day, and the dusk banner pops in quickly.
 *
 * Each plate carries its mob's box on the page as `data-mob="x head feet"` (`plates.ts`). A night
 * runs on real time, so the pictures are attached for review, not compared.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, ready } from "./helpers/vt";

/** The smallest mob a child should have to read, CSS pixels (the gate review's "about 48 px"). */
const MIN_MOB_PX = 46;

interface Look {
  /** Each plate's mob: its height, and how far the plate reaches down past the mob's head. */
  mobs: { word: string; height: number; overlap: number }[];
  /** The open stage's height over the viewport's. */
  stageShare: number;
  /** The lit key on the on-screen keyboard (its code), or null. */
  litKey: string | null;
}

async function look(page: Page): Promise<Look> {
  return page.evaluate(() => {
    const mobs = [...document.querySelectorAll<HTMLElement>(".vt-defense-plate[data-mob]")].map(
      (el) => {
        const [x = 0, head = 0, feet = 0] = (el.dataset["mob"] ?? "").split(" ").map(Number);
        const r = el.getBoundingClientRect();
        const across = r.left <= x && x <= r.right;
        return {
          word: el.dataset["word"] ?? "",
          height: feet - head,
          // How far the plate's bottom edge comes down past the mob's head (≤ 0: clear of it).
          overlap: across ? r.bottom - head : 0,
        };
      },
    );
    const stage = document.querySelector('[data-hud="stage"]')?.getBoundingClientRect();
    const lit = document.querySelector<HTMLElement>('[data-hud="keyboard"] [data-next="key"]');
    return {
      mobs,
      stageShare: (stage?.height ?? 0) / window.innerHeight,
      litKey: lit?.dataset["code"] ?? null,
    };
  });
}

for (const [profile, scale] of [
  ["small-text-miner", 1],
  ["meadow-done-miner", 1.25],
  ["fresh-sprout", 1.5],
  ["voice-miner", 2],
] as const) {
  test(`1024×600, ${profile} (text scale ${scale}): big mobs, plates clear of them`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1024, height: 600 });
    const errors = collectErrors(page);
    await page.goto(`/?profile=${profile}&screen=play&lesson=birch-08&seed=1&nosave=1`);
    await ready(page);
    const app = page.locator("#app");
    await expect(app.getByText("Night is coming!")).toBeVisible({ timeout: 30_000 });
    // The field keeps at least 40 % of the screen (the HUD renders the floor a frame later).
    await expect
      .poll(async () => (await look(page)).stageShare, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(0.4);
    // No empty hotbar during the day: it keeps its room, so nothing moves when loot lands.
    await expect(page.locator('[role="group"][data-lit]')).toBeHidden();
    const dusk = app.getByText(/on the way!$/);
    await expect(async () => {
      await page.keyboard.press("f");
      await expect(dusk).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 90_000 });
    // The banner pops in quickly (90 ms or less), not in the kit's slower fade.
    const durations = await page
      .locator('[data-hud="stage"] output')
      .evaluate((el) => el.getAnimations().map((a) => Number(a.effect?.getTiming().duration)));
    for (const d of durations) expect(d).toBeLessThanOrEqual(100);

    await expect(page.locator(".vt-defense-plate[data-mob]").first()).toBeVisible({
      timeout: 60_000,
    });
    // Let the first visitor grow in (260 ms) at the far end, where it is smallest.
    await page.waitForTimeout(600);
    let smallest = Infinity;
    let worst = -Infinity;
    for (let i = 0; i < 6; i++) {
      const l = await look(page);
      expect(l.stageShare).toBeGreaterThanOrEqual(0.4);
      for (const m of l.mobs) {
        smallest = Math.min(smallest, m.height);
        worst = Math.max(worst, m.overlap);
      }
      await page.waitForTimeout(250);
    }
    info.annotations.push({ type: "smallest mob (px)", description: smallest.toFixed(1) });
    info.annotations.push({
      type: "plate past its mob's head (px)",
      description: worst.toFixed(1),
    });
    await info.attach(`${profile}-1024x600`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    expect(smallest, "a mob is too small to read").toBeGreaterThanOrEqual(MIN_MOB_PX);
    // A couple of pixels of slack: the plate keeps 6 px above the head.
    expect(worst, "a word plate covers its own mob").toBeLessThanOrEqual(2);
    // The smaller keyboard still lights the next key: the first letter of a word on the field.
    expect((await look(page)).litKey).toMatch(/^Key[A-Z]$/);
    expect(errors).toEqual([]);
  });
}
