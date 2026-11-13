/** @jsxImportSource preact */
/**
 * World map (task M3-04): the map and the lesson path work from the keyboard alone and name
 * everything for a screen reader, through the real app shell and input router. There is no WebGL
 * here, so the map runs flat: the same buttons the 3D map shows, without the islands behind them
 * (`tests/unit/render/map.test.ts` covers the 3D view, the e2e the two together).
 */
import * as fc from "fast-check";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyResult } from "../../../src/app/progress";
import { lessons as shipped } from "../../../src/content/lessons";
import { REMEDIAL_EVERY } from "../../../src/engine/remedial";
import { t } from "../../../src/i18n";
import en from "../../../src/i18n/en";
import type { Profile } from "../../../src/save/schema";
import { BiomePath } from "../../../src/ui/screens/BiomePath";
import {
  LABEL_LAYOUT,
  islandInfos,
  islandLabel,
  layoutLabels,
  lessonNodes,
  nodeLabel,
  notYetLine,
  opensAfter,
  practiceCamp,
  recommendedLesson,
  startIsland,
} from "../../../src/ui/screens/map-logic";
import { LONG_PRESS_MS, resetMapMemory } from "../../../src/ui/screens/WorldMap";
import { result, summary } from "../app/helpers";
import type { Harness } from "./screens/harness";
import { buttonByText, fixture, mount, text } from "./screens/harness";

/**
 * The map is checked against a fixed curriculum, Meadow 1–6 (M2-12), so its counts and labels
 * don't change each time lessons are added. Birch and later biomes have no lessons here.
 */
const lessons = shipped.filter((l) => l.biome === "meadow" && l.order <= 6);

let h: Harness | null = null;
afterEach(() => {
  h?.unmount();
  h = null;
  resetMapMemory();
});

