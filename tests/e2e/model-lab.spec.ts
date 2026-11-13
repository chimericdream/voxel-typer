/**
 * Model Lab (M4-02): opens every `*.model.json` in the repo and plays each of its anims with no
 * console errors.
 *
 * WebGL shader problems are failures here. three.js reports a shader that fails to compile or link
 * with `console.error` ("THREE.WebGLProgram: Shader Error …") and a non-empty program log with
 * `console.warn`; the browser reports bad GL calls as "WebGL: …" warnings. A unit test can't see
 * these (no GLSL compiler under Node), so this is where a broken model shader patch (M4-01 review
 * m31: `vMapUv` renamed to `vUv`, say) gets caught.
 */
import { expect, test } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";
// Brings in the page's `window.vtLab` declaration (type only; nothing runs in Node).
import type { ModelLabHooks } from "../../src/dev/model-lab";

/** True for a console message that should fail the test. */
function isProblem(msg: ConsoleMessage): boolean {
  if (msg.type() === "error") return true;
  if (msg.type() !== "warning") return false;
  const text = msg.text();
  // A readback stall is a performance note from the GPU process, not a shader problem.
  if (/GPU stall/i.test(text)) return false;
  return /THREE\.|WebGL|shader|GL_|program/i.test(text);
}

async function openLab(page: Page, query = ""): Promise<string[]> {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (isProblem(msg)) problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`/lab.html${query}`);
  await expect(page.locator("#lab")).toHaveAttribute("data-ready", "1");
  return problems;
}

test("lists every model file, and every one is valid", async ({ page }) => {
  const problems = await openLab(page);
  const entries: ModelLabHooks["entries"] = await page.evaluate(() => window.vtLab?.entries ?? []);
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.map((e) => e.id)).toContain("box-critter");
  expect(entries.filter((e) => e.error !== null)).toEqual([]);
  await expect(page.locator("#lab .models button")).toHaveCount(entries.length);
  expect(problems).toEqual([]);
});

test("opens every model and plays every anim, day and night, without console errors", async ({
  page,
}) => {
  // Every model times every anim, twice: 24-28 s on CI's software renderer, against the 30 s
  // default. It grows with each model added, so it gets its own budget (M4-FIX-2).
  test.setTimeout(90_000);
  const problems = await openLab(page);
  const entries: ModelLabHooks["entries"] = await page.evaluate(() => window.vtLab?.entries ?? []);
  for (const tod of ["day", "night"] as const) {
    await page.evaluate((t) => window.vtLab?.setTimeOfDay(t), tod);
    for (const entry of entries) {
      const calls = await page.evaluate((id) => window.vtLab?.open(id) ?? 0, entry.id);
      expect(calls, `${entry.id} draws`).toBeGreaterThan(0);
      for (const anim of entry.anims) {
        await page.evaluate((a) => window.vtLab?.play(a), anim);
        const state = await page.evaluate(() => window.vtLab?.state());
        expect(state?.anim, `${entry.id}: ${anim}`).toBe(anim);
        await page.evaluate((d) => window.vtLab?.scrub(d / 2), state?.durationMs ?? 0);
      }
    }
  }
  expect(problems).toEqual([]);
});

test("the scrubber pauses at the given time, and play resumes from there", async ({ page }) => {
  const problems = await openLab(page, "?model=box-critter&anim=walk");
  await expect(page.locator('#lab button[data-anim="walk"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const scrubber = page.locator("#scrubber");
  await scrubber.fill("250");
  const paused = await page.evaluate(() => window.vtLab?.state());
  expect(paused).toMatchObject({ anim: "walk", playing: false, timeMs: 250, durationMs: 500 });
  await expect(page.locator("#play-pause")).toHaveText("Play");
  // Paused and nothing else moving: the loop goes idle.
  await expect.poll(() => page.evaluate(() => window.vtLab?.scheduled())).toBe(false);

  await page.locator("#play-pause").click();
  await expect(page.locator("#play-pause")).toHaveText("Pause");
  await expect.poll(() => page.evaluate(() => window.vtLab?.state().timeMs)).not.toBe(250);
  expect(problems).toEqual([]);
});

test("day/night toggle and copy screenshot work", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const problems = await openLab(page, "?model=box-critter");
  await page.locator('#lab button[data-tod="night"]').click();
  await expect(page.locator('#lab button[data-tod="night"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const bytes = await page.evaluate(() => window.vtLab?.screenshot() ?? 0);
  expect(bytes).toBeGreaterThan(1000);
  await page.locator("#copy-screenshot").click();
  await expect(page.locator("#lab .status")).toHaveText(/copied|downloaded/);
  expect(problems).toEqual([]);
});
