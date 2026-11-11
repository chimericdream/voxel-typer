/**
 * Atlas builder (docs/impl/contracts.md §8.3). Uses the DOM, so it is NOT pure. The layout math
 * (`planTiles`, `packAtlas`, `tileUv`, …) is pure and exported for tests and tools.
 *
 * Tiles are 16×16 and sit in 18×18 cells: each tile gets a 1-px gutter of duplicated edge pixels,
 * so a sample that strays past the tile edge still gets the tile's own color. The atlas is square,
 * 2^n pixels on a side. Textures use `NearestFilter` and no mipmaps.
 *
 * Tile 0 is the "missing" tile (a magenta checkerboard), used for any block or face the atlas
 * doesn't know.
 */
import * as THREE from "three";
import type { BlockDef } from "@/content/blocks/types";
import { createRng } from "@/engine/rng";
import type { BlockId } from "@/types/core";
import type { AtlasLookup } from "../mesher/voxel-grid";
import { MAX_CRACK_STAGE, TILE_SIZE } from "./painters";
import { BASE_PALETTE } from "./palettes";
import { TILE_BYTES, paintTile } from "./recipes";
import type { Palette } from "./recipes";

/** The packed texture atlas, plus the lookups the mesher needs. */
export interface Atlas extends AtlasLookup {
  texture: THREE.Texture;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** The tile index of a block face. */
  tileOf(blockId: BlockId, face: "top" | "bottom" | "side"): number;
}

/** A block face, as the atlas sees it. */
export type Face = "top" | "side" | "bottom";
/** The faces in the order tiles are painted. */
export const FACES: readonly Face[] = ["top", "side", "bottom"];
/** Gutter width around each tile, in pixels. */
export const GUTTER = 1;
/** One tile plus its gutters. */
export const CELL = TILE_SIZE + 2 * GUTTER;
/** The tile index used for unknown blocks and faces. */
export const MISSING_TILE = 0;
/** How far UVs stay inside the tile edge, in texels, so no sample lands on the gutter. */
export const UV_INSET = 1 / 64;

/** The side of the smallest square 2^n atlas (at least 32 px) that holds `tileCount` tiles. */
export function atlasSize(tileCount: number): number {
  let size = 32;
  while (Math.floor(size / CELL) ** 2 < tileCount) size *= 2;
  return size;
}

/** Where tile `index`'s 16×16 pixels start in an atlas of side `size` (canvas pixels, y down). */
export function tileRect(size: number, index: number): { x: number; y: number } {
  const cols = Math.floor(size / CELL);
  if (!Number.isInteger(index) || index < 0 || index >= cols * cols) {
    throw new RangeError(`tile ${index} does not fit an atlas of ${size} px`);
  }
  return {
    x: (index % cols) * CELL + GUTTER,
    y: Math.floor(index / cols) * CELL + GUTTER,
  };
}

/**
 * The UV rectangle of tile `index`: `[u0, v0, u1, v1]`, inset by {@link UV_INSET} texels. The
 * texture keeps three.js's default `flipY = true`, so `v0` is the tile's bottom row and `v1` its
 * top row; a face whose `v` runs upward shows the tile the right way up.
 */
export function tileUv(
  size: number,
  index: number,
): [u0: number, v0: number, u1: number, v1: number] {
  const { x, y } = tileRect(size, index);
  return [
    (x + UV_INSET) / size,
    1 - (y + TILE_SIZE - UV_INSET) / size,
    (x + TILE_SIZE - UV_INSET) / size,
    1 - (y + UV_INSET) / size,
  ];
}

/** Painted tiles and which tile each block face uses. */
export interface AtlasPlan {
  /** RGBA tiles, 16 × 16 × 4 bytes each. Index 0 is the missing tile. */
  tiles: Uint8ClampedArray[];
  /** Tile index of each face, by block id. */
  faces: Map<BlockId, Record<Face, number>>;
}

/** The key of a PNG override: `'<blockId>_<face>'`. */
export const overrideKey = (blockId: BlockId, face: Face): string => `${blockId}_${face}`;

