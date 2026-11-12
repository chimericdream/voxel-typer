/**
 * Steps of the vertical slice (task M2-15) shared by the slice specs: a new player made with the
 * keyboard alone, and a lesson played from its intro to Results.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { playLesson, typeLikeAKid } from "./kid";
import type { KidOptions, Played } from "./kid";
import { ready, state, vt, waitForLesson } from "./vt";

/** M2-11 Results ignores presses for its first 700 ms, so a stray key can't skip the stars. */
export const RESULTS_ARM_MS = 700;

/** Runs axe on the page as it is now and expects no violations. */
export async function expectNoAxeViolations(page: Page, where: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    `axe on ${where}`,
  ).toEqual([]);
}

/** Polls until the route is `id`. */
export async function expectScreen(page: Page, id: string, timeout = 15_000): Promise<void> {
  await expect.poll(async () => (await state(page)).screen, { timeout }).toBe(id);
  await ready(page);
}

/**
 * Splash → any key → New player → type the name → Enter → the map's "Play" offer → Enter →
 * lesson intro. The keyboard only: no clicks. Runs axe on each screen when `axe` is set.
 */
export async function newPlayerToIntro(
  page: Page,
  name: string,
  opts: { axe?: boolean; seed?: number } = {},
): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ready(page);
  await expect(page.getByText("Press any key to start")).toBeVisible();
  if (opts.axe === true) await expectNoAxeViolations(page, "splash");

  await page.keyboard.press("k");
  // No players on this device yet, so the first key goes straight to New player.
  await expectScreen(page, "profileCreate");
  const field = page.getByRole("textbox");
  await expect(field).toBeFocused();
  if (opts.axe === true) await expectNoAxeViolations(page, "profile create");
  // A slow typist who fixes a slip with Backspace.
  await typeLikeAKid(page, name, {
    wpm: 15,
    errorRate: 0.2,
    seed: opts.seed ?? 7,
    fix: "backspace",
  });
  await expect(field).toHaveValue(name);
  await page.keyboard.press("Enter");

  // The map is M3-04; until then its panel offers the next lesson, with focus on that button.
  await expectScreen(page, "map");
  const play = page.getByRole("button", { name: /^Play: / });
  await expect(play).toBeFocused();
  await page.keyboard.press("Enter");
  await expectScreen(page, "lessonIntro");
  await expect(page.getByRole("button", { name: "Start" })).toBeFocused();
}

/** On a lesson intro: Enter starts, then the kid plays until Results. */
export async function playFromIntro(page: Page, kid: KidOptions): Promise<Played> {
  await expect(page.getByRole("button", { name: "Start" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expectScreen(page, "play");
  await waitForLesson(page);
  const played = await playLesson(page, kid);
  // Results come about 0.9 s after the last key (M2-13).
  await expectScreen(page, "results");
  await expect(page.getByRole("heading", { name: "Lesson done!" })).toBeVisible();
  return played;
}

/** Logs a soft performance reading on the test (SwiftShader is far from a real GPU). */
export function logPerf(label: string, fps: number, peakCalls: number): void {
  const note = `${label}: fps ${fps.toFixed(1)}, peak draw calls ${peakCalls}`;
  test.info().annotations.push({ type: "perf", description: note });
  // oxlint-disable-next-line no-console -- reason: the soft perf reading is meant to be seen in the run log
  console.log(note);
  if (peakCalls > 150) {
    test.info().annotations.push({ type: "warning", description: `${label}: over 150 draw calls` });
  }
}

/** The profile as the game holds it, with the parts these tests read. */
export interface ProfileView {
  name: string;
  ageBand: string;
  stars: Record<string, number>;
  inventory: Record<string, number>;
  sessionCounter: number;
}

function get(o: unknown, k: string): unknown {
  return typeof o === "object" && o !== null ? Reflect.get(o, k) : undefined;
}

export async function profileView(page: Page): Promise<ProfileView | null> {
  const p: unknown = await vt(page, "profile");
  if (typeof p !== "object" || p === null) return null;
  const stars: Record<string, number> = {};
  const lessons = get(get(p, "progress"), "lessons");
  if (typeof lessons === "object" && lessons !== null) {
    for (const [id, rec] of Object.entries(lessons)) stars[id] = Number(get(rec, "bestStars"));
  }
  const inventory: Record<string, number> = {};
  const inv = get(p, "inventory");
  if (typeof inv === "object" && inv !== null) {
    for (const [id, n] of Object.entries(inv)) inventory[id] = Number(n);
  }
  return {
    name: String(get(p, "name")),
    ageBand: String(get(p, "ageBand")),
    stars,
    inventory,
    sessionCounter: Number(get(p, "sessionCounter")),
  };
}
