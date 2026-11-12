/**
 * Voxel model animation (task M4-01): track interpolation, loop and clamp, the 120 ms crossfade,
 * `onEnd` and reduced motion. No three.js here: the animator writes plain pose arrays.
 */
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { Animator, CROSSFADE_MS } from "../../../src/render/models/animator";
import {
  POSE_STRIDE,
  PROP_SLOT,
  compileRig,
  restPose,
  sampleTrack,
} from "../../../src/render/models/rig";
import type { CompiledTrack } from "../../../src/render/models/rig";
import type { VoxelModel } from "../../../src/render/models/types";
import { critter, oneBox } from "./helpers";

const SEED = 4401;

/** A single-part track with x = the given values at the given times (y = 2x, z = -x). */
function track(keys: [t: number, x: number][]): CompiledTrack {
  return {
    at: 0,
    times: Float64Array.from(keys.map(([t]) => t)),
    values: Float64Array.from(keys.flatMap(([, x]) => [x, 2 * x, -x])),
  };
}

function sampleX(tr: CompiledTrack, t: number, loop: boolean, duration: number): number {
  const out = restPose(1);
  sampleTrack(tr, t, loop, duration, out);
  expect(out[1]).toBeCloseTo(2 * (out[0] ?? 0), 4);
  expect(out[2]).toBeCloseTo(-(out[0] ?? 0), 4);
  return out[0] ?? Number.NaN;
}

/** One box whose `pos` x goes 0 → 10 over `a` (clamped) and 0 → -10 → 0 over `b` (looping). */
function twoAnims(): VoxelModel {
  return oneBox({
    a: {
      durationMs: 100,
      loop: false,
      tracks: [
        {
          part: "box",
          prop: "pos",
          keys: [
            { t: 0, v: [0, 0, 0] },
            { t: 100, v: [10, 0, 0] },
          ],
        },
      ],
    },
    b: {
      durationMs: 200,
      loop: true,
      tracks: [
        {
          part: "box",
          prop: "pos",
          keys: [
            { t: 0, v: [0, 0, 0] },
            { t: 100, v: [-10, 0, 0] },
            { t: 200, v: [0, 0, 0] },
          ],
        },
      ],
    },
    spin: {
      durationMs: 100,
      loop: false,
      tracks: [
        {
          part: "box",
          prop: "rot",
          keys: [
            { t: 0, v: [0, 0, 0] },
            { t: 100, v: [0, 90, 0] },
          ],
        },
      ],
    },
  });
}

const posX = (a: Animator): number => a.pose[PROP_SLOT.pos] ?? Number.NaN;

