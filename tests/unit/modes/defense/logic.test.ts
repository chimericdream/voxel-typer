/**
 * Night Defense's pure rules (task M4-04): the night's length, lanes, mob motion, the shield, the
 * wave's score, the word plates' layout (they never overlap) and the camera framing.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { arenaLayout } from "../../../../src/content/worldgen/defense-arena";
import {
  BAND_LANES,
  DEFAULT_WAVES,
  FIELD_FRONT,
  FIELD_HEADROOM,
  FIELD_MIN_PX,
  PLATE_GAP,
  STAGE_MIN_SHARE,
  QUEUE_GAP,
  SHIELD_SEGMENTS,
  WAVES_MAX,
  WAVES_MIN,
  baselineAccuracy,
  bonkShield,
  emptyTally,
  fitLaneView,
  laneSlot,
  capStageFloor,
  messageFontPx,
  plateFontPx,
  stageFloor,
  stageRoom,
  layoutPlates,
  mobHead,
  lockedWpm,
  nextKeyFor,
  NIGHT_CAP_MS,
  WALK_REF_MS,
  nightOver,
  nightProgress,
  nightWaves,
  walkRate,
  projectLane,
  stepMobs,
  fieldEmpty,
  clearOfBanner,
  waveAnnouncement,
  waveFeedback,
} from "../../../../src/modes/defense/logic";
import type {
  Box,
  FieldMob,
  PlateBounds,
  PlatePlace,
  PlateWish,
} from "../../../../src/modes/defense/logic";
import { isInZone, pureZoneGlobs } from "../../../../tools/check-boundaries";
import type { AgeBand } from "../../../../src/types/core";

const BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];

const mob = (over: Partial<FieldMob> = {}): FieldMob => ({
  id: "m",
  mobId: "slimeling",
  slot: 0,
  word: "sad",
  speed: 0.1,
  p: 0,
  state: "walking",
  ...over,
});

/** One past session, as the profile's history keeps it. */
const run = (mode: "mine" | "defense" | "practice", accuracy: number) => ({ mode, accuracy });
/** One mob of a wave. */
const waveMob = (mobId: string) => ({
  id: "x",
  mobId,
  lane: 0,
  spawnAtMs: 0,
  speed: 0.1,
  word: "a",
});

const touching = (a: PlatePlace, b: PlatePlace, gap: number): boolean =>
  a.left < b.left + b.width + gap - 1e-6 &&
  b.left < a.left + a.width + gap - 1e-6 &&
  a.top < b.top + b.height + gap - 1e-6 &&
  b.top < a.top + a.height + gap - 1e-6;

describe("purity", () => {
  it("is a pure zone", () => {
    expect(isInZone("src/modes/defense/logic.ts", pureZoneGlobs())).toBe(true);
  });
});

describe("the night", () => {
  it("has 2 to 5 waves, from the lesson's length", () => {
    expect(nightWaves(null, "miner")).toBe(DEFAULT_WAVES);
    for (const band of BANDS) {
      // The shipped Defense lessons are 75–90 chars: a three-wave night for every band.
      for (const chars of [75, 90]) expect(nightWaves({ length: { chars } }, band)).toBe(3);
      expect(nightWaves({ length: { chars: 1 } }, band)).toBe(WAVES_MIN);
      expect(nightWaves({ length: { chars: 5000 } }, band)).toBe(WAVES_MAX);
      expect(nightWaves({ length: { targets: 24 }, bandScale: { [band]: 1 } }, band)).toBe(3);
      expect(nightWaves({ length: { seconds: 90 } }, band)).toBeGreaterThanOrEqual(WAVES_MIN);
      expect(nightWaves({ length: { seconds: Number.NaN } }, band)).toBe(DEFAULT_WAVES);
    }
    // A timed lesson is the same amount of time for every band.
    expect(nightWaves({ length: { seconds: 90 } }, "sprout")).toBe(3);
    expect(nightWaves({ length: { seconds: 180 } }, "builder")).toBe(5);
  });

  it("reports progress as waves done plus the share of the current wave", () => {
    expect(nightProgress(0, 3, 0, 6)).toBe(0);
    expect(nightProgress(1, 3, 3, 6)).toBeCloseTo(0.5);
    expect(nightProgress(3, 3, 0, 0)).toBe(1);
    expect(nightProgress(9, 3, 9, 1)).toBe(1);
    expect(nightProgress(1, 0, 0, 0)).toBe(0);
  });
});

describe("lanes", () => {
  it("builds 3 lanes for Sprouts, 4 for Miners and 5 for Builders", () => {
    expect(BAND_LANES).toEqual({ sprout: 3, miner: 4, builder: 5 });
  });

  it("spreads a wave's lanes over the arena's, outer lanes first", () => {
    expect([0, 1].map((l) => laneSlot(l, 2, 3))).toEqual([0, 2]);
    expect([0, 1, 2].map((l) => laneSlot(l, 3, 3))).toEqual([0, 1, 2]);
    expect([0, 1, 2].map((l) => laneSlot(l, 3, 4))).toEqual([0, 2, 3]);
    expect([0, 1, 2, 3].map((l) => laneSlot(l, 4, 5))).toEqual([0, 1, 3, 4]);
    expect(laneSlot(0, 1, 3)).toBe(1);
    // Out-of-range input still lands on a real lane.
    for (const lane of [-3, 0, 7, Number.NaN])
      for (const used of [0, 2, 9]) {
        const slot = laneSlot(lane, used, 4);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(4);
      }
  });

  it("gives each lane of a wave its own slot", () => {
    for (let built = 1; built <= 5; built++)
      for (let used = 1; used <= built; used++) {
        const slots = Array.from({ length: used }, (_, l) => laneSlot(l, used, built));
        expect(new Set(slots).size).toBe(used);
      }
  });
});

