import { createHash } from "node:crypto";
import { assert, integer, property } from "fast-check";
import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/engine/rng";
import {
  CUSTOM_PAINTERS,
  MAX_CRACK_STAGE,
  parseHex,
  toHex,
} from "../../../src/render/atlas/painters";
import { BASE_PALETTE } from "../../../src/render/atlas/palettes";
import { TILE_BYTES, paintTile } from "../../../src/render/atlas/recipes";
import type { TextureRecipe } from "../../../src/render/atlas/recipes";

const sha = (px: Uint8ClampedArray): string =>
  createHash("sha256").update(px).digest("hex").slice(0, 16);

const STONE: TextureRecipe = { kind: "noise", ramp: "stone", scale: 4, contrast: 0.8 };

/** One recipe per kind, plus every custom painter. */
const RECIPES: readonly TextureRecipe[] = [
  STONE,
  { kind: "planks", ramp: "oak", boards: 4 },
  { kind: "bricks", ramp: "brick", mortar: "mortar" },
  { kind: "ore", base: STONE, ore: "ore-gem", density: 0.4 },
  {
    kind: "overlay-top",
    base: { kind: "noise", ramp: "dirt", scale: 4, contrast: 1 },
    top: "grass",
    depth: 3,
  },
  { kind: "crack", stage: 5 },
  { kind: "custom", paint: "missing" },
  { kind: "custom", paint: "glass" },
  { kind: "custom", paint: "rings:oak" },
  { kind: "custom", paint: "bark:oak-bark" },
  { kind: "custom", paint: "dashed-bark:birch-bark" },
  { kind: "custom", paint: "knit:wool-red" },
  { kind: "custom", paint: "facets:crystal" },
  { kind: "custom", paint: "cap:mushroom" },
  { kind: "custom", paint: "lamp:spark" },
  { kind: "custom", paint: "ripple:water" },
  { kind: "custom", paint: "leaves:leaf" },
  { kind: "custom", paint: "pebbles:gravel" },
];

function colorsOf(px: Uint8ClampedArray): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < px.length; i += 4)
    out.add(toHex([px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0]));
  return out;
}

describe("paintTile determinism", () => {
  // Pinned hashes: if a painter changes on purpose, update these and the screenshot baseline.
  it.each([
    ["noise stone", STONE, "09b20eb669343421"],
    ["planks oak", { kind: "planks", ramp: "oak", boards: 4 } as const, "2bee329e0de38502"],
    [
      "ore gem on stone",
      { kind: "ore", base: STONE, ore: "ore-gem", density: 0.4 } as const,
      "74322db0c9ce2d56",
    ],
  ] as const)("%s at seed 1 is pinned", (_name, recipe, hash) => {
    expect(sha(paintTile(recipe, BASE_PALETTE, createRng(1)))).toBe(hash);
  });

  it.each(RECIPES)("$kind is the same for the same seed and differs for another", (recipe) => {
    const a = paintTile(recipe, BASE_PALETTE, createRng(7));
    const b = paintTile(recipe, BASE_PALETTE, createRng(7));
    expect(a).toEqual(b);
    if (!(recipe.kind === "custom" && recipe.paint === "missing")) {
      expect(paintTile(recipe, BASE_PALETTE, createRng(8))).not.toEqual(a);
    }
  });

  it.each(RECIPES)("$kind paints exactly 16×16 RGBA", (recipe) => {
    expect(paintTile(recipe, BASE_PALETTE, createRng(3))).toHaveLength(TILE_BYTES);
  });

  it("does not depend on how much of the stream was used before a fork", () => {
    const fresh = createRng(5);
    const used = createRng(5);
    for (let i = 0; i < 50; i++) used.next();
    expect(paintTile(STONE, BASE_PALETTE, used.fork("tile"))).toEqual(
      paintTile(STONE, BASE_PALETTE, fresh.fork("tile")),
    );
  });
});

describe("ramp quantization", () => {
  it("noise uses only colors of its ramp, fully opaque, for any seed", () => {
    const ramp = new Set(BASE_PALETTE.grass.map((h) => toHex(parseHex(h))));
    assert(
      property(
        integer({ min: 0, max: 2 ** 32 - 1 }),
        integer({ min: 1, max: 16 }),
        (seed, scale) => {
          const px = paintTile(
            { kind: "noise", ramp: "grass", scale, contrast: 1 },
            BASE_PALETTE,
            createRng(seed),
          );
          for (const c of colorsOf(px)) expect(ramp.has(c)).toBe(true);
          for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(255);
        },
      ),
      { seed: 20261111, numRuns: 100 },
    );
  });

  it("contrast 0 gives one flat color", () => {
    const px = paintTile(
      { kind: "noise", ramp: "dirt", scale: 4, contrast: 0 },
      BASE_PALETTE,
      createRng(1),
    );
    expect(colorsOf(px).size).toBe(1);
  });

  it("planks have a darkest-ramp 1-px bottom edge on every board", () => {
    const darkest = BASE_PALETTE.oak[0];
    for (const boards of [2, 4]) {
      const px = paintTile({ kind: "planks", ramp: "oak", boards }, BASE_PALETTE, createRng(2));
      const h = 16 / boards;
      for (let b = 0; b < boards; b++) {
        const y = b * h + h - 1;
        for (let x = 0; x < 16; x++) {
          const i = (y * 16 + x) * 4;
          expect(toHex([px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0])).toBe(darkest);
        }
      }
    }
  });

  it("bricks show mortar on every 4th row", () => {
    const mortar = new Set(BASE_PALETTE.mortar);
    const px = paintTile(
      { kind: "bricks", ramp: "brick", mortar: "mortar" },
      BASE_PALETTE,
      createRng(4),
    );
    for (const y of [3, 7, 11, 15]) {
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        expect(mortar.has(toHex([px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0]))).toBe(true);
      }
    }
  });
});

