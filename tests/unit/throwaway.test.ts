import { expect, it } from "vitest";

it("fails on purpose (M0-03 throwaway)", () => {
  expect(1 + 1).toBe(3);
});
