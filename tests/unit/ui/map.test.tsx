/** @jsxImportSource preact */
/**
 * World map (task M3-04): the map and the lesson path work from the keyboard alone and name
 * everything for a screen reader, through the real app shell and input router. There is no WebGL
 * here, so the map runs flat: the same buttons the 3D map shows, without the islands behind them
 * (`tests/unit/render/map.test.ts` covers the 3D view, the e2e the two together).
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyResult } from "../../../src/app/progress";
import { lessons } from "../../../src/content/lessons";
import { t } from "../../../src/i18n";
import en from "../../../src/i18n/en";
import type { Profile } from "../../../src/save/schema";
import { BiomePath } from "../../../src/ui/screens/BiomePath";
import {
  islandInfos,
  islandLabel,
  lessonNodes,
  nodeLabel,
  opensAfter,
  practiceCamp,
  recommendedLesson,
  startIsland,
} from "../../../src/ui/screens/map-logic";
import { resetMapMemory } from "../../../src/ui/screens/WorldMap";
import { result, summary } from "../app/helpers";
import type { Harness } from "./screens/harness";
import { buttonByText, fixture, mount, text } from "./screens/harness";

let h: Harness | null = null;
afterEach(() => {
  h?.unmount();
  h = null;
  resetMapMemory();
});

async function openMap(profile: Profile): Promise<Harness> {
  h = await mount({ initial: { id: "map" }, initialProfile: profile });
  return h;
}

const active = (): HTMLElement | null =>
  document.activeElement instanceof HTMLElement ? document.activeElement : null;
/** A button's name: its hidden sentence, or its `aria-label`. */
const label = (el: Element | null): string =>
  el?.querySelector("[data-label]")?.textContent ?? el?.getAttribute("aria-label") ?? "";
const island = (root: HTMLElement, biome: string): HTMLButtonElement => {
  const el = root.querySelector<HTMLButtonElement>(`[data-spot="${biome}"] button`);
  if (!el) throw new Error(`no island ${biome}`);
  return el;
};
const node = (root: HTMLElement, id: string): HTMLButtonElement => {
  const el = root.querySelector<HTMLButtonElement>(`[data-lesson="${id}"]`);
  if (!el) throw new Error(`no lesson node ${id}`);
  return el;
};

/** `profile` after playing `id` for `stars`. */
function played(profile: Profile, id: string, stars: 0 | 1 | 2 | 3): Profile {
  const lesson = lessons.find((l) => l.id === id);
  if (!lesson) throw new Error(`no lesson ${id}`);
  return applyResult(profile, lesson, result({ stars, summary: summary({ lessonId: id }) }), 1);
}

