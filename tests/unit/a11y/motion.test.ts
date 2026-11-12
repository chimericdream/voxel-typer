import { describe, expect, it, vi } from "vitest";
import {
  createMotionFlag,
  REDUCED_MOTION_QUERY,
  resolveReducedMotion,
} from "../../../src/a11y/motion";
import type { MotionHost } from "../../../src/a11y/motion";

/** A fake `window.matchMedia` whose answer the test flips. */
function fakeHost(reduce: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: reduce,
    addEventListener: (_: "change", fn: () => void) => listeners.add(fn),
    removeEventListener: (_: "change", fn: () => void) => listeners.delete(fn),
  };
  const queries: string[] = [];
  const host: MotionHost = {
    matchMedia(q) {
      queries.push(q);
      return media;
    },
  };
  return {
    host,
    queries,
    listeners,
    setSystem(on: boolean) {
      media.matches = on;
      for (const fn of listeners) fn();
    },
  };
}

describe("reduced motion flag (PLAN.md §4.6)", () => {
  it("true and false beat the OS; 'system' follows it", () => {
    expect(resolveReducedMotion(true, false)).toBe(true);
    expect(resolveReducedMotion(false, true)).toBe(false);
    expect(resolveReducedMotion("system", true)).toBe(true);
    expect(resolveReducedMotion("system", false)).toBe(false);
    expect(resolveReducedMotion(undefined, true)).toBe(true);
  });

  it("asks the prefers-reduced-motion query", () => {
    const f = fakeHost(false);
    createMotionFlag(f.host);
    expect(f.queries).toEqual([REDUCED_MOTION_QUERY]);
    expect(REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
  });

  it("follows the OS live under 'system', not just at start", () => {
    const f = fakeHost(false);
    const flag = createMotionFlag(f.host);
    const seen = vi.fn();
    flag.subscribe(seen);
    expect(flag.reduced()).toBe(false);
    f.setSystem(true);
    expect(flag.reduced()).toBe(true);
    expect(seen).toHaveBeenLastCalledWith(true);
    f.setSystem(false);
    expect(flag.reduced()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("an explicit setting wins over the OS and tells subscribers only on a real change", () => {
    const f = fakeHost(true);
    const flag = createMotionFlag(f.host);
    const seen = vi.fn();
    const off = flag.subscribe(seen);
    expect(flag.reduced()).toBe(true);
    flag.setSetting(false);
    expect(flag.reduced()).toBe(false);
    f.setSystem(false);
    f.setSystem(true);
    expect(seen).toHaveBeenCalledTimes(1);
    flag.setSetting(true);
    expect(flag.setting()).toBe(true);
    expect(seen).toHaveBeenLastCalledWith(true);
    off();
    flag.setSetting(false);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("without matchMedia, only the setting counts", () => {
    const flag = createMotionFlag(null);
    expect(flag.reduced()).toBe(false);
    expect(flag.systemReduces()).toBe(false);
    flag.setSetting(true);
    expect(flag.reduced()).toBe(true);
    expect(createMotionFlag({}).reduced()).toBe(false);
  });

  it("dispose stops listening to the OS", () => {
    const f = fakeHost(false);
    const flag = createMotionFlag(f.host);
    expect(f.listeners.size).toBe(1);
    flag.dispose();
    expect(f.listeners.size).toBe(0);
  });
});
