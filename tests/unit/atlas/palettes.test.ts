import { describe, expect, it } from "vitest";
import { parseHex } from "../../../src/render/atlas/painters";
import {
  BASE_PALETTE,
  BIOME_VARIANTS,
  paletteFor,
  shiftRamp,
} from "../../../src/render/atlas/palettes";
import { PALETTE_RAMP_IDS } from "../../../src/render/atlas/recipes";
import type { Palette } from "../../../src/render/atlas/recipes";
import { BIOME_ORDER } from "../../../src/types/core";

const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const palettes: [string, Palette][] = [
  ["base", BASE_PALETTE],
  ...BIOME_ORDER.map((b): [string, Palette] => [b, paletteFor(b)]),
];

describe("palettes", () => {
  it("the base palette has exactly the ramps in PALETTE_RAMP_IDS", () => {
    expect(Object.keys(BASE_PALETTE).toSorted()).toEqual([...PALETTE_RAMP_IDS].toSorted());
  });

  it("covers the ramps the card names", () => {
    for (const id of [
      "grass",
      "dirt",
      "stone",
      "oak",
      "birch",
      "sand",
      "snow",
      "water",
      "leaf",
      "ore-copper",
      "ore-gem",
      "crystal",
      "mushroom",
      "spark",
      "cloud",
      "wool-red",
    ]) {
      expect(PALETTE_RAMP_IDS).toContain(id);
    }
  });

  it.each(palettes)("%s: every ramp has 4–6 hex colors, dark to light", (_name, palette) => {
    for (const id of PALETTE_RAMP_IDS) {
      const ramp = palette[id];
      expect(ramp.length, id).toBeGreaterThanOrEqual(4);
      expect(ramp.length, id).toBeLessThanOrEqual(6);
      for (const hex of ramp) expect(hex, id).toMatch(/^#[0-9a-f]{6}$/);
      for (let i = 1; i < ramp.length; i++) {
        expect(luminance(ramp[i] ?? ""), `${id}[${i}]`).toBeGreaterThanOrEqual(
          luminance(ramp[i - 1] ?? ""),
        );
      }
    }
  });

  it("every biome has a variant, and all but meadow change something", () => {
    expect(Object.keys(BIOME_VARIANTS).toSorted()).toEqual([...BIOME_ORDER].toSorted());
    for (const b of BIOME_ORDER) {
      if (b === "meadow") expect(paletteFor(b)).toEqual(BASE_PALETTE);
      else expect(paletteFor(b)).not.toEqual(BASE_PALETTE);
    }
  });

  it("wool, ore and light ramps are the same in every biome", () => {
    const fixed = PALETTE_RAMP_IDS.filter(
      (id) => id.startsWith("wool-") || id.startsWith("ore-") || id === "spark",
    );
    for (const b of BIOME_ORDER)
      for (const id of fixed) expect(paletteFor(b)[id], `${b} ${id}`).toEqual(BASE_PALETTE[id]);
  });

  it("paletteFor is deterministic and doesn't change the base palette", () => {
    const before = structuredClone(BASE_PALETTE);
    expect(paletteFor("frosty")).toEqual(paletteFor("frosty"));
    expect(BASE_PALETTE).toEqual(before);
  });

  it("shiftRamp: an empty shift round-trips, hue 360 is a no-op, light clamps", () => {
    const ramp = BASE_PALETTE.grass;
    expect(shiftRamp(ramp, {})).toEqual(ramp);
    expect(shiftRamp(ramp, { hue: 360 })).toEqual(ramp);
    expect(shiftRamp(["#808080"], { light: 2 })).toEqual(["#ffffff"]);
    expect(shiftRamp(["#000000"], { tint: "#ffffff", tintAmount: 1 })).toEqual(["#ffffff"]);
  });
});
