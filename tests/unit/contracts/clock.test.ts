import { describe, expect, it } from "vitest";
import { fixedStepClock, realClock } from "../../../src/app/clock";

describe("fixedStepClock (contracts §13)", () => {
  it("returns startMs first, then advances by stepMs on every now()", () => {
    const clock = fixedStepClock(1000, 16);
    expect([clock.now(), clock.now(), clock.now()]).toEqual([1000, 1016, 1032]);
  });

  it("epoch() follows the latest now() and never advances the clock", () => {
    const clock = fixedStepClock(500, 100);
    expect(clock.epoch()).toBe(500);
    expect(clock.now()).toBe(500);
    expect(clock.epoch()).toBe(500);
    expect(clock.now()).toBe(600);
    expect([clock.epoch(), clock.epoch()]).toEqual([600, 600]);
    expect(clock.now()).toBe(700);
  });

  it("is frozen with a step of 0", () => {
    const clock = fixedStepClock(42, 0);
    expect([clock.now(), clock.now(), clock.epoch()]).toEqual([42, 42, 42]);
  });

  it("gives independent clocks", () => {
    const a = fixedStepClock(0, 10);
    const b = fixedStepClock(0, 10);
    a.now();
    a.now();
    expect(b.now()).toBe(0);
  });
});

describe("realClock (contracts §13)", () => {
  it("now() is monotonic", () => {
    const first = realClock.now();
    const second = realClock.now();
    expect(Number.isFinite(first)).toBe(true);
    expect(second).toBeGreaterThanOrEqual(first);
  });

  it("epoch() is wall-clock time", () => {
    const before = Date.now();
    const epoch = realClock.epoch();
    expect(epoch).toBeGreaterThanOrEqual(before);
    expect(epoch).toBeLessThanOrEqual(Date.now());
  });
});
