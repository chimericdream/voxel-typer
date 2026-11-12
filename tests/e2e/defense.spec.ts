/**
 * Night Defense in a real browser (task M4-04): a night plays from day to dawn and reaches
 * Results inside the draw-call budget; the word plates are real text in the body font, never
 * overlap and stay clear of the HUD; calm mode shows no clock.
 *
 * The feel-review pictures (the dusk banner, mid-wave with a lock, dawn, Results, and the Sprout
 * and Builder layouts) are attached to the report, not compared: a night runs on real time, so no
 * two runs draw the same frame. M4-10 owns the M4 e2e suite and its baselines.
 */
import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { collectErrors, ready, state } from "./helpers/vt";

interface NightState {
  /** Words on the field, in the order their mobs set out. */
  words: string[];
  /** The key that moves the night on: the locked word's next char, or a first letter. */
  next: string | null;
  locked: boolean;
}

/** Reads the night's typing session through `window.__vt`. */
async function night(page: Page): Promise<NightState> {
  return page.evaluate(() => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- reason: this runs in the page; page.evaluate sends only the function it is given
    const get = (o: unknown, k: string): unknown =>
      typeof o === "object" && o !== null ? Reflect.get(o, k) : undefined;
    const hooks: unknown = Reflect.get(window, "__vt");
    const fn = get(hooks, "session");
    const session: unknown = typeof fn === "function" ? Reflect.apply(fn, hooks, []) : null;
    const raw = get(session, "targets");
    const targets: unknown[] = Array.isArray(raw) ? raw : [];
    const open = targets.filter((x) => get(x, "complete") !== true);
    const words = open.flatMap((x) => {
      const word = get(x, "text");
      return typeof word === "string" ? [word] : [];
    });
    const active = get(session, "active");
    const text = get(active, "text");
    if (typeof text === "string") {
      const typed = Number(get(active, "typed") ?? 0);
      return { words, next: Array.from(text)[typed] ?? null, locked: true };
    }
    return { words, next: Array.from(words[0] ?? "")[0] ?? null, locked: false };
  });
}

/** What the plates look like on the page right now. */
async function plates(page: Page): Promise<{
  count: number;
  overlaps: number;
  fonts: string[];
  overHud: number;
  locked: number;
}> {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".vt-defense-plate")];
    const rects = els.map((e) => e.getBoundingClientRect());
    let overlaps = 0;
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (!a || !b) continue;
        // Half a pixel of slack for sub-pixel rounding.
        if (
          a.left < b.right - 0.5 &&
          b.left < a.right - 0.5 &&
          a.top < b.bottom - 0.5 &&
          b.top < a.bottom - 0.5
        )
          overlaps++;
      }
    // The HUD parts a plate must never cover: the top row's hotbar and the on-screen keyboard.
    const hud = [
      document.querySelector('[data-hud="keyboard"] [role="img"]')?.parentElement,
      document.querySelector('[role="group"][data-lit]'),
    ].flatMap((e) => (e ? [e.getBoundingClientRect()] : []));
    let overHud = 0;
    for (const r of rects)
      for (const h of hud)
        if (r.left < h.right && h.left < r.right && r.top < h.bottom && h.top < r.bottom) overHud++;
    return {
      count: els.length,
      overlaps,
      fonts: [...new Set(els.map((e) => getComputedStyle(e).fontFamily))],
      overHud,
      locked: els.filter((e) => e.dataset["locked"] === "1").length,
    };
  });
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await info.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

/** Opens a night and moves through the day to the dusk banner. */
async function toDusk(page: Page, info: TestInfo, query: string, name: string): Promise<void> {
  await page.goto(`/?${query}&screen=play&lesson=birch-08&seed=1&nosave=1`);
  await ready(page);
  await expect(page.locator("canvas.vt-stage")).toBeVisible();
  const app = page.locator("#app");
  await expect(app.getByText("Night is coming!")).toBeVisible({ timeout: 30_000 });
  await shot(page, info, `${name}-day`);
  // A key moves the day along once it has been seen for 1.5 s of game time. Game time follows
  // frames, and CI's software renderer draws them slowly, so keep asking until dusk comes.
  const dusk = app.getByText(/on the way!$/);
  await expect(async () => {
    await page.keyboard.press("f");
    await expect(dusk).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 90_000 });
  info.annotations.push({ type: `fps (${name})`, description: String((await state(page)).fps) });
}

/** Waits for the first visitor's plate, then types `chars` chars of its word. */
async function lockFirst(page: Page, chars: number): Promise<void> {
  await expect(page.locator(".vt-defense-plate").first()).toBeVisible({ timeout: 60_000 });
  for (let i = 0; i < chars; i++) {
    const s = await night(page);
    if (s.next === null) break;
    await page.keyboard.press(s.next);
    await page.waitForTimeout(120);
  }
  // The plate is repainted on the next frame, and CI's software renderer draws frames slowly.
  await expect(page.locator('.vt-defense-plate[data-locked="1"]')).toHaveCount(1, {
    timeout: 20_000,
  });
}