describe("sampleTrack: linear interpolation between keys", () => {
  const tr = track([
    [100, 0],
    [200, 10],
    [400, 30],
  ]);

  it("hits every key exactly and is linear between keys", () => {
    expect(sampleX(tr, 100, false, 500)).toBe(0);
    expect(sampleX(tr, 200, false, 500)).toBe(10);
    expect(sampleX(tr, 400, false, 500)).toBe(30);
    expect(sampleX(tr, 150, false, 500)).toBeCloseTo(5, 6);
    expect(sampleX(tr, 300, false, 500)).toBeCloseTo(20, 6);
    expect(sampleX(tr, 350, false, 500)).toBeCloseTo(25, 6);
  });

  it("clamps before the first key and after the last when not looping", () => {
    expect(sampleX(tr, 0, false, 500)).toBe(0);
    expect(sampleX(tr, 50, false, 500)).toBe(0);
    expect(sampleX(tr, 450, false, 500)).toBe(30);
    expect(sampleX(tr, 9999, false, 500)).toBe(30);
  });

  it("wraps a loop: after the last key it blends toward the first, and before the first from the last", () => {
    // Last key 400 (30) → first key again at 100 + 500 = 600 (0). Gap 200 ms.
    expect(sampleX(tr, 500, true, 500)).toBeCloseTo(15, 5);
    // Before the first key: from the last key at 400 - 500 = -100 to the first at 100.
    expect(sampleX(tr, 0, true, 500)).toBeCloseTo(15, 5);
    expect(sampleX(tr, 50, true, 500)).toBeCloseTo(7.5, 5);
  });

  it("a single key is constant", () => {
    const one = track([[50, 7]]);
    for (const t of [0, 50, 100]) expect(sampleX(one, t, false, 100)).toBe(7);
    expect(sampleX(one, 0, true, 100)).toBe(7);
  });

  it("two keys at the same time make a step: the later key wins from then on", () => {
    const step = track([
      [0, 0],
      [100, 0],
      [100, 5],
      [200, 5],
    ]);
    expect(sampleX(step, 99, false, 200)).toBe(0);
    expect(sampleX(step, 100, false, 200)).toBe(5);
    expect(sampleX(step, 150, false, 200)).toBe(5);
  });

  it("property: the value always lies between the smallest and largest key (seeded)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 1000 }),
            fc.double({ min: -100, max: 100, noNaN: true }),
          ),
          {
            minLength: 1,
            maxLength: 8,
          },
        ),
        fc.integer({ min: 0, max: 1000 }),
        fc.boolean(),
        (raw, t, loop) => {
          const keys = raw.toSorted((p, q) => p[0] - q[0]);
          const tr2 = track(keys);
          const out = restPose(1);
          sampleTrack(tr2, t, loop, 1000, out);
          const xs = keys.map(([, x]) => x);
          const v = out[0] ?? Number.NaN;
          // Float32 storage: allow for rounding.
          const eps = 1e-3 * (1 + Math.max(...xs.map(Math.abs)));
          return v >= Math.min(...xs) - eps && v <= Math.max(...xs) + eps;
        },
      ),
      { seed: SEED, numRuns: 400 },
    );
  });
});

describe("compileRig", () => {
  it("orders parts parent-first and links parents by index", () => {
    const def = critter();
    const reversed: VoxelModel = { ...def, parts: def.parts.toReversed() };
    const rig = compileRig(reversed);
    expect(rig.parts).toHaveLength(def.parts.length);
    for (const part of rig.parts) {
      expect(part.parent).toBeLessThan(part.index);
      if (part.def.parent === undefined) expect(part.parent).toBe(-1);
      else expect(rig.parts[part.parent]?.def.name).toBe(part.def.parent);
    }
  });

  it("binds tracks to the right pose slot", () => {
    const rig = compileRig(critter());
    const head = rig.parts.findIndex((p) => p.def.name === "head");
    const idle = rig.anims.get("idle");
    const headRot = idle?.tracks.find((t) => t.at === head * POSE_STRIDE + PROP_SLOT.rot);
    expect(headRot).toBeDefined();
  });

  it("throws on an unknown parent, a cycle and a track on a missing part", () => {
    const base = oneBox();
    const part = base.parts[0];
    if (!part) throw new Error("fixture");
    expect(() => compileRig({ ...base, parts: [{ ...part, parent: "nope" }] })).toThrow(
      /unknown parent/,
    );
    expect(() =>
      compileRig({
        ...base,
        parts: [
          { ...part, name: "a", parent: "b" },
          { ...part, name: "b", parent: "a" },
        ],
      }),
    ).toThrow(/cycle/);
    expect(() =>
      compileRig(
        oneBox({
          x: {
            durationMs: 10,
            loop: false,
            tracks: [{ part: "ghost", prop: "pos", keys: [{ t: 0, v: [0, 0, 0] }] }],
          },
        }),
      ),
    ).toThrow(/unknown part/);
  });
});

