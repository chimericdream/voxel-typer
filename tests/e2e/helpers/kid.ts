/**
 * Types like a child (task M2-15): real key presses, an uneven rhythm around a target speed, and
 * now and then the key next door first. Everything random comes from one seeded generator, so a
 * run with the same seed sends the same keys in the same order (the delays are real time).
 */
import type { Page } from "@playwright/test";
import { state } from "./vt";

export interface KidOptions {
  /** Target speed in words per minute (5 chars a word). */
  wpm: number;
  /** Chance, per char, of pressing a neighbouring key first. 0 to 1. */
  errorRate: number;
  seed: number;
  /**
   * What a slip costs. `retry` (the game's `stay` policy): just press the right key next.
   * `backspace` (a text field): delete the slip first.
   */
  fix?: "retry" | "backspace";
}

/** mulberry32: a small seeded generator, uniform in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"] as const;

/** The letter keys left, right, above and below `c` on a US QWERTY keyboard. */
export function neighbours(c: string): string[] {
  const lower = c.toLowerCase();
  const out: string[] = [];
  ROWS.forEach((row, r) => {
    const i = row.indexOf(lower);
    if (i < 0) return;
    for (const [dr, di] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [-1, 1],
      [1, -1],
      [1, 0],
    ] as const) {
      const n = ROWS[r + dr]?.[i + di];
      if (n !== undefined) out.push(n);
    }
  });
  return out;
}

/** Playwright's name for the key that types `c`. */
export function keyName(c: string): string {
  return c === " " ? "Space" : c;
}

/** One kid at the keyboard: presses one char at a time, slips now and then. */
export function createKid(page: Page, opts: KidOptions): (c: string) => Promise<number> {
  const rand = seeded(opts.seed);
  const meanMs = 60_000 / (opts.wpm * 5);
  // Kids are uneven: anywhere from 0.6× to 1.4× the mean gap.
  const gap = (): number => Math.round(meanMs * (0.6 + rand() * 0.8));
  return async (c: string): Promise<number> => {
    let slips = 0;
    const near = neighbours(c);
    if (near.length > 0 && rand() < opts.errorRate) {
      const wrong = near[Math.floor(rand() * near.length)] ?? near[0] ?? c;
      await page.keyboard.press(keyName(wrong));
      slips++;
      // A beat to notice the slip.
      await page.waitForTimeout(gap());
      if (opts.fix === "backspace") {
        await page.keyboard.press("Backspace");
        await page.waitForTimeout(gap());
      }
    }
    await page.keyboard.press(keyName(c));
    await page.waitForTimeout(gap());
    return slips;
  };
}

/** Types `text` like a child. Returns the number of slips. */
export async function typeLikeAKid(page: Page, text: string, opts: KidOptions): Promise<number> {
  const press = createKid(page, opts);
  let slips = 0;
  for (const c of Array.from(text)) slips += await press(c);
  return slips;
}

export interface Played {
  /** Correct keys pressed. */
  keys: number;
  slips: number;
  peakCalls: number;
}

/**
 * Plays the running lesson like a child until no target is left: reads the next key from
 * `__vt.session()` before each press (the lesson's text is drawn as it goes).
 * `onKey` runs after each correct key, with its index (pause tests hook in here).
 */
export async function playLesson(
  page: Page,
  opts: KidOptions,
  onKey?: (index: number) => Promise<void>,
): Promise<Played> {
  const press = createKid(page, opts);
  const played: Played = { keys: 0, slips: 0, peakCalls: 0 };
  for (let now = await state(page); now.next !== null; now = await state(page)) {
    // The frame drawn since the last key (one read per key keeps the overhead low).
    played.peakCalls = Math.max(played.peakCalls, now.calls);
    played.slips += await press(now.next);
    played.keys++;
    if (onKey !== undefined) await onKey(played.keys);
  }
  return played;
}
