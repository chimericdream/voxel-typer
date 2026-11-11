import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, isProfile, profileProblem } from "../../../src/save/schema";
import type { Profile } from "../../../src/save/schema";

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/profiles");
const NAMES = [
  "fresh-sprout",
  "fresh-builder",
  "meadow-done-miner",
  "pinky-weak",
  "veteran-builder",
] as const;

function fixture(name: string): Profile {
  const v: unknown = JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), "utf8"));
  if (!isProfile(v)) throw new Error(`${name}: ${profileProblem(v)}`);
  return v;
}

/** A deep copy as plain JSON, so a test can damage it freely. */
function json(p: Profile): Record<string, unknown> {
  const v: unknown = JSON.parse(JSON.stringify(p));
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not an object");
  return { ...v };
}

describe("fixture profiles (task M1-09)", () => {
  it.each(NAMES)("%s is a valid current-version profile", (name) => {
    expect(profileProblem(fixture(name))).toBeNull();
  });

  it("fresh-sprout and fresh-builder have no progress", () => {
    for (const name of ["fresh-sprout", "fresh-builder"]) {
      const p = fixture(name);
      expect(p.history).toEqual([]);
      expect(p.progress.lessons).toEqual({});
      expect(p.sessionCounter).toBe(0);
    }
    expect(fixture("fresh-sprout").ageBand).toBe("sprout");
    expect(fixture("fresh-builder").ageBand).toBe("builder");
  });

  it("meadow-done-miner has every meadow lesson and Birch Forest unlocked", () => {
    const p = fixture("meadow-done-miner");
    expect(p.ageBand).toBe("miner");
    expect(p.progress.unlockedBiomes).toEqual(["meadow", "birch"]);
    const meadow = Object.keys(p.progress.lessons).filter((id) => id.startsWith("meadow-"));
    expect(meadow.length).toBe(12);
  });

  it("pinky-weak is a Miner whose `a` and `;` show high error rates", () => {
    const p = fixture("pinky-weak");
    expect(p.ageBand).toBe("miner");
    const rest = Object.entries(p.keyStats).filter(([k]) => k !== "a" && k !== ";");
    const worstOther = Math.max(...rest.map(([, s]) => s.recentErrRate));
    for (const k of ["a", ";"]) {
      const s = p.keyStats[k];
      expect(s?.recentErrRate).toBeGreaterThan(0.3);
      expect(s?.recentErrRate).toBeGreaterThan(worstOther * 3);
    }
  });

  it("veteran-builder has all biomes unlocked and 200 sessions of history", () => {
    const p = fixture("veteran-builder");
    expect(p.ageBand).toBe("builder");
    expect(p.progress.unlockedBiomes.length).toBe(9);
    expect(p.history.length).toBe(200);
  });
});

