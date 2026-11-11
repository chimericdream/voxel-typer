import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockDef } from "../../../src/content/blocks/types";
import {
  CELL,
  MISSING_TILE,
  atlasSize,
  buildAtlas,
  buildCrackTextures,
  createAtlasLookup,
  packAtlas,
  paintCrackStages,
  parseOverridePath,
  planTiles,
  tileRect,
  tileUv,
} from "../../../src/render/atlas/build";
import { BASE_PALETTE } from "../../../src/render/atlas/palettes";
import { TILE_BYTES } from "../../../src/render/atlas/recipes";
import type { TextureRecipe } from "../../../src/render/atlas/recipes";

const noise = (ramp: "stone" | "dirt" | "grass" | "sand"): TextureRecipe => ({
  kind: "noise",
  ramp,
  scale: 4,
  contrast: 1,
});

function block(
  id: string,
  num: number,
  faces: Partial<BlockDef["faces"]> = {},
  tags: string[] = [],
): BlockDef {
  const all = faces.side ?? noise("stone");
  return {
    id,
    num,
    nameKey: `common.${id}`,
    faces: { top: faces.top ?? all, side: all, bottom: faces.bottom ?? all },
    material: "stone",
    rarity: "common",
    tags,
    typedName: id.replaceAll("-", ""),
  };
}

/** Enough blocks (with distinct faces) to need more than one atlas row and a 2^n step. */
const BLOCKS: BlockDef[] = Array.from({ length: 30 }, (_, i) =>
  block(
    `b${i}`,
    i + 1,
    { top: noise("grass"), side: noise("dirt"), bottom: noise("sand") },
    i % 5 === 0 ? ["transparent"] : [],
  ),
);

describe("layout", () => {
  it("atlasSize is the smallest power of two that fits", () => {
    expect(atlasSize(1)).toBe(32);
    expect(atlasSize(49)).toBe(128);
    expect(atlasSize(50)).toBe(256);
    for (const n of [1, 5, 50, 200, 900]) {
      const size = atlasSize(n);
      expect(Math.log2(size) % 1).toBe(0);
      expect(Math.floor(size / CELL) ** 2).toBeGreaterThanOrEqual(n);
      if (size > 32) expect(Math.floor(size / 2 / CELL) ** 2).toBeLessThan(n);
    }
  });

  it("tileRect rejects tiles that don't fit", () => {
    expect(() => tileRect(32, 1)).toThrow(RangeError);
    expect(() => tileRect(128, -1)).toThrow(RangeError);
  });
});

describe("packAtlas", () => {
  it("copies each tile and duplicates its edge pixels into a 1-px gutter", () => {
    const plan = planTiles(BLOCKS, BASE_PALETTE, 1);
    const { size, pixels } = packAtlas(plan.tiles);
    const at = (x: number, y: number): number[] => [
      ...pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
    ];
    plan.tiles.forEach((tile, index) => {
      const { x, y } = tileRect(size, index);
      const src = (tx: number, ty: number): number[] => [
        ...tile.subarray((ty * 16 + tx) * 4, (ty * 16 + tx) * 4 + 4),
      ];
      for (let ty = 0; ty < 16; ty++)
        for (let tx = 0; tx < 16; tx++) expect(at(x + tx, y + ty)).toEqual(src(tx, ty));
      for (let t = 0; t < 16; t++) {
        expect(at(x - 1, y + t)).toEqual(src(0, t));
        expect(at(x + 16, y + t)).toEqual(src(15, t));
        expect(at(x + t, y - 1)).toEqual(src(t, 0));
        expect(at(x + t, y + 16)).toEqual(src(t, 15));
      }
      expect(at(x - 1, y - 1)).toEqual(src(0, 0));
      expect(at(x + 16, y + 16)).toEqual(src(15, 15));
    });
  });
});

