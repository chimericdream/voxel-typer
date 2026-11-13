/** @jsxImportSource preact */
/**
 * My Badges and the badge toast (task M3-10).
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { achievements } from "../../../src/content/achievements";
import { t } from "../../../src/i18n";
import { AchievementToast, BADGE_TOAST_MS } from "../../../src/ui/components/AchievementToast";
import { attachRouteAnnouncer } from "../../../src/a11y/route-announcer";
import { BADGE_SETTLE_MS } from "../../../src/app/App";
import { screens } from "../../../src/app/routes";
import { announce, announcer } from "../../../src/ui/kit/announce";
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