async function openMap(profile: Profile): Promise<Harness> {
  h = await mount({ lessons, initial: { id: "map" }, initialProfile: profile });
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

/** `p` with a shaky `d`, at session `at` (sessions 0, 4, 8, … are remedial offer slots). */
const weakD = (p: Profile, at: number = p.sessionCounter): Profile => ({
  ...p,
  sessionCounter: at,
  keyStats: {
    ...p.keyStats,
    d: {
      attempts: 80,
      errors: 40,
      recentErrRate: 0.5,
      latencyMedian: 400,
      recentLatencies: [400],
      lastSeenSession: 2,
      srs: { intervalSessions: 1, dueSession: 99 },
    },
  },
});

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

  it('"No Peeking!" can be skipped: the lesson after it opens with it, and the map moves on', () => {
    // The whole shipped Meadow: lesson 11 is its `challenge-hide-keyboard` lesson (M3-FIX-7).
    const meadow = shipped.filter((l) => l.biome === "meadow");
    const challenge = meadow.find((l) => l.tags?.includes("challenge-hide-keyboard") === true);
    if (!challenge) throw new Error("Meadow has no No Peeking! lesson");
    const after = meadow.find((l) => l.order === challenge.order + 1);
    if (!after) throw new Error("no lesson after the challenge");
    const play = (p: Profile, id: string): Profile => {
      const lesson = meadow.find((l) => l.id === id);
      if (!lesson) throw new Error(`no lesson ${id}`);
      return applyResult(p, lesson, result({ stars: 2, summary: summary({ lessonId: id }) }), 1);
    };
    const upTo = meadow.filter((l) => l.order < challenge.order);
    const before = upTo.reduce((p, l) => play(p, l.id), sprout);

    // Before the challenge is played, both it and the lesson after it are open.
    const nodes = lessonNodes(before, meadow, "meadow");
    const at = (id: string) => nodes.find((n) => n.lesson.id === id);
    expect(at(challenge.id)).toMatchObject({ open: true, played: false, next: true });
    expect(at(after.id)).toMatchObject({ open: true, played: false });
    // The lesson after that still waits for its own lesson before; its label names that one.
    const third = nodes.find((n) => n.lesson.order === challenge.order + 2);
    expect(third?.open).toBe(false);
    expect(third && nodeLabel(third)).toContain(String(after.order));

    // Skip it: play the next lesson. The challenge stays open and unplayed, and the map points on.
    const skipped = play(before, after.id);
    const later = lessonNodes(skipped, meadow, "meadow");
    expect(later.find((n) => n.lesson.id === challenge.id)).toMatchObject({
      open: true,
      played: false,
      next: false,
    });
    expect(recommendedLesson(skipped, meadow)?.order).toBe(challenge.order + 2);

    // The fewest-stars fallback never points back at a skipped challenge (M3-FIX-7 review):
    // every other Meadow lesson played, the mastery check at 1 star, the challenge unplayed.
    const mastery = meadow.find((l) => l.tags?.includes("mastery") === true);
    if (!mastery) throw new Error("Meadow has no mastery lesson");
    const allButChallenge = meadow
      .filter((l) => l.id !== challenge.id)
      .reduce(
        (p, l) =>
          applyResult(
            p,
            l,
            result({ stars: l.id === mastery.id ? 1 : 3, summary: summary({ lessonId: l.id }) }),
            1,
          ),
        sprout,
      );
    expect(recommendedLesson(allButChallenge, meadow)?.id).toBe(mastery.id);

    // Before any lesson that comes ahead of it is played, nothing opens past it.
    const fresh = lessonNodes(sprout, meadow, "meadow");
    expect(fresh.filter((n) => n.open).map((n) => n.n)).toEqual([1]);
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

  it("says which island opens a locked one, without pressure words", () => {
    const infos = islandInfos(sprout, lessons);
    const line = (b: string) => {
      const info = infos.find((i) => i.biome === b);
      if (!info) throw new Error(b);
      return notYetLine(info);
    };
    expect(line("birch")).toBe("Finish Meadow Home to open this island!");
    expect(line("sparkstone")).toBe("Finish Crystal Caverns to open this island!");
    const first = infos[0];
    if (!first) throw new Error("no meadow");
    expect(notYetLine({ ...first, unlocked: false })).toBe(t("map.island.notYetFirst"));
  });

  it("while a remedial is due, the next lesson still pulses and the camp sits beside it (M3-06)", () => {
    expect(practiceCamp(sprout, lessons, "meadow")).toBeNull();
    const shaky = weakD(played(played(sprout, "meadow-01", 2), "meadow-02", 2), REMEDIAL_EVERY);
    expect(practiceCamp(shaky, lessons, "birch")).toBeNull();
    const camp = practiceCamp(shaky, lessons, "meadow");
    expect(camp?.label).toBe(
      "Practice camp. Your left middle finger wants practice! Practice key: D.",
    );
    expect(camp?.lesson).toMatchObject({ biome: "meadow", newKeys: ["d"], mode: "mine" });
    // The camp is an optional side stop: every "next" cue stays on the next lesson.
    const nodes = lessonNodes(shaky, lessons, "meadow");
    expect(nodes.filter((n) => n.next).map((n) => n.lesson.id)).toEqual(["meadow-03"]);
    const next = nodes.find((n) => n.next);
    expect(next && nodeLabel(next)).toBe(
      t("map.path.lessonNext", { n: 3, title: next?.title ?? "", stars: 0 }),
    );
    expect(recommendedLesson(shaky, lessons)?.id).toBe("meadow-03");
    expect(islandInfos(shaky, lessons).find((i) => i.biome === "meadow")?.next).toBe(true);
  });

  it("after a biome unlock, the camp sits on the new island with its first lesson (M3-06)", () => {
    const twoBiomes = shipped.filter((l) => l.biome === "meadow" || l.biome === "birch");
    const meadowAll = twoBiomes.filter((l) => l.biome === "meadow");
    const done = meadowAll.reduce(
      (p, l) => applyResult(p, l, result({ stars: 3, summary: summary({ lessonId: l.id }) }), 1),
      sprout,
    );
    expect(done.progress.unlockedBiomes).toContain("birch");
    const p = weakD(done, 8 * REMEDIAL_EVERY);
    expect(practiceCamp(p, twoBiomes, "meadow")).toBeNull();
    const camp = practiceCamp(p, twoBiomes, "birch");
    expect(camp).not.toBeNull();
    // It still practises keys the child knows: its place (and keys) are Meadow's last lesson.
    expect(camp?.lesson.biome).toBe("meadow");
    const birch = lessonNodes(p, twoBiomes, "birch");
    expect(birch.filter((n) => n.next).map((n) => n.lesson.order)).toEqual([1]);
    const infos = islandInfos(p, twoBiomes);
    expect(infos.filter((i) => i.next).map((i) => i.biome)).toEqual(["birch"]);
    expect(startIsland(infos)).toBe("birch");
  });

  it("a camp passed by stays away for four sessions, then comes back (M3-06, M3-FIX-11)", () => {
    let p = weakD(played(played(sprout, "meadow-01", 2), "meadow-02", 2), REMEDIAL_EVERY);
    expect(practiceCamp(p, lessons, "meadow")).not.toBeNull();
    // The child plays lessons instead; `d` stays shaky (the helper's summaries only type `f`).
    for (const id of ["meadow-03", "meadow-04", "meadow-05"]) {
      p = played(p, id, 2);
      expect(practiceCamp(p, lessons, "meadow")).toBeNull();
    }
    p = played(p, "meadow-05", 3);
    expect(p.sessionCounter).toBe(2 * REMEDIAL_EVERY);
    expect(practiceCamp(p, lessons, "meadow")).not.toBeNull();
    // The stones never stopped pointing ahead.
    expect(recommendedLesson(p, lessons)?.id).toBe("meadow-06");
  });

  it("the practice camp opens its remedial lesson's intro, which the shell can find (M3-06)", async () => {
    const shaky = weakD(played(played(sprout, "meadow-01", 2), "meadow-02", 2), REMEDIAL_EVERY);
    const s = await openMap(shaky);
    void act(() => island(s.root, "meadow").click());
    await s.settle();
    const camp = s.root.querySelector<HTMLButtonElement>('[data-state="camp"]');
    expect(camp?.getAttribute("aria-label")).toContain("Your left middle finger wants practice!");
    // The camp shows a word a child can read, and it pulses gently (CSS); the next stone keeps
    // the pulse, the "Next" tag and the first focus.
    expect(text(camp)).toBe(t("remedial.campTag"));
    expect(active()?.dataset["lesson"]).toBe("meadow-03");
    void act(() => camp?.click());
    await s.settle();
    const route = s.route();
    expect(route.id).toBe("lessonIntro");
    expect(route.lesson?.startsWith("remedial-")).toBe(true);
    expect(s.shell.api.lesson(route.lesson ?? "")?.newKeys).toEqual(["d"]);
    expect(text(s.root.querySelector("h1"))).toBe("Your left middle finger wants practice!");
    // The keys are known ones: "Practice keys", never "New keys".
    expect(text(s.root.querySelector("h2"))).toBe(t("remedial.practiceKeys"));
  });
});

/** A pointer event of the given kind, for happy-dom (which has no PointerEvent constructor). */
const pointer = (type: string, pointerType = "touch"): Event => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "pointerType", { value: pointerType });
  return e;
};
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
    // A new player sees words, not "★ 0 0 of 6": the star count waits for the first star.
    expect(text(meadow.querySelector("[aria-hidden]:last-child"))).toBe("0 of 6 done");
    expect(meadow.querySelector("svg")).toBeNull();
  });

  it("the meta line shows the star count once there are stars", async () => {
    const s = await openMap(fixture("meadow-done-miner"));
    const meta = text(island(s.root, "meadow").querySelector("[aria-hidden]:last-child"));
    expect(meta).toBe("6 of 6 done16");
  });

  it("clicking an island in the clouds says kindly what opens it, and goes nowhere", async () => {
    const s = await openMap(fixture("fresh-sprout"));
    const note = () => text(s.root.querySelector("[data-note]"));
    expect(note()).toBe("");
    // An <output>: a polite live region, so a screen reader hears the line.
    expect(s.root.querySelector("[data-note]")?.tagName).toBe("OUTPUT");
    void act(() => island(s.root, "birch").click());
    await s.settle();
    expect(s.root.querySelector("h2")).toBeNull();
    expect(s.route().id).toBe("map");
    expect(note()).toBe("Finish Meadow Home to open this island!");
    expect(s.audio.sfx.mock.calls).toEqual([["pop", { gain: 0.5 }]]);
    void act(() => island(s.root, "citadel").click());
    await s.settle();
    expect(note()).toBe("Finish Crystal Caverns to open this island!");
    // Any key clears it.
    await s.press("ArrowRight");
    expect(note()).toBe("");
  });

  it("the note goes away on its own after a few seconds", async () => {
    const s = await openMap(fixture("fresh-sprout"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      void act(() => island(s.root, "shore").click());
      expect(text(s.root.querySelector("[data-note]"))).toBe(
        "Finish Birch Forest to open this island!",
      );
      void act(() => {
        vi.advanceTimersByTime(4100);
      });
      expect(text(s.root.querySelector("[data-note]"))).toBe("");
    } finally {
      vi.useRealTimers();
    }
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

  it("the arrows move between open islands only, then to the corner buttons, and wrap", async () => {
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
    // The corner: Players, My Badges (M3-10), My Blocks (M4-09), My Island (M4-07), Settings (M3-08).
    await s.press("ArrowRight");
    expect(text(active())).toBe(t("achievements.title"));
    await s.press("ArrowRight");
    expect(text(active())).toBe(t("inventory.title"));
    await s.press("ArrowRight");
    expect(text(active())).toBe(t("builder.title"));
    await s.press("ArrowRight");
    expect(text(active())).toBe(t("settings.title"));
    await s.press("ArrowRight");
    expect(active()).toBe(meadow);
    await s.press("ArrowLeft");
    expect(text(active())).toBe(t("settings.title"));
    await s.press("ArrowLeft");
    expect(text(active())).toBe(t("builder.title"));
    await s.press("ArrowLeft");
    expect(text(active())).toBe(t("inventory.title"));
    await s.press("ArrowLeft");
    expect(text(active())).toBe(t("achievements.title"));
    await s.press("ArrowLeft");
    expect(text(active())).toBe(t("map.players"));
    await s.press("ArrowUp");
    expect(active()).toBe(birch);
  });

  it("an island without lessons says so; Escape leaves the path, then goes to the players", async () => {
    h = await mount({ lessons, initialProfile: fixture("meadow-done-miner") });
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

  it("narrow, by touch: one tap goes (M3-FIX-4 (a))", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width: 1100px") }));
    try {
      const s = await openMap(fixture("fresh-sprout"));
      const home = buttonByText(s.root, t("builder.title"));
      await act(() => {
        home.dispatchEvent(pointer("pointerdown"));
        home.dispatchEvent(pointer("pointerup"));
        home.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
      });
      await s.settle();
      expect(s.route()).toEqual({ id: "play", lesson: "builder" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("narrow, by touch: a long press shows the words and doesn't go; a tap elsewhere closes them", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width: 1100px") }));
    try {
      const s = await openMap(fixture("fresh-sprout"));
      const home = buttonByText(s.root, t("builder.title"));
      const wrap = home.closest("[data-nav]");
      await act(() => {
        home.dispatchEvent(pointer("pointerdown"));
      });
      await act(() => wait(LONG_PRESS_MS + 50));
      expect(wrap?.getAttribute("data-tip")).toBe("open");
      // Lifting the finger: the click it makes is not a tap.
      await act(() => {
        home.dispatchEvent(pointer("pointerup"));
        home.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
      });
      await s.settle();
      expect(s.route()).toEqual({ id: "map" });
      expect(wrap?.getAttribute("data-tip")).toBe("open");
      // A tap anywhere else closes it.
      await act(() => {
        (s.root.querySelector("h1") ?? s.root).dispatchEvent(pointer("pointerdown"));
      });
      expect(wrap?.hasAttribute("data-tip")).toBe(false);
      // And the next tap on the button goes.
      await act(() => {
        home.dispatchEvent(pointer("pointerdown"));
        home.dispatchEvent(pointer("pointerup"));
        home.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
      });
      await s.settle();
      expect(s.route()).toEqual({ id: "play", lesson: "builder" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("narrow, by touch: a touch that becomes a scroll leaves nothing set (M3-FIX-4 (b))", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width: 1100px") }));
    try {
      const s = await openMap(fixture("fresh-sprout"));
      const home = buttonByText(s.root, t("builder.title"));
      const wrap = home.closest("[data-nav]");
      await act(() => {
        home.dispatchEvent(pointer("pointerdown"));
        home.dispatchEvent(pointer("pointercancel"));
      });
      await act(() => wait(LONG_PRESS_MS + 50));
      // No tip opened later, and the next click, from a key (no detail), goes at once.
      expect(wrap?.hasAttribute("data-tip")).toBe(false);
      await act(() => {
        home.click();
      });
      await s.settle();
      expect(s.route()).toEqual({ id: "play", lesson: "builder" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("narrow: after a long press and its lift, a click from assistive tech goes (review S1)", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width: 1100px") }));
    try {
      const s = await openMap(fixture("fresh-sprout"));
      const home = buttonByText(s.root, t("builder.title"));
      await act(() => {
        home.dispatchEvent(pointer("pointerdown"));
      });
      await act(() => wait(LONG_PRESS_MS + 50));
      // The browser turned the long press into a gesture: the lift makes no click.
      await act(() => {
        home.dispatchEvent(pointer("pointerup"));
      });
      await act(() => wait(10));
      // TalkBack's double tap: a click with a detail and no pointer before it.
      await act(() => {
        home.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
      });
      await s.settle();
      expect(s.route()).toEqual({ id: "play", lesson: "builder" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("narrow: a busy page that sends the lift's click late still doesn't go (M3-14)", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width: 1100px") }));
    try {
      const s = await openMap(fixture("fresh-sprout"));
      const home = buttonByText(s.root, t("builder.title"));
      const wrap = home.closest("[data-nav]");
      await act(() => {
        home.dispatchEvent(pointer("pointerdown"));
      });
      await act(() => wait(LONG_PRESS_MS + 50));
      expect(wrap?.getAttribute("data-tip")).toBe("open");
      const up = pointer("pointerup");
      await act(() => {
        home.dispatchEvent(up);
      });
      // The page was busy: the held mark is long gone when the click comes. Chrome stamps that
      // click with the lift's own time (checked with CDP touch input under an 800 ms busy loop).
      await act(() => wait(30));
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
      Object.defineProperty(click, "timeStamp", { value: up.timeStamp });
      await act(() => {
        home.dispatchEvent(click);
      });
      await s.settle();
      expect(s.route()).toEqual({ id: "map" });
      expect(wrap?.getAttribute("data-tip")).toBe("open");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("narrow: after a long press, a key's click still goes", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width: 1100px") }));
    try {
      const s = await openMap(fixture("fresh-sprout"));
      const home = buttonByText(s.root, t("builder.title"));
      await act(() => {
        home.dispatchEvent(pointer("pointerdown"));
      });
      await act(() => wait(LONG_PRESS_MS + 50));
      // The finger slid off and was lifted elsewhere; then Enter on the focused button.
      await act(() => {
        home.dispatchEvent(pointer("pointerleave"));
        home.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
      });
      await s.settle();
      expect(s.route()).toEqual({ id: "play", lesson: "builder" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a mouse click, and a tap in a wide window, go straight away", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width: 1100px") }));
    try {
      const s = await openMap(fixture("fresh-sprout"));
      const home = buttonByText(s.root, t("builder.title"));
      await act(() => {
        const down = new Event("pointerdown", { bubbles: true });
        Object.defineProperty(down, "pointerType", { value: "mouse" });
        home.dispatchEvent(down);
        home.click();
      });
      await s.settle();
      expect(s.route()).toEqual({ id: "play", lesson: "builder" });
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    try {
      const s = await openMap(fixture("fresh-sprout"));
      const home = buttonByText(s.root, t("builder.title"));
      await act(() => {
        const down = new Event("pointerdown", { bubbles: true });
        Object.defineProperty(down, "pointerType", { value: "touch" });
        home.dispatchEvent(down);
        home.click();
      });
      await s.settle();
      expect(s.route()).toEqual({ id: "play", lesson: "builder" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("without a player, offers the way to pick one", async () => {
    h = await mount({ lessons, initial: { id: "map" } });
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

/** Labels about as big as the browser draws them at text scale 2. */
const scale2 = (anchors: [number, number][]) =>
  anchors.map(([x, y], i) => ({
    x,
    y,
    w: 320 - (i % 3) * 40,
    h: 104,
    above: i === 0 ? 30 : 0,
  }));

describe("layoutLabels", () => {
  type Box = { left: number; top: number; right: number; bottom: number };
  const { margin, gap } = LABEL_LAYOUT;
  const place = (
    labels: Parameters<typeof layoutLabels>[0],
    size: { width: number; height: number },
    keepOut: Box[] = [],
  ): Box[] =>
    layoutLabels(labels, size, keepOut).map((p, i) => {
      const l = labels[i];
      if (!l) throw new Error("label");
      return { left: p.left, top: p.top - l.above, right: p.left + l.w, bottom: p.top + l.h };
    });
  const crosses = (a: Box, b: Box, room = 0): boolean =>
    a.left < b.right + room &&
    b.left < a.right + room &&
    a.top < b.bottom + room &&
    b.top < a.bottom + room;
  const expectClear = (
    boxes: Box[],
    size: { width: number; height: number },
    keepOut: Box[] = [],
  ) => {
    for (const [i, a] of boxes.entries()) {
      expect(a.left, `label ${i} left`).toBeGreaterThanOrEqual(margin - 0.5);
      expect(a.right, `label ${i} right`).toBeLessThanOrEqual(size.width - margin + 0.5);
      expect(a.top, `label ${i} top`).toBeGreaterThanOrEqual(margin - 0.5);
      expect(a.bottom, `label ${i} bottom`).toBeLessThanOrEqual(size.height - margin + 0.5);
      for (const k of keepOut) expect(crosses(a, k), `label ${i} and the heading`).toBe(false);
      for (const [j, b] of boxes.entries()) {
        if (j > i) expect(crosses(a, b, gap - 1), `labels ${i} and ${j}`).toBe(false);
      }
    }
  };

  it("leaves a label under its island when nothing is in the way", () => {
    expect(
      layoutLabels([{ x: 500, y: 300, w: 200, h: 60, above: 0 }], { width: 1024, height: 720 }),
    ).toEqual([{ left: 400, top: 300 }]);
  });

  it("keeps labels inside the window", () => {
    const size = { width: 1024, height: 720 };
    const labels = [
      { x: 20, y: 200, w: 270, h: 70, above: 0 },
      { x: 1010, y: 300, w: 270, h: 70, above: 0 },
      { x: 500, y: 700, w: 200, h: 70, above: 0 },
      { x: 500, y: 2, w: 200, h: 70, above: 20 },
    ];
    expectClear(place(labels, size), size);
  });

  // The anchors of the real 3D view at 1024×720 (all islands open), and label sizes about as big
  // as the browser draws them at text scale 2, names wrapped to fit three across.
  const anchors1024: [number, number][] = [
    [190, 532],
    [512, 544],
    [845, 528],
    [848, 354],
    [545, 351],
    [228, 345],
    [395, 218],
    [116, 203],
    [715, 184],
  ];

  for (const [scale, w, tall] of [
    [1.5, 274, 78],
    [2, 320, 104],
  ] as const) {
    it(`at text scale ${scale}, no two labels overlap and none leaves the window or meets the heading`, () => {
      const size = { width: 1024, height: 720 };
      const heading = { left: 16, top: 12, right: 700, bottom: scale === 2 ? 128 : 96 };
      const labels = anchors1024.map(([x, y], i) => ({
        x,
        y,
        w: w - (i % 3) * 40,
        h: tall,
        above: i === 0 ? 30 : 0,
      }));
      expectClear(place(labels, size, [heading]), size, [heading]);
    });
  }

  // The same anchors at 1024×600: the overview keeps its distance, so the picture shrinks toward
  // the middle by 600 / 720 both ways.
  const anchors600 = anchors1024.map(([x, y]): [number, number] => [
    512 + ((x - 512) * 600) / 720,
    300 + ((y - 360) * 600) / 720,
  ]);
  const heading600 = { left: 16, top: 12, right: 700, bottom: 128 };
  const corner600 = { left: 820, top: 12, right: 1008, bottom: 70 };

  it("1024×600 at text scale 2 (M3-FIX-1 review N1): no overlap, nothing past the bottom", () => {
    const size = { width: 1024, height: 600 };
    const keep = [heading600, corner600];
    expectClear(place(scale2(anchors600), size, keep), size, keep);
  });

  it("property: jittered anchors at 1024×600 and 1024×720, scale 2, always come out clear", () => {
    const jitter = fc.array(
      fc.tuple(fc.integer({ min: -30, max: 30 }), fc.integer({ min: -30, max: 30 })),
      {
        minLength: 9,
        maxLength: 9,
      },
    );
    fc.assert(
      fc.property(jitter, fc.boolean(), (moves, short) => {
        const size = { width: 1024, height: short ? 600 : 720 };
        const base = short ? anchors600 : anchors1024;
        const anchors = base.map(([x, y], i): [number, number] => {
          const [dx, dy] = moves[i] ?? [0, 0];
          return [x + dx, y + dy];
        });
        const keep = [heading600, corner600];
        expectClear(place(scale2(anchors), size, keep), size, keep);
      }),
      { seed: 4162, numRuns: 300 },
    );
  });

  it("moves a label below its neighbour when a row has no room left", () => {
    const size = { width: 600, height: 720 };
    const labels = [0, 1, 2, 3].map((i) => ({ x: 150 + i * 100, y: 200, w: 260, h: 60, above: 0 }));
    expectClear(place(labels, size), size);
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
