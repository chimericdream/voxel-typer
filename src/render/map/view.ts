/**
 * The world map in 3D (task M3-04, PLAN.md §3.1): nine small floating islands, drawn in the app's
 * one shared scene. This module adds its own objects to that scene and removes them again in
 * `dispose()`; it never makes a renderer.
 *
 * Cost: one textured mesh per island (plus one unlit mesh on the few islands that glow), one mesh
 * for all the cloud cover and one for all the stepping stones. About 20 draw calls with the sky.
 *
 * Motion: the camera glides between the overview and a close view of one island, and the picked
 * island rises a little. Each move is short and finite. The view subscribes to frames only while
 * something moves, so the render loop idles as soon as the map is at rest. Nothing bobs, drifts
 * or loops here.
 */
import * as THREE from "three";
import {
  ISLAND_GROUND_Y,
  ISLAND_LAYOUT,
  ISLAND_LINKS,
  MAP_SEED,
  generateIsland,
} from "@/content/worldgen/islands";
import type { IslandPlace } from "@/content/worldgen/islands";
import { hash2 } from "@/content/worldgen/noise";
import { BIOME_ORDER } from "@/types/core";
import type { BiomeId, Ms, TimeOfDay } from "@/types/core";
import type { CameraPose } from "../camera";
import { boxesGeometry, islandGeometry } from "./geometry";
import type { ColorBox } from "./geometry";
import { buildMapTiles, flipRows } from "./tiles";

/** What the map needs from the app's scene. The render core's `SceneCore` fits. */
export interface MapStage {
  three: { scene: THREE.Scene; camera: THREE.PerspectiveCamera };
  camera: { moveTo(to: Readonly<CameraPose>, opts?: { durationMs?: Ms }): void };
  /** Aims the sun (and with it the sky's clouds and fog) at the archipelago. */
  lights?: { fitTo(box: THREE.Box3): void } | undefined;
  setEnvironment(env: { biome: BiomeId; timeOfDay: TimeOfDay }): void;
  requestRender(): void;
  onFrame(fn: (dtMs: Ms, t: Ms) => void): () => void;
}

export interface MapViewOptions {
  /** Islands drawn in color. Every other island is washed out under clouds. */
  unlocked: ReadonlySet<BiomeId>;
  /** The size of the canvas in CSS pixels. Read on every use. */
  viewport: () => { width: number; height: number };
  reducedMotion: () => boolean;
  /** The island to start close on, or null for the overview (with a short glide in). */
  start?: BiomeId | null;
  seed?: number;
}

/** A point on the canvas, in CSS pixels from its top left. */
export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WorldMapView {
  /** Everything the map added to the scene (for tests and debugging). */
  readonly root: THREE.Group;
  /** Moves the camera: `null` shows the whole archipelago, a biome goes close to its island. */
  show(biome: BiomeId | null, opts?: { snap?: boolean }): void;
  /** The island the camera is close on, or null on the overview. */
  readonly shown: BiomeId | null;
  /** Lifts one island a little, to mark it as picked. `null` sets every island down. */
  select(biome: BiomeId | null): void;
  /** Where each island's label goes: just under the island, as the camera sees it now. */
  anchors(): Map<BiomeId, ScreenPoint>;
  /** The middle of each island's model on screen, as the camera sees it now. */
  centers(): Map<BiomeId, ScreenPoint>;
  /**
   * The island under a point on the canvas (CSS pixels from its top left), or null. The island's
   * blocks are tested first; a click in a gap between them (between two trees, say) still finds
   * the island through the ellipsoid that fills its bounding box, so a child never has to aim
   * (M3-FIX-4). The ellipsoid, not the box: a box's empty corners reached out into the sky and,
   * near another island, sometimes took a click meant for it (a11y review S4).
   */
  pick(at: ScreenPoint): BiomeId | null;
  /**
   * Brightens one island while the pointer is over it; `null` for none. A change of color only,
   * so it moves nothing and needs no reduced-motion check. Renders once; starts no loop.
   */
  hover(biome: BiomeId | null): void;
  /** Called after every frame in which the picture changed (camera or island moves, resizes). */
  onMove(fn: () => void): () => void;
  /** Call after the canvas changed size: re-frames the current view. */
  refresh(): void;
  /** True while a move is still running (the view is subscribed to frames). */
  readonly moving: boolean;
  /** Removes the map from the scene and frees its geometries, materials and texture. */
  dispose(): void;
}

