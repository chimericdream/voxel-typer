/**
 * Mine mode in a real browser (task M2-13): the stage objects compile and draw inside the
 * draw-call budget, a lesson plays to Results, a wrong key costs nothing, and the block is framed
 * clear of the HUD. No screenshot baselines here; M2-15 owns the slice's baselines.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

interface State {
  screen: string;
  calls: number;
  /** The active target, or null before the world is ready and after the last block. */
  text: string | null;
  typed: number;
  /** The key the session wants next, or null. */
  next: string | null;
  stars: number;
  lootTotal: number;
  correct: number;
  errors: number;
  done: number;
}

/** Reads `window.__vt` in the page and returns plain values. */
async function state(page: Page): Promise<State> {
  return page.evaluate(() => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- reason: this runs in the page; page.evaluate sends only the function it is given
    const get = (o: unknown, k: string): unknown =>
      typeof o === "object" && o !== null ? Reflect.get(o, k) : undefined;
    const call = (o: unknown, k: string): unknown => {
      const fn = get(o, k);
      return typeof fn === "function" ? Reflect.apply(fn, o, []) : undefined;
    };
    const hooks: unknown = Reflect.get(window, "__vt");
    const a = get(call(hooks, "session"), "active");
    const text = typeof get(a, "text") === "string" ? String(get(a, "text")) : null;
    const typed = Number(get(a, "typed") ?? 0);
    const marks = get(a, "marks");
    const chars = text === null ? [] : Array.from(text);
    const next =
      text === null
        ? null
        : typed < chars.length
          ? (chars[typed] ?? null)
          : Array.isArray(marks) && marks.length > chars.length
            ? " "
            : null;
    const result = call(hooks, "lastResult");
    const summary = get(result, "summary");
    const loot = get(result, "loot");
    let lootTotal = 0;
    if (typeof loot === "object" && loot !== null) {
      for (const n of Object.values(loot)) lootTotal += Number(n);
    }
    return {
      screen: String(call(hooks, "screen")),
      calls: Number(call(hooks, "drawCalls") ?? 0),
      text,
      typed,
      next,
      stars: Number(get(result, "stars") ?? 0),
      lootTotal,
      correct: Number(get(summary, "correct") ?? 0),
      errors: Number(get(summary, "errors") ?? 0),
      done: Number(get(summary, "targetsCompleted") ?? 0),
    };
  });
}

async function start(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto(`/?${query}&nosave=1`);
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "1");
  // The session is null until the meadow is on the stage; keys before that are dropped.
  await expect.poll(async () => (await state(page)).text, { timeout: 30_000 }).not.toBeNull();
  return errors;
}

test("meadow-01 plays to Results inside the draw-call budget", async ({ page }) => {
  test.slow();
  const errors = await start(page, "profile=fresh-sprout&screen=play&lesson=meadow-01&seed=1");
  await expect(page.locator("canvas.vt-stage")).toBeVisible();
  await expect(page.getByRole("img", { name: /^Type: / })).toBeVisible();

  // A wrong key: nothing is lost, and the kind banner shows.
  const before = await state(page);
  await page.keyboard.press("q");
  await expect(page.getByText("Almost! Try that key again")).toBeVisible();
  expect(await state(page)).toMatchObject({ typed: before.typed, text: before.text });

  let typed = 0;
  let peakCalls = 0;
  for (let now = await state(page); now.next !== null; now = await state(page)) {
    await page.keyboard.press(now.next === " " ? "Space" : now.next);
    typed++;
    await page.waitForTimeout(60);
    peakCalls = Math.max(peakCalls, (await state(page)).calls);
  }
  expect(typed).toBe(25);
  // Block, crack, letter, glow, shadow, arm, particles, sky and the meadow together.
  expect(peakCalls).toBeGreaterThan(5);
  expect(peakCalls).toBeLessThanOrEqual(150);

  await expect.poll(async () => (await state(page)).screen, { timeout: 15_000 }).toBe("results");
  const end = await state(page);
  expect(end.stars).toBeGreaterThanOrEqual(1);
  expect(end).toMatchObject({ correct: 25, errors: 1, done: 25 });
  expect(end.lootTotal).toBeGreaterThanOrEqual(25);
  // The loot overlay is gone with the mode, and the shared camera is handed back unshifted.
  await expect(page.locator(".vt-mine-loot")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("meadow-05: a word chips, breaks on its space, and the loot lands in the hotbar", async ({
  page,
}) => {
  test.slow();
  const errors = await start(page, "profile=meadow-done-miner&screen=play&lesson=meadow-05&seed=1");
  const first = (await state(page)).text ?? "";
  expect(first.length).toBeGreaterThan(1);
  const hotbar = page.getByRole("group", { name: /./ }).first();
  await expect(hotbar.getByRole("img")).toHaveCount(0);
  for (let i = 0; i < first.length + 1; i++) {
    const key = (await state(page)).next;
    if (key === null) break;
    await page.keyboard.press(key === " " ? "Space" : key);
    await page.waitForTimeout(80);
  }
  // The next word is up, and what was inside the block is in a hotbar slot.
  const after = await state(page);
  expect(after.text).not.toBeNull();
  expect(after.typed).toBe(0);
  await expect(hotbar.getByRole("img")).not.toHaveCount(0);
  expect(after.calls).toBeLessThanOrEqual(150);
  expect(errors).toEqual([]);
});

for (const [name, query, width] of [
  ["sprout at 1280", "profile=fresh-sprout", 1280],
  ["sprout at 1024", "profile=fresh-sprout", 1024],
  ["miner at 1280", "profile=meadow-done-miner", 1280],
  ["builder at 1280", "profile=fresh-builder", 1280],
] as const) {
  test(`the block is framed clear of the HUD: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await start(page, `${query}&screen=play&lesson=meadow-01&seed=1&freeze=1`);
    // The first break makes a "+1" label right above the block: it marks where the block is.
    const key = (await state(page)).next;
    await page.waitForTimeout(600);
    await page.keyboard.press(key ?? "f");
    const label = page
      .locator(".vt-fx-text span")
      .filter({ hasText: /^\+\d+$/ })
      .first();
    await expect(label).toBeVisible();
    const at = await label.boundingBox();
    if (at === null) throw new Error("no label");
    const x = at.x + at.width / 2;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(width);
    for (const part of [
      page.getByRole("img", { name: /^Type: / }),
      page.locator('[data-hud="keyboard"] [role="img"]').first(),
    ]) {
      if ((await part.count()) === 0) continue;
      const box = await part.boundingBox();
      if (box === null) continue;
      const inside =
        x > box.x && x < box.x + box.width && at.y > box.y && at.y < box.y + box.height;
      expect(inside, `${name}: the block's label is over part of the HUD`).toBe(false);
    }
  });
}
