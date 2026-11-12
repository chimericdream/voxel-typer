/**
 * The world map's texture atlas (task M3-04). No DOM and no three.js here, so it runs in Node.
 *
 * Each island is painted from its own biome's palette (`paletteFor`), with the shared texture
 * recipes. A locked island gets washed-out copies of its tiles: grayer, paler and a little blue,
 * like something seen through mist, but with enough of its own colors left that a child can tell
 * the snowy island from the mushroom one (M3-04 review N4). All tiles of all nine islands share one small atlas,
 * so the whole map uses one texture.
 */
import { ISLAND_KINDS } from "@/content/worldgen/islands";
import { createRng } from "@/engine/rng";
import type { BiomeId } from "@/types/core";
import { MISSING_TILE, atlasSize, packAtlas, tileUv } from "../atlas/build";
import { paletteFor } from "../atlas/palettes";
import { TILE_BYTES, paintTile } from "../atlas/recipes";
import type { AtlasLookup, VoxelGrid } from "../mesher/voxel-grid";

/** One island to paint tiles for. */
export interface MapIslandSpec {
  biome: BiomeId;
  grid: VoxelGrid;
  locked: boolean;
}

type Face = "top" | "side" | "bottom";
const FACES: readonly Face[] = ["top", "side", "bottom"];

export interface MapTiles {
  /** Atlas side in pixels. */
  size: number;
  /** RGBA rows, top row first, `size × size × 4` bytes. */
  pixels: Uint8ClampedArray;
  /** Number of tiles painted, the missing tile included. */
  tileCount: number;
  /** The mesher lookup for one island. Unknown kinds get the missing tile. */
  lookup: (biome: BiomeId) => AtlasLookup;
  /** True for a kind drawn unlit (crystals, lamps, sparks). */
  glows: (kindNum: number) => boolean;
}

/** How far a locked island's colors move toward gray, and toward the mist color. */
export const WASH_GRAY = 0.55;
export const WASH_MIST = 0.35;
const MIST = [203, 212, 224] as const;

/** A washed-out copy of a tile, for locked islands. */
export function washOut(tile: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(tile.length);
  for (let i = 0; i < tile.length; i += 4) {
    const r = tile[i] ?? 0;
    const g = tile[i + 1] ?? 0;
    const b = tile[i + 2] ?? 0;
    const gray = 0.3 * r + 0.59 * g + 0.11 * b;
    const mix = (c: number, k: number): number => {
      const washed = c + (gray - c) * WASH_GRAY;
      return washed + ((MIST[k] ?? 0) - washed) * WASH_MIST;
    };
    out[i] = mix(r, 0);
    out[i + 1] = mix(g, 1);
    out[i + 2] = mix(b, 2);
    out[i + 3] = 255;
  }
  return out;
}

/** The kinds a grid uses. */
function kindsIn(grid: VoxelGrid): Set<number> {
  const used = new Set<number>();
  for (const num of grid.data) if (num !== 0) used.add(num);
  return used;
}

/**
 * Paints the tiles every island needs and packs them (pure). A tile is painted from
 * `createRng(seed).fork('map:<kind>:<face>')`, so the same kind has the same pattern on every
 * island and only its colors change with the biome.
 */
export function buildMapTiles(islands: readonly MapIslandSpec[], seed: number): MapTiles {
  const root = createRng(seed);
  const tiles: Uint8ClampedArray[] = [
    paintTile({ kind: "custom", paint: "missing" }, paletteFor("meadow"), root.fork("map:missing")),
  ];
  const byBiome = new Map<BiomeId, Map<number, Record<Face, number>>>();
  const glow = new Set<number>(ISLAND_KINDS.filter((k) => k.glow === true).map((k) => k.num));

  for (const island of islands) {
    const palette = paletteFor(island.biome);
    const used = kindsIn(island.grid);
    const faces = new Map<number, Record<Face, number>>();
    // Faces of one island with the same recipe share a tile (grass bottom and dirt, say).
    const byRecipe = new Map<string, number>();
    for (const kind of ISLAND_KINDS) {
      if (!used.has(kind.num)) continue;
      const entry: Record<Face, number> = {
        top: MISSING_TILE,
        side: MISSING_TILE,
        bottom: MISSING_TILE,
      };
      for (const face of FACES) {
        const recipe = kind.faces[face];
        const key = JSON.stringify(recipe);
        let index = byRecipe.get(key);
        if (index === undefined) {
          const painted = paintTile(recipe, palette, root.fork(`map:${kind.id}:${face}`));
          if (painted.length !== TILE_BYTES) throw new Error(`map tile ${kind.id} is not 16×16`);
          // Islands are drawn opaque, so see-through recipes (water) lose their alpha.
          for (let i = 3; i < painted.length; i += 4) painted[i] = 255;
          index = tiles.length;
          tiles.push(island.locked ? washOut(painted) : painted);
          byRecipe.set(key, index);
        }
        entry[face] = index;
      }
      faces.set(kind.num, entry);
    }
    byBiome.set(island.biome, faces);
  }

  const { size, pixels } = packAtlas(tiles);
  if (size !== atlasSize(tiles.length)) throw new Error("map atlas size mismatch");
  return {
    size,
    pixels,
    tileCount: tiles.length,
    lookup(biome) {
      const faces = byBiome.get(biome);
      return {
        uv: (num, face) => tileUv(size, faces?.get(num)?.[face] ?? MISSING_TILE),
        transparent: () => false,
      };
    },
    glows: (num) => glow.has(num),
  };
}

/** `pixels` with its rows in bottom-up order, as a `DataTexture` wants them (`flipY` is off). */
export function flipRows(pixels: Uint8ClampedArray, size: number): Uint8Array {
  const out = new Uint8Array(pixels.length);
  const row = size * 4;
  for (let y = 0; y < size; y++) {
    out.set(pixels.subarray(y * row, (y + 1) * row), (size - 1 - y) * row);
  }
  return out;
}