const rad = THREE.MathUtils.degToRad;

export const MAP_FOV = 35;
export const OVERVIEW_MS: Ms = 900;
export const ZOOM_MS: Ms = 650;
export const LIFT_MS: Ms = 160;
/** How far a picked island rises, in blocks. */
export const LIFT = 0.9;

/** The overview is framed for this aspect ratio; a narrower window pulls the camera back. */
const OVERVIEW_ASPECT = 1.7;

/** The pose that shows all nine islands in a window of `aspect` (width / height). */
export function overviewPose(aspect: number): CameraPose {
  const a = aspect > 0 ? aspect : OVERVIEW_ASPECT;
  return {
    target: { x: -2, y: 1.5, z: -10 },
    yaw: 0,
    pitch: rad(21),
    distance: 118 * Math.max(1, OVERVIEW_ASPECT / a),
    fov: MAP_FOV,
  };
}

/**
 * The close pose for one island. In a wide window the island sits in the left third, leaving the
 * right for the lesson path; in a narrow one it is centered, a little above the middle.
 */
export function islandPose(place: IslandPlace, aspect: number): CameraPose {
  const a = aspect > 0 ? aspect : OVERVIEW_ASPECT;
  const yaw = rad(12);
  const distance = 46;
  const visibleHeight = 2 * distance * Math.tan(rad(MAP_FOV / 2));
  const wide = a >= 1.3;
  const side = wide ? 0.21 * visibleHeight * a : 0;
  return {
    target: {
      x: place.x + Math.cos(yaw) * side,
      y: place.y + (wide ? 1.5 : -visibleHeight * 0.16),
      z: place.z - Math.sin(yaw) * side,
    },
    yaw,
    pitch: rad(22),
    distance,
    fov: MAP_FOV,
  };
}

/** The box around the whole archipelago. */
export function archipelagoBox(): THREE.Box3 {
  const box = new THREE.Box3();
  for (const biome of BIOME_ORDER) {
    const p = ISLAND_LAYOUT[biome];
    box.expandByPoint(new THREE.Vector3(p.x - 10, p.y - 8, p.z - 10));
    box.expandByPoint(new THREE.Vector3(p.x + 10, p.y + 8, p.z + 10));
  }
  return box;
}

const CLOUD_LIGHT = [1, 1, 1] as const;
const STONE_BASE = [0.3, 0.32, 0.35] as const;
const STONE_GRASS = [0.2, 0.42, 0.1] as const;
const STONE_PALE = [0.55, 0.6, 0.68] as const;

/** A unit-interval hash for cloud and stone jitter. */
const jitter = (a: number, b: number, seed: number): number => hash2(a, b, seed) / 4294967296;

/**
 * The gentle cloud cover over one locked island: three flat puffs, one low in front and two
 * drifting over it. Most of the island still shows between them.
 */
export function cloudCover(place: IslandPlace, index: number, seed: number): ColorBox[] {
  const puffs: readonly (readonly [number, number, number, number, number, number, boolean])[] = [
    [-4.5, 0.6, 8.5, 9, 2, 4.5, true],
    [7, 5.5, 2.5, 7, 1.8, 4.5, true],
    [-7.5, 6.5, -2, 6, 1.6, 4, false],
  ];
  const out: ColorBox[] = [];
  puffs.forEach(([dx, dy, dz, w, h, d, crest], i) => {
    const jx = (jitter(index, i, seed) - 0.5) * 3;
    const jy = (jitter(i, index, seed + 1) - 0.5) * 1.2;
    const x = place.x + dx + jx;
    const y = place.y + dy + jy;
    const z = place.z + dz;
    out.push({ x, y, z, w, h, d, color: CLOUD_LIGHT });
    if (crest) {
      out.push({
        x: x + (jx > 0 ? -1 : 1),
        y: y + h * 0.5 + 0.7,
        z: z - 0.4,
        w: w * 0.55,
        h: 1.4,
        d: d * 0.65,
        color: CLOUD_LIGHT,
      });
    }
  });
  return out;
}