const alphaSum = (px: Uint8ClampedArray): number => {
  let s = 0;
  for (let i = 3; i < px.length; i += 4) s += px[i] ?? 0;
  return s;
};

describe("crack overlays", () => {
  const stages = Array.from({ length: MAX_CRACK_STAGE + 1 }, (_, stage) =>
    paintTile({ kind: "crack", stage }, BASE_PALETTE, createRng(9).fork("crack")),
  );

  it("stage 0 already shows a crack and the rest stays clear", () => {
    const first = stages[0] ?? new Uint8ClampedArray();
    expect(alphaSum(first)).toBeGreaterThan(0);
    expect(alphaSum(first)).toBeLessThan(16 * 16 * 255 * 0.1);
  });

  it("each stage keeps every pixel of the one before (alpha never drops) and grows", () => {
    for (let s = 1; s < stages.length; s++) {
      const prev = stages[s - 1] ?? new Uint8ClampedArray();
      const cur = stages[s] ?? new Uint8ClampedArray();
      for (let i = 3; i < cur.length; i += 4)
        expect(cur[i] ?? 0).toBeGreaterThanOrEqual(prev[i] ?? 0);
      expect(alphaSum(cur)).toBeGreaterThan(alphaSum(prev));
    }
  });

  it.each([-1, 10, 2.5, Number.NaN])("rejects stage %s", (stage) => {
    expect(() => paintTile({ kind: "crack", stage }, BASE_PALETTE, createRng(1))).toThrow(
      RangeError,
    );
  });
});

describe("errors", () => {
  it("throws on an unknown painter or ramp", () => {
    expect(() => paintTile({ kind: "custom", paint: "nope" }, BASE_PALETTE, createRng(1))).toThrow(
      /no painter/,
    );
    expect(() =>
      paintTile({ kind: "custom", paint: "knit:nope" }, BASE_PALETTE, createRng(1)),
    ).toThrow(/no ramp/);
    expect(() => paintTile({ kind: "custom", paint: "knit" }, BASE_PALETTE, createRng(1))).toThrow(
      /needs a ramp/,
    );
    expect(() =>
      paintTile({ kind: "custom", paint: "rings:stone" }, BASE_PALETTE, createRng(1)),
    ).toThrow(/stone-bark/);
  });

  it("throws on an unknown recipe kind from data", () => {
    const bad: unknown = { kind: "sparkles" };
    expect(() => Reflect.apply(paintTile, undefined, [bad, BASE_PALETTE, createRng(1)])).toThrow(
      /unknown recipe kind/,
    );
  });

  it("validates recipe numbers", () => {
    const rng = createRng(1);
    expect(() => paintTile({ ...STONE, scale: 0 }, BASE_PALETTE, rng)).toThrow(RangeError);
    expect(() => paintTile({ ...STONE, contrast: -1 }, BASE_PALETTE, rng)).toThrow(RangeError);
    expect(() => paintTile({ kind: "planks", ramp: "oak", boards: 0 }, BASE_PALETTE, rng)).toThrow(
      RangeError,
    );
    expect(() =>
      paintTile({ kind: "ore", base: STONE, ore: "ore-gem", density: 2 }, BASE_PALETTE, rng),
    ).toThrow(RangeError);
    expect(() =>
      paintTile({ kind: "overlay-top", base: STONE, top: "grass", depth: 17 }, BASE_PALETTE, rng),
    ).toThrow(RangeError);
  });

  it("parseHex accepts #rgb and #rrggbb only", () => {
    expect(parseHex("#fa0")).toEqual([255, 170, 0]);
    expect(parseHex("#0a0B0c")).toEqual([10, 11, 12]);
    expect(() => parseHex("red")).toThrow();
  });

  it("every custom painter is covered above", () => {
    const used = new Set(
      RECIPES.flatMap((r) => (r.kind === "custom" ? [r.paint.split(":")[0]] : [])),
    );
    expect([...used].toSorted()).toEqual(Object.keys(CUSTOM_PAINTERS).toSorted());
  });
});