describe("Animator", () => {
  it("starts at rest and still", () => {
    const a = new Animator(compileRig(twoAnims()));
    expect(Array.from(a.pose)).toEqual(Array.from(restPose(1)));
    expect(a.animating).toBe(false);
    expect(a.update(16)).toBe(false);
  });

  it("plays a clamped anim with linear interpolation, holds the end, fires onEnd once, then goes still", () => {
    const onEnd = vi.fn();
    const a = new Animator(compileRig(twoAnims()));
    a.play("a", { fadeMs: 0, onEnd });
    a.update(0);
    expect(posX(a)).toBe(0);
    a.update(25);
    expect(posX(a)).toBeCloseTo(2.5, 5);
    a.update(50);
    expect(posX(a)).toBeCloseTo(7.5, 5);
    expect(onEnd).not.toHaveBeenCalled();
    a.update(60);
    expect(posX(a)).toBe(10);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(a.animating).toBe(false);
    expect(a.current).toBe("a");
    a.update(100);
    expect(posX(a)).toBe(10);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("loops: time wraps and the anim keeps asking for frames; onEnd never fires", () => {
    const onEnd = vi.fn();
    const a = new Animator(compileRig(twoAnims()));
    a.play("b", { fadeMs: 0, onEnd });
    a.update(50);
    expect(posX(a)).toBeCloseTo(-5, 5);
    a.update(200); // 250 → 50
    expect(a.timeMs).toBeCloseTo(50, 6);
    expect(posX(a)).toBeCloseTo(-5, 5);
    for (let i = 0; i < 100; i++) a.update(16);
    expect(a.animating).toBe(true);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("the play option `loop` overrides the anim's flag", () => {
    const a = new Animator(compileRig(twoAnims()));
    const onEnd = vi.fn();
    a.play("b", { fadeMs: 0, loop: false, onEnd });
    a.update(500);
    expect(posX(a)).toBe(0);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(a.animating).toBe(false);
  });

  it("speed scales time", () => {
    const a = new Animator(compileRig(twoAnims()));
    a.play("a", { fadeMs: 0, speed: 2 });
    a.update(25);
    expect(posX(a)).toBeCloseTo(5, 5);
  });

  it(`crossfades for ${CROSSFADE_MS} ms by default: a linear blend from the old pose into the running new anim`, () => {
    const a = new Animator(compileRig(twoAnims()));
    a.play("a", { fadeMs: 0 });
    a.update(100); // at the end of a: x = 10
    expect(posX(a)).toBe(10);
    a.play("b"); // b runs during the fade: x_b(t) = -t/10 for t ≤ 100
    a.update(30);
    // w = 30/120 = 0.25, target -3: 10 + (-3 - 10) * 0.25 = 6.75
    expect(posX(a)).toBeCloseTo(6.75, 4);
    a.update(30);
    // w = 0.5, target -6: 10 + (-16) * 0.5 = 2
    expect(posX(a)).toBeCloseTo(2, 4);
    a.update(60);
    // fade done (w = 1), target at t = 120: -10 + (20 / 100) * 10 = -8
    expect(posX(a)).toBeCloseTo(-8, 4);
    a.update(30);
    // pure b at t = 150: -5
    expect(posX(a)).toBeCloseTo(-5, 4);
  });

  it("crossfades rotations too, and from a pose caught mid-fade", () => {
    const a = new Animator(compileRig(twoAnims()));
    const rotY = (): number => a.pose[PROP_SLOT.rot + 1] ?? Number.NaN;
    a.play("spin", { fadeMs: 0 });
    a.update(100);
    expect(rotY()).toBe(90);
    a.play("a", { fadeMs: 100 });
    a.update(50);
    expect(rotY()).toBeCloseTo(45, 4);
    // Switch again halfway: the new fade starts from the blended pose (rot 45, x 2.5).
    a.stop({ fadeMs: 100 });
    a.update(0);
    expect(rotY()).toBeCloseTo(45, 4);
    a.update(50);
    expect(rotY()).toBeCloseTo(22.5, 4);
    expect(posX(a)).toBeCloseTo(1.25, 4);
    a.update(50);
    expect(Array.from(a.pose)).toEqual(Array.from(restPose(1)));
    expect(a.animating).toBe(false);
    expect(a.current).toBe(null);
  });

  it("a custom fade length and fadeMs 0 (snap)", () => {
    const a = new Animator(compileRig(twoAnims()));
    a.play("a", { fadeMs: 0 });
    a.update(100);
    a.play("b", { fadeMs: 40 });
    a.update(20);
    expect(posX(a)).toBeCloseTo(10 + (-2 - 10) * 0.5, 4);
    a.play("a", { fadeMs: 0 });
    a.update(0);
    expect(posX(a)).toBe(0);
  });

  it("onEnd fires after the final pose is written, and may start the next anim", () => {
    const a = new Animator(compileRig(twoAnims()));
    let seen = Number.NaN;
    a.play("a", {
      fadeMs: 0,
      onEnd: () => {
        seen = posX(a);
        a.play("b");
      },
    });
    a.update(200);
    expect(seen).toBe(10);
    expect(a.current).toBe("b");
    expect(a.animating).toBe(true);
  });

  it("replacing an anim before its end never calls its onEnd", () => {
    const onEnd = vi.fn();
    const a = new Animator(compileRig(twoAnims()));
    a.play("a", { onEnd });
    a.update(50);
    a.play("b");
    a.update(500);
    a.stop();
    a.update(500);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("playing the running anim again doesn't restart it, unless asked", () => {
    const a = new Animator(compileRig(twoAnims()));
    a.play("b", { fadeMs: 0 });
    a.update(50);
    expect(a.play("b")).toBe(true);
    expect(a.timeMs).toBe(50);
    a.play("b", { restart: true, fadeMs: 0 });
    expect(a.timeMs).toBe(0);
  });

  it("an unknown anim returns false and changes nothing", () => {
    const a = new Animator(compileRig(twoAnims()));
    a.play("b", { fadeMs: 0 });
    a.update(50);
    expect(a.play("dance")).toBe(false);
    expect(a.current).toBe("b");
    expect(a.timeMs).toBe(50);
  });

  it("negative dt is treated as 0", () => {
    const a = new Animator(compileRig(twoAnims()));
    a.play("a", { fadeMs: 0 });
    a.update(30);
    a.update(-50);
    expect(a.timeMs).toBe(30);
  });

  describe("reduced motion", () => {
    it("holds a looping anim on its first frame and stops asking for frames", () => {
      let reduced = true;
      const a = new Animator(compileRig(twoAnims()), { reducedMotion: () => reduced });
      a.play("b", { fadeMs: 0 });
      expect(a.animating).toBe(true); // the held pose still has to be written once
      a.update(50);
      expect(posX(a)).toBe(0);
      expect(a.animating).toBe(false);
      // The flag is read live: turning it off lets the loop run again.
      reduced = false;
      expect(a.animating).toBe(true);
      a.update(50);
      expect(posX(a)).toBeCloseTo(-5, 5);
    });

    it("still plays one-shot anims to the end and fires onEnd", () => {
      const onEnd = vi.fn();
      const a = new Animator(compileRig(twoAnims()), { reducedMotion: () => true });
      a.play("a", { fadeMs: 0, onEnd });
      a.update(50);
      expect(posX(a)).toBeCloseTo(5, 5);
      a.update(50);
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(a.animating).toBe(false);
    });

    it("finishes a crossfade into a held loop, then goes still", () => {
      const a = new Animator(compileRig(twoAnims()), { reducedMotion: () => true });
      a.play("a", { fadeMs: 0 });
      a.update(100);
      a.play("b"); // fade 120 ms toward b's first frame (x = 0)
      a.update(60);
      expect(posX(a)).toBeCloseTo(5, 4);
      expect(a.animating).toBe(true);
      a.update(60);
      expect(posX(a)).toBe(0);
      expect(a.animating).toBe(false);
    });
  });
});

// Review N3, N7 and N8 (PR #157): bad timing input, reduced motion switched on mid-loop, and
// replaying anims.

describe("Animator: bad timing input is safe", () => {
  for (const speed of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`speed ${speed} on a one-shot jumps to its end, fires onEnd once and goes still`, () => {
      const onEnd = vi.fn();
      const a = new Animator(compileRig(twoAnims()));
      a.play("a", { fadeMs: 0, speed, onEnd });
      a.update(16);
      expect(posX(a)).toBe(10);
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(a.animating).toBe(false);
      a.update(16);
      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it(`speed ${speed} on a loop holds its first frame and goes still`, () => {
      const a = new Animator(compileRig(twoAnims()));
      a.play("b", { fadeMs: 0, speed });
      for (let i = 0; i < 5; i++) a.update(37);
      expect(a.timeMs).toBe(0);
      expect(posX(a)).toBe(0);
      expect(a.animating).toBe(false);
    });
  }

  it("speed changed to 0 on the running loop snaps it to its first frame", () => {
    const a = new Animator(compileRig(twoAnims()));
    a.play("b", { fadeMs: 0 });
    a.update(50);
    expect(posX(a)).toBeCloseTo(-5, 5);
    a.play("b", { speed: 0 });
    expect(a.animating).toBe(true);
    a.update(16);
    expect(posX(a)).toBe(0);
    expect(a.animating).toBe(false);
  });

  it("a negative speed never shows a pose outside a loop's keys", () => {
    // A loop whose first and last keys differ, so a negative time would extrapolate.
    const def = oneBox({
      ramp: {
        durationMs: 200,
        loop: true,
        tracks: [
          {
            part: "box",
            prop: "pos",
            keys: [
              { t: 20, v: [2, 0, 0] },
              { t: 180, v: [8, 0, 0] },
            ],
          },
        ],
      },
    });
    const a = new Animator(compileRig(def));
    a.play("ramp", { fadeMs: 0, speed: -1 });
    for (let i = 0; i < 40; i++) {
      a.update(23);
      expect(posX(a)).toBeGreaterThanOrEqual(2);
      expect(posX(a)).toBeLessThanOrEqual(8);
      expect(a.timeMs).toBeGreaterThanOrEqual(0);
      expect(a.timeMs).toBeLessThan(200);
    }
  });

  for (const dt of [Number.NaN, -16, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
    it(`a dtMs of ${dt} counts as 0 for time and fades`, () => {
      const a = new Animator(compileRig(twoAnims()));
      a.play("a", { fadeMs: 0 });
      a.update(30);
      a.update(dt);
      expect(a.timeMs).toBe(30);
      expect(posX(a)).toBeCloseTo(3, 5);
      a.play("b", { fadeMs: 100 });
      a.update(dt);
      expect(Number.isFinite(posX(a))).toBe(true);
      expect(posX(a)).toBeCloseTo(3, 5);
      a.update(50);
      expect(Number.isFinite(posX(a))).toBe(true);
    });
  }

  for (const fadeMs of [Number.NaN, -50, Number.POSITIVE_INFINITY]) {
    it(`a fadeMs of ${fadeMs} snaps`, () => {
      const a = new Animator(compileRig(twoAnims()));
      a.play("a", { fadeMs: 0 });
      a.update(100);
      a.play("b", { fadeMs });
      a.update(50);
      expect(posX(a)).toBeCloseTo(-5, 5);
    });
  }
});

describe("Animator: reduced motion switched on mid-loop", () => {
  it("snaps the loop to its first frame on the next update, then goes still", () => {
    let reduced = false;
    const a = new Animator(compileRig(twoAnims()), { reducedMotion: () => reduced });
    a.play("b", { fadeMs: 0 });
    a.update(70);
    expect(posX(a)).toBeCloseTo(-7, 5);
    reduced = true;
    expect(a.animating).toBe(true); // one more update to reach the first frame
    a.update(16);
    expect(posX(a)).toBe(0);
    expect(a.timeMs).toBe(0);
    expect(a.animating).toBe(false);
  });
});

describe("Animator: playing again", () => {
  it("restarts a one-shot that has already ended (a second hit), and fires its new onEnd", () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = new Animator(compileRig(twoAnims()));
    a.play("a", { fadeMs: 0, onEnd: first });
    a.update(200);
    expect(a.animating).toBe(false);
    expect(a.play("a", { fadeMs: 0, onEnd: second })).toBe(true);
    expect(a.timeMs).toBe(0);
    expect(a.animating).toBe(true);
    a.update(50);
    expect(posX(a)).toBeCloseTo(5, 5);
    a.update(50);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("playing the running anim applies a new loop option without restarting", () => {
    const onEnd = vi.fn();
    const a = new Animator(compileRig(twoAnims()));
    a.play("b", { fadeMs: 0 });
    a.update(150);
    a.play("b", { loop: false, onEnd });
    expect(a.timeMs).toBe(150);
    a.update(100);
    expect(posX(a)).toBe(0);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(a.animating).toBe(false);
  });
});
