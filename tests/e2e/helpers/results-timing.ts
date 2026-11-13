/**
 * When the Results screen and its lines show, measured in the page (M4-FIX-7). A lesson's end
 * changes the route at once, but Results is a lazy screen: fetched only then, a server stall left
 * it empty for 10 s. The recorder runs in the page, so a slow test runner doesn't blur it.
 */
import type { Page } from "@playwright/test";

export interface ResultsTiming {
  /** ms from the route turning to `results` to the heading showing, or null if it never did. */
  heading: number | null;
  /** ms from the route change to every line in `lines` showing, or null. */
  lines: number | null;
}

/**
 * Starts recording, in the page: the moment `__vt.screen()` turns to `results`, the moment the
 * Results heading ("Lesson done!") shows in `#app`, and the moment every text in `lines` does.
 * Call it before the lesson ends.
 */
export async function watchResults(page: Page, lines: readonly string[]): Promise<void> {
  await page.evaluate((want) => {
    const marks: Record<string, number> = {};
    Reflect.set(window, "__vtResultsTiming", marks);
    const screen = (): unknown => {
      const hooks: unknown = Reflect.get(window, "__vt");
      const fn: unknown =
        typeof hooks === "object" && hooks !== null ? Reflect.get(hooks, "screen") : undefined;
      return typeof fn === "function" ? Reflect.apply(fn, hooks, []) : null;
    };
    const check = (): void => {
      const now = performance.now();
      if (marks["route"] === undefined && screen() === "results") marks["route"] = now;
      const text = document.querySelector("#app")?.textContent ?? "";
      if (marks["heading"] === undefined && text.includes("Lesson done!")) marks["heading"] = now;
      if (marks["lines"] === undefined && want.every((l) => text.includes(l))) marks["lines"] = now;
    };
    // The DOM change is caught as it happens; the timer catches the route change itself.
    new MutationObserver(check).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    setInterval(check, 5);
  }, lines);
}

/** Reads what {@link watchResults} recorded. */
export async function resultsTiming(page: Page): Promise<ResultsTiming> {
  return page.evaluate(() => {
    const marks: unknown = Reflect.get(window, "__vtResultsTiming");
    const at = (k: string): number | null => {
      const v: unknown = typeof marks === "object" && marks !== null ? Reflect.get(marks, k) : null;
      return typeof v === "number" ? v : null;
    };
    const route = at("route");
    const since = (k: string): number | null => {
      const v = at(k);
      return v === null || route === null ? null : Math.round(v - route);
    };
    return { heading: since("heading"), lines: since("lines") };
  });
}
