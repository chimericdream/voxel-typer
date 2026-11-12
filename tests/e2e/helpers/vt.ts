/**
 * Reads the game's `window.__vt` test hooks (docs/impl/contracts.md §13) from e2e specs. The hooks
 * are installed with `Object.defineProperty`, so everything goes through `Reflect`.
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** One snapshot of the running game, as plain values. */
export interface VtState {
  screen: string;
  /** Draw calls of the last frame; 0 before the scene exists. */
  calls: number;
  fps: number;
  /** The active target, or null before the world is ready and after the last block. */
  text: string | null;
  typed: number;
  /** The key the session wants next (" " for a word's trailing space), or null. */
  next: string | null;
  paused: boolean;
  /** Active time of the live session (paused time is not counted). */
  elapsedMs: number;
  /** From `lastResult()`. */
  stars: number;
  lootTotal: number;
  correct: number;
  errors: number;
  done: number;
  netWpm: number;
  activeMs: number;
}

/** Reads `window.__vt` in the page and returns plain values. */
export async function state(page: Page): Promise<VtState> {
  return page.evaluate(() => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- reason: this runs in the page; page.evaluate sends only the function it is given
    const get = (o: unknown, k: string): unknown =>
      typeof o === "object" && o !== null ? Reflect.get(o, k) : undefined;
    const call = (o: unknown, k: string): unknown => {
      const fn = get(o, k);
      return typeof fn === "function" ? Reflect.apply(fn, o, []) : undefined;
    };
    const hooks: unknown = Reflect.get(window, "__vt");
    const session = call(hooks, "session");
    const a = get(session, "active");
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
      fps: Number(call(hooks, "fps") ?? 0),
      text,
      typed,
      next,
      paused: get(session, "paused") === true,
      elapsedMs: Number(get(session, "elapsedMs") ?? 0),
      stars: Number(get(result, "stars") ?? 0),
      lootTotal,
      correct: Number(get(summary, "correct") ?? 0),
      errors: Number(get(summary, "errors") ?? 0),
      done: Number(get(summary, "targetsCompleted") ?? 0),
      netWpm: Number(get(summary, "netWpm") ?? 0),
      activeMs: Number(get(summary, "activeMs") ?? 0),
    };
  });
}

/** The key the session wants next, or null when none is up. */
export async function nextKey(page: Page): Promise<string | null> {
  return (await state(page)).next;
}

/** Calls `window.__vt[name]()` in the page (awaiting promises) and returns the JSON result. */
export async function vt(page: Page, name: string): Promise<unknown> {
  return page.evaluate(async (fn) => {
    const hooks: unknown = Reflect.get(window, "__vt");
    if (typeof hooks !== "object" || hooks === null) throw new Error("no test hooks");
    const method: unknown = Reflect.get(hooks, fn);
    if (typeof method !== "function") throw new Error(`no hook ${fn}`);
    const out: unknown = await Reflect.apply(method, hooks, []);
    return out ?? null;
  }, name);
}

/** Waits for the shell, then for the current screen's assets. */
export async function ready(page: Page): Promise<void> {
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "1");
  await vt(page, "ready");
}

/**
 * Waits until a lesson takes keys. `__vt.session()` is null until the world is on the stage, and
 * keys before that are dropped (docs/handoffs/M2-13.md).
 */
export async function waitForLesson(page: Page): Promise<void> {
  await ready(page);
  await expect.poll(async () => (await state(page)).text, { timeout: 30_000 }).not.toBeNull();
}

/** Collects page errors and console errors, for an `expect(errors).toEqual([])` at the end. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}
