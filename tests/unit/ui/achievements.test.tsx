/** @jsxImportSource preact */
/**
 * My Badges and the badge toast (task M3-10).
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { achievements } from "../../../src/content/achievements";
import { t } from "../../../src/i18n";
import {
  AchievementToast,
  BADGE_TOAST_MS,
  clearBelow,
} from "../../../src/ui/components/AchievementToast";
import { hiddenParts } from "../../../src/ui/screens/Achievements";
import { Dialog } from "../../../src/ui/kit/Dialog";
import { attachRouteAnnouncer } from "../../../src/a11y/route-announcer";
import { BADGE_SETTLE_MS } from "../../../src/app/App";
import { screens } from "../../../src/app/routes";
import {
  FIRST_ANNOUNCE_MS,
  TOAST_AFTER_PAGE_MS,
  announce,
  announcer,
} from "../../../src/ui/kit/announce";
import type { Harness } from "./screens/harness";
import { fixture, mount, text } from "./screens/harness";

let h: Harness | null = null;
afterEach(() => {
  h?.unmount();
  h = null;
  vi.useRealTimers();
});

describe("My Badges", () => {
  it("lists every badge, earned ones marked, and focuses Back", async () => {
    const vet = fixture("veteran-builder");
    h = await mount({ initial: { id: "achievements" }, initialProfile: vet });
    const cards = [...h.root.querySelectorAll("[data-badge]")];
    expect(cards).toHaveLength(achievements.length);
    const earned = cards
      .filter((c) => c.hasAttribute("data-earned"))
      .map((c) => c.getAttribute("data-badge"));
    expect(earned.toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "first-lesson",
      "meadow-master",
    ]);
    expect(text(h.root)).toContain(t("achievements.count", { got: 2, total: achievements.length }));
    expect(text(h.root.querySelector('[data-badge="first-lesson"]'))).toContain(
      t("achievements.got"),
    );
    expect(document.activeElement?.textContent).toBe(t("achievements.back"));
  });

  it("keeps a surprise badge's name to itself until it is earned", async () => {
    const sprout = fixture("fresh-sprout");
    h = await mount({ initial: { id: "achievements" }, initialProfile: sprout });
    const card = text(h.root.querySelector('[data-badge="early-bird"]'));
    expect(card).toContain(t("achievements.hiddenName"));
    expect(card).not.toContain(t("achievements.earlyBird.name"));
    h.unmount();
    h = await mount({
      initial: { id: "achievements" },
      initialProfile: { ...sprout, achievements: { "early-bird": 1 } },
    });
    expect(text(h.root.querySelector('[data-badge="early-bird"]'))).toContain(
      t("achievements.earlyBird.name"),
    );
  });

  it("Escape goes back", async () => {
    h = await mount({ initial: { id: "map" }, initialProfile: fixture("fresh-sprout") });
    h.shell.api.navigate({ id: "achievements" });
    await h.settle();
    expect(h.route().id).toBe("achievements");
    await h.press("Escape");
    expect(h.route().id).toBe("map");
  });
});

/** Gives `el` the scroll measurements a browser would, then tells it it scrolled. */
function scrollTo(el: HTMLElement, at: { top: number; client: number; content: number }): void {
  Object.defineProperty(el, "clientHeight", { configurable: true, value: at.client });
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: at.content });
  Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: at.top });
  el.dispatchEvent(new Event("scroll"));
}

describe("My Badges shows that it scrolls (M3-FIX-8)", () => {
  it("reads what a scroll area hides", () => {
    expect(hiddenParts(0, 400, 400)).toEqual({ above: false, below: false });
    expect(hiddenParts(0, 400, 1000)).toEqual({ above: false, below: true });
    expect(hiddenParts(300, 400, 1000)).toEqual({ above: true, below: true });
    expect(hiddenParts(600, 400, 1000)).toEqual({ above: true, below: false });
    // Subpixel scroll positions at the ends still count as the end.
    expect(hiddenParts(599.5, 400, 1000)).toEqual({ above: true, below: false });
    expect(hiddenParts(1, 400, 1000)).toEqual({ above: false, below: true });
  });

  it("fades the cut edge and shows a 'More badges below' cue until the end, which scrolls on a click", async () => {
    h = await mount({
      initial: { id: "achievements" },
      initialProfile: fixture("veteran-builder"),
    });
    const list = h.root.querySelector<HTMLElement>("section[tabindex='0']");
    if (!list) throw new Error("no badge list");
    // Everything fits: no fade, no cue.
    scrollTo(list, { top: 0, client: 900, content: 900 });
    await h.settle();
    expect(h.root.querySelector("[data-testid='badges-more']")).toBeNull();
    expect(list.hasAttribute("data-below")).toBe(false);

    // Badges hidden below: the bottom fades and the cue shows.
    scrollTo(list, { top: 0, client: 300, content: 900 });
    await h.settle();
    const more = h.root.querySelector<HTMLButtonElement>("[data-testid='badges-more']");
    expect(more?.textContent).toBe(t("achievements.moreBelow"));
    expect(more?.hasAttribute("data-show")).toBe(true);
    expect(more?.tabIndex).toBe(-1);
    expect(list.hasAttribute("data-below")).toBe(true);
    expect(list.hasAttribute("data-above")).toBe(false);
    // Every badge is in the list for a screen reader, hidden or not, and the list takes focus.
    expect(list.querySelectorAll("[data-badge]")).toHaveLength(achievements.length);
    expect(list.tabIndex).toBe(0);

    // A click scrolls most of a screenful down.
    const scrollBy = vi.fn();
    list.scrollBy = scrollBy;
    more?.click();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    const arg: unknown = scrollBy.mock.calls[0]?.[0];
    expect(arg).toMatchObject({ top: 240 });

    // The middle: both edges fade.
    scrollTo(list, { top: 300, client: 300, content: 900 });
    await h.settle();
    expect(list.hasAttribute("data-above")).toBe(true);
    expect(list.hasAttribute("data-below")).toBe(true);

    // The end: the cue goes (its room stays, so the list doesn't jump).
    scrollTo(list, { top: 600, client: 300, content: 900 });
    await h.settle();
    expect(list.hasAttribute("data-below")).toBe(false);
    expect(h.root.querySelector("[data-testid='badges-more']")?.hasAttribute("data-show")).toBe(
      false,
    );
  });
});

