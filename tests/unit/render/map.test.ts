/**
 * The world map's 3D view (task M3-04), on a real three.js scene with a fake stage: what it
 * draws (the draw-call budget), where the labels go, that it idles once its moves end, and that
 * it leaves nothing behind.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  ISLAND_KINDS,
  ISLAND_LAYOUT,
  generateIsland,
  islandKindNum,
} from "../../../src/content/worldgen/islands";
import { applyPose } from "../../../src/render/camera";
import type { CameraPose } from "../../../src/render/camera";
import { boxesGeometry, islandGeometry } from "../../../src/render/map/geometry";
import { buildMapTiles, flipRows, washOut } from "../../../src/render/map/tiles";
import {
  LIFT,
  OVERVIEW_MS,
  ZOOM_MS,
  cloudCover,
  createWorldMapView,
  HOVER_BRIGHTEN,
  islandPose,
  overviewPose,
  steppingStones,
} from "../../../src/render/map/view";
import type { MapStage } from "../../../src/render/map/view";
import type { AtlasLookup } from "../../../src/render/mesher/voxel-grid";
import { BIOME_ORDER } from "../../../src/types/core";
import type { BiomeId } from "../../../src/types/core";

interface Fake {
  stage: MapStage;
  scene: THREE.Scene;
  moves: { to: CameraPose; durationMs: number }[];
  subscribers(): number;
  /** Runs frames of 16 ms until nothing is subscribed (or `max` frames). Returns the count. */
  pump(max?: number): number;
  renders: number;
  fitted: THREE.Box3[];
  env: string[];
}

function fake(width = 1280, height = 720): Fake {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 500);
  const subs = new Set<(dt: number, t: number) => void>();
  const f: Fake = {
    scene,
    moves: [],
    renders: 0,
    fitted: [],
    env: [],
    subscribers: () => subs.size,
    pump(max = 500) {
      let n = 0;
      let t = 0;
      while (subs.size > 0 && n < max) {
        // Like the real loop: the first frame after idle has dt 0.
        const dt = n === 0 ? 0 : 16;
        t += dt;
        for (const fn of subs) fn(dt, t);
        n++;
      }
      return n;
    },
    stage: {
      three: { scene, camera },
      camera: {
        moveTo(to, opts) {
          f.moves.push({
            to: { ...to, target: { ...to.target } },
            durationMs: opts?.durationMs ?? 0,
          });
          // The fake camera always snaps; the real rig's tween is tested in camera.test.ts.
          applyPose(camera, to);
          camera.updateMatrixWorld();
        },
      },
      lights: { fitTo: (box) => f.fitted.push(box.clone()) },
      setEnvironment: (env) => f.env.push(`${env.biome}/${env.timeOfDay}`),
      requestRender: () => {
        f.renders += 1;
      },
      onFrame(fn) {
        subs.add(fn);
        return () => subs.delete(fn);
      },
    },
  };
  return f;
}

const view = (f: Fake, unlocked: BiomeId[], opts: { reduced?: boolean; start?: BiomeId } = {}) =>
  createWorldMapView(f.stage, {
    unlocked: new Set(unlocked),
    viewport: () => ({ width: 1280, height: 720 }),
    reducedMotion: () => opts.reduced === true,
    ...(opts.start ? { start: opts.start } : {}),
  });

const meshes = (root: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
};

const at = (p: ArrayLike<number>, i: number): number => p[i] ?? 0;

const specs = (locked: BiomeId[]) =>
  BIOME_ORDER.map((biome) => ({
    biome,
    grid: generateIsland(biome),
    locked: locked.includes(biome),
  }));

/** How colorful a tile set is: the sum of each pixel's channel spread. */
const chroma = (p: Uint8ClampedArray): number => {
  let sum = 0;
  for (let i = 0; i < p.length; i += 4) {
    sum +=
      Math.max(at(p, i), at(p, i + 1), at(p, i + 2)) -
      Math.min(at(p, i), at(p, i + 1), at(p, i + 2));
  }
  return sum;
};

const quads = (g: THREE.BufferGeometry | null): number => (g?.getIndex()?.count ?? 0) / 6;

