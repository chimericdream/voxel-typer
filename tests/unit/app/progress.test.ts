import { describe, expect, it } from "vitest";
import { createBreakReminder } from "../../../src/app/break-reminder";
import { parseDebugParams } from "../../../src/app/debug";
import { applyResult, biomesUnlockedBy } from "../../../src/app/progress";
import { isRouteId, ROUTE_IDS, screens } from "../../../src/app/routes";
import { isProfile } from "../../../src/save/schema";
import { fixture, lesson, result, summary } from "./helpers";

describe("applyResult", () => {
  const p = fixture("fresh-sprout");
  const at = 1_800_000_000_000;

  it("counts the session, folds stats, adds loot and history, and stays a valid profile", () => {
    const next = applyResult(p, lesson(), result({ loot: { dirt: 2, stone: 0 } }), at);
    expect(next.sessionCounter).toBe(p.sessionCounter + 1);
    expect(next.keyStats["f"]?.attempts).toBe(10);
    expect(next.keyStats["f"]?.lastSeenSession).toBe(next.sessionCounter);
    expect(next.bigramStats["fj"]?.attempts).toBe(4);
    expect(next.inventory).toEqual({ ...p.inventory, dirt: (p.inventory["dirt"] ?? 0) + 2 });
    const stored = next.history.at(-1);
    expect(stored?.at).toBe(at);
    expect(stored).not.toHaveProperty("perKey");
    expect(stored).not.toHaveProperty("bigrams");
    expect(isProfile(next)).toBe(true);
    expect(p.sessionCounter).toBe(fixture("fresh-sprout").sessionCounter); // input untouched
  });

  it("keeps the best scores and counts plays", () => {
    const one = applyResult(p, lesson(), result({ stars: 3 }), at);
    const two = applyResult(
      one,
      lesson(),
      result({ stars: 1, summary: summary({ netWpm: 30, accuracy: 0.8 }) }),
      at + 1,
    );
    expect(two.progress.lessons["meadow-01"]).toEqual({
      bestStars: 3,
      bestNetWpm: 30,
      bestAccuracy: 0.95,
      plays: 2,
      lastPlayed: at + 1,
    });
  });

  it("a mastery lesson with ≥ 2 stars unlocks the next biome, once", () => {
    const mastery = lesson({ id: "meadow-12", tags: ["mastery"] });
    expect(applyResult(p, mastery, result({ stars: 1 }), at).progress.unlockedBiomes).toEqual([
      "meadow",
    ]);
    const once = applyResult(p, mastery, result({ stars: 2 }), at);
    expect(once.progress.unlockedBiomes).toEqual(["meadow", "birch"]);
    const twice = applyResult(once, mastery, result({ stars: 3 }), at);
    expect(twice.progress.unlockedBiomes).toEqual(["meadow", "birch"]);
  });

  it("caverns opens both sparkstone and citadel; the last biome opens nothing", () => {
    expect(biomesUnlockedBy("caverns")).toEqual(["sparkstone", "citadel"]);
    expect(biomesUnlockedBy("meadow")).toEqual(["birch"]);
    expect(biomesUnlockedBy("citadel")).toEqual([]);
  });

  it("free play (no lesson) touches no lesson progress", () => {
    const next = applyResult(p, null, result(), at);
    expect(next.progress).toBe(p.progress);
    expect(next.sessionCounter).toBe(p.sessionCounter + 1);
  });
});

describe("parseDebugParams", () => {
  it("reads every param in dev and test builds", () => {
    expect(
      parseDebugParams(
        "?seed=42&freeze=1&profile=fresh-sprout&screen=play&lesson=meadow-01&record=1&quality=low&lite=1&nosave=1",
        false,
      ),
    ).toEqual({
      seed: 42,
      freeze: true,
      profile: "fresh-sprout",
      screen: "play",
      lesson: "meadow-01",
      record: true,
      quality: "low",
      lite: true,
      nosave: true,
    });
  });

  it("keeps only lite and quality in production", () => {
    expect(parseDebugParams("?seed=42&freeze=1&screen=play&quality=high&lite=1", true)).toEqual({
      seed: null,
      freeze: false,
      profile: null,
      screen: null,
      lesson: null,
      record: false,
      quality: "high",
      lite: true,
      nosave: false,
    });
  });

  it("ignores bad values", () => {
    const d = parseDebugParams("?seed=x&screen=nope&quality=ultra&profile=../x&freeze=0", false);
    expect(d).toMatchObject({
      seed: null,
      screen: null,
      quality: null,
      profile: null,
      freeze: false,
    });
  });
});

describe("routes", () => {
  it("knows every card route", () => {
    expect(ROUTE_IDS).toEqual([
      "splash",
      "profiles",
      "profileCreate",
      "map",
      "lessonIntro",
      "play",
      "results",
      "island",
      "inventory",
      "achievements",
      "settings",
      "parent",
      "privacy",
      "placement",
    ]);
    expect(isRouteId("map")).toBe(true);
    expect(isRouteId("toString")).toBe(false);
  });

  it("play has no screen file (the shell draws it)", () => {
    expect(screens.play).toBeUndefined();
  });
});

describe("break reminder", () => {
  it("is due after the set minutes of live play, and resets", () => {
    const r = createBreakReminder();
    r.add(14 * 60_000);
    expect(r.due(15)).toBe(false);
    r.add(60_000);
    r.add(Number.NaN);
    r.add(-5);
    expect(r.due(15)).toBe(true);
    expect(r.due(0)).toBe(false);
    r.reset();
    expect(r.due(15)).toBe(false);
  });
});