/**
 * Paints every block face (pure). Each face is painted from
 * `createRng(seed).fork('tile:<blockId>:<face>')`, so adding a block never changes another
 * block's pixels. Faces of one block with identical recipes share a tile. An entry in
 * `overrides` (keyed by {@link overrideKey}) replaces the painted tile.
 *
 * Throws on a duplicate block id or num, or an override that isn't 16 × 16 × 4 bytes.
 */
export function planTiles(
  blocks: readonly BlockDef[],
  palette: Palette,
  seed: number,
  overrides: ReadonlyMap<string, Uint8ClampedArray> = new Map(),
): AtlasPlan {
  const root = createRng(seed);
  const tiles = [
    paintTile({ kind: "custom", paint: "missing" }, palette, root.fork("tile:missing")),
  ];
  const faces = new Map<BlockId, Record<Face, number>>();
  const nums = new Set<number>();
  for (const block of blocks) {
    if (faces.has(block.id)) throw new Error(`duplicate block id: ${block.id}`);
    if (nums.has(block.num)) throw new Error(`duplicate block num: ${block.num} (${block.id})`);
    nums.add(block.num);
    const byRecipe = new Map<string, number>();
    const entry: Record<Face, number> = {
      top: MISSING_TILE,
      side: MISSING_TILE,
      bottom: MISSING_TILE,
    };
    for (const face of FACES) {
      const override = overrides.get(overrideKey(block.id, face));
      if (override) {
        if (override.length !== TILE_BYTES)
          throw new Error(`override ${overrideKey(block.id, face)} is not 16×16`);
        entry[face] = tiles.push(override) - 1;
        continue;
      }
      const recipe = block.faces[face];
      const key = JSON.stringify(recipe);
      const shared = byRecipe.get(key);
      if (shared !== undefined) {
        entry[face] = shared;
        continue;
      }
      entry[face] =
        tiles.push(paintTile(recipe, palette, root.fork(`tile:${block.id}:${face}`))) - 1;
      byRecipe.set(key, entry[face]);
    }
    faces.set(block.id, entry);
  }
  return { tiles, faces };
}

/** Packs tiles into one RGBA image (pure), each with a 1-px gutter of duplicated edge pixels. */
export function packAtlas(tiles: readonly Uint8ClampedArray[]): {
  size: number;
  pixels: Uint8ClampedArray;
} {
  const size = atlasSize(tiles.length);
  const pixels = new Uint8ClampedArray(size * size * 4);
  const last = TILE_SIZE - 1;
  tiles.forEach((tile, index) => {
    const { x, y } = tileRect(size, index);
    for (let dy = -GUTTER; dy <= last + GUTTER; dy++) {
      const sy = Math.min(last, Math.max(0, dy));
      for (let dx = -GUTTER; dx <= last + GUTTER; dx++) {
        const sx = Math.min(last, Math.max(0, dx));
        const from = (sy * TILE_SIZE + sx) * 4;
        pixels.set(tile.subarray(from, from + 4), ((y + dy) * size + (x + dx)) * 4);
      }
    }
  });
  return { size, pixels };
}

/** The lookups of an atlas of side `size` built from `plan` (pure). Throws on a duplicate num. */
export function createAtlasLookup(
  blocks: readonly BlockDef[],
  plan: AtlasPlan,
  size: number,
): Pick<Atlas, "uv" | "transparent" | "tileOf"> {
  const byNum = new Map<number, Record<Face, number>>();
  const transparent = new Set<number>();
  for (const block of blocks) {
    const faces = plan.faces.get(block.id);
    if (byNum.has(block.num)) throw new Error(`duplicate block num: ${block.num}`);
    if (faces) byNum.set(block.num, faces);
    if (block.tags.includes("transparent")) transparent.add(block.num);
  }
  return {
    uv: (blockNum, face) => tileUv(size, byNum.get(blockNum)?.[face] ?? MISSING_TILE),
    transparent: (blockNum) => transparent.has(blockNum),
    tileOf: (blockId, face) => plan.faces.get(blockId)?.[face] ?? MISSING_TILE,
  };
}

