import * as fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowFlash, flashGuard } from "../../../src/a11y/flashes";
import {
  createFlashGuard,
  FLASH_WINDOW_MS,
  MAX_FLASHES,
  planFlashes,
} from "../../../src/a11y/flash-guard";

/** A test clock: time only moves when the test says so. */
function testClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("flash guard (PLAN.md §4.6: never more than 3 flashes a second)", () => {
  it("allows 3 flashes in a second and refuses the 4th", () => {
    const clock = testClock(1000);
    const guard = createFlashGuard();
    const got: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      got.push(guard.tryFlash(clock.now()));
      clock.advance(100);
    }
    expect(MAX_FLASHES).toBe(3);
    expect(got).toEqual([true, true, true, false, false]);
  });

  it("allows a flash again once the oldest leaves the one-second window", () => {
    const clock = testClock(0);
    const guard = createFlashGuard();
    expect(guard.tryFlash(clock.now())).toBe(true); // t = 0
    clock.advance(300);
    expect(guard.tryFlash(clock.now())).toBe(true); // 300
    clock.advance(300);
    expect(guard.tryFlash(clock.now())).toBe(true); // 600
    clock.advance(399);
    expect(guard.tryFlash(clock.now())).toBe(false); // 999: three in the window
    expect(guard.nextAllowedAt(clock.now())).toBe(FLASH_WINDOW_MS);
    clock.advance(1);
    expect(guard.tryFlash(clock.now())).toBe(true); // 1000: the flash at 0 left
  });

  it("is a sliding window: 3 late in one second and 3 early in the next can't all flash", () => {
    const guard = createFlashGuard();
    const times = [900, 950, 990, 1010, 1050, 1100];
    expect(times.map((t) => guard.tryFlash(t))).toEqual([true, true, true, false, false, false]);
  });

  it("a refused flash doesn't count", () => {
    const guard = createFlashGuard();
    for (const t of [0, 10, 20]) guard.tryFlash(t);
    for (let t = 30; t < 1000; t += 10) expect(guard.tryFlash(t)).toBe(false);
    expect(guard.tryFlash(1000)).toBe(true);
  });

  it("nextAllowedAt counts nothing", () => {
    const guard = createFlashGuard();
    expect(guard.nextAllowedAt(5)).toBe(5);
    expect(guard.nextAllowedAt(5)).toBe(5);
    expect(guard.tryFlash(5)).toBe(true);
  });

  it("reset forgets every flash; a clock that runs backwards starts afresh", () => {
    const guard = createFlashGuard();
    for (const t of [0, 1, 2]) guard.tryFlash(t);
    expect(guard.tryFlash(3)).toBe(false);
    guard.reset();
    expect(guard.tryFlash(3)).toBe(true);
    for (const t of [4, 5]) guard.tryFlash(t);
    expect(guard.tryFlash(-100)).toBe(true);
  });

  it("refuses a non-finite time", () => {
    const guard = createFlashGuard();
    expect(guard.tryFlash(Number.NaN)).toBe(false);
    expect(guard.tryFlash(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("takes another limit and window", () => {
    const guard = createFlashGuard({ max: 1, windowMs: 500 });
    expect([0, 499, 500].map((t) => guard.tryFlash(t))).toEqual([true, false, true]);
    expect(createFlashGuard({ max: 0 }).tryFlash(0)).toBe(true);
  });

  it("planFlashes keeps only what fits, in time order", () => {
    // Three stars 350 ms apart fit; a fourth blink 100 ms later doesn't.
    expect(planFlashes([700, 0, 350, 800])).toEqual([0, 350, 700]);
    expect(planFlashes([0, 350, 700, 1050])).toEqual([0, 350, 700, 1050]);
  });

  it("property: no one-second window ever holds more than 3 allowed flashes", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 400 }), { minLength: 1, maxLength: 200 }),
        (gaps) => {
          const clock = testClock(0);
          const guard = createFlashGuard();
          const allowed: number[] = [];
          for (const gap of gaps) {
            clock.advance(gap);
            if (guard.tryFlash(clock.now())) allowed.push(clock.now());
          }
          for (let i = MAX_FLASHES; i < allowed.length; i++) {
            const first = allowed[i - MAX_FLASHES] ?? 0;
            const t = allowed[i] ?? 0;
            if (t - first < FLASH_WINDOW_MS) return false;
          }
          return true;
        },
      ),
      { seed: 307, numRuns: 300 },
    );
  });
});

describe("a time from another clock (M3-07 review N4)", () => {
  it("with backwards: 'refuse', an earlier time is refused and the window is kept", () => {
    const guard = createFlashGuard({ backwards: "refuse" });
    for (const t of [5000, 5100, 5200]) expect(guard.tryFlash(t)).toBe(true);
    // A caller on a fixed-step clock asks at t = 16: no, and the three flashes still count.
    expect(guard.tryFlash(16)).toBe(false);
    expect(guard.nextAllowedAt(16)).toBe(6000);
    expect(guard.tryFlash(5300)).toBe(false);
    expect(guard.tryFlash(6000)).toBe(true);
  });

  describe("the app's shared guard", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      flashGuard().reset();
    });

    it("reads performance.now() itself, so a stray earlier time can't wipe its window", () => {
      flashGuard().reset();
      let t = 50_000;
      vi.spyOn(performance, "now").mockImplementation(() => t);
      for (let i = 0; i < 3; i++) expect(allowFlash()).toBe(true);
      // Someone asks the guard directly on another clock: refused, and nothing is forgotten.
      expect(flashGuard().tryFlash(10)).toBe(false);
      expect(allowFlash()).toBe(false);
      t += 1000;
      expect(allowFlash()).toBe(true);
    });
  });
});