describe("mobs", () => {
  it("walk at their speed and arrive at the base once", () => {
    const a = mob({ id: "a", speed: 0.5 });
    const b = mob({ id: "b", speed: 0.1 });
    expect(stepMobs([a, b], 1000, { calm: false, waitP: 0.85 })).toEqual([]);
    expect(a.p).toBeCloseTo(0.5);
    expect(b.p).toBeCloseTo(0.1);
    const arrived = stepMobs([a, b], 1000, { calm: false, waitP: 0.85 });
    expect(arrived).toEqual([a]);
    expect(a.p).toBe(1);
    // A mob on its way out doesn't move and doesn't arrive again.
    a.state = "bonking";
    expect(stepMobs([a, b], 60_000, { calm: false, waitP: 0.85 })).toEqual([b]);
  });

  it("ignores bad frame times", () => {
    const a = mob({ speed: 0.5 });
    for (const dt of [Number.NaN, -500, Number.POSITIVE_INFINITY])
      stepMobs([a], dt, { calm: false, waitP: 0.85 });
    expect(a.p).toBe(0);
  });

  it("calm mode: nobody reaches the base; mobs queue at the waiting line", () => {
    // `a` set out first.
    const lane = [
      mob({ id: "a", speed: 0.5, p: 0.2 }),
      mob({ id: "b", speed: 0.5, p: 0 }),
      mob({ id: "c", speed: 0.5, slot: 1 }),
    ];
    for (let i = 0; i < 400; i++)
      expect(stepMobs(lane, 50, { calm: true, waitP: 0.85 })).toEqual([]);
    expect(lane[0]).toMatchObject({ p: 0.85, state: "waiting" });
    expect(lane[1]?.p).toBeCloseTo(0.85 - QUEUE_GAP);
    expect(lane[1]?.state).toBe("waiting");
    // The other lane has its own line.
    expect(lane[2]).toMatchObject({ p: 0.85, state: "waiting" });
    // When the first is typed away and gone, the next walks up.
    const rest = lane.slice(1);
    stepMobs(rest, 16, { calm: true, waitP: 0.85 });
    expect(rest[0]?.state).toBe("walking");
    for (let i = 0; i < 100; i++) stepMobs(rest, 50, { calm: true, waitP: 0.85 });
    expect(rest[0]).toMatchObject({ p: 0.85, state: "waiting" });
  });

  it("calm mode: a mob never moves back, and never passes the line (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            slot: fc.integer({ min: 0, max: 2 }),
            speed: fc.double({ min: 0.02, max: 0.4, noNaN: true }),
            p: fc.double({ min: 0, max: 0.85, noNaN: true }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        fc.array(fc.integer({ min: 0, max: 400 }), { minLength: 1, maxLength: 40 }),
        (specs, steps) => {
          const mobs = specs.map((s, i) => mob({ id: `m${i}`, ...s }));
          for (const dt of steps) {
            const before = mobs.map((m) => m.p);
            expect(stepMobs(mobs, dt, { calm: true, waitP: 0.85 })).toEqual([]);
            mobs.forEach((m, i) => {
              expect(m.p).toBeGreaterThanOrEqual(before[i] ?? 0);
              expect(m.p).toBeLessThanOrEqual(0.85 + 1e-9);
            });
          }
        },
      ),
      { seed: 4404, numRuns: 200 },
    );
  });

  it("hints at the first letter of the mob nearest the base", () => {
    const far = mob({ id: "far", word: "jam", p: 0.2 });
    const near = mob({ id: "near", word: "sad", p: 0.7 });
    const leaving = mob({ id: "out", word: "fig", p: 0.95, state: "popping" });
    expect(nextKeyFor(null, [far, near, leaving])).toBe("s");
    expect(nextKeyFor(null, [leaving])).toBeNull();
    expect(nextKeyFor(null, [])).toBeNull();
    const active = {
      id: "far",
      text: "jam",
      typed: 1,
      marks: ["ok" as const, "pending" as const, "pending" as const],
      locked: true,
      complete: false,
    };
    expect(nextKeyFor(active, [far, near])).toBe("a");
  });
});

