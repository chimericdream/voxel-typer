/**
 * World-map islands (task M3-04): determinism (hashes pinned), size, kinds and landmarks of the
 * nine island models, and the archipelago layout.
 */
import { describe, expect, it } from "vitest";
import { biomesUnlockedBy } from "../../../src/app/progress";
import {
  ISLAND_GROUND_Y,
  ISLAND_KINDS,
  ISLAND_LAYOUT,
  ISLAND_LINKS,
  ISLAND_SIZE,
  MAP_SEED,
  generateIsland,
  islandKindNum,
} from "../../../src/content/worldgen/islands";
import type { IslandKindId } from "../../../src/content/worldgen/islands";
import type { VoxelGrid } from "../../../src/render/mesher/voxel-grid";
import { BIOME_ORDER } from "../../../src/types/core";
import type { BiomeId } from "../../../src/types/core";

/** FNV-1a over the grid's cells. */
function hash(grid: VoxelGrid): string {
  let h = 0x811c9dc5;
  for (const v of grid.data) {
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ (v >>> 8), 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const count = (grid: VoxelGrid, kind: IslandKindId): number => {
  const num = islandKindNum(kind);
  let n = 0;
  for (const v of grid.data) if (v === num) n++;
  return n;
};

const heightOf = (b: BiomeId): number => ISLAND_LAYOUT[b].y;

const PINNED: Record<BiomeId, string> = {
  meadow: "32ddf46b",
  birch: "25bcbc3a",
  shore: "365eace6",
  frosty: "1de72ab8",
  mines: "75301ea3",
  marsh: "7a1e1192",
  caverns: "e4d0dde9",
  sparkstone: "09cbbe31",
  citadel: "d660e56e",
};

describe("island kinds", () => {
  it("have unique ids and nums from 1, and none uses a banned name", () => {
    expect(new Set(ISLAND_KINDS.map((k) => k.id)).size).toBe(ISLAND_KINDS.length);
    expect(ISLAND_KINDS.map((k) => k.num)).toEqual(ISLAND_KINDS.map((_, i) => i + 1));
    for (const k of ISLAND_KINDS) {
      expect(k.id).not.toMatch(/creeper|enderman|redstone|nether|steve/);
    }
  });

  it("only crystals, lamps, sparks and gold glow", () => {
    expect(ISLAND_KINDS.filter((k) => k.glow === true).map((k) => k.id)).toEqual([
      "lantern",
      "crystal",
      "spark",
      "gold",
    ]);
  });
});

describe("generateIsland", () => {
  it("is deterministic: the same biome and seed give the same grid (hashes pinned)", () => {
    for (const biome of BIOME_ORDER) {
      const a = generateIsland(biome, MAP_SEED);
      const b = generateIsland(biome);
      expect(a.data).toEqual(b.data);
      expect(hash(a), biome).toBe(PINNED[biome]);
    }
  });

  it("a different seed changes the clump's outline", () => {
    for (const biome of BIOME_ORDER) {
      expect(hash(generateIsland(biome, 7)), biome).not.toBe(hash(generateIsland(biome, 8)));
    }
  });

  it("every island is 16×12×16, uses only island kinds, and all nine differ", () => {
    const known = new Set(ISLAND_KINDS.map((k) => k.num));
    const hashes = new Set<string>();
    for (const biome of BIOME_ORDER) {
      const g = generateIsland(biome);
      expect([g.sx, g.sy, g.sz]).toEqual([ISLAND_SIZE.sx, ISLAND_SIZE.sy, ISLAND_SIZE.sz]);
      for (const v of g.data) if (v !== 0) expect(known.has(v)).toBe(true);
      hashes.add(hash(g));
    }
    expect(hashes.size).toBe(BIOME_ORDER.length);
  });

  it("is a floating clump: wide at the ground, tapering to a few cells at the bottom", () => {
    for (const biome of BIOME_ORDER) {
      const g = generateIsland(biome);
      const layer = (y: number): number => {
        let n = 0;
        for (let z = 0; z < g.sz; z++) for (let x = 0; x < g.sx; x++) if (g.get(x, y, z)) n++;
        return n;
      };
      expect(layer(ISLAND_GROUND_Y), biome).toBeGreaterThan(110);
      expect(layer(0), biome).toBeLessThan(40);
      expect(layer(1), biome).toBeLessThanOrEqual(layer(3));
      // Something stands on the ground, and the middle column is solid all the way down.
      expect(layer(ISLAND_GROUND_Y + 2), biome).toBeGreaterThan(0);
      for (let y = 1; y <= ISLAND_GROUND_Y; y++) expect(g.get(8, y, 8), biome).not.toBe(0);
    }
  });

  it("each island carries its biome's landmarks", () => {
    const g = generateIsland;
    expect(count(g("meadow"), "red-wool")).toBeGreaterThan(20);
    expect(count(g("meadow"), "water")).toBeGreaterThan(2);
    expect(count(g("birch"), "birch-log")).toBeGreaterThan(10);
    expect(count(g("shore"), "sand")).toBeGreaterThan(100);
    expect(count(g("shore"), "water")).toBeGreaterThan(15);
    expect(count(g("frosty"), "snow")).toBeGreaterThan(80);
    expect(count(g("frosty"), "ice")).toBeGreaterThan(3);
    expect(count(g("mines"), "copper-ore") + count(g("mines"), "gem-ore")).toBeGreaterThan(4);
    expect(count(g("mines"), "lantern")).toBe(1);
    expect(count(g("marsh"), "mushroom-cap")).toBeGreaterThan(20);
    expect(count(g("caverns"), "crystal")).toBeGreaterThan(25);
    expect(count(g("sparkstone"), "spark")).toBeGreaterThan(4);
    expect(count(g("sparkstone"), "brick")).toBeGreaterThan(40);
    expect(count(g("citadel"), "cloud")).toBeGreaterThan(150);
    expect(count(g("citadel"), "gold")).toBe(4);
  });
});

describe("archipelago layout", () => {
  it("places all nine islands apart from each other", () => {
    for (const a of BIOME_ORDER) {
      for (const b of BIOME_ORDER) {
        if (a >= b) continue;
        const p = ISLAND_LAYOUT[a];
        const q = ISLAND_LAYOUT[b];
        expect(Math.hypot(p.x - q.x, p.z - q.z), `${a}–${b}`).toBeGreaterThan(24);
      }
    }
  });

  it("stepping stones follow the unlock rules: each island is reached from the one that opens it", () => {
    expect(ISLAND_LINKS.meadow).toBeUndefined();
    for (const biome of BIOME_ORDER.slice(1)) {
      // The first biome in curriculum order that opens it (Crystal Caverns opens two).
      const opener = BIOME_ORDER.find((x) => biomesUnlockedBy(x).includes(biome));
      expect(ISLAND_LINKS[biome], biome).toBe(opener);
    }
    expect(Object.keys(ISLAND_LINKS)).toHaveLength(BIOME_ORDER.length - 1);
  });

  it("later islands float higher, and the citadel is the highest", () => {
    expect(heightOf("citadel")).toBe(Math.max(...BIOME_ORDER.map(heightOf)));
    expect(heightOf("meadow")).toBe(Math.min(...BIOME_ORDER.map(heightOf)));
  });
});