describe("profileProblem rejects damaged profiles", () => {
  const good = fixture("veteran-builder");

  type Damage = [label: string, damage: (p: Record<string, unknown>) => unknown, path: string];
  const cases: Damage[] = [
    ["not an object", () => "hello", "profile: expected an object"],
    ["null", () => null, "profile: expected an object"],
    ["an array", () => [], "profile: expected an object"],
    [
      "missing id",
      (p) => {
        const { id: _, ...rest } = p;
        return rest;
      },
      "profile.id: missing",
    ],
    ["empty name", (p) => ({ ...p, name: "" }), "profile.name"],
    ["17-char name", (p) => ({ ...p, name: "abcdefghijklmnopq" }), "profile.name"],
    ["unknown band", (p) => ({ ...p, ageBand: "toddler" }), "profile.ageBand"],
    ["avatar without skin", (p) => ({ ...p, avatar: {} }), "profile.avatar.skin"],
    ["numeric hat", (p) => ({ ...p, avatar: { skin: "a", hat: 3 } }), "profile.avatar.hat"],
    ["NaN-ish createdAt", (p) => ({ ...p, createdAt: null }), "profile.createdAt"],
    ["string createdAt", (p) => ({ ...p, createdAt: "today" }), "profile.createdAt"],
    [
      "text scale 3",
      (p) => ({ ...p, settings: { ...asObj(p["settings"]), textScale: 3 } }),
      "profile.settings.textScale",
    ],
    [
      "bad font",
      (p) => ({ ...p, settings: { ...asObj(p["settings"]), font: "comic" } }),
      "profile.settings.font",
    ],
    [
      "reducedMotion 'yes'",
      (p) => ({ ...p, settings: { ...asObj(p["settings"]), reducedMotion: "yes" } }),
      "profile.settings.reducedMotion",
    ],
    [
      "volume above 1",
      (p) => ({
        ...p,
        settings: {
          ...asObj(p["settings"]),
          volume: { master: 2, music: 1, sfx: 1, voice: 1 },
        },
      }),
      "profile.settings.volume.master",
    ],
    [
      "missing volume bus",
      (p) => ({
        ...p,
        settings: { ...asObj(p["settings"]), volume: { master: 1, music: 1, sfx: 1 } },
      }),
      "profile.settings.volume.voice: missing",
    ],
    [
      "unknown biome",
      (p) => ({ ...p, progress: { lessons: {}, unlockedBiomes: ["moon"] } }),
      "profile.progress.unlockedBiomes[0]",
    ],
    [
      "4 stars",
      (p) => ({
        ...p,
        progress: {
          unlockedBiomes: [],
          lessons: {
            "meadow-01": {
              bestStars: 4,
              bestNetWpm: 1,
              bestAccuracy: 1,
              plays: 1,
              lastPlayed: 1,
            },
          },
        },
      }),
      'profile.progress.lessons["meadow-01"].bestStars',
    ],
    ["fractional session counter", (p) => ({ ...p, sessionCounter: 1.5 }), "sessionCounter"],
    ["negative session counter", (p) => ({ ...p, sessionCounter: -1 }), "sessionCounter"],
    [
      "key stat error rate 2",
      (p) => ({ ...p, keyStats: { a: { ...asObj(asObj(p["keyStats"])["a"]), recentErrRate: 2 } } }),
      'profile.keyStats["a"].recentErrRate',
    ],
    ["fractional inventory", (p) => ({ ...p, inventory: { dirt: 0.5 } }), "profile.inventory"],
    ["island grid as text", (p) => ({ ...p, island: { grid: "x" } }), "profile.island.grid"],
    ["daily date format", (p) => ({ ...p, daily: { streakDates: ["9/1/2026"] } }), "streakDates"],
    ["history not a list", (p) => ({ ...p, history: {} }), "profile.history: expected a list"],
    [
      "history entry with unknown mode",
      (p) => ({ ...p, history: [{ ...asObj(asList(p["history"])[0]), mode: "race" }] }),
      "profile.history[0].mode",
    ],
    [
      "history entry without `at`",
      (p) => {
        const { at: _, ...rest } = asObj(asList(p["history"])[0]);
        return { ...p, history: [rest] };
      },
      "profile.history[0].at: missing",
    ],
    [
      "weekly row with a bad date",
      (p) => ({
        ...p,
        weekly: [{ weekStart: "x", minutes: 1, sessions: 1, avgNetWpm: 1, avgAccuracy: 1 }],
      }),
      "profile.weekly[0].weekStart",
    ],
    ["schema version 0", (p) => ({ ...p, schemaVersion: 0 }), "profile.schemaVersion"],
    [
      "a newer schema version",
      (p) => ({ ...p, schemaVersion: SCHEMA_VERSION + 1 }),
      "profile.schemaVersion: expected",
    ],
  ];

  it.each(cases)("%s", (_label, damage, path) => {
    const bad = damage(json(good));
    const problem = profileProblem(bad);
    expect(problem).toContain(path);
    expect(isProfile(bad)).toBe(false);
  });

  it("allows unknown extra keys and absent optional ones", () => {
    const p = { ...json(good), extra: { anything: true } };
    expect(profileProblem(p)).toBeNull();
    const fresh = fixture("fresh-sprout");
    expect(fresh.progress.placement).toBeUndefined();
    expect(profileProblem(fresh)).toBeNull();
  });

  it("rejects non-finite numbers, which JSON could not keep", () => {
    expect(profileProblem({ ...json(good), createdAt: Number.NaN })).toContain("createdAt");
    expect(profileProblem({ ...json(good), createdAt: Infinity })).toContain("createdAt");
  });

  it("counts name length in characters, not UTF-16 units", () => {
    expect(profileProblem({ ...json(good), name: "🦊".repeat(16) })).toBeNull();
    expect(profileProblem({ ...json(good), name: "🦊".repeat(17) })).toContain("profile.name");
  });
});

function asObj(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not an object");
  return { ...v };
}

function asList(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new Error("not a list");
  return v;
}