function show(queue: string[], open: boolean, onShown = vi.fn()) {
  const root = document.createElement("div");
  document.body.append(root);
  void act(() => render(<AchievementToast queue={queue} open={open} onShown={onShown} />, root));
  const done = (): void => {
    void act(() => render(null, root));
    root.remove();
  };
  return { root, onShown, done };
}

describe("badge toast", () => {
  it("waits while closed (a child is typing), then shows one badge for a while", () => {
    vi.useFakeTimers();
    const closed = show(["first-word", "first-ore"], false);
    expect(closed.root.textContent).toBe("");
    vi.advanceTimersByTime(BADGE_TOAST_MS * 2);
    expect(closed.onShown).not.toHaveBeenCalled();
    closed.done();

    const open = show(["first-word", "first-ore"], true);
    expect(text(open.root)).toContain(
      t("achievements.toast", { name: t("achievements.firstWord.name") }),
    );
    expect(text(open.root)).not.toContain(t("achievements.firstOre.name"));
    vi.advanceTimersByTime(BADGE_TOAST_MS - 1);
    expect(open.onShown).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(open.onShown).toHaveBeenCalledTimes(1);
    open.done();
  });

  it("skips an id this build doesn't know", () => {
    vi.useFakeTimers();
    const s = show(["from-a-newer-build"], true);
    expect(s.root.textContent).toBe("");
    vi.advanceTimersByTime(0);
    expect(s.onShown).toHaveBeenCalledTimes(1);
    s.done();
  });
});

/** A kit Dialog in its own root, opened and closed by `set`. */
function modal(): { set: (open: boolean) => void; done: () => void } {
  const root = document.createElement("div");
  document.body.append(root);
  const set = (open: boolean): void => {
    void act(() =>
      render(
        <Dialog open={open} onClose={() => {}} title="Pause" closeLabel="Close">
          <button type="button">Go on</button>
        </Dialog>,
        root,
      ),
    );
  };
  return {
    set,
    done: () => {
      void act(() => render(null, root));
      root.remove();
    },
  };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("a badge toast under a modal (M3-FIX-8)", () => {
  it("waits while a modal is open, then shows and reads it out once the modal closes", async () => {
    // Toasts speak in their own region (M3-FIX-4), at least TOAST_AFTER_PAGE_MS after a page message.
    const region = announcer(document, "toast").region;
    const spoken: string[] = [];
    const watch = new MutationObserver(() => {
      const now = region.textContent ?? "";
      if (now !== "") spoken.push(now);
    });
    watch.observe(region, { childList: true, characterData: true, subtree: true });
    const dialog = modal();
    dialog.set(true);
    expect(document.querySelector("dialog[open]")).not.toBeNull();
    const s = show(["first-word"], true);
    const badge = t("achievements.toast", { name: t("achievements.firstWord.name") });
    try {
      await wait(TOAST_AFTER_PAGE_MS + FIRST_ANNOUNCE_MS + 100);
      // Held: not drawn, not read, and its time on screen hasn't started.
      expect(s.root.textContent).toBe("");
      expect(spoken).not.toContain(badge);
      expect(s.onShown).not.toHaveBeenCalled();

      dialog.set(false);
      expect(document.querySelector("dialog[open]")).toBeNull();
      await wait(TOAST_AFTER_PAGE_MS + FIRST_ANNOUNCE_MS + 100);
      expect(text(s.root)).toContain(badge);
      expect(spoken.at(-1)).toBe(badge);
      expect(s.onShown).not.toHaveBeenCalled();
    } finally {
      watch.disconnect();
      s.done();
      dialog.done();
    }
  });

  it("puts a toast already up away when a modal opens, and shows it again in full after", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const dialog = modal();
    const s = show(["first-word"], true);
    const badge = t("achievements.toast", { name: t("achievements.firstWord.name") });
    try {
      expect(text(s.root)).toContain(badge);
      vi.advanceTimersByTime(BADGE_TOAST_MS - 500);
      dialog.set(true);
      await vi.waitFor(() => expect(s.root.textContent).toBe(""));
      vi.advanceTimersByTime(BADGE_TOAST_MS * 2);
      expect(s.onShown).not.toHaveBeenCalled();
      dialog.set(false);
      // (vi.waitFor moves fake time on by a few 50 ms steps while it polls.)
      await vi.waitFor(() => expect(text(s.root)).toContain(badge));
      // Its full time again, not the 500 ms it had left.
      vi.advanceTimersByTime(BADGE_TOAST_MS - 1000);
      expect(s.onShown).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(s.onShown).toHaveBeenCalledTimes(1);
    } finally {
      s.done();
      dialog.done();
    }
  });
});

