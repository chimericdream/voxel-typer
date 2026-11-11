/**
 * `BIOME_ORDER` is typed `readonly BiomeId[]`, so the compiler would not notice a missing or
 * repeated biome. This pins it to exactly the `BiomeId` union, in curriculum order (contracts §1).
 */
import { describe, expect, it } from "vitest";
import { BIOME_ORDER, type BiomeId } from "../../../src/types/core";

// `satisfies` makes this fail to compile if a BiomeId is added or removed.
const EVERY_BIOME = {
  meadow: true,
  birch: true,
  shore: true,
  frosty: true,
  mines: true,
  marsh: true,
  caverns: true,
  sparkstone: true,
  citadel: true,
} as const satisfies Record<BiomeId, true>;

describe("BIOME_ORDER", () => {
  it("lists every biome exactly once", () => {
    expect(new Set(BIOME_ORDER).size).toBe(BIOME_ORDER.length);
    expect(BIOME_ORDER.toSorted()).toEqual(Object.keys(EVERY_BIOME).toSorted());
  });

  it("is in curriculum order", () => {
    expect(BIOME_ORDER).toEqual([
      "meadow",
      "birch",
      "shore",
      "frosty",
      "mines",
      "marsh",
      "caverns",
      "sparkstone",
      "citadel",
    ]);
  });
});
