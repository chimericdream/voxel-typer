/**
 * Placement mode headless (task M3-05): Mine's stage and rules with the placement driver's blocks.
 * Same rig idea as Mine's own test: a fake scene whose `three` is null.
 */
import { describe, expect, it } from "vitest";
import { createSilentAudio } from "../../../../src/app/audio";
import { fixedStepClock } from "../../../../src/app/clock";
import { placementRungsOf } from "../../../../src/app/progress";
import { createEmitter } from "../../../../src/app/events";
import type { GameEvents } from "../../../../src/app/events";
import { createHudStore } from "../../../../src/app/hud";
import { PLACEMENT_MS, tierKeys } from "../../../../src/engine/placement";
import { createRng } from "../../../../src/engine/rng";
import { mode } from "../../../../src/modes/placement";
import {
  PLACEMENT_LESSON,
  PLACEMENT_RUNGS_EXTRA,
  PLACEMENT_TIER_EXTRA,
} from "../../../../src/modes/placement/lesson";
import { create } from "../../../../src/modes/placement/placement";
import type { ModeResult } from "../../../../src/modes/types";
import type { Profile } from "../../../../src/save/schema";
import { fakeScene, fixture, flush } from "../../app/helpers";

async function rig(profile: Profile) {
  const scene = fakeScene();
  const hud = createHudStore();
  const results: ModeResult[] = [];
  let loaded: (() => void) | null = null;
  scene.loadDiorama = () =>
    new Promise<void>((resolve) => {
      loaded = resolve;
    });
  const instance = create({
    lesson: PLACEMENT_LESSON,
    params: {},
    profile,
    settings: profile.settings,
    band: profile.ageBand,
    rng: createRng(5),
    clock: fixedStepClock(5000, 1),
    scene,
    hud,
    audio: createSilentAudio(),
    bus: createEmitter<GameEvents>(),
    finish: (r) => results.push(r),
  });
  let now = 10_000;
  const type = (key: string, gap = 300): void => {
    now += gap;
    instance.input({ key, t: now, shift: key !== key.toLowerCase() });
  };
  const typeNext = (gap = 300): string | null => {
    const key = hud.get().nextKey;
    if (key !== null) type(key, gap);
    return key;
  };
  const run = (ms: number): void => {
    for (let left = ms; left > 0; left -= 16) instance.frame(16, 0);
  };
  instance.start();
  return {
    instance,
    hud,
    results,
    type,
    typeNext,
    run,
    async loadWorld() {
      loaded?.();
      await flush();
    },
  };
}

const builder = fixture("fresh-builder");
const calm = (p: Profile): Profile => ({ ...p, settings: { ...p.settings, calmMode: true } });

describe("placement mode", () => {
  it("is registered as its own mode", () => {
    expect(mode.id).toBe("placement");
    expect(PLACEMENT_LESSON.mode).toBe("placement");
  });

  it("drops keys until the world has loaded (decision 83)", async () => {
    const r = await rig(builder);
    r.type("f");
    expect(r.instance.session()).toBeNull();
    await r.loadWorld();
    const v = r.instance.session();
    expect(v?.active).not.toBeNull();
    expect(v?.elapsedMs).toBe(0);
  });

  it("starts on the home row, ignores a habit space, and climbs once each home key broke clean", async () => {
    const r = await rig(builder);
    await r.loadWorld();
    const home = new Set(tierKeys(0));
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const key = r.hud.get().nextKey;
      expect(key !== null && home.has(key)).toBe(true);
      if (key !== null) seen.add(key);
      r.typeNext();
      // A space between blocks is not a slip (decision 90).
      r.type(" ");
    }
    // The 10 blocks were the 10 home keys (M3-FIX-3 N1).
    expect(seen.size).toBe(10);
    expect(r.instance.session()?.active?.id.startsWith("p1-")).toBe(true);
    const top = new Set(tierKeys(1));
    expect(top.has(r.hud.get().nextKey ?? "")).toBe(true);
    // No slip was counted for the spaces.
    expect(r.instance.session()?.streak).toBe(10);
  });

  it("ends after 90 s and hands back the rung reached, with no stars and no countdown", async () => {
    const r = await rig(builder);
    await r.loadWorld();
    for (let i = 0; i < 20; i++) r.typeNext();
    expect(r.hud.get().timer).toBeNull();
    r.run(PLACEMENT_MS / 2);
    expect(r.hud.get().progress01).toBeGreaterThan(0.4);
    r.run(PLACEMENT_MS / 2 + 100);
    r.run(2000);
    expect(r.results).toHaveLength(1);
    const res = r.results[0];
    expect(res?.stars).toBe(0);
    expect(res?.summary.mode).toBe("placement");
    expect(res?.extra?.[PLACEMENT_TIER_EXTRA]).toBe(2);
  });

  it("scores each rung it left, with paused time taken out (N2)", async () => {
    const r = await rig(builder);
    await r.loadWorld();
    for (let i = 0; i < 10; i++) {
      r.typeNext();
      if (i === 4) {
        r.instance.pause(10_000 + 300 * 5 + 10);
        r.instance.resume(10_000 + 300 * 5 + 5010);
        r.type(" ", 5000);
      }
    }
    r.run(PLACEMENT_MS + 2000);
    const res = r.results[0];
    expect(res?.extra?.[PLACEMENT_TIER_EXTRA]).toBe(1);
    const rungs = res?.extra?.[PLACEMENT_RUNGS_EXTRA];
    expect(rungs).toEqual([{ tier: 0, ms: expect.any(Number), keystrokes: 10, correct: 10 }]);
    const ms = placementRungsOf(res ?? {})[0]?.ms ?? 0;
    // 10 keys 300 ms apart: under 3 s of typing; the 5 s pause is not in it.
    expect(ms).toBeGreaterThan(2000);
    expect(ms).toBeLessThanOrEqual(3000);
  });

  it("in calm mode also ends at 90 s, with no clock shown (review B1)", async () => {
    const r = await rig(calm(builder));
    await r.loadWorld();
    for (let i = 0; i < 20; i++) r.typeNext();
    expect(r.hud.get().timer).toBeNull();
    r.run(PLACEMENT_MS / 2);
    expect(r.results).toHaveLength(0);
    expect(r.hud.get().progress01).toBeGreaterThan(0.4);
    r.run(PLACEMENT_MS / 2 + 100);
    r.run(2000);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]?.summary.mode).toBe("placement");
  });
});