describe("map tiles", () => {
  it("washes a locked island's colors toward a pale gray, keeping a hint of each hue", () => {
    const tile = new Uint8ClampedArray([200, 30, 30, 255, 30, 160, 40, 120]);
    const out = washOut(tile);
    const spread = (i: number) =>
      Math.max(at(out, i), at(out, i + 1), at(out, i + 2)) -
      Math.min(at(out, i), at(out, i + 1), at(out, i + 2));
    // Well under the source's spread (170 and 130), but not gray: red stays reddish, green greenish.
    expect(spread(0)).toBeLessThan(70);
    expect(spread(4)).toBeLessThan(70);
    expect(spread(0)).toBeGreaterThan(25);
    expect(spread(4)).toBeGreaterThan(25);
    expect(at(out, 0)).toBeGreaterThan(Math.max(at(out, 1), at(out, 2)));
    expect(at(out, 5)).toBeGreaterThan(Math.max(at(out, 4), at(out, 6)));
    expect(out[3]).toBe(255);
    expect(out[7]).toBe(255);
    // Paler than the source's luminance, never darker.
    expect(at(out, 0) + at(out, 1) + at(out, 2)).toBeGreaterThan(
      3 * (0.3 * 200 + 0.59 * 30 + 0.11 * 30),
    );
  });

  it("packs every island's tiles into one small atlas, all opaque", () => {
    const tiles = buildMapTiles(specs([]), 1);
    expect(tiles.size).toBeLessThanOrEqual(256);
    expect(tiles.pixels.length).toBe(tiles.size * tiles.size * 4);
    expect(tiles.tileCount).toBeGreaterThan(40);
    const grass = islandKindNum("grass");
    const meadow = tiles.lookup("meadow");
    const frosty = tiles.lookup("frosty");
    // Grass has three different faces; Frosty has no grass, so it gets the missing tile.
    expect(meadow.uv(grass, "top")).not.toEqual(meadow.uv(grass, "side"));
    expect(meadow.uv(grass, "top")).not.toEqual(frosty.uv(grass, "top"));
    expect(frosty.uv(grass, "top")).toEqual(frosty.uv(9999, "top"));
    expect(meadow.transparent(islandKindNum("water"))).toBe(false);
    expect(ISLAND_KINDS.filter((k) => tiles.glows(k.num)).map((k) => k.id)).toContain("crystal");
  });

  it("is deterministic, and a locked island's tiles are grayer than its open ones", () => {
    const open = buildMapTiles(specs([]), 1);
    const again = buildMapTiles(specs([]), 1);
    expect(again.pixels).toEqual(open.pixels);
    const locked = buildMapTiles(specs(["birch"]), 1);
    expect(chroma(locked.pixels)).toBeLessThan(chroma(open.pixels));
  });

  it("flipRows turns the rows upside down", () => {
    const px = new Uint8ClampedArray(2 * 2 * 4).map((_, i) => i);
    expect([...flipRows(px, 2)]).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("map geometry", () => {
  const atlas: AtlasLookup = { uv: () => [0, 0, 1, 1], transparent: () => false };

  it("an island is centered on its ground, and glowing voxels split off only when asked", () => {
    const grid = generateIsland("caverns");
    const crystal = islandKindNum("crystal");
    const both = islandGeometry(grid, atlas, (n) => n === crystal);
    expect(both.lit).not.toBeNull();
    expect(both.glow).not.toBeNull();
    const box = both.lit?.boundingBox;
    expect(box?.min.x).toBeGreaterThanOrEqual(-8);
    expect(box?.max.x).toBeLessThanOrEqual(8);
    expect(box?.min.y).toBeGreaterThanOrEqual(-6);
    expect(box?.max.y).toBeLessThanOrEqual(6);
    const one = islandGeometry(grid, atlas, null);
    expect(one.glow).toBeNull();
    expect(quads(one.lit)).toBe(quads(both.lit) + quads(both.glow));
  });

  it("boxesGeometry puts every box in one geometry with its color", () => {
    const g = boxesGeometry([
      { x: 0, y: 0, z: 0, w: 2, h: 2, d: 2, color: [1, 0, 0] },
      { x: 10, y: 0, z: 0, w: 4, h: 1, d: 1, color: [0, 0, 1] },
    ]);
    expect(g.getAttribute("position").count).toBe(48);
    expect(g.getIndex()?.count).toBe(72);
    expect(g.boundingBox?.min.x).toBe(-1);
    expect(g.boundingBox?.max.x).toBe(12);
    const c = g.getAttribute("color");
    expect([c.getX(0), c.getZ(0)]).toEqual([1, 0]);
    expect([c.getX(24), c.getZ(24)]).toEqual([0, 1]);
  });

  it("cloud cover sits around and above its island; stepping stones run between two islands", () => {
    const place = ISLAND_LAYOUT.frosty;
    const puffs = cloudCover(place, 3, 1);
    expect(puffs.length).toBeGreaterThanOrEqual(4);
    for (const p of puffs) {
      expect(Math.abs(p.x - place.x)).toBeLessThan(14);
      expect(p.y).toBeGreaterThan(place.y);
    }
    const stones = steppingStones(ISLAND_LAYOUT.meadow, ISLAND_LAYOUT.birch, true);
    expect(stones.length).toBeGreaterThanOrEqual(4);
    for (const s of stones) {
      expect(s.x).toBeGreaterThan(ISLAND_LAYOUT.meadow.x + 8);
      expect(s.x).toBeLessThan(ISLAND_LAYOUT.birch.x - 8);
    }
    const pale = steppingStones(ISLAND_LAYOUT.meadow, ISLAND_LAYOUT.birch, false);
    expect(pale[0]?.color).not.toEqual(stones[0]?.color);
  });
});

describe("world map view", () => {
  it("draws at most one mesh per island plus glow, clouds and stones (the draw-call budget)", () => {
    const f = fake();
    const all = view(f, [...BIOME_ORDER]);
    const open = meshes(all.root);
    // 9 islands, 4 of them with glowing voxels, and the stepping stones. No cloud cover.
    expect(open.length).toBe(9 + 4 + 1);
    expect(open.some((m) => m.name === "map-cloud-cover")).toBe(false);
    all.dispose();

    const fresh = view(f, ["meadow"]);
    const few = meshes(fresh.root);
    // Locked islands never glow, and all their cloud cover is one mesh.
    expect(few.length).toBe(9 + 1 + 1);
    expect(few.filter((m) => m.name === "map-cloud-cover")).toHaveLength(1);
    fresh.dispose();
  });

  it("uses one texture and four materials, and sets up the sky for the archipelago", () => {
    const f = fake();
    const v = view(f, ["meadow", "birch", "caverns"]);
    const mats = new Set(meshes(v.root).map((m) => m.material));
    expect(mats.size).toBeLessThanOrEqual(4);
    const maps = new Set<THREE.Texture>();
    for (const m of mats) {
      if (m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshBasicMaterial) {
        if (m.map) maps.add(m.map);
      }
    }
    expect(maps.size).toBe(1);
    expect(f.env).toEqual(["meadow/day"]);
    expect(f.fitted).toHaveLength(1);
    for (const biome of BIOME_ORDER) {
      const p = ISLAND_LAYOUT[biome];
      expect(f.fitted[0]?.containsPoint(new THREE.Vector3(p.x, p.y, p.z))).toBe(true);
    }
    v.dispose();
  });

  it("glides onto the overview, then stops asking for frames", () => {
    const f = fake();
    const v = view(f, ["meadow"]);
    expect(f.scene.children).toContain(v.root);
    expect(f.moves).toHaveLength(2);
    expect(f.moves[0]?.durationMs).toBe(0);
    expect(f.moves[0]?.to.distance).toBeGreaterThan(f.moves[1]?.to.distance ?? 0);
    expect(f.moves[1]?.durationMs).toBe(OVERVIEW_MS);
    expect(v.moving).toBe(true);
    const frames = f.pump();
    // About 900 ms of 16 ms frames, then idle: no subscriber left, so the render loop stops.
    expect(frames).toBeGreaterThan(OVERVIEW_MS / 16);
    expect(frames).toBeLessThan(OVERVIEW_MS / 16 + 4);
    expect(f.subscribers()).toBe(0);
    expect(v.moving).toBe(false);
    v.dispose();
  });

  it("with reduced motion every move is a snap that needs one frame", () => {
    const f = fake();
    const v = view(f, ["meadow"], { reduced: true });
    expect(f.moves.every((m) => m.durationMs === 0)).toBe(true);
    expect(f.pump()).toBe(1);
    v.show("meadow");
    expect(f.moves.at(-1)?.durationMs).toBe(0);
    expect(f.pump()).toBe(1);
    v.select("meadow");
    expect(f.pump()).toBe(1);
    expect(v.root.getObjectByName("island meadow")?.position.y).toBe(ISLAND_LAYOUT.meadow.y + LIFT);
    v.dispose();
  });

  it("show() goes close to an island and back, and select() lifts only the picked island", () => {
    const f = fake();
    const v = view(f, ["meadow", "birch"]);
    f.pump();
    v.show("birch");
    expect(v.shown).toBe("birch");
    expect(f.moves.at(-1)?.durationMs).toBe(ZOOM_MS);
    expect(f.moves.at(-1)?.to.distance).toBeLessThan(60);
    f.pump();
    expect(f.subscribers()).toBe(0);
    v.show(null);
    expect(f.moves.at(-1)?.to).toEqual(overviewPose(1280 / 720));
    f.pump();

    v.select("birch");
    f.pump();
    const y = (b: BiomeId) => v.root.getObjectByName(`island ${b}`)?.position.y;
    expect(y("birch")).toBeCloseTo(ISLAND_LAYOUT.birch.y + LIFT);
    expect(y("meadow")).toBe(ISLAND_LAYOUT.meadow.y);
    v.select("meadow");
    f.pump();
    expect(y("birch")).toBe(ISLAND_LAYOUT.birch.y);
    expect(y("meadow")).toBeCloseTo(ISLAND_LAYOUT.meadow.y + LIFT);
    expect(f.subscribers()).toBe(0);
    v.dispose();
  });

  it("starts close on an island when asked, without the glide in", () => {
    const f = fake();
    const v = view(f, ["meadow"], { start: "meadow" });
    expect(f.moves).toHaveLength(1);
    expect(f.moves[0]).toEqual({
      to: islandPose(ISLAND_LAYOUT.meadow, 1280 / 720),
      durationMs: 0,
    });
    expect(f.pump()).toBe(1);
    v.dispose();
  });

  it.each([
    [1280, 720],
    [1024, 720],
    [1920, 1080],
    [1024, 768],
  ])("puts every island's label on screen at %i×%i, in three rows", (width, height) => {
    const f = fake(width, height);
    const v = createWorldMapView(f.stage, {
      unlocked: new Set<BiomeId>(BIOME_ORDER),
      viewport: () => ({ width, height }),
      reducedMotion: () => true,
    });
    f.pump();
    const spots = v.anchors();
    expect(spots.size).toBe(9);
    for (const [biome, p] of spots) {
      expect(p.x, biome).toBeGreaterThan(width * 0.06);
      expect(p.x, biome).toBeLessThan(width * 0.94);
      expect(p.y, biome).toBeGreaterThan(height * 0.2);
      // Room for the label under the lowest islands.
      expect(p.y, biome).toBeLessThan(height * 0.9);
    }
    const y = (b: BiomeId) => spots.get(b)?.y ?? 0;
    const x = (b: BiomeId) => spots.get(b)?.x ?? 0;
    const front = Math.min(y("meadow"), y("birch"), y("shore"));
    const middle = [y("frosty"), y("mines"), y("marsh")];
    const back = Math.max(y("caverns"), y("sparkstone"), y("citadel"));
    expect(Math.max(...middle)).toBeLessThan(front - height * 0.2);
    expect(back).toBeLessThan(Math.min(...middle) - height * 0.12);
    // The path snakes: left to right along the front, back along the middle.
    expect(x("meadow")).toBeLessThan(x("birch"));
    expect(x("birch")).toBeLessThan(x("shore"));
    expect(x("frosty")).toBeGreaterThan(x("mines"));
    expect(x("mines")).toBeGreaterThan(x("marsh"));
    // No two labels hang from nearly the same point.
    for (const a of BIOME_ORDER) {
      for (const b of BIOME_ORDER) {
        if (a >= b) continue;
        const near = Math.abs(x(a) - x(b)) < width * 0.1 && Math.abs(y(a) - y(b)) < height * 0.1;
        expect(near, `${a}–${b}`).toBe(false);
      }
    }
    v.dispose();
  });

  it("tells listeners after every frame of a move, and refresh() re-frames for a new size", () => {
    const f = fake();
    let size = { width: 1280, height: 720 };
    const v = createWorldMapView(f.stage, {
      unlocked: new Set<BiomeId>(["meadow"]),
      viewport: () => size,
      reducedMotion: () => true,
    });
    let calls = 0;
    const off = v.onMove(() => calls++);
    f.pump();
    expect(calls).toBe(1);
    size = { width: 900, height: 720 };
    v.refresh();
    expect(f.moves.at(-1)?.to).toEqual(overviewPose(900 / 720));
    // Two frames, so the scene's own resize has landed before the last one.
    expect(f.pump()).toBe(2);
    expect(calls).toBe(3);
    off();
    v.refresh();
    f.pump();
    expect(calls).toBe(3);
    v.dispose();
  });

  it("pick() finds the island under a point, its middle included (M3-FIX-4)", () => {
    const f = fake();
    const v = view(f, ["meadow", "birch"]);
    f.pump();
    const centers = v.centers();
    expect(centers.size).toBe(9);
    for (const biome of BIOME_ORDER) {
      const c = centers.get(biome);
      expect(c, biome).toBeDefined();
      if (c === undefined) continue;
      expect(c.x).toBeGreaterThan(0);
      expect(c.x).toBeLessThan(1280);
      expect(c.y).toBeGreaterThan(0);
      expect(c.y).toBeLessThan(720);
      expect(v.pick(c), biome).toBe(biome);
    }
    // The empty sky in a corner is no island.
    expect(v.pick({ x: 4, y: 4 })).toBeNull();
    // A whole close view: the middle of the screen is the island the camera is on.
    v.show("meadow", { snap: true });
    f.pump();
    const close = v.centers().get("meadow");
    if (close === undefined) throw new Error("no meadow");
    expect(v.pick(close)).toBe("meadow");
    v.dispose();
    expect(v.pick(close)).toBeNull();
  });

  it("hover() brightens one island by color only, renders once and starts no frames", () => {
    const f = fake();
    const v = view(f, ["meadow", "birch"]);
    f.pump();
    const lit = (biome: BiomeId): THREE.Material | THREE.Material[] | undefined =>
      meshes(v.root.getObjectByName(`island ${biome}`) ?? new THREE.Group())[0]?.material;
    const plain = lit("birch");
    const renders = f.renders;
    v.hover("meadow");
    expect(f.subscribers()).toBe(0);
    expect(f.renders).toBe(renders + 1);
    const bright = lit("meadow");
    expect(bright).not.toBe(plain);
    expect(bright instanceof THREE.MeshLambertMaterial && bright.color.r).toBeCloseTo(
      HOVER_BRIGHTEN,
    );
    expect(lit("birch")).toBe(plain);
    // The same island again: nothing to do.
    v.hover("meadow");
    expect(f.renders).toBe(renders + 1);
    v.hover(null);
    expect(lit("meadow")).toBe(plain);
    expect(f.renders).toBe(renders + 2);
    v.dispose();
  });

  it("dispose() removes the map, frees its GPU objects and stops its frames", () => {
    const f = fake();
    const v = view(f, ["meadow"]);
    const root = v.root;
    const parts = meshes(root);
    let freed = 0;
    const seen = new Set<THREE.BufferGeometry>();
    const textures = new Set<THREE.Texture>();
    for (const m of parts) {
      if (m.material instanceof THREE.MeshLambertMaterial && m.material.map) {
        textures.add(m.material.map);
      }
      if (seen.has(m.geometry)) continue;
      seen.add(m.geometry);
      m.geometry.addEventListener("dispose", () => freed++);
    }
    let texturesFreed = 0;
    for (const tex of textures) tex.addEventListener("dispose", () => texturesFreed++);
    expect(textures.size).toBe(1);
    expect(f.subscribers()).toBe(1);
    v.dispose();
    expect(f.scene.children).not.toContain(root);
    expect(freed).toBe(seen.size);
    expect(texturesFreed).toBe(1);
    expect(f.subscribers()).toBe(0);
    expect(f.renders).toBe(1);
    // A dead view ignores everything.
    const moves = f.moves.length;
    v.show("meadow");
    v.select("meadow");
    v.refresh();
    v.dispose();
    expect(f.moves.length).toBe(moves);
    expect(f.subscribers()).toBe(0);
  });
});
