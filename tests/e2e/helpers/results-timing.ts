/**
 * When the Results screen and its lines show, measured in the page (M4-FIX-7). A lesson's end
 * changes the route at once, but Results is a lazy screen: fetched only then, a server stall left
 * it empty for 10 s. The recorder runs in the page, so a slow test runner doesn't blur it.
 *
 * It also keeps a short trace of what the page showed between the route change and the lines
 * (`trace`), for the CI log: on CI the gap was about 2 s, against under 0.1 s locally.
 */
import type { Page } from "@playwright/test";

export interface ResultsTiming {
  /** ms from the route turning to `results` to the heading showing, or null if it never did. */
  heading: number | null;
  /** ms from the route change to every line in `lines` showing, or null. */
  lines: number | null;
  /** What happened from just before the route change to the lines, one entry per event. */
  trace: string;
}

/**
 * Starts recording, in the page: the moment `__vt.screen()` turns to `results`, the moment the
 * Results heading ("Lesson done!") shows in `#app`, and the moment every text in `lines` does.
 * Call it before the lesson ends.
 */
export async function watchResults(page: Page, lines: readonly string[]): Promise<void> {
  await page.evaluate((want) => {
    const marks: Record<string, number> = {};
    const trace: string[] = [];
    Reflect.set(window, "__vtResultsTiming", marks);
    Reflect.set(window, "__vtResultsTrace", trace);
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- reason: this runs in the page; page.evaluate sends only the function it is given
    const screen = (): unknown => {
      const hooks: unknown = Reflect.get(window, "__vt");
      const fn: unknown =
        typeof hooks === "object" && hooks !== null ? Reflect.get(hooks, "screen") : undefined;
      return typeof fn === "function" ? Reflect.apply(fn, hooks, []) : null;
    };
    // Events from the route change until the lines, plus long tasks and frames around them.
    const open = (): boolean => marks["route"] !== undefined && marks["lines"] === undefined;
    const note = (what: string): void => {
      if (trace.length < 60) trace.push(`${Math.round(performance.now())} ${what}`);
    };
    const check = (via: string) => (): void => {
      const now = performance.now();
      const wasOpen = open();
      if (marks["route"] === undefined && screen() === "results") marks["route"] = now;
      const app = document.querySelector("#app");
      const text = app?.textContent ?? "";
      if (marks["heading"] === undefined && text.includes("Lesson done!")) marks["heading"] = now;
      if (marks["lines"] === undefined && want.every((l) => text.includes(l))) marks["lines"] = now;
      if (wasOpen || open() || marks["lines"] === now) {
        const shown = app?.querySelector<HTMLElement>("[data-route]")?.dataset["route"] ?? "?";
        note(`${via} route=${String(screen())} shown=${shown} text=${text.length}`);
      }
    };
    new MutationObserver(check("dom")).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-route"],
    });
    setInterval(check("tick"), 5);
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (marks["lines"] === undefined && e.duration > 50)
            note(`longtask at ${Math.round(e.startTime)} for ${Math.round(e.duration)}`);
      }).observe({ type: "longtask" });
    } catch {
      // No long-task timing in this browser.
    }
    const frame = (): void => {
      if (open()) note("frame");
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
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
    const raw: unknown = Reflect.get(window, "__vtResultsTrace");
    const chunks = performance
      .getEntriesByType("resource")
      .filter((e) => /\/Results-[^/]*\.js$/.test(e.name))
      .map(
        (e) =>
          `results chunk fetched ${Math.round(e.startTime)}–${Math.round(e.startTime + e.duration)}`,
      );
    const lines = Array.isArray(raw) ? raw.map(String) : [];
    return {
      heading: since("heading"),
      lines: since("lines"),
      trace: [`route at ${route === null ? "?" : Math.round(route)}`, ...chunks, ...lines].join(
        " | ",
      ),
    };
  });
}