describe("a badge toast keeps clear of the map's corner (M3-FIX-8)", () => {
  it("sits below every data-toast-clear element, and moves when one grows", () => {
    const corner = document.createElement("div");
    corner.setAttribute("data-toast-clear", "");
    let bottom = 60;
    corner.getBoundingClientRect = () => new DOMRect(900, 12, 360, bottom - 12);
    document.body.append(corner);
    const s = show(["first-word"], true);
    try {
      expect(clearBelow(document)).toBe(60);
      // Only what is above or below the toast counts: a heading on the left doesn't push it down.
      const heading = document.createElement("header");
      heading.setAttribute("data-toast-clear", "");
      heading.getBoundingClientRect = () => new DOMRect(16, 70, 500, 80);
      document.body.append(heading);
      expect(clearBelow(document, { left: 900, right: 1264 })).toBe(60);
      expect(clearBelow(document, { left: 480, right: 1264 })).toBe(150);
      expect(clearBelow(document)).toBe(150);
      heading.remove();
      const wrap = s.root.querySelector<HTMLElement>("[data-testid='badge-toast']");
      expect(wrap?.style.top).toBe("72px");
      // Text scale 2: the corner row wraps and doubles.
      bottom = 130.4;
      window.dispatchEvent(new Event("resize"));
      expect(wrap?.style.top).toBe("143px");
      // No corner (an island's lesson path is open): the stylesheet's place.
      corner.remove();
      expect(clearBelow(document)).toBeNull();
      window.dispatchEvent(new Event("resize"));
      expect(wrap?.style.top).toBe("");
    } finally {
      s.done();
      corner.remove();
    }
  });
});

describe("badge toasts and the route announcer, each in its own live region (review B1, M3-07 N6)", () => {
  it("never opens on the play route; on Results the stars are read first, then the badge", async () => {
    h = await mount({ initialProfile: fixture("fresh-sprout"), initial: { id: "map" } });
    const s = h;
    const spoken: string[] = [];
    const off = attachRouteAnnouncer({
      route: s.shell.route,
      hasScreen: (id) => screens[id] !== undefined,
      lesson: (id) => s.shell.api.lesson(id),
      lastResult: () => s.shell.play.lastResult(),
      band: () => s.shell.profile.value?.ageBand ?? null,
      say: (msg) => {
        announce(document, msg);
      },
    });
    const regions = [announcer(document).region, announcer(document, "toast").region];
    const watch = new MutationObserver((records) => {
      for (const r of records) {
        const region = regions.find((el) => el.contains(r.target));
        const now = region?.textContent ?? "";
        if (now !== "" && spoken.at(-1) !== now) spoken.push(now);
      }
    });
    for (const region of regions) {
      watch.observe(region, { childList: true, characterData: true, subtree: true });
    }
    try {
      // A badge earned as the lesson finishes, while the route is still `play`.
      s.shell.api.navigate({ id: "play", lesson: "meadow-01" });
      await s.settle();
      s.shell.queueBadges(["first-lesson"]);
      await s.settle();
      await new Promise((r) => setTimeout(r, BADGE_SETTLE_MS + 200));
      await s.settle();
      expect(s.root.querySelector("[data-testid='badge-toast']")).toBeNull();

      s.shell.api.navigate({ id: "results", lesson: "meadow-01" }, { replace: true });
      await s.settle();
      await new Promise((r) => setTimeout(r, 300));
      await s.settle();
      // Results' own message is read, and the toast hasn't opened over it.
      expect(s.root.querySelector("[data-testid='badge-toast']")).toBeNull();
      const results = t("screens.results.title");
      expect(spoken.at(-1)).toBe(results);

      await new Promise((r) => setTimeout(r, BADGE_SETTLE_MS));
      await s.settle();
      const badge = t("achievements.toast", { name: t("achievements.firstLesson.name") });
      expect(text(s.root.querySelector("[data-testid='badge-toast']"))).toContain(badge);
      await new Promise((r) => setTimeout(r, 200));
      expect(spoken.filter((x) => x === results || x === badge)).toEqual([results, badge]);
    } finally {
      watch.disconnect();
      off();
    }
  }, 15_000);
});