/** Checks a UV rect: every point in it samples (nearest) a texel of tile `index`, never a gutter. */
function expectInsideTile(size: number, index: number, uv: readonly number[]): void {
  const [u0 = Number.NaN, v0 = Number.NaN, u1 = Number.NaN, v1 = Number.NaN] = uv;
  const { x, y } = tileRect(size, index);
  // Canvas rows run down; with flipY, texture row = (1 - v) * size.
  const texelX = (u: number): number => Math.floor(u * size);
  const texelY = (v: number): number => Math.floor((1 - v) * size);
  expect(u0).toBeLessThan(u1);
  expect(v0).toBeLessThan(v1);
  for (const u of [u0, u1, (u0 + u1) / 2]) {
    expect(texelX(u)).toBeGreaterThanOrEqual(x);
    expect(texelX(u)).toBeLessThanOrEqual(x + 15);
  }
  for (const v of [v0, v1, (v0 + v1) / 2]) {
    expect(texelY(v)).toBeGreaterThanOrEqual(y);
    expect(texelY(v)).toBeLessThanOrEqual(y + 15);
  }
  // v0 is the tile's bottom row, v1 its top row.
  expect(texelY(v0)).toBe(y + 15);
  expect(texelY(v1)).toBe(y);
  expect(texelX(u0)).toBe(x);
  expect(texelX(u1)).toBe(x + 15);
}

describe("tileUv", () => {
  it("lands inside its tile for every tile of every atlas size", () => {
    for (const size of [32, 64, 128, 256, 512, 1024]) {
      const cols = Math.floor(size / CELL);
      for (let index = 0; index < cols * cols; index++)
        expectInsideTile(size, index, tileUv(size, index));
    }
  });
});

describe("planTiles", () => {
  it("starts with the missing tile and shares a tile between identical faces of a block", () => {
    const plan = planTiles(
      [block("stone", 1), block("grassy", 2, { top: noise("grass"), side: noise("dirt") })],
      BASE_PALETTE,
      1,
    );
    expect(plan.tiles).toHaveLength(1 + 1 + 2);
    expect(plan.faces.get("stone")).toEqual({ top: 1, side: 1, bottom: 1 });
    expect(plan.faces.get("grassy")).toEqual({ top: 2, side: 3, bottom: 3 });
  });

  it("adding a block doesn't change other blocks' pixels", () => {
    const a = planTiles([block("x", 1), block("y", 2)], BASE_PALETTE, 3);
    const b = planTiles([block("w", 9), block("x", 1), block("y", 2)], BASE_PALETTE, 3);
    expect(b.tiles[b.faces.get("y")?.side ?? -1]).toEqual(a.tiles[a.faces.get("y")?.side ?? -1]);
  });

  it("is deterministic for a seed and changes with it", () => {
    expect(planTiles(BLOCKS, BASE_PALETTE, 1).tiles).toEqual(
      planTiles(BLOCKS, BASE_PALETTE, 1).tiles,
    );
    expect(planTiles(BLOCKS, BASE_PALETTE, 2).tiles).not.toEqual(
      planTiles(BLOCKS, BASE_PALETTE, 1).tiles,
    );
  });

  it("uses an override in place of the painted tile", () => {
    const red = new Uint8ClampedArray(TILE_BYTES).fill(200);
    const plan = planTiles([block("stone", 1)], BASE_PALETTE, 1, new Map([["stone_top", red]]));
    expect(plan.tiles[plan.faces.get("stone")?.top ?? -1]).toBe(red);
    expect(plan.faces.get("stone")?.side).not.toBe(plan.faces.get("stone")?.top);
    expect(() =>
      planTiles(
        [block("stone", 1)],
        BASE_PALETTE,
        1,
        new Map([["stone_top", new Uint8ClampedArray(4)]]),
      ),
    ).toThrow(/16×16/);
  });

  it("rejects duplicate ids and nums", () => {
    expect(() => planTiles([block("a", 1), block("a", 2)], BASE_PALETTE, 1)).toThrow(
      /duplicate block id/,
    );
    expect(() => planTiles([block("a", 1), block("b", 1)], BASE_PALETTE, 1)).toThrow(
      /duplicate block num/,
    );
  });
});