/** The stepping stones from one island to the next. Pale when they lead to a locked island. */
export function steppingStones(from: IslandPlace, to: IslandPlace, open: boolean): ColorBox[] {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const margin = 10.5;
  if (length <= margin * 2) return [];
  const count = Math.max(1, Math.floor((length - margin * 2) / 4.2));
  const out: ColorBox[] = [];
  for (let i = 0; i < count; i++) {
    const along = margin + ((i + 0.5) * (length - margin * 2)) / count;
    const k = along / length;
    const x = from.x + dx * k;
    const z = from.z + dz * k;
    // The stones hang in a shallow arc between the two islands' ground levels.
    const y = from.y + (to.y - from.y) * k - 1.2 - Math.sin(k * Math.PI) * 1.6;
    const s = i % 2 === 0 ? 1.9 : 1.5;
    out.push({ x, y, z, w: s, h: 0.9, d: s, color: open ? STONE_BASE : STONE_PALE });
    out.push({
      x,
      y: y + 0.6,
      z,
      w: s,
      h: 0.3,
      d: s,
      color: open ? STONE_GRASS : STONE_PALE,
    });
  }
  return out;
}

/** How much brighter the island under the pointer is drawn. */
export const HOVER_BRIGHTEN = 1.3;

interface Island {
  group: THREE.Group;
  /** The island's lit mesh (the one that changes color on hover), if it has one. */
  litMesh: THREE.Mesh | null;
  /** The island's meshes, for picking. */
  meshes: THREE.Mesh[];
  place: IslandPlace;
  lift: number;
  wantLift: number;
}

