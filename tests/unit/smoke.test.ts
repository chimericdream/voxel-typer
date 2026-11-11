import { describe, expect, it } from "vitest";

describe("toolchain smoke", () => {
  it("runs TypeScript tests in the node environment", () => {
    expect(typeof window).toBe("undefined");
    expect([1, 2, 3].at(-1)).toBe(3);
  });
});