describe("plates and the banner (M4-FIX-2)", () => {
  const bounds = { left: 0, top: 50, right: 800, bottom: 500 };
  it("moves the plates' top below a banner that reaches into their room", () => {
    expect(clearOfBanner(bounds, null)).toEqual(bounds);
    // A one-line banner fits the room the layout keeps already.
    expect(clearOfBanner(bounds, { bottom: 40 })).toEqual(bounds);
    // A taller one pushes the plates down, a gap clear of it.
    expect(clearOfBanner(bounds, { bottom: 90 }, 4)).toEqual({ ...bounds, top: 94 });
    // Never past the bottom, and a bad rectangle changes nothing.
    expect(clearOfBanner(bounds, { bottom: 900 }).top).toBe(500);
    expect(clearOfBanner(bounds, { bottom: Number.NaN })).toEqual(bounds);
  });

  it("lays every plate out below the banner when there is room (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 800 }), fc.integer({ min: 0, max: 500 })), {
          maxLength: 4,
        }),
        fc.integer({ min: 0, max: 200 }),
        (spots, bannerBottom) => {
          const b = clearOfBanner(bounds, { bottom: bannerBottom });
          const wishes = spots.map(([x, y], i) => ({
            id: `p${i}`,
            x,
            y,
            width: 80,
            height: 28,
            order: i,
          }));
          for (const p of layoutPlates(wishes, b)) expect(p.top).toBeGreaterThan(bannerBottom);
        },
      ),
      { seed: 11, numRuns: 300 },
    );
  });
});

describe("the empty field (M4-FIX-2)", () => {
  it("is empty while no mob still needs typing", () => {
    expect(fieldEmpty([])).toBe(true);
    expect(fieldEmpty([{ state: "popping" }, { state: "bonking" }])).toBe(true);
    expect(fieldEmpty([{ state: "popping" }, { state: "walking" }])).toBe(false);
    expect(fieldEmpty([{ state: "waiting" }])).toBe(false);
  });
});

describe("the shield", () => {
  it("loses one segment a bonk, stops at zero, and says when it emptied", () => {
    let shield = SHIELD_SEGMENTS;
    const emptied: boolean[] = [];
    for (let i = 0; i < SHIELD_SEGMENTS + 4; i++) {
      const hit = bonkShield(shield);
      expect(hit.shield).toBe(Math.max(0, shield - 1));
      emptied.push(hit.emptied);
      shield = hit.shield;
    }
    expect(shield).toBe(0);
    // Exactly one bonk empties it: the banner shows once.
    expect(emptied.filter(Boolean)).toHaveLength(1);
    expect(emptied[SHIELD_SEGMENTS - 1]).toBe(true);
  });

  it("never goes under zero or over full, whatever it is given (property)", () => {
    fc.assert(
      fc.property(fc.oneof(fc.double({ noNaN: true }), fc.integer()), (v) => {
        const hit = bonkShield(v);
        expect(hit.shield).toBeGreaterThanOrEqual(0);
        expect(hit.shield).toBeLessThanOrEqual(SHIELD_SEGMENTS);
      }),
      { seed: 4405 },
    );
  });
});

describe("scoring a wave", () => {
  it("gives the director the wave's own accuracy and counts", () => {
    const t = emptyTally();
    expect(waveFeedback(t)).toEqual({
      accuracy: 1,
      reachedBase: 0,
      wordsDone: 0,
      activeMs: 0,
      pulledMs: 0,
    });
    Object.assign(t, {
      keystrokes: 20,
      correct: 18,
      wordsDone: 4,
      reachedBase: 2,
      activeMs: 9000,
      pulledMs: 1500,
    });
    expect(waveFeedback(t)).toEqual({
      accuracy: 0.9,
      reachedBase: 2,
      wordsDone: 4,
      activeMs: 9000,
      pulledMs: 1500,
    });
  });

  it("takes the baseline accuracy from Mine-like sessions only", () => {
    expect(baselineAccuracy([])).toBeNull();
    expect(baselineAccuracy([run("mine", 0.9), run("mine", 0.92)])).toBeNull();
    // Nights don't count: their accuracy is under the pace's pressure.
    expect(
      baselineAccuracy([run("defense", 0.5), run("defense", 0.5), run("defense", 0.5)]),
    ).toBeNull();
    expect(
      baselineAccuracy([
        run("mine", 0.9),
        run("defense", 0.5),
        run("practice", 0.96),
        run("mine", 0.94),
      ]),
    ).toBeCloseTo(0.94);
  });

  it("measures speed on the words themselves, not on the waiting", () => {
    expect(lockedWpm([])).toBe(0);
    // A 5-letter word in 2.4 s: 4 gaps of 600 ms, which is 20 WPM.
    expect(lockedWpm([{ chars: 5, durationMs: 2400 }])).toBeCloseTo(20);
    // Single letters and zero-time words tell nothing.
    expect(lockedWpm([{ chars: 1, durationMs: 0 }])).toBe(0);
    expect(
      lockedWpm([
        { chars: 5, durationMs: 2400 },
        { chars: 1, durationMs: 0 },
      ]),
    ).toBeCloseTo(20);
  });

  it("names the wave's mob when there is one kind, and says friends otherwise", () => {
    expect(waveAnnouncement({ mobs: [waveMob("slimeling"), waveMob("slimeling")] })).toEqual({
      mobId: "slimeling",
      count: 2,
    });
    expect(waveAnnouncement({ mobs: [waveMob("slimeling"), waveMob("cave-bat")] })).toEqual({
      mobId: null,
      count: 2,
    });
    expect(waveAnnouncement({ mobs: [] })).toEqual({ mobId: null, count: 0 });
  });
});