describe("map logic", () => {
  const sprout = fixture("fresh-sprout");

  it("recommends the first open lesson not played yet", () => {
    expect(recommendedLesson(sprout, lessons)?.id).toBe("meadow-01");
    expect(recommendedLesson(played(sprout, "meadow-01", 1), lessons)?.id).toBe("meadow-02");
  });

  it("with every open lesson played, recommends the one with the fewest stars, else none", () => {
    let p = sprout;
    for (const id of ["meadow-01", "meadow-02", "meadow-03", "meadow-04", "meadow-05"]) {
      p = played(p, id, 3);
    }
    p = played(p, "meadow-06", 3);
    expect(recommendedLesson(p, lessons)).toBeNull();
    const weak = played(sprout, "meadow-01", 2);
    const all = ["meadow-02", "meadow-03", "meadow-04", "meadow-05", "meadow-06"].reduce(
      (acc, id) => played(acc, id, id === "meadow-04" ? 1 : 3),
      weak,
    );
    expect(recommendedLesson(all, lessons)?.id).toBe("meadow-04");
  });

  it("a lesson opens when the one before it has been played; a locked biome's never do", () => {
    const nodes = lessonNodes(played(sprout, "meadow-01", 0), lessons, "meadow");
    expect(nodes.map((n) => n.open)).toEqual([true, true, false, false, false, false]);
    expect(nodes.map((n) => n.next)).toEqual([false, true, false, false, false, false]);
    expect(nodes[0]).toMatchObject({ n: 1, played: true, stars: 0 });
    expect(lessonNodes(sprout, lessons, "birch")).toEqual([]);
  });

  it("lists nine islands with their counts, and which island opens which", () => {
    const miner = fixture("meadow-done-miner");
    const infos = islandInfos(miner, lessons);
    expect(infos.map((i) => i.biome)).toHaveLength(9);
    expect(infos[0]).toMatchObject({
      biome: "meadow",
      unlocked: true,
      total: 6,
      done: 6,
      stars: 16,
    });
    expect(infos[1]).toMatchObject({
      biome: "birch",
      unlocked: true,
      total: 0,
      opensAfter: "meadow",
    });
    expect(infos[2]).toMatchObject({ biome: "shore", unlocked: false, opensAfter: "birch" });
    expect(opensAfter("meadow")).toBeNull();
    expect(opensAfter("sparkstone")).toBe("caverns");
    expect(opensAfter("citadel")).toBe("caverns");
    expect(startIsland(infos)).toBe("meadow");
    expect(startIsland(islandInfos(sprout, lessons))).toBe("meadow");
  });

  it("names islands and lessons for a screen reader", () => {
    const [meadow, birch, shore] = islandInfos(played(sprout, "meadow-01", 1), lessons);
    expect(meadow && islandLabel(meadow)).toBe(
      "Meadow Home, 1 of 6 lessons done, 1 star. Go here next!",
    );
    expect(birch && islandLabel(birch)).toBe(
      "Birch Forest. In the clouds for now. Finish Meadow Home to get here.",
    );
    expect(shore && islandLabel(shore)).toContain("Finish Birch Forest");
    expect(
      islandLabel({
        biome: "birch",
        name: "Birch Forest",
        unlocked: true,
        total: 15,
        done: 4,
        stars: 9,
        opensAfter: "meadow",
        next: false,
      }),
    ).toBe("Birch Forest, 4 of 15 lessons done, 9 stars");
    const nodes = lessonNodes(played(sprout, "meadow-01", 2), lessons, "meadow");
    expect(nodes.map(nodeLabel)).toEqual([
      "Lesson 1: Find F and J. 2 stars out of 3.",
      "Lesson 2: Hello, D and K. Play this one next!",
      "Lesson 3. Finish lesson 2 first.",
      "Lesson 4. Finish lesson 3 first.",
      "Lesson 5. Finish lesson 4 first.",
      "Lesson 6. Finish lesson 5 first.",
    ]);
  });

  it("leaves the practice camp to M3-06: no camp is suggested yet", () => {
    expect(practiceCamp(sprout, "meadow")).toBeNull();
  });
});

