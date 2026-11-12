/** @jsxImportSource preact */
/**
 * The placement screen (task M3-05) through the real shell and input router: Start, a clear Skip,
 * Escape skips, and the "you start here" view after the test.
 */
import { afterEach, describe, expect, it } from "vitest";
import { applyPlacement } from "../../../../src/app/progress";
import { lessons } from "../../../../src/content/lessons";
import { t } from "../../../../src/i18n";
import { PLACEMENT_LESSON_ID } from "../../../../src/modes/placement/lesson";
import type { Harness } from "./harness";
import { buttonByText, fixture, mount, text } from "./harness";

let h: Harness | null = null;
afterEach(() => {
  h?.unmount();
  h = null;
});
async function open(opts: Parameters<typeof mount>[0]): Promise<Harness> {
  h = await mount(opts);
  return h;
}

describe("Placement", () => {
  it("explains the test, focuses Start and offers Skip", async () => {
    const s = await open({ initial: { id: "placement" }, initialProfile: fixture("fresh-sprout") });
    expect(text(s.root.querySelector("h1"))).toBe(t("placement.title"));
    expect(text(s.root)).toContain(t("placement.intro"));
    expect(text(s.root)).toContain(t("placement.skipHint"));
    expect(document.activeElement).toBe(buttonByText(s.root, t("placement.start")));
    expect(buttonByText(s.root, t("placement.skip"))).not.toBeNull();
  });

  it("Skip goes to the map and only settles the start at the Meadow", async () => {
    const p = fixture("fresh-sprout");
    const s = await open({ initial: { id: "placement" }, initialProfile: p });
    buttonByText(s.root, t("placement.skip"))?.focus();
    await s.press("Enter");
    expect(s.route()).toEqual({ id: "map" });
    // Nothing unlocks or is tested out; the start is settled, so a reload doesn't ask again (N4).
    expect(s.shell.profile.value?.progress).toEqual({
      ...p.progress,
      placement: { doneAt: expect.any(Number), startBiome: "meadow" },
    });
    expect(s.shell.profile.value?.sessionCounter).toBe(p.sessionCounter);
  });

  it("Skip keeps a start that was already settled", async () => {
    const p = fixture("fresh-sprout");
    const settled = {
      ...p,
      progress: { ...p.progress, placement: { doneAt: 5, startBiome: "meadow" as const } },
    };
    const s = await open({ initial: { id: "placement" }, initialProfile: settled });
    await s.press("Escape");
    expect(s.shell.profile.value?.progress.placement).toEqual({ doneAt: 5, startBiome: "meadow" });
  });

  it("Escape skips too", async () => {
    const s = await open({ initial: { id: "placement" }, initialProfile: fixture("fresh-sprout") });
    await s.press("Escape");
    expect(s.route().id).toBe("map");
  });

  it("Start plays the test", async () => {
    const s = await open({ initial: { id: "placement" }, initialProfile: fixture("fresh-sprout") });
    await s.press("Enter");
    expect(s.route()).toEqual({ id: "play", lesson: PLACEMENT_LESSON_ID });
  });

  it("after the test says where the player starts, then goes to the map", async () => {
    const base = fixture("fresh-builder");
    const done = applyPlacement(
      base,
      lessons,
      {
        summary: {
          mode: "placement",
          seed: 1,
          startedAtT: 0,
          activeMs: 90_000,
          keystrokes: 100,
          correct: 90,
          errors: 10,
          uncorrected: 0,
          grossWpm: 6,
          netWpm: 6,
          accuracy: 0.9,
          consistency: 0.5,
          perKey: {},
          bigrams: {},
          longestStreak: 9,
          targetsCompleted: 50,
        },
        loot: {},
        stars: 0,
      },
      1,
    );
    const s = await open({
      initial: { id: "placement", lesson: PLACEMENT_LESSON_ID },
      initialProfile: done,
    });
    expect(text(s.root.querySelector("h1"))).toBe(t("placement.doneTitle"));
    expect(text(s.root)).toContain(t("placement.startAt", { name: t("map.biome.meadow") }));
    expect(text(s.root)).not.toMatch(/\d/);
    expect(document.activeElement).toBe(buttonByText(s.root, t("placement.toMap")));
    await s.press("Enter");
    expect(s.route().id).toBe("map");
  });
});