const over = (a: PlatePlace, b: PlateBounds): boolean =>
  a.left < b.right && b.left < a.left + a.width && a.top < b.bottom && b.top < a.top + a.height;

// The review's case (#213 N3): the near mob's plate lands on the head of the mob behind it.
const shade = (o: Partial<PlateWish> = {}): PlateWish => ({
  id: "shade",
  x: 500,
  y: 294,
  width: 90,
  height: 30,
  order: 0,
  head: { left: 472, top: 300, right: 528, bottom: 332 },
  ...o,
});
const rugs = (head: PlateBounds, o: Partial<PlateWish> = {}): PlateWish => ({
  id: "rugs",
  x: 520,
  y: head.top - 6,
  width: 72,
  height: 30,
  order: 1,
  head,
  ...o,
});

describe("plates and other mobs' heads (M4-FIX-7)", () => {
  const bounds: PlateBounds = { left: 0, top: 80, right: 1280, bottom: 360 };
  it("mobHead: the top 40 % of the mob, 70 % of its height wide", () => {
    expect(mobHead(500, 200, 300)).toEqual({ left: 465, top: 200, right: 535, bottom: 240 });
    expect(mobHead(500, 300, 300)).toBeNull();
    expect(mobHead(Number.NaN, 200, 300)).toBeNull();
  });

  it("slides a plate off another mob's head when that is nearest, still over its own mob", () => {
    const head = { left: 502.5, top: 250, right: 537.5, bottom: 270 };
    const placed = new Map(layoutPlates([shade(), rugs(head)], bounds).map((p) => [p.id, p]));
    const s = placed.get("shade");
    // 42.5 px to the left beats 48 px up; the plate still spans the mob's middle (x 500).
    expect(s).toMatchObject({ left: 412.5, top: 264, covers: false });
    expect(s && s.left <= 500 && 500 <= s.left + s.width).toBe(true);
    expect(s && over(s, head)).toBe(false);
    // The far mob's plate had nothing in its way: it stays at its wish.
    expect(placed.get("rugs")).toMatchObject({ left: 484, top: 214, covers: false });
  });

  it("keeps last frame's slide while it still fits, instead of jumping to a nearer spot", () => {
    // Up is nearer here (36 px) than the slide left (42.5 px).
    const head = { left: 502.5, top: 262, right: 537.5, bottom: 270 };
    const fresh = layoutPlates([shade(), rugs(head)], bounds).find((p) => p.id === "shade");
    expect(fresh).toMatchObject({ left: 455, top: 262 - PLATE_GAP - 30, side: 0 });
    // Slid left last frame: it stays slid while that still fits.
    const kept = layoutPlates([shade({ side: -1 }), rugs(head)], bounds).find(
      (p) => p.id === "shade",
    );
    expect(kept).toMatchObject({ left: 412.5, top: 264, side: -1, covers: false });
    // Once the head has moved away, the slide is let go and the plate goes back over its mob.
    const away = { left: 800, top: 262, right: 835, bottom: 270 };
    const back = layoutPlates([shade({ side: -1 }), rugs(away)], bounds).find(
      (p) => p.id === "shade",
    );
    expect(back).toMatchObject({ left: 455, top: 264, side: 0 });
  });

  it("moves up past a head too wide to slide by, keeping its x", () => {
    const head = { left: 440, top: 270, right: 560, bottom: 290 };
    const placed = new Map(
      layoutPlates([shade(), rugs(head, { x: 500, y: 200 })], bounds).map((p) => [p.id, p]),
    );
    expect(placed.get("shade")).toMatchObject({ left: 455, top: 270 - PLATE_GAP - 30 });
    expect(placed.get("shade")?.covers).toBe(false);
  });

  it("keeps the order: the first plate keeps its spot; a later one moves for it and the heads", () => {
    const head = { left: 502.5, top: 250, right: 537.5, bottom: 270 };
    // The far mob is locked: placed first, at its wish. The near plate works round it.
    const placed = new Map(
      layoutPlates([shade({ order: 1 }), rugs(head, { order: -1 })], bounds).map((p) => [p.id, p]),
    );
    expect(placed.get("rugs")).toMatchObject({ left: 484, top: 214, covers: false });
    const s = placed.get("shade");
    expect(s?.covers).toBe(false);
    expect(s && over(s, head)).toBe(false);
  });

  it("with no free spot, lies on the head and says so (covers), never on another plate", () => {
    const tight: PlateBounds = { left: 0, top: 250, right: 1280, bottom: 300 };
    const head = { left: 440, top: 262, right: 560, bottom: 285 };
    const placed = new Map(layoutPlates([shade(), rugs(head)], tight).map((p) => [p.id, p]));
    // No room above, below or beside: it stays where it wished to be, marked.
    expect(placed.get("shade")).toMatchObject({ left: 455, top: 264, covers: true });
    const s = placed.get("shade");
    const r = placed.get("rugs");
    if (s && r) expect(touching(s, r, PLATE_GAP)).toBe(false);
    // Without heads nothing is ever marked.
    const { head: _a, ...bareShade } = shade();
    const { head: _b, ...bareRugs } = rugs(head);
    expect(layoutPlates([bareShade, bareRugs], tight).every((p) => !p.covers)).toBe(true);
  });

  it("never goes down past a head onto its own mob, even with room below (1024x500 on CI)", () => {
    // No room above the far mob's head, none beside, plenty below.
    const short: PlateBounds = { left: 0, top: 250, right: 1280, bottom: 420 };
    const head = { left: 440, top: 262, right: 560, bottom: 285 };
    const s = layoutPlates([shade(), rugs(head)], short).find((p) => p.id === "shade");
    // It stays over its own mob, marked, instead of hanging under the heads on its mob's body.
    expect(s).toMatchObject({ left: 455, top: 264, covers: true, side: 0 });
    expect(s && s.top + s.height <= 300).toBe(true);
  });

  it("never overlap, and any plate on another mob's head is marked (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.double({ min: 0, max: 1280, noNaN: true }),
            top: fc.double({ min: 60, max: 380, noNaN: true }),
            tall: fc.double({ min: 20, max: 90, noNaN: true }),
            width: fc.double({ min: 30, max: 220, noNaN: true }),
            order: fc.integer({ min: -1, max: 30 }),
          }),
          { maxLength: 16 },
        ),
        (raw) => {
          const wishes: PlateWish[] = raw.map((m, i) => {
            const head = mobHead(m.x, m.top, m.top + m.tall);
            return {
              id: `m${i}`,
              x: m.x,
              y: m.top - 6,
              width: m.width,
              height: 30,
              order: m.order,
              ...(head === null ? {} : { head }),
            };
          });
          const placed = layoutPlates(wishes, bounds);
          expect(placed).toHaveLength(wishes.length);
          for (let i = 0; i < placed.length; i++)
            for (let j = i + 1; j < placed.length; j++) {
              const a = placed[i];
              const b = placed[j];
              if (a && b) expect(touching(a, b, PLATE_GAP), `${a.id} over ${b.id}`).toBe(false);
            }
          for (const p of placed) {
            const onHead = wishes.some(
              (w) => w.id !== p.id && w.head !== undefined && over(p, w.head),
            );
            if (onHead) expect(p.covers, `${p.id} covers a head unmarked`).toBe(true);
          }
        },
      ),
      { seed: 7216, numRuns: 400 },
    );
  });

  it("most plates find a spot clear of every head on a normal night", () => {
    // Three lanes, mobs at a few depths: about what 1024×600 draws.
    const wishes: PlateWish[] = [];
    let i = 0;
    for (const x of [300, 512, 724])
      for (const top of [140, 200, 260]) {
        const tall = 30 + (top - 140) / 3;
        const head = mobHead(x, top, top + tall);
        if (head === null) continue;
        wishes.push({ id: `m${i}`, x, y: top - 6, width: 80, height: 28, order: i++, head });
      }
    const placed = layoutPlates(wishes, { left: 0, top: 40, right: 1024, bottom: 340 });
    expect(placed.filter((p) => p.covers).length).toBeLessThanOrEqual(1);
  });
});