export function createWorldMapView(stage: MapStage, opts: MapViewOptions): WorldMapView {
  const seed = opts.seed ?? MAP_SEED;
  const { scene, camera } = stage.three;
  const root = new THREE.Group();
  root.name = "world-map";

  const specs = BIOME_ORDER.map((biome) => ({
    biome,
    grid: generateIsland(biome, seed),
    locked: !opts.unlocked.has(biome),
  }));
  const tiles = buildMapTiles(specs, seed);
  const texture = new THREE.DataTexture(
    flipRows(tiles.pixels, tiles.size),
    tiles.size,
    tiles.size,
    THREE.RGBAFormat,
  );
  texture.name = "world-map-atlas";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const lit = new THREE.MeshLambertMaterial({ map: texture, vertexColors: true });
  lit.name = "map-island";
  // The same material a little brighter, for the island under the pointer. Same shader program.
  const litHover = lit.clone();
  litHover.name = "map-island-hover";
  litHover.color.setScalar(HOVER_BRIGHTEN);
  const glow = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true });
  glow.name = "map-glow";
  // Unlit, like the sky's own clouds, so the cover stays white from every side.
  const cloud = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
  });
  cloud.name = "map-cloud";
  const stone = new THREE.MeshLambertMaterial({ vertexColors: true });
  stone.name = "map-stone";
  const geometries: THREE.BufferGeometry[] = [];

  const islands = new Map<BiomeId, Island>();
  const cover: ColorBox[] = [];
  const stones: ColorBox[] = [];
  specs.forEach((spec, index) => {
    const place = ISLAND_LAYOUT[spec.biome];
    const group = new THREE.Group();
    group.name = `island ${spec.biome}`;
    group.position.set(place.x, place.y, place.z);
    group.rotation.y = rad(place.turn);
    // A locked island never glows: its crystals and lamps are washed out with the rest.
    const parts = islandGeometry(
      spec.grid,
      tiles.lookup(spec.biome),
      spec.locked ? null : tiles.glows,
    );
    let litMesh: THREE.Mesh | null = null;
    const meshes: THREE.Mesh[] = [];
    if (parts.lit) {
      geometries.push(parts.lit);
      litMesh = new THREE.Mesh(parts.lit, lit);
      meshes.push(litMesh);
      group.add(litMesh);
    }
    if (parts.glow) {
      geometries.push(parts.glow);
      const mesh = new THREE.Mesh(parts.glow, glow);
      meshes.push(mesh);
      group.add(mesh);
    }
    root.add(group);
    islands.set(spec.biome, { group, litMesh, meshes, place, lift: 0, wantLift: 0 });
    if (spec.locked) cover.push(...cloudCover(place, index, seed));
    const from = ISLAND_LINKS[spec.biome];
    if (from !== undefined) {
      stones.push(...steppingStones(ISLAND_LAYOUT[from], place, !spec.locked));
    }
  });
  if (cover.length > 0) {
    const g = boxesGeometry(cover, true);
    geometries.push(g);
    const mesh = new THREE.Mesh(g, cloud);
    mesh.name = "map-cloud-cover";
    // Drawn after the islands, so the islands show through the soft cloud edges.
    mesh.renderOrder = 2;
    root.add(mesh);
  }
  if (stones.length > 0) {
    const g = boxesGeometry(stones);
    geometries.push(g);
    const mesh = new THREE.Mesh(g, stone);
    mesh.name = "map-stones";
    root.add(mesh);
  }

  scene.add(root);
  stage.setEnvironment({ biome: "meadow", timeOfDay: "day" });
  stage.lights?.fitTo(archipelagoBox());

  const aspect = (): number => {
    const { width, height } = opts.viewport();
    return width > 0 && height > 0 ? width / height : OVERVIEW_ASPECT;
  };
  const poseFor = (biome: BiomeId | null): CameraPose =>
    biome === null ? overviewPose(aspect()) : islandPose(ISLAND_LAYOUT[biome], aspect());

  // Frames: subscribed only while something moves.
  const listeners = new Set<() => void>();
  let off: (() => void) | null = null;
  let left: Ms = 0;
  let frames = 0;
  let disposed = false;

  const stepLifts = (dt: Ms): boolean => {
    let busy = false;
    const step = opts.reducedMotion() ? Infinity : (dt / LIFT_MS) * LIFT;
    for (const island of islands.values()) {
      if (island.lift === island.wantLift) continue;
      const d = island.wantLift - island.lift;
      island.lift = Math.abs(d) <= step ? island.wantLift : island.lift + Math.sign(d) * step;
      island.group.position.y = island.place.y + island.lift;
      if (island.lift !== island.wantLift) busy = true;
    }
    return busy;
  };

  const tick = (dt: Ms): void => {
    left -= dt;
    frames -= 1;
    const lifting = stepLifts(dt);
    for (const fn of listeners) fn();
    if (left <= 0 && frames <= 0 && !lifting) {
      off?.();
      off = null;
      left = 0;
    }
  };

  /** Keeps frames coming for `ms` of frame time and at least `minFrames` frames. */
  const run = (ms: Ms, minFrames = 1): void => {
    if (disposed) return;
    left = Math.max(left, ms);
    frames = Math.max(frames, minFrames);
    off ??= stage.onFrame(tick);
  };

  let shown: BiomeId | null = opts.start ?? null;

  const moveCamera = (ms: Ms): void => {
    const duration = opts.reducedMotion() ? 0 : ms;
    stage.camera.moveTo(poseFor(shown), { durationMs: duration });
    run(duration);
  };

  if (shown === null) {
    // Start a little farther out and higher, then settle onto the overview.
    const far = overviewPose(aspect());
    stage.camera.moveTo({ ...far, distance: far.distance * 1.12, pitch: far.pitch + rad(3) });
    moveCamera(OVERVIEW_MS);
  } else {
    moveCamera(0);
  }

  const point = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const box = new THREE.Box3();
  const mid = new THREE.Vector3();
  const half = new THREE.Vector3();
  const o = new THREE.Vector3();
  const d = new THREE.Vector3();

  /**
   * Where the ray first enters the ellipsoid that fills `b` (its distance along the ray), or null.
   * Scaling the box to a unit cube turns the ellipsoid into the unit sphere; the distance along
   * the ray stays the same.
   */
  const ellipsoidHit = (ray: THREE.Ray, b: THREE.Box3): number | null => {
    b.getCenter(mid);
    b.getSize(half).multiplyScalar(0.5);
    if (half.x <= 0 || half.y <= 0 || half.z <= 0) return null;
    o.copy(ray.origin).sub(mid).divide(half);
    d.copy(ray.direction).divide(half);
    const a = d.dot(d);
    const bq = 2 * o.dot(d);
    const c = o.dot(o) - 1;
    const disc = bq * bq - 4 * a * c;
    if (disc < 0) return null;
    const spread = Math.sqrt(disc);
    const near = (-bq - spread) / (2 * a);
    const far = (-bq + spread) / (2 * a);
    if (far < 0) return null;
    return Math.max(0, near);
  };
  let hovered: BiomeId | null = null;

  /** Projects a world point to canvas pixels. */
  const toScreen = (width: number, height: number): ScreenPoint => {
    point.project(camera);
    return { x: (point.x * 0.5 + 0.5) * width, y: (1 - (point.y * 0.5 + 0.5)) * height };
  };

  return {
    root,
    show(biome, showOpts) {
      if (disposed) return;
      const zooming = biome !== null || shown !== null;
      shown = biome;
      moveCamera(showOpts?.snap === true ? 0 : zooming ? ZOOM_MS : OVERVIEW_MS);
    },
    get shown() {
      return shown;
    },
    select(biome) {
      if (disposed) return;
      for (const [id, island] of islands) island.wantLift = id === biome ? LIFT : 0;
      run(opts.reducedMotion() ? 0 : LIFT_MS);
    },
    anchors() {
      const { width, height } = opts.viewport();
      const out = new Map<BiomeId, ScreenPoint>();
      for (const [id, island] of islands) {
        // Just above the lowest point of the island's underside: the label overlaps the tip.
        point.set(island.place.x, island.place.y - (ISLAND_GROUND_Y - 0.5), island.place.z);
        out.set(id, toScreen(width, height));
      }
      return out;
    },
    centers() {
      const { width, height } = opts.viewport();
      const out = new Map<BiomeId, ScreenPoint>();
      root.updateMatrixWorld(true);
      for (const [id, island] of islands) {
        box.setFromObject(island.group);
        if (box.isEmpty()) continue;
        box.getCenter(point);
        out.set(id, toScreen(width, height));
      }
      return out;
    },
    pick(at) {
      if (disposed) return null;
      const { width, height } = opts.viewport();
      if (width <= 0 || height <= 0) return null;
      ndc.set((at.x / width) * 2 - 1, 1 - (at.y / height) * 2);
      camera.updateMatrixWorld();
      root.updateMatrixWorld(true);
      raycaster.setFromCamera(ndc, camera);
      let best: BiomeId | null = null;
      let nearest = Infinity;
      for (const [id, island] of islands) {
        for (const h of raycaster.intersectObjects(island.meshes, false)) {
          if (h.distance < nearest) {
            nearest = h.distance;
            best = id;
          }
        }
      }
      if (best !== null) return best;
      for (const [id, island] of islands) {
        box.setFromObject(island.group);
        if (box.isEmpty()) continue;
        const enter = ellipsoidHit(raycaster.ray, box);
        if (enter !== null && enter < nearest) {
          nearest = enter;
          best = id;
        }
      }
      return best;
    },
    hover(biome) {
      if (disposed || biome === hovered) return;
      hovered = biome;
      for (const [id, island] of islands) {
        if (island.litMesh !== null) island.litMesh.material = id === biome ? litHover : lit;
      }
      stage.requestRender();
    },
    onMove(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    refresh() {
      if (disposed) return;
      // The scene resizes its buffer from a ResizeObserver, which may run after this call, so
      // keep two frames coming: the second one is sure to have the new aspect ratio.
      stage.camera.moveTo(poseFor(shown));
      run(0, 2);
    },
    get moving() {
      return off !== null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      off?.();
      off = null;
      listeners.clear();
      scene.remove(root);
      for (const g of geometries) g.dispose();
      for (const m of [lit, litHover, glow, cloud, stone]) m.dispose();
      texture.dispose();
      stage.requestRender();
    },
  };
}
