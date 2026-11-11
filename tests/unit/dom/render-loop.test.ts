/**
 * Render loop (task M2-01): render-on-demand, dt clamping and hit-stop, driven by a fake
 * requestAnimationFrame and a manual clock.
 */
import { describe, expect, it, vi } from "vitest";
import { MAX_FRAME_DT, createLoop } from "../../../src/render/loop";
import type { LoopDeps } from "../../../src/render/loop";

/** A fake rAF queue plus a clock the test moves by hand. */
function harness(onError?: (err: unknown) => void) {
  let queue: { id: number; cb: (ts: number) => void }[] = [];
  let nextId = 1;
  let now = 1000;
  const renders: { dt: number; t: number }[] = [];
  const deps: LoopDeps = {
    raf(cb) {
      const id = nextId++;
      queue.push({ id, cb });
      return id;
    },
    caf(id) {
      queue = queue.filter((q) => q.id !== id);
    },
    now: () => now,
    render: (dt, t) => renders.push({ dt, t }),
    ...(onError && { onError }),
  };
  const loop = createLoop(deps);
  return {
    loop,
    renders,
    pending: () => queue.length,
    /** Advances the clock by `ms`, then runs every queued frame callback once. */
    tick(ms = 16) {
      now += ms;
      const run = queue;
      queue = [];
      for (const q of run) q.cb(now);
    },
  };
}

describe("render loop", () => {
  it("requests no frames while idle", () => {
    const h = harness();
    expect(h.pending()).toBe(0);
    h.tick();
    h.tick();
    expect(h.renders).toHaveLength(0);
    expect(h.loop.scheduled).toBe(false);
  });

  it("requestRender draws exactly one frame, then stops", () => {
    const h = harness();
    h.loop.requestRender();
    h.loop.requestRender();
    expect(h.pending()).toBe(1);
    h.tick();
    expect(h.renders).toHaveLength(1);
    expect(h.pending()).toBe(0);
    h.tick();
    expect(h.renders).toHaveLength(1);
  });

  it("runs continuously while a subscriber is active and stops when it leaves", () => {
    const h = harness();
    const seen: number[] = [];
    const off = h.loop.onFrame((dt) => seen.push(dt));
    for (let i = 0; i < 5; i++) h.tick(16);
    expect(seen).toEqual([0, 16, 16, 16, 16]);
    expect(h.pending()).toBe(1);
    off();
    h.tick(16);
    expect(h.pending()).toBe(0);
    expect(h.loop.scheduled).toBe(false);
    expect(seen).toHaveLength(5);
  });

  it("the first frame after idle reports dt = 0, not the idle gap", () => {
    const h = harness();
    h.loop.requestRender();
    h.tick(16);
    h.tick(5000);
    h.loop.requestRender();
    h.tick(16);
    expect(h.renders.map((r) => r.dt)).toEqual([0, 0]);
  });

  it("clamps dt to 50 ms", () => {
    const h = harness();
    const seen: number[] = [];
    h.loop.onFrame((dt) => seen.push(dt));
    h.tick(16);
    h.tick(400);
    h.tick(30);
    expect(seen).toEqual([0, MAX_FRAME_DT, 30]);
  });

  it("keeps running while a system is busy, then goes idle", () => {
    const h = harness();
    let left = 3;
    h.loop.addSystem(() => --left > 0);
    h.loop.wake();
    for (let i = 0; i < 6; i++) h.tick();
    expect(h.renders).toHaveLength(3);
    expect(h.pending()).toBe(0);
  });

  it("hitStop gives subscribers dt = 0 for its duration; systems keep real dt", () => {
    const h = harness();
    const sub: number[] = [];
    const sys: number[] = [];
    h.loop.onFrame((dt) => sub.push(dt));
    h.loop.addSystem((dt) => {
      sys.push(dt);
      return false;
    });
    h.tick(16); // first frame: dt 0
    h.loop.hitStop(40);
    h.tick(16); // frozen (40 left → 24)
    h.tick(16); // frozen (24 → 8)
    h.tick(16); // frozen (8 → 0)
    h.tick(16); // running again
    expect(sub).toEqual([0, 0, 0, 0, 16]);
    expect(sys).toEqual([0, 16, 16, 16, 16]);
  });

  it("hitStop keeps frames coming while idle, and ignores non-positive durations", () => {
    const h = harness();
    h.loop.hitStop(0);
    h.loop.hitStop(-5);
    expect(h.pending()).toBe(0);
    h.loop.hitStop(30);
    h.tick(16);
    h.tick(16);
    h.tick(16);
    h.tick(16);
    // dt 0 on the first frame doesn't use up the hit-stop, so it runs 16 + 16 more ms.
    expect(h.renders).toHaveLength(3);
    expect(h.pending()).toBe(0);
  });

  it("passes the same frame time to systems, subscribers and render", () => {
    const h = harness();
    const times: number[] = [];
    h.loop.addSystem((_dt, t) => {
      times.push(t);
      return false;
    });
    h.loop.onFrame((_dt, t) => times.push(t));
    h.tick(16);
    expect(times).toEqual([1016, 1016]);
    expect(h.renders[0]?.t).toBe(1016);
  });

  it("a throwing subscriber is reported and the loop keeps running", () => {
    const errors: unknown[] = [];
    const h = harness((e) => errors.push(e));
    const seen: number[] = [];
    h.loop.onFrame(() => {
      throw new Error("boom");
    });
    h.loop.onFrame((dt) => seen.push(dt));
    h.tick(16);
    h.tick(16);
    expect(errors).toHaveLength(2);
    expect(seen).toEqual([0, 16]);
    expect(h.renders).toHaveLength(2);
  });

  it("subscribing the same function twice gives two independent subscriptions", () => {
    const h = harness();
    const fn = vi.fn();
    const off1 = h.loop.onFrame(fn);
    h.loop.onFrame(fn);
    h.tick();
    expect(fn).toHaveBeenCalledTimes(2);
    off1();
    h.tick();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("dispose cancels the pending frame and drops subscribers", () => {
    const h = harness();
    const fn = vi.fn();
    h.loop.onFrame(fn);
    expect(h.pending()).toBe(1);
    h.loop.dispose();
    expect(h.pending()).toBe(0);
    h.loop.requestRender();
    h.tick();
    expect(fn).not.toHaveBeenCalled();
    expect(h.renders).toHaveLength(0);
  });
});