describe("word plates", () => {
  const bounds: PlateBounds = { left: 0, top: 80, right: 1280, bottom: 360 };

  const arbWish = fc.record({
    x: fc.double({ min: -50, max: 1330, noNaN: true }),
    y: fc.double({ min: 40, max: 400, noNaN: true }),
    width: fc.double({ min: 30, max: 220, noNaN: true }),
    height: fc.double({ min: 20, max: 44, noNaN: true }),
    order: fc.integer({ min: -1, max: 30 }),
  });

  it("never overlap, on random positions (property)", () => {
    fc.assert(
      fc.property(fc.array(arbWish, { minLength: 0, maxLength: 24 }), (raw) => {
        const wishes: PlateWish[] = raw.map((w, i) => ({ id: `p${i}`, ...w }));
        const placed = layoutPlates(wishes, bounds);
        expect(placed).toHaveLength(wishes.length);
        expect(new Set(placed.map((p) => p.id)).size).toBe(wishes.length);
        for (let i = 0; i < placed.length; i++)
          for (let j = i + 1; j < placed.length; j++) {
            const a = placed[i];
            const b = placed[j];
            if (a && b) expect(touching(a, b, PLATE_GAP), `${a.id} over ${b.id}`).toBe(false);
          }
        // Every plate keeps its size and stays between the side edges.
        for (const p of placed) {
          const w = wishes.find((x) => x.id === p.id);
          expect(p.width).toBe(w?.width);
          expect(p.height).toBe(w?.height);
          expect(p.left).toBeGreaterThanOrEqual(bounds.left - 1e-9);
          expect(p.left + p.width).toBeLessThanOrEqual(bounds.right + 1e-9);
        }
      }),
      { seed: 4406, numRuns: 500 },
    );
  });

  it("never overlap when every mob stands on the same spot (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 18 }), fc.integer({ min: 0, max: 1280 }), (n, x) => {
        const wishes: PlateWish[] = Array.from({ length: n }, (_, i) => ({
          id: `p${i}`,
          x,
          y: 300,
          width: 90,
          height: 30,
          order: i,
        }));
        const placed = layoutPlates(wishes, bounds);
        for (let i = 0; i < placed.length; i++)
          for (let j = i + 1; j < placed.length; j++) {
            const a = placed[i];
            const b = placed[j];
            if (a && b) expect(touching(a, b, PLATE_GAP)).toBe(false);
          }
      }),
      { seed: 4407, numRuns: 100 },
    );
  });

  it("stay inside the bounds while there is room, and only nudge up or down", () => {
    const wishes: PlateWish[] = [
      { id: "a", x: 400, y: 300, width: 80, height: 30, order: 0 },
      { id: "b", x: 420, y: 305, width: 80, height: 30, order: 1 },
      { id: "c", x: 440, y: 310, width: 80, height: 30, order: 2 },
      { id: "far", x: 900, y: 200, width: 80, height: 30, order: 3 },
    ];
    const placed = new Map(layoutPlates(wishes, bounds).map((p) => [p.id, p]));
    // The first keeps its wish: its bottom middle on the point.
    expect(placed.get("a")).toMatchObject({ left: 360, top: 270 });
    // The others keep their x and move straight up, one on top of the other.
    expect(placed.get("b")).toMatchObject({ left: 380, top: 270 - PLATE_GAP - 30 });
    expect(placed.get("c")).toMatchObject({ left: 400, top: 270 - 2 * (PLATE_GAP + 30) });
    // A plate with nothing near it doesn't move at all.
    expect(placed.get("far")).toMatchObject({ left: 860, top: 170 });
    for (const p of placed.values()) {
      expect(p.top).toBeGreaterThanOrEqual(bounds.top);
      expect(p.top + p.height).toBeLessThanOrEqual(bounds.bottom);
    }
  });

  it("goes down when there is no room above", () => {
    const top: PlateWish[] = [
      { id: "a", x: 400, y: 100, width: 80, height: 30, order: 0 },
      { id: "b", x: 410, y: 100, width: 80, height: 30, order: 1 },
    ];
    const placed = new Map(layoutPlates(top, bounds).map((p) => [p.id, p]));
    expect(placed.get("a")?.top).toBe(bounds.top);
    expect(placed.get("b")?.top).toBe(bounds.top + 30 + PLATE_GAP);
  });

  it("places the locked plate first, so it moves least", () => {
    const wishes: PlateWish[] = [
      { id: "first", x: 400, y: 300, width: 80, height: 30, order: 0 },
      { id: "locked", x: 410, y: 300, width: 96, height: 36, order: -1 },
    ];
    const placed = new Map(layoutPlates(wishes, bounds).map((p) => [p.id, p]));
    expect(placed.get("locked")?.top).toBe(264);
    expect(placed.get("first")?.top).toBeLessThan(264);
  });

  it("drops plates it can't draw and is stable for the same input", () => {
    const wishes: PlateWish[] = [
      { id: "ok", x: 200, y: 200, width: 60, height: 24, order: 0 },
      { id: "zero", x: 200, y: 200, width: 0, height: 24, order: 1 },
      { id: "nan", x: Number.NaN, y: 200, width: 60, height: 24, order: 2 },
    ];
    expect(layoutPlates(wishes, bounds).map((p) => p.id)).toEqual(["ok"]);
    expect(layoutPlates(wishes, bounds)).toEqual(layoutPlates(wishes.toReversed(), bounds));
  });
});