/** Parses an override path such as `/assets/textures/src/oak-log_top.png`. */
export function parseOverridePath(path: string): { blockId: BlockId; face: Face } | null {
  const m = /(?:^|\/)([a-z0-9]+(?:-[a-z0-9]+)*)_(top|side|bottom)\.png$/.exec(path);
  const blockId = m?.[1];
  const face = m?.[2];
  if (blockId === undefined || (face !== "top" && face !== "side" && face !== "bottom"))
    return null;
  return { blockId, face };
}

/** Hand-drawn PNG overrides, as URLs (Vite inlines files this small as data URIs). */
const OVERRIDE_URLS = import.meta.glob<string>("/assets/textures/src/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createCanvas(size: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx2d } {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    return { canvas, ctx };
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  return { canvas, ctx };
}

/** Decodes the PNG overrides. Files that aren't 16×16 or don't decode are skipped with a warning. */
async function loadOverrides(): Promise<Map<string, Uint8ClampedArray>> {
  const out = new Map<string, Uint8ClampedArray>();
  const entries = Object.entries(OVERRIDE_URLS);
  if (entries.length === 0) return out;
  if (typeof Image === "undefined") {
    console.warn("atlas: PNG overrides need the DOM; using painted tiles");
    return out;
  }
  for (const [path, url] of entries) {
    const parsed = parseOverridePath(path);
    if (!parsed) {
      console.warn(`atlas: ignoring ${path}; name it <blockId>_<top|side|bottom>.png`);
      continue;
    }
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      console.warn(`atlas: could not decode ${path}`);
      continue;
    }
    if (img.naturalWidth !== TILE_SIZE || img.naturalHeight !== TILE_SIZE) {
      console.warn(
        `atlas: ${path} is ${img.naturalWidth}×${img.naturalHeight}, not 16×16; skipped`,
      );
      continue;
    }
    const { ctx } = createCanvas(TILE_SIZE);
    ctx.drawImage(img, 0, 0);
    out.set(
      overrideKey(parsed.blockId, parsed.face),
      ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data,
    );
  }
  return out;
}

function pixelTexture(
  pixels: Uint8ClampedArray,
  size: number,
): {
  texture: THREE.CanvasTexture<HTMLCanvasElement | OffscreenCanvas>;
  canvas: HTMLCanvasElement | OffscreenCanvas;
} {
  const { canvas, ctx } = createCanvas(size);
  const image = ctx.createImageData(size, size);
  image.data.set(pixels);
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, canvas };
}

/**
 * Paints every block face with `paintTile` and packs the tiles into a canvas atlas. A PNG at
 * `assets/textures/src/<blockId>_<face>.png` overrides the painted tile.
 */
export async function buildAtlas(
  blocks: readonly BlockDef[],
  palette: Palette,
  seed: number,
): Promise<Atlas> {
  const plan = planTiles(blocks, palette, seed, await loadOverrides());
  const { size, pixels } = packAtlas(plan.tiles);
  return { ...createAtlasLookup(blocks, plan, size), ...pixelTexture(pixels, size) };
}

/**
 * The 10 crack overlay stages (0–9) as RGBA tiles (pure). All stages share one fracture network
 * from `createRng(seed).fork('crack')`, so each stage adds to the one before.
 */
export function paintCrackStages(seed: number): Uint8ClampedArray[] {
  const root = createRng(seed);
  return Array.from({ length: MAX_CRACK_STAGE + 1 }, (_, stage) =>
    paintTile({ kind: "crack", stage }, BASE_PALETTE, root.fork("crack")),
  );
}

/**
 * Crack overlays for Mine mode, one 16×16 texture per stage. They're drawn as a second material
 * layer over the block, not baked into the atlas.
 */
export function buildCrackTextures(seed: number): THREE.Texture[] {
  return paintCrackStages(seed).map((tile) => pixelTexture(tile, TILE_SIZE).texture);
}
