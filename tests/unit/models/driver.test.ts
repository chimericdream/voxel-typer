/**
 * The model driver on the real render loop with a fake rAF (task M4-01): a playing anim keeps
 * the loop drawing, an idle model never wakes it, and reduced motion lets it rest.
 */
import { describe, expect, it } from "vitest";
import { createLoop } from "../../../src/render/loop";
import { buildModel, buildModelInstanced } from "../../../src/render/models/build";
import { createModelDriver } from "../../../src/render/models/driver";
import { critter } from "./helpers";

function harness() {
  let queue: ((ts: number) => void)[] = [];
  let now = 0;
  let renders = 0;
  const loop = createLoop({
    raf(cb) {
      queue.push(cb);
      return queue.length;
    },
    caf() {
      queue = [];
    },
    now: () => now,
    render() {
      renders++;
    },
  });
  return {
    loop,
    get renders() {
      return renders;
    },
    pending: () => queue.length,
    /** Runs frames of 16 ms until the loop idles (or `max` frames). Returns frames run. */
    pump(max = 1000) {
      let n = 0;
      while (queue.length > 0 && n < max) {
        now += 16;
        const run = queue;
        queue = [];
        for (const cb of run) cb(now);
        n++;
      }
      return n;
    },
  };
}

describe("createModelDriver", () => {
  it("an idle model never wakes the loop", () => {
    const h = harness();
    const driver = createModelDriver(h.loop);
    driver.add(buildModel(critter(), null));
    expect(h.pending()).toBe(0);
    expect(h.renders).toBe(0);
  });

  it("a one-shot anim keeps the loop drawing until it ends, then the loop idles", () => {
    const h = harness();
    const driver = createModelDriver(h.loop);
    const m = buildModel(critter(), null);
    driver.add(m);
    let ended = 0;
    m.play("hit", { onEnd: () => ended++ }); // 240 ms, with a 120 ms fade
    expect(h.pending()).toBe(1);
    const frames = h.pump();
    expect(ended).toBe(1);
    expect(frames).toBeGreaterThanOrEqual(240 / 16);
    expect(frames).toBeLessThan(40);
    expect(h.pending()).toBe(0);
    expect(m.animating).toBe(false);
  });

  it("a looping anim keeps the loop running; stop lets it idle after the fade", () => {
    const h = harness();
    const driver = createModelDriver(h.loop);
    const m = buildModel(critter(), null);
    driver.add(m);
    m.play("walk");
    expect(h.pump(200)).toBe(200);
    expect(h.pending()).toBe(1);
    m.stop();
    const frames = h.pump();
    expect(frames).toBeLessThanOrEqual(120 / 16 + 2);
    expect(h.pending()).toBe(0);
    expect(m.part("leg-fl")?.rotation.x).toBe(0);
  });

  it("under reduced motion a looping anim draws its held pose once and the loop idles", () => {
    const h = harness();
    const driver = createModelDriver(h.loop);
    const m = buildModel(critter(), null, { reducedMotion: () => true });
    driver.add(m);
    m.play("idle", { fadeMs: 0 });
    expect(h.pump()).toBeLessThanOrEqual(2);
    expect(h.pending()).toBe(0);
    expect(m.part("head")?.rotation.z).toBeCloseTo((-4 * Math.PI) / 180, 6);
  });

  it("drives an instanced herd, and setTint draws one frame", () => {
    const h = harness();
    const driver = createModelDriver(h.loop);
    const herd = buildModelInstanced(critter(), 5);
    herd.update(0);
    driver.add(herd);
    expect(h.pending()).toBe(0);
    herd.setVisible(2, true);
    herd.play(2, "hit");
    h.pump();
    expect(h.pending()).toBe(0);
    const before = h.renders;
    herd.setTint(2, "#ffcccc");
    h.pump();
    expect(h.renders).toBe(before + 1);
  });

  it("an added model that is already playing wakes the loop", () => {
    const h = harness();
    const driver = createModelDriver(h.loop);
    const m = buildModel(critter(), null);
    m.play("walk");
    driver.add(m);
    expect(h.pending()).toBe(1);
  });

  it("remove and dispose unbind models, so play no longer wakes the loop", () => {
    const h = harness();
    const driver = createModelDriver(h.loop);
    const a = buildModel(critter(), null);
    const b = buildModel(critter(), null);
    const removeA = driver.add(a);
    driver.add(b);
    expect(driver.size).toBe(2);
    removeA();
    expect(driver.size).toBe(1);
    a.play("walk");
    expect(h.pending()).toBe(0);
    driver.dispose();
    expect(driver.size).toBe(0);
    b.play("walk");
    expect(h.pending()).toBe(0);
  });
});