describe("framing the field", () => {
  const canvas = { width: 1280, height: 720 };
  /** The open stage of the real HUD at 1280×720 (M2-14): under the top row, above the keys. */
  const STAGES: Record<AgeBand, Box> = {
    // Measured on CI's screenshots, less the banner's room. A night shows the keys and the
    // hint line without the drawn hands: 272 px.
    sprout: { left: 16, top: 131, width: 1248, height: 297 },
    // Keyboard only.
    miner: { left: 16, top: 131, width: 1248, height: 314 },
    // No keyboard.
    builder: { left: 16, top: 131, width: 1248, height: 570 },
  };

  /** The mode keeps this much room for a locked plate above the far end. */
  const PLATE_ROOM = 56;

  it("projects a point the way three.js does", () => {
    const view = {
      target: { x: 24, y: 5, z: 21.5 },
      pitch: (28 * Math.PI) / 180,
      distance: 40,
      fov: 38,
    };
    const camera = new THREE.PerspectiveCamera(view.fov, canvas.width / canvas.height, 0.1, 500);
    camera.position.set(
      view.target.x,
      view.target.y + view.distance * Math.sin(view.pitch),
      view.target.z + view.distance * Math.cos(view.pitch),
    );
    camera.lookAt(view.target.x, view.target.y, view.target.z);
    camera.updateMatrixWorld();
    for (const p of [
      { x: 24, y: 5, z: 21.5 },
      { x: 10, y: 5, z: 9.5 },
      { x: 38, y: 9, z: 33.5 },
      { x: 24, y: 7, z: 40 },
    ]) {
      const ndc = new THREE.Vector3(p.x, p.y, p.z).project(camera);
      const mine = projectLane(p, view, canvas);
      expect(mine.x).toBeCloseTo(((ndc.x + 1) / 2) * canvas.width, 3);
      expect(mine.y).toBeCloseTo(((1 - ndc.y) / 2) * canvas.height, 3);
      expect(mine.z).toBeGreaterThan(0);
    }
  });

  it("keeps the whole field inside the space the HUD leaves, for every band", () => {
    for (const band of BANDS) {
      const field = arenaLayout(BAND_LANES[band]);
      const box = STAGES[band];
      const fit = fitLaneView(field, canvas, box, PLATE_ROOM);
      // A mob at the far end has room above its head for a locked plate, inside the box.
      const head = projectLane(
        { x: field.center.x, y: field.groundY + FIELD_HEADROOM, z: field.farZ },
        fit,
        canvas,
      );
      expect(head.y + fit.shiftY, `${band} plate room`).toBeGreaterThanOrEqual(
        box.top + PLATE_ROOM - 1,
      );
      const half = field.width / 2;
      const corners = [-1, 1].flatMap((side) => [
        { x: field.center.x + side * half, y: field.groundY, z: field.baseZ + FIELD_FRONT },
        { x: field.center.x + side * half, y: field.groundY + FIELD_HEADROOM, z: field.farZ },
        { x: field.center.x + side * half, y: field.groundY, z: field.farZ },
      ]);
      for (const c of corners) {
        const s = projectLane(c, fit, canvas);
        const x = s.x + fit.shiftX;
        const y = s.y + fit.shiftY;
        expect(x, `${band} x`).toBeGreaterThanOrEqual(box.left - 1);
        expect(x, `${band} x`).toBeLessThanOrEqual(box.left + box.width + 1);
        expect(y, `${band} y`).toBeGreaterThanOrEqual(box.top - 1);
        expect(y, `${band} y`).toBeLessThanOrEqual(box.top + box.height + 1);
      }
      // The lanes are spread over a good part of the box, not a speck in the middle.
      const base = projectLane(
        { x: field.center.x, y: field.groundY, z: field.baseZ },
        fit,
        canvas,
      );
      const far = projectLane({ x: field.center.x, y: field.groundY, z: field.farZ }, fit, canvas);
      expect(base.y - far.y, band).toBeGreaterThan(box.height * 0.35);
    }
  });

  it("draws a mob big enough to read, even in a Sprout's narrow stage", () => {
    for (const band of BANDS) {
      const field = arenaLayout(BAND_LANES[band]);
      const fit = fitLaneView(field, canvas, STAGES[band], PLATE_ROOM);
      const at = (y: number, z: number): number =>
        projectLane({ x: field.center.x, y, z }, fit, canvas).y;
      // A mob is about 2.2 blocks tall (a 16-px model at 2.2×).
      const nearPx = at(field.groundY, field.baseZ) - at(field.groundY + 2.2, field.baseZ);
      const farPx = at(field.groundY, field.farZ) - at(field.groundY + 2.2, field.farZ);
      expect(nearPx, band).toBeGreaterThanOrEqual(44);
      expect(farPx, band).toBeGreaterThanOrEqual(30);
      // And the lanes are far enough apart for a word plate over each.
      const x = (lane: number): number =>
        projectLane({ x: field.laneX[lane] ?? 0, y: field.groundY, z: field.farZ }, fit, canvas).x;
      expect(x(1) - x(0), band).toBeGreaterThanOrEqual(70);
    }
  });

  it("uses the whole canvas when the HUD isn't there, and survives a tiny box", () => {
    const field = arenaLayout(3);
    const whole = fitLaneView(field, canvas, null);
    expect(whole.distance).toBeGreaterThan(5);
    expect(Number.isFinite(whole.shiftX) && Number.isFinite(whole.shiftY)).toBe(true);
    const tiny = fitLaneView(
      field,
      { width: 0, height: 0 },
      { left: 0, top: 0, width: 0, height: 0 },
    );
    expect(Number.isFinite(tiny.distance)).toBe(true);
    // Bad plate room is ignored, and it never takes more than two fifths of the box.
    expect(fitLaneView(field, canvas, null, Number.NaN)).toEqual(whole);
    expect(Number.isFinite(fitLaneView(field, canvas, null, 1e9).distance)).toBe(true);
    // A flat box gets a lower camera than a tall one.
    const flat = fitLaneView(field, canvas, { left: 0, top: 100, width: 1280, height: 200 });
    const tall = fitLaneView(field, canvas, { left: 0, top: 100, width: 1280, height: 600 });
    expect(flat.pitch).toBeLessThan(tall.pitch);
  });
});