test("a Miner's night plays from day to dawn inside the draw-call budget", async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = collectErrors(page);
  await toDusk(page, info, "profile=meadow-done-miner", "miner");
  const app = page.locator("#app");
  await shot(page, info, "miner-dusk-banner");

  let keys = 0;
  let peakCalls = 0;
  let peakPlates = 0;
  let midShot = false;
  let dawnShot = false;
  let checks = 0;
  for (let now = await state(page); now.screen === "play"; now = await state(page)) {
    peakCalls = Math.max(peakCalls, now.calls);
    if (!dawnShot && (await app.getByText("The sun is up! The camp is safe!").isVisible())) {
      dawnShot = true;
      // The sky takes two seconds to turn: take the picture once it has.
      await page.waitForTimeout(2600);
      await shot(page, info, "miner-dawn");
    }
    const s = await night(page);
    if (s.next === null) {
      await page.waitForTimeout(150);
      continue;
    }
    // The mid-wave picture: a few visitors out, one locked with a letter or two typed.
    if (!midShot && s.words.length >= 3) {
      await lockFirst(page, 2);
      const p = await plates(page);
      expect(p.locked).toBe(1);
      await expect(page.locator(".vt-defense-shield")).toHaveAttribute(
        "aria-label",
        "Shield: 5 of 5",
      );
      await shot(page, info, "miner-mid-wave-lock");
      midShot = true;
      continue;
    }
    // Let a few visitors gather before typing on, so plates share the field.
    if (!midShot && s.words.length < 3 && !s.locked) {
      await page.waitForTimeout(250);
      continue;
    }
    await page.keyboard.press(s.next);
    keys++;
    if (keys % 6 === 0) {
      const p = await plates(page);
      checks++;
      peakPlates = Math.max(peakPlates, p.count);
      expect(p.overlaps, "word plates overlap").toBe(0);
      expect(p.overHud, "a word plate covers the HUD").toBe(0);
      // Typing targets use the body font, never the pixel font (decision 68).
      for (const font of p.fonts) expect(font).not.toMatch(/Pixelify/i);
    }
    await page.waitForTimeout(70);
  }
  expect(midShot).toBe(true);
  expect(checks).toBeGreaterThan(3);
  expect(peakPlates).toBeGreaterThan(1);

  await expect.poll(async () => (await state(page)).screen, { timeout: 30_000 }).toBe("results");
  const end = await state(page);
  expect(end.lessonId).toBe("birch-08");
  expect(end.stars).toBeGreaterThanOrEqual(1);
  expect(end.done).toBeGreaterThan(5);
  expect(end.lootTotal).toBeGreaterThanOrEqual(end.done);
  await expect(app.getByText(/sent home$/)).toBeVisible();
  // The stars and the loot fill in one by one.
  await page.waitForTimeout(2500);
  await shot(page, info, "miner-results");
  // The arena, the mobs (one InstancedMesh per part per type), the ring, the shield and the sky.
  expect(peakCalls).toBeGreaterThan(5);
  expect(peakCalls).toBeLessThanOrEqual(150);
  info.annotations.push({ type: "draw calls (peak, medium)", description: String(peakCalls) });
  // The mode took its layers with it and handed the shared camera back.
  await expect(page.locator(".vt-defense-plates")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a Sprout's calm night: the field fits above the keyboard and no clock shows", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await toDusk(page, info, "profile=fresh-sprout", "sprout");
  await shot(page, info, "sprout-dusk-banner");
  await lockFirst(page, 1);
  const p = await plates(page);
  expect(p.count).toBeGreaterThan(0);
  expect(p.locked).toBe(1);
  expect(p.overlaps).toBe(0);
  expect(p.overHud).toBe(0);
  for (const font of p.fonts) expect(font).not.toMatch(/Pixelify/i);
  // Calm mode: no countdown anywhere.
  await expect(page.locator("#app").getByText("Time left")).toHaveCount(0);
  // Nothing reaches the camp in calm mode, so there is no shield bar to worry about.
  await expect(page.locator(".vt-defense-shield")).toBeHidden();
  // The keys and the hint line stay; the drawn hands make room for the field.
  const keys = page.locator('[data-hud="keyboard"]');
  await expect(keys).toHaveAttribute("data-hands-caption", "1");
  await expect(keys.locator("svg")).toHaveCount(0);
  await expect(keys.getByText(/^Use your /)).toBeVisible();
  await shot(page, info, "sprout-calm-lock");
  // A wrong key costs nothing: the same word, the same progress.
  const before = await night(page);
  await page.keyboard.press("0");
  const after = await night(page);
  expect(after.words).toEqual(before.words);
  expect(after.next).toBe(before.next);
  expect((await state(page)).calls).toBeLessThanOrEqual(150);
  expect(errors).toEqual([]);
});

test("a Builder's night uses the whole screen, with five lanes", async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await toDusk(page, info, "profile=fresh-builder", "builder");
  await lockFirst(page, 2);
  const p = await plates(page);
  expect(p.locked).toBe(1);
  expect(p.overlaps).toBe(0);
  expect(p.overHud).toBe(0);
  await shot(page, info, "builder-lock");
  expect((await state(page)).calls).toBeLessThanOrEqual(150);
  expect(errors).toEqual([]);
});

test("reduced motion: a night still plays, and the plates hold still", async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = collectErrors(page);
  await toDusk(page, info, "profile=meadow-done-miner", "reduced");
  await lockFirst(page, 1);
  // A slip: no shake of the plate under reduced motion (no running animation on it).
  await page.keyboard.press("0");
  const moving = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (a) =>
            a.effect instanceof KeyframeEffect && a.effect.target?.className === "vt-defense-plate",
        ).length,
  );
  expect(moving).toBe(0);
  // The word still pops, on its last letter.
  const word = (await night(page)).words[0] ?? "";
  for (let i = 0; i < word.length + 2; i++) {
    const s = await night(page);
    if (!s.locked) break;
    await page.keyboard.press(s.next ?? "a");
    await page.waitForTimeout(100);
  }
  await expect
    .poll(async () => (await night(page)).words.includes(word), { timeout: 15_000 })
    .toBe(false);
  await shot(page, info, "reduced-motion-after-pop");
  expect(errors).toEqual([]);
});
