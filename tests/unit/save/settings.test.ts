import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../../src/save/settings";
import { isProfile } from "../../../src/save/schema";
import type { AgeBand } from "../../../src/types/core";

describe("defaultSettings (PLAN.md §2)", () => {
  it("sprout: keyboard and hands on, calm mode on, text scale 1.5, read-aloud on", () => {
    expect(defaultSettings("sprout")).toMatchObject({
      showKeyboard: true,
      showHands: true,
      calmMode: true,
      textScale: 1.5,
      tts: true,
    });
  });

  it("miner: keyboard on, hands off, timers allowed", () => {
    expect(defaultSettings("miner")).toMatchObject({
      showKeyboard: true,
      showHands: false,
      calmMode: false,
    });
  });

  it("builder: keyboard off, hands off, normal text", () => {
    expect(defaultSettings("builder")).toMatchObject({
      showKeyboard: false,
      showHands: false,
      calmMode: false,
      textScale: 1,
      tts: false,
    });
  });

  it.each<AgeBand>(["sprout", "miner", "builder"])(
    "%s: shared defaults (contracts §15) and text scale in 1.0–2.0",
    (band) => {
      const s = defaultSettings(band);
      expect(s).toMatchObject({
        reducedMotion: "system",
        highContrast: false,
        font: "pixel",
        quality: "auto",
        breakReminderMin: 15,
        layout: "en-US",
      });
      expect(s.textScale).toBeGreaterThanOrEqual(1);
      expect(s.textScale).toBeLessThanOrEqual(2);
      for (const v of Object.values(s.volume)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    },
  );

  it("returns a new object each call, so changing one never changes the defaults", () => {
    const a = defaultSettings("sprout");
    a.volume.master = 0;
    a.showHands = false;
    const b = defaultSettings("sprout");
    expect(b.volume.master).toBe(0.8);
    expect(b.showHands).toBe(true);
  });

  it.each<AgeBand>(["sprout", "miner", "builder"])(
    "%s defaults pass the save validator",
    (band) => {
      const profile = {
        id: "x",
        name: "Pip",
        ageBand: band,
        avatar: { skin: "moss" },
        createdAt: 0,
        settings: defaultSettings(band),
        progress: { lessons: {}, unlockedBiomes: [] },
        sessionCounter: 0,
        keyStats: {},
        bigramStats: {},
        inventory: {},
        island: null,
        cosmetics: { unlocked: [] },
        achievements: {},
        daily: { streakDates: [] },
        history: [],
        weekly: [],
        schemaVersion: 1,
      };
      expect(isProfile(profile)).toBe(true);
    },
  );
});