const REPO = resolve(import.meta.dirname, "../../../..");

describe("short screens (M4-FIX-4)", () => {
  it("sizes the message's and the plate's room from their real, screen-capped fonts", () => {
    // 1280×720 at text scale 1: the banner's old room, and a locked plate's real height
    // (1.47 em × 1.2) plus its 6 px gap and a little more.
    const base = stageRoom(720, 1);
    expect(base.banner).toBe(46);
    expect(base.plate).toBeCloseTo(51.6);
    expect(base.plate).toBeGreaterThanOrEqual(22 * 1.47 * 1.2 + 6 + 4);
    // 600 px tall at text scale 2: the fonts stop at 3.6 and 5.4 dvh, and so does the room.
    expect(messageFontPx(600, 2)).toBeCloseTo(21.6);
    expect(plateFontPx(600, 2)).toBeCloseTo(32.4);
    const r = stageRoom(600, 2);
    expect(r.banner).toBeCloseTo(49.68);
    expect(r.plate).toBeCloseTo(70.32, 1);
    // The fonts' own formulas: keep them in step with the CSS.
    const css = readFileSync(join(REPO, "src/ui/hud/Hud.module.css"), "utf8");
    expect(css).toContain("font-size: min(calc(20px * var(--text-scale)), 3.6dvh);");
    const plates = readFileSync(join(REPO, "src/modes/defense/plates.ts"), "utf8");
    expect(plates).toContain('"min(calc(22px * var(--text-scale, 1)), 5.4dvh)"');
  });

  it("asks for at least 40 % of the screen, more when the room and the field need it", () => {
    for (const h of [480, 600, 720, 900, 1080])
      for (const scale of [1, 1.25, 1.5, 2]) {
        const floor = stageFloor(h, scale);
        const r = stageRoom(h, scale);
        expect(floor).toBeGreaterThanOrEqual(Math.round(STAGE_MIN_SHARE * h));
        expect(floor).toBeGreaterThanOrEqual(Math.round(FIELD_MIN_PX + r.banner + r.plate) - 1);
      }
    // 1024×600: about half the screen at text scale 2, under that at 1.
    expect(stageFloor(600, 2)).toBe(290);
    expect(stageFloor(600, 1)).toBe(268);
    // A tall screen: the 40 % share decides.
    expect(stageFloor(1080, 1)).toBe(432);
  });

  it("never asks for more stage than is left above the keys at their smallest (review B1)", () => {
    expect(capStageFloor(290, 400)).toBe(290);
    expect(capStageFloor(290, 183.7)).toBe(183);
    expect(capStageFloor(290, -20)).toBe(0);
    expect(capStageFloor(290, null)).toBe(290);
    expect(capStageFloor(290, Number.NaN)).toBe(290);
  });

  it("frames mobs about 48 px tall at 1024×600, with the plate's room above the far end", () => {
    const canvas = { width: 1024, height: 600 };
    for (const band of BANDS) {
      const field = arenaLayout(BAND_LANES[band]);
      for (const scale of [1, 1.25, 1.5, 2]) {
        // The real HUD's top row ends about 100 px down; the stage then holds its floor.
        const height = stageFloor(600, scale);
        const room = stageRoom(600, scale);
        const banner = Math.min(room.banner, height * 0.25);
        const box: Box = { left: 16, top: 100 + banner, width: 992, height: height - banner };
        const fit = fitLaneView(field, canvas, box, room.plate);
        const at = (y: number, z: number): number =>
          projectLane({ x: field.center.x, y, z }, fit, canvas).y;
        // A mob is about 2.2 blocks tall (a 16-px model at 2.2×).
        const farPx = at(field.groundY, field.farZ) - at(field.groundY + 2.2, field.farZ);
        expect(farPx, `${band} ×${scale}`).toBeGreaterThanOrEqual(44);
        // The far mob's head leaves a locked plate its room inside the stage.
        const head = at(field.groundY + FIELD_HEADROOM, field.farZ) + fit.shiftY;
        expect(head, `${band} ×${scale}`).toBeGreaterThanOrEqual(box.top + room.plate - 1);
      }
    }
  });
});