describe("World map", () => {
  it("shows nine islands; only open ones can be reached, and the next one has focus", async () => {
    const s = await openMap(fixture("fresh-sprout"));
    expect(text(s.root.querySelector("h1"))).toBe(t("map.title"));
    const all = [...s.root.querySelectorAll<HTMLButtonElement>("[data-spot] button")];
    expect(all).toHaveLength(9);
    expect(all.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    const meadow = island(s.root, "meadow");
    expect(active()).toBe(meadow);
    expect(label(meadow)).toBe("Meadow Home, 0 of 6 lessons done, 0 stars. Go here next!");
    expect(text(meadow)).toContain(t("map.island.next"));
    const birch = island(s.root, "birch");
    expect(birch.getAttribute("aria-disabled")).toBe("true");
    expect(birch.tabIndex).toBe(-1);
    expect(label(birch)).toContain("In the clouds for now");
    // A locked island does nothing when clicked.
    void act(() => birch.click());
    await s.settle();
    expect(s.root.querySelector("h2")).toBeNull();
  });

  it("keyboard only: Enter goes in, Enter on the pulsing lesson opens its intro", async () => {
    const s = await openMap(fixture("fresh-sprout"));
    await s.press("Enter");
    expect(text(s.root.querySelector("h2"))).toBe("Meadow Home");
    const first = node(s.root, "meadow-01");
    expect(active()).toBe(first);
    expect(first.dataset["state"]).toBe("next");
    expect(text(first)).toContain(t("map.path.next"));
    expect(label(first)).toBe("Lesson 1: Find F and J. Play this one next!");
    expect(text(s.root)).toContain("0 of 6 lessons done");
    // The island buttons are out of the way while the path is open.
    expect(s.root.querySelector("ul[hidden]")).not.toBeNull();
    await s.press("Enter");
    expect(s.route()).toEqual({ id: "lessonIntro", lesson: "meadow-01" });
  });

  it("the arrows move between open islands only, then to the last button, and wrap", async () => {
    const s = await openMap(fixture("meadow-done-miner"));
    const meadow = island(s.root, "meadow");
    const birch = island(s.root, "birch");
    // Every Meadow lesson is played and Birch has none yet, so the one with the fewest stars is next.
    expect(label(meadow)).toBe("Meadow Home, 6 of 6 lessons done, 16 stars. Go here next!");
    expect(label(birch)).toBe("Birch Forest. New lessons are coming soon.");
    expect(active()).toBe(meadow);
    await s.press("ArrowRight");
    expect(active()).toBe(birch);
    await s.press("ArrowDown");
    expect(text(active())).toBe(t("map.players"));
    await s.press("ArrowRight");
    expect(active()).toBe(meadow);
    await s.press("ArrowLeft");
    expect(text(active())).toBe(t("map.players"));
    await s.press("ArrowUp");
    expect(active()).toBe(birch);
  });

  it("an island without lessons says so; Escape leaves the path, then goes to the players", async () => {
    h = await mount({ initialProfile: fixture("meadow-done-miner") });
    const s = h;
    s.shell.api.navigate({ id: "map" });
    await s.settle();
    await s.press("ArrowRight");
    await s.press("Enter");
    expect(text(s.root.querySelector("h2"))).toBe("Birch Forest");
    expect(text(s.root)).toContain(t("map.path.empty"));
    expect(text(active())).toBe(t("map.path.back"));
    await s.press("Escape");
    expect(s.route().id).toBe("map");
    expect(s.root.querySelector("h2")).toBeNull();
    expect(active()).toBe(island(s.root, "birch"));
    await s.press("Escape");
    expect(s.route().id).toBe("profiles");
    // And Escape there comes back to the map.
    await s.press("Escape");
    expect(s.route().id).toBe("map");
  });

  it("on a path, the arrows skip lessons that aren't open yet", async () => {
    const s = await openMap(played(fixture("fresh-sprout"), "meadow-01", 2));
    await s.press("Enter");
    const second = node(s.root, "meadow-02");
    expect(active()).toBe(second);
    const third = node(s.root, "meadow-03");
    expect(third.getAttribute("aria-disabled")).toBe("true");
    expect(third.dataset["state"]).toBe("locked");
    await s.press("ArrowRight");
    expect(text(active())).toBe(t("map.path.back"));
    await s.press("ArrowRight");
    expect(active()).toBe(node(s.root, "meadow-01"));
    expect(node(s.root, "meadow-01").querySelectorAll("svg[data-earned]")).toHaveLength(2);
    // A locked lesson does nothing when clicked.
    void act(() => third.click());
    await s.settle();
    expect(s.route().id).toBe("map");
  });

  it("after a lesson, the map comes back on the same island with the node updated", async () => {
    const s = await openMap(fixture("fresh-sprout"));
    await s.press("Enter");
    await s.press("Enter");
    expect(s.route()).toEqual({ id: "lessonIntro", lesson: "meadow-01" });
    const before = s.shell.api.profile();
    if (!before) throw new Error("no profile");
    // The lesson is played (play-host folds the result in and saves); Results then goes to the map.
    s.shell.api.setProfile(played(before, "meadow-01", 3));
    s.shell.api.navigate({ id: "map" }, { replace: true });
    await s.settle();
    expect(text(s.root.querySelector("h2"))).toBe("Meadow Home");
    const first = node(s.root, "meadow-01");
    expect(first.dataset["state"]).toBe("done");
    expect(first.querySelectorAll("svg[data-earned]")).toHaveLength(3);
    expect(label(first)).toBe("Lesson 1: Find F and J. 3 stars out of 3.");
    const second = node(s.root, "meadow-02");
    expect(second.dataset["state"]).toBe("next");
    expect(active()).toBe(second);
    expect(text(s.root)).toContain("1 of 6 lessons done");
    // The memory is used once: the next plain visit shows the whole map.
    s.shell.api.navigate({ id: "profiles" });
    await s.settle();
    s.shell.api.navigate({ id: "map" });
    await s.settle();
    expect(s.root.querySelector("h2")).toBeNull();
    expect(active()).toBe(island(s.root, "meadow"));
  });

  it("a newly opened island brings the whole map back, not the old path", async () => {
    const s = await openMap(fixture("fresh-sprout"));
    await s.press("Enter");
    await s.press("Enter");
    const before = s.shell.api.profile();
    if (!before) throw new Error("no profile");
    s.shell.api.setProfile({
      ...before,
      progress: { ...before.progress, unlockedBiomes: ["meadow", "birch"] },
    });
    s.shell.api.navigate({ id: "map" }, { replace: true });
    await s.settle();
    expect(s.root.querySelector("h2")).toBeNull();
    expect(island(s.root, "birch").tabIndex).toBe(0);
  });

  it("a held Enter goes in once and does not start a lesson; sounds stay gentle", async () => {
    const s = await openMap(fixture("fresh-sprout"));
    await s.press("Enter");
    expect(s.audio.sfx.mock.calls).toEqual([["whoosh"]]);
    const held = await s.press("Enter", { repeat: true });
    expect(held.defaultPrevented).toBe(true);
    expect(s.route().id).toBe("map");
    expect(text(s.root.querySelector("h2"))).toBe("Meadow Home");
  });

  it("the mouse works too: click an island, then Back to the map, then Change player", async () => {
    const s = await openMap(fixture("pinky-weak"));
    void act(() => island(s.root, "meadow").click());
    await s.settle();
    expect(text(s.root.querySelector("h2"))).toBe("Meadow Home");
    void act(() => buttonByText(s.root, t("map.path.back")).click());
    await s.settle();
    expect(s.root.querySelector("h2")).toBeNull();
    void act(() => buttonByText(s.root, t("map.players")).click());
    await s.settle();
    expect(s.route().id).toBe("profiles");
  });

  it("without a player, offers the way to pick one", async () => {
    h = await mount({ initial: { id: "map" } });
    expect(text(h.root)).toContain(t("map.noPlayer.body"));
    expect(text(active())).toBe(t("map.noPlayer.go"));
    await h.press("Enter");
    expect(h.route().id).toBe("profiles");
  });
});

describe("BiomePath", () => {
  it("draws a practice camp before the lessons when one is suggested (the M3-06 hook)", () => {
    const profile = fixture("pinky-weak");
    const [meadow] = islandInfos(profile, lessons);
    if (!meadow) throw new Error("no meadow");
    const open = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    void act(() =>
      render(
        <BiomePath
          info={meadow}
          nodes={lessonNodes(profile, lessons, "meadow")}
          camp={{ label: "Practice camp", open }}
          onPick={() => undefined}
          onBack={() => undefined}
        />,
        host,
      ),
    );
    const steps = [...host.querySelectorAll("ol > li > button")];
    expect(steps).toHaveLength(7);
    expect(label(steps[0] ?? null)).toBe("Practice camp");
    expect(steps[0]?.getAttribute("data-state")).toBe("camp");
    void act(() => (steps[0] instanceof HTMLButtonElement ? steps[0].click() : undefined));
    expect(open).toHaveBeenCalledTimes(1);
    void act(() => render(null, host));
    host.remove();
  });
});

describe("map copy", () => {
  const strings: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") strings.push(v);
    else if (typeof v === "object" && v !== null) Object.values(v).forEach(walk);
  };
  walk(en.map);

  it("is warm and short: no pressure words, nothing shouted", () => {
    expect(strings.length).toBeGreaterThan(25);
    for (const s of strings) {
      expect(s, s).not.toMatch(/\b(wrong|fail|failed|bad|can't|cannot|must|hurry|locked)\b/i);
      expect(s.replace(/\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, "").length, s).toBeLessThan(70);
    }
  });

  it("names the nine biomes as PLAN.md §3.1 does", () => {
    expect(Object.values(en.map.biome)).toEqual([
      "Meadow Home",
      "Birch Forest",
      "Sandy Shore",
      "Frosty Peaks",
      "Deep Mines",
      "Mushroom Marsh",
      "Crystal Caverns",
      "Sparkstone Factory",
      "Sky Citadel",
    ]);
  });
});