describe("createAtlasLookup", () => {
  const plan = planTiles(BLOCKS, BASE_PALETTE, 1);
  const size = atlasSize(plan.tiles.length);
  const lookup = createAtlasLookup(BLOCKS, plan, size);

  it("uv() lands inside the right tile for every block face", () => {
    for (const b of BLOCKS) {
      for (const face of ["top", "side", "bottom"] as const) {
        const index = lookup.tileOf(b.id, face);
        expect(index).not.toBe(MISSING_TILE);
        expectInsideTile(size, index, lookup.uv(b.num, face));
      }
    }
  });

  it("unknown blocks get the missing tile and are opaque", () => {
    expect(lookup.uv(9999, "top")).toEqual(tileUv(size, MISSING_TILE));
    expect(lookup.tileOf("nope", "side")).toBe(MISSING_TILE);
    expect(lookup.transparent(9999)).toBe(false);
  });

  it("transparent() follows the 'transparent' tag", () => {
    for (const b of BLOCKS) expect(lookup.transparent(b.num)).toBe(b.tags.includes("transparent"));
  });
});

describe("parseOverridePath", () => {
  it.each([
    ["/assets/textures/src/oak-log_top.png", { blockId: "oak-log", face: "top" }],
    ["/assets/textures/src/stone_side.png", { blockId: "stone", face: "side" }],
    ["stone_bottom.png", { blockId: "stone", face: "bottom" }],
    ["/assets/textures/src/stone.png", null],
    ["/assets/textures/src/stone_front.png", null],
    ["/assets/textures/src/Stone_top.png", null],
  ] as const)("%s", (path, expected) => {
    expect(parseOverridePath(path)).toEqual(expected);
  });
});

describe("cracks", () => {
  it("paints 10 deterministic stages", () => {
    const stages = paintCrackStages(4);
    expect(stages).toHaveLength(10);
    expect(stages).toEqual(paintCrackStages(4));
  });
});

/** Just enough of a 2D canvas for buildAtlas under Node. */
class FakeCanvas {
  data: Uint8ClampedArray = new Uint8ClampedArray(0);
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(): object {
    return {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image: { data: Uint8ClampedArray }) => {
        this.data = image.data;
      },
    };
  }
}

describe("buildAtlas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("packs the painted tiles into a nearest-filtered sRGB canvas texture with in-tile UVs", async () => {
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    const atlas = await buildAtlas(BLOCKS, BASE_PALETTE, 1);
    const plan = planTiles(BLOCKS, BASE_PALETTE, 1);
    const packed = packAtlas(plan.tiles);
    expect(atlas.canvas).toBeInstanceOf(FakeCanvas);
    expect(atlas.canvas.width).toBe(packed.size);
    if (atlas.canvas instanceof FakeCanvas) expect(atlas.canvas.data).toEqual(packed.pixels);
    expect(atlas.texture).toBeInstanceOf(THREE.CanvasTexture);
    expect(atlas.texture.magFilter).toBe(THREE.NearestFilter);
    expect(atlas.texture.minFilter).toBe(THREE.NearestFilter);
    expect(atlas.texture.generateMipmaps).toBe(false);
    expect(atlas.texture.colorSpace).toBe(THREE.SRGBColorSpace);
    for (const b of BLOCKS) {
      for (const face of ["top", "side", "bottom"] as const) {
        expectInsideTile(packed.size, atlas.tileOf(b.id, face), atlas.uv(b.num, face));
      }
    }
  });

  it("buildCrackTextures makes 10 nearest-filtered 16×16 textures", () => {
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    const textures = buildCrackTextures(1);
    expect(textures).toHaveLength(10);
    for (const t of textures) expect(t.magFilter).toBe(THREE.NearestFilter);
  });
});