describe("night length and walking (M4-FIX-3)", () => {
  it("ends the night after every wave, or after the wave on when the band's cap passed", () => {
    expect(NIGHT_CAP_MS).toEqual({ sprout: 240_000, miner: 300_000, builder: 300_000 });
    expect(nightOver(2, 3, 60_000, "miner")).toBe(false);
    expect(nightOver(3, 3, 60_000, "miner")).toBe(true);
    expect(nightOver(1, 5, 299_999, "miner")).toBe(false);
    expect(nightOver(1, 5, 300_000, "miner")).toBe(true);
    // A Sprout's night is shorter.
    expect(nightOver(1, 5, 250_000, "sprout")).toBe(true);
    expect(nightOver(1, 5, 250_000, "builder")).toBe(false);
  });

  it("plays the walk clip slower for a slow mob, never faster than authored, never under 0.4", () => {
    // A lane walked in WALK_REF_MS or less: the clip's own pace.
    expect(walkRate(1000 / WALK_REF_MS)).toBeCloseTo(1);
    expect(walkRate(1000 / 4000)).toBe(1);
    // Twice as slow: half the rate.
    expect(walkRate(1000 / (2 * WALK_REF_MS))).toBeCloseTo(0.5);
    // A 90 s walk (a 5 WPM learner's) and bad input stop at 0.4.
    expect(walkRate(1000 / 90_000)).toBe(0.4);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const rate = walkRate(bad);
      expect(rate).toBeGreaterThanOrEqual(0.4);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });
});
