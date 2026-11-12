import { signal } from "@preact/signals";
import { describe, expect, it } from "vitest";
import { announcementFor, attachRouteAnnouncer } from "../../../src/a11y/route-announcer";
import type { RouteAnnouncerDeps } from "../../../src/a11y/route-announcer";
import type { Route, RouteId } from "../../../src/app/routes";
import { lessons } from "../../../src/content/lessons/meadow";
import type { ModeResult } from "../../../src/modes/types";
import type { AgeBand } from "../../../src/types/core";
import { summary } from "../app/helpers";

const WITH_SCREENS = new Set<RouteId>([
  "splash",
  "profiles",
  "profileCreate",
  "lessonIntro",
  "results",
  "privacy",
  "map",
]);

function result(stars: 0 | 1 | 2 | 3): ModeResult {
  return { stars, loot: {}, summary: summary() };
}

function deps(over: Partial<RouteAnnouncerDeps> = {}) {
  const route = signal<Route>({ id: "splash" });
  const said: string[] = [];
  let last: ModeResult | null = null;
  let band: AgeBand | null = "miner";
  const d: RouteAnnouncerDeps = {
    route,
    hasScreen: (id) => WITH_SCREENS.has(id),
    lesson: (id) => lessons.find((l) => l.id === id) ?? null,
    lastResult: () => last,
    band: () => band,
    say: (text) => said.push(text),
    ...over,
  };
  return {
    d,
    route,
    said,
    setResult(r: ModeResult | null) {
      last = r;
    },
    setBand(b: AgeBand | null) {
      band = b;
    },
  };
}

describe("route announcements (menu changes and lesson results)", () => {
  it("names menu screens", () => {
    const { d } = deps();
    expect(announcementFor({ id: "profiles" }, d)).toBe("Who is playing?");
    expect(announcementFor({ id: "profileCreate" }, d)).toBe("New player");
    expect(announcementFor({ id: "map" }, d)).toBe("World Map");
    expect(announcementFor({ id: "privacy" }, d)).toBe("How we keep you safe");
  });

  it("says 'coming soon' for a route with no screen yet", () => {
    const { d } = deps();
    expect(announcementFor({ id: "settings" }, d)).toBe("Coming soon!");
    expect(announcementFor({ id: "settings" }, { ...d, hasScreen: () => true })).toBe("Settings");
  });

  it("never announces in play (no per-keystroke chatter)", () => {
    const { d } = deps();
    expect(announcementFor({ id: "play", lesson: "meadow-01" }, d)).toBeNull();
  });

  it("names the lesson on the intro", () => {
    const { d } = deps();
    expect(announcementFor({ id: "lessonIntro", lesson: "meadow-01" }, d)).toMatch(
      /^Next lesson: \S/,
    );
    expect(announcementFor({ id: "lessonIntro", lesson: "nope" }, d)).toBeNull();
  });

  it("reads the stars and the warm message on Results, per band", () => {
    const h = deps();
    h.setResult(result(2));
    expect(announcementFor({ id: "results", lesson: "meadow-01" }, h.d)).toBe(
      "Lesson done! 2 stars out of 3. Great job! Your fingers know the way.",
    );
    h.setBand("sprout");
    h.setResult(result(1));
    expect(announcementFor({ id: "results", lesson: "meadow-01" }, h.d)).toBe(
      "Lesson done! 1 star out of 3. Good work!",
    );
    h.setResult(null);
    expect(announcementFor({ id: "results" }, h.d)).toBe("Lesson done!");
  });

  it("announces each change once, not the first screen and not a repeat", () => {
    const h = deps();
    const off = attachRouteAnnouncer(h.d);
    expect(h.said).toEqual([]);
    h.route.value = { id: "profiles" };
    h.route.value = { id: "profiles" };
    h.route.value = { id: "map" };
    h.route.value = { id: "play", lesson: "meadow-01" };
    h.setResult(result(3));
    h.route.value = { id: "results", lesson: "meadow-01" };
    off();
    h.route.value = { id: "map" };
    expect(h.said).toEqual([
      "Who is playing?",
      "World Map",
      "Lesson done! 3 stars out of 3. Amazing! You got all three stars!",
    ]);
  });
});
