/**
 * Render core (task M2-01, contracts.md §8, PLAN.md §5.1 and §6.4).
 *
 * `createSceneHandle(canvas, opts)` makes the one WebGL2 renderer the app uses and returns a
 * {@link SceneCore}: the contract's {@link SceneHandle} plus what the app needs to own it
 * (`dispose`, `renderStats`, `resize`, voxel edits).
 *
 * Look: `antialias: false` and `NearestFilter` textures for hard pixel edges, sRGB output, and
 * **no tone mapping** (`NoToneMapping`) so palette colors stay flat and saturated. Voxel AO comes
 * from the mesher's vertex colors, multiplied with the atlas by Lambert materials.
 *
 * Seams for later tasks, so they don't edit this file:
 * - `opts.createFx` (M2-05) supplies the real {@link FxApi}. The default only does hit-stop.
 * - `opts.createEnvironment` (M2-02) supplies sky, fog and per-biome lighting. The default sets a
 *   flat background and {@link DEFAULT_LIGHTING} per time of day.
 */
import * as THREE from "three";
import { realClock } from "@/app/clock";
import type { Clock } from "@/app/clock";
import type { BlockDef } from "@/content/blocks/types";
import type { BiomeId, Ms, QualityLevel, TimeOfDay } from "@/types/core";
import { buildAtlas } from "./atlas/build";
import type { Atlas } from "./atlas/build";
import { paletteFor } from "./atlas/palettes";
import { createCameraRig } from "./camera";
import type { CameraRigCore } from "./camera";
import { createChunkStore } from "./chunks";
import type { Bucket, ChunkStore, Mesher } from "./chunks";
import { DEFAULT_LIGHTING, createLightRig } from "./lights";
import type { LampSource, LightRig } from "./lights";
import { createLoop } from "./loop";
import type { RenderLoop, SystemFn } from "./loop";
import type { VoxelGrid } from "./mesher/voxel-grid";
import { QUALITY_PRESETS, pixelRatioFor } from "./quality";
import type { FxApi, SceneHandle, Vec3 } from "./types";

/** What an environment controller can reach (M2-02). */
export interface EnvironmentContext {
  scene: THREE.Scene;
  lights: LightRig;
  wake(): void;
  reducedMotion(): boolean;
}

/** Sky, fog and lighting for a biome and time of day. */
export interface EnvironmentController {
  set(env: { biome: BiomeId; timeOfDay: TimeOfDay; t01?: number }): void;
  /** Per-frame update (sky lerps, clouds). Returns true while it needs frames. */
  system?: SystemFn;
  dispose(): void;
}

/** What an effects module can reach (M2-05). */
export interface FxContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  loop: RenderLoop;
  cameraRig: CameraRigCore;
  reducedMotion(): boolean;
  /** The current block atlas, or null before the first diorama loads. */
  atlas(): Atlas | null;
}

export type FxModule = FxApi & { dispose?(): void };

export interface SceneOptions {
  /** Block definitions for the atlas and for `light`/`transparent` tags. */
  blocks: readonly BlockDef[];
  /** Atlas seed. */
  seed: number;
  quality?: QualityLevel;
  /** Read on every use. The app resolves `Settings.reducedMotion` ('system' → media query). */
  reducedMotion?: () => boolean;
  /** Read once per frame by the loop. `fixedStepClock` under `?freeze`. */
  clock?: Clock;
  /** Ambient camera drift. Default true; `?freeze` passes false. Reduced motion always stops it. */
  ambientMotion?: boolean;
  /** Keep the drawing buffer so tests can read pixels back. Default false. */
  preserveDrawingBuffer?: boolean;
  devicePixelRatio?: number;
  createFx?: (ctx: FxContext) => FxModule;
  createEnvironment?: (ctx: EnvironmentContext) => EnvironmentController;
  /** Test seam: count or replace meshing. */
  mesher?: Mesher;
}

/** Renderer counters for `__vt` (M2-10 wires the getter) and the dispose check. */
export interface RenderStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

export interface SceneCore extends SceneHandle {
  readonly three: {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
  };
  readonly lite: null;
  readonly camera: CameraRigCore;
  readonly loop: RenderLoop;
  readonly lights: LightRig;
  /** The current diorama's chunks, or null. */
  chunks(): ChunkStore | null;
  /** The current diorama's grid, or null. */
  grid(): VoxelGrid | null;
  atlas(): Atlas | null;
  /** Sets a voxel of the current diorama and rebuilds the touched chunk(s) next frame. */
  setVoxel(x: number, y: number, z: number, blockNum: number): void;
  /** Rebuild the chunk(s) reading this cell next frame (after editing the grid directly). */
  markDirty(x: number, y: number, z: number): void;
  /** Resizes the drawing buffer (CSS pixels). Called automatically by a ResizeObserver. */
  resize(width: number, height: number): void;
  renderStats(): RenderStats;
  /** Frees every geometry, material, texture and the GL context. The handle is dead after. */
  dispose(): void;
}

const LAMP_INTENSITY_SCALE = 3;
const DEFAULT_LAMP_COLOR = "#ffd58a";

/** The default environment: flat background color plus default lighting per time of day. */
function flatEnvironment(ctx: EnvironmentContext): EnvironmentController {
  const background = new THREE.Color();
  ctx.scene.background = background;
  return {
    set({ timeOfDay }) {
      const state = DEFAULT_LIGHTING[timeOfDay];
      ctx.lights.apply(state);
      background.set(state.background);
      ctx.wake();
    },
    dispose() {
      ctx.scene.background = null;
    },
  };
}

export function createSceneHandle(canvas: HTMLCanvasElement, opts: SceneOptions): SceneCore {
  const clock = opts.clock ?? realClock;
  const reducedMotion = opts.reducedMotion ?? (() => false);
  let quality: QualityLevel = opts.quality ?? "medium";
  let preset = QUALITY_PRESETS[quality];
  const dpr = (): number => opts.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "default",
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  renderer.shadowMap.enabled = preset.shadows;
  renderer.setPixelRatio(pixelRatioFor(quality, dpr()));

  const scene = new THREE.Scene();
  scene.name = "voxel-typer";
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 500);

  // Materials are shared by every chunk; the atlas map arrives with the first diorama.
  const materials: Record<Bucket, THREE.MeshLambertMaterial | THREE.MeshBasicMaterial> = {
    opaque: new THREE.MeshLambertMaterial({ vertexColors: true, alphaTest: 0.5 }),
    transparent: new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, alphaTest: 0.5 }),
  };
  materials.opaque.name = "voxel-opaque";
  materials.transparent.name = "voxel-transparent";
  materials.glow.name = "voxel-glow";

  const byNum = new Map<number, BlockDef>();
  for (const b of opts.blocks) byNum.set(b.num, b);
  const bucketOf = (num: number): Bucket => {
    const tags = byNum.get(num)?.tags;
    if (tags?.includes("light")) return "glow";
    if (tags?.includes("transparent")) return "transparent";
    return "opaque";
  };

  let chunks: ChunkStore | null = null;
  let grid: VoxelGrid | null = null;
  let biome: BiomeId = "meadow";
  let atlas: Atlas | null = null;
  let atlasBiome: BiomeId | null = null;
  let atlasPending: Promise<Atlas> | null = null;
  let pendingBiome: BiomeId | null = null;
  let disposed = false;

  const loop = createLoop({
    raf: (cb) => requestAnimationFrame(cb),
    caf: (id) => cancelAnimationFrame(id),
    now: () => clock.now(),
    render: () => {
      chunks?.flush();
      renderer.render(scene, camera);
    },
  });

  const cameraRig = createCameraRig(camera, {
    reducedMotion,
    drift: opts.ambientMotion ?? true,
    wake: () => loop.wake(),
  });
  loop.addSystem(cameraRig.system);

  const lights = createLightRig(scene, preset);
  const env = (opts.createEnvironment ?? flatEnvironment)({
    scene,
    lights,
    wake: () => loop.wake(),
    reducedMotion,
  });
  if (env.system) loop.addSystem(env.system);
  env.set({ biome, timeOfDay: "day" });

  /** Swaps in a freshly built atlas, disposing the old texture. */
  const useAtlas = (next: Atlas, forBiome: BiomeId): void => {
    const old = atlas;
    atlas = next;
    atlasBiome = forBiome;
    for (const m of Object.values(materials)) {
      m.map = next.texture;
      m.needsUpdate = true;
    }
    if (old && old.texture !== next.texture) old.texture.dispose();
    if (chunks) {
      chunks.setAtlas(next);
      chunks.markAllDirty();
    }
    loop.requestRender();
  };

  /** Resolves with the atlas for the current biome, building it if needed. */
  const ensureAtlas = async (): Promise<Atlas> => {
    while (true) {
      if (atlas && atlasBiome === biome) return atlas;
      if (!atlasPending || pendingBiome !== biome) {
        const want = biome;
        pendingBiome = want;
        const promise = buildAtlas(opts.blocks, paletteFor(want), opts.seed);
        atlasPending = promise;
        const settle = (): void => {
          if (atlasPending === promise) {
            atlasPending = null;
            pendingBiome = null;
          }
        };
        promise.then((built) => {
          settle();
          // Too late (disposed, or the biome moved on): free it.
          if (disposed || want !== biome) built.texture.dispose();
          else useAtlas(built, want);
        }, settle);
      }
      await atlasPending;
      if (disposed) throw new Error("scene disposed");
    }
  };

  const fxCtx: FxContext = {
    scene,
    camera,
    renderer,
    canvas,
    loop,
    cameraRig,
    reducedMotion,
    atlas: () => atlas,
  };
  const fx: FxModule = opts.createFx?.(fxCtx) ?? {
    burst() {},
    hitStop(ms: Ms) {
      if (!reducedMotion()) loop.hitStop(ms);
    },
    floatText() {},
  };

  const resize = (width: number, height: number): void => {
    if (!(width > 0 && height > 0)) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    loop.requestRender();
  };
  resize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);
  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
          const box = entries[0]?.contentRect;
          if (box) resize(box.width, box.height);
        });
  observer?.observe(canvas);

  const lampSources = (g: VoxelGrid): LampSource[] => {
    const lamps = new Map<number, { color: string; intensity: number }>();
    for (const b of opts.blocks) {
      if (b.tags.includes("light")) {
        lamps.set(b.num, {
          color: b.light?.color ?? DEFAULT_LAMP_COLOR,
          intensity: (b.light?.intensity ?? 1) * LAMP_INTENSITY_SCALE,
        });
      }
    }
    const out: LampSource[] = [];
    if (lamps.size === 0) return out;
    const { sx, sz, data } = g;
    for (let i = 0; i < data.length; i++) {
      const lamp = lamps.get(data[i] ?? 0);
      if (!lamp) continue;
      const x = i % sx;
      const z = Math.floor(i / sx) % sz;
      const y = Math.floor(i / (sx * sz));
      out.push({ at: { x, y, z }, ...lamp });
    }
    return out;
  };

  const clearDiorama = (): void => {
    if (chunks) {
      scene.remove(chunks.group);
      chunks.dispose();
    }
    chunks = null;
    grid = null;
    lights.setLamps([], { x: 0, y: 0, z: 0 });
    loop.requestRender();
  };

  const handle: SceneCore = {
    three: { scene, camera, renderer },
    lite: null,
    camera: cameraRig,
    fx,
    loop,
    lights,
    setEnvironment(next) {
      const changed = next.biome !== biome;
      biome = next.biome;
      env.set(next);
      if (changed && chunks) void ensureAtlas().catch(() => {});
      loop.requestRender();
    },
    async loadDiorama(_id, g) {
      const a = await ensureAtlas();
      if (disposed) return;
      clearDiorama();
      grid = g;
      chunks = createChunkStore({
        grid: g,
        atlas: a,
        materials,
        bucketOf,
        ao: true,
        shadows: preset.shadows,
        onDirty: () => loop.requestRender(),
        ...(opts.mesher && { mesher: opts.mesher }),
      });
      chunks.flush();
      scene.add(chunks.group);
      const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(g.sx, g.sy, g.sz));
      lights.fitTo(box);
      cameraRig.setBounds(box);
      const focus = cameraRig.pose().target;
      lights.setLamps(lampSources(g), focus);
      loop.requestRender();
    },
    clearDiorama,
    requestRender: () => loop.requestRender(),
    setQuality(q) {
      quality = q;
      preset = QUALITY_PRESETS[q];
      renderer.setPixelRatio(pixelRatioFor(q, dpr()));
      if (renderer.shadowMap.enabled !== preset.shadows) {
        renderer.shadowMap.enabled = preset.shadows;
        for (const m of Object.values(materials)) m.needsUpdate = true;
      }
      lights.setQuality(preset);
      chunks?.setShadows(preset.shadows);
      loop.requestRender();
    },
    onFrame: (fn) => loop.onFrame(fn),
    chunks: () => chunks,
    grid: () => grid,
    atlas: () => atlas,
    setVoxel(x, y, z, blockNum) {
      if (!grid || !chunks) return;
      grid.set(x, y, z, blockNum);
      chunks.markDirty(x, y, z);
    },
    markDirty(x, y, z) {
      chunks?.markDirty(x, y, z);
    },
    resize,
    renderStats() {
      const { render, memory, programs } = renderer.info;
      return {
        calls: render.calls,
        triangles: render.triangles,
        geometries: memory.geometries,
        textures: memory.textures,
        programs: programs?.length ?? 0,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loop.dispose();
      observer?.disconnect();
      clearDiorama();
      fx.dispose?.();
      env.dispose();
      lights.dispose();
      for (const m of Object.values(materials)) m.dispose();
      atlas?.texture.dispose();
      atlas = null;
      renderer.dispose();
    },
  };
  return handle;
}

/** Center of a block cell, for camera targets and effects. */
export const cellCenter = (x: number, y: number, z: number): Vec3 => ({
  x: x + 0.5,
  y: y + 0.5,
  z: z + 0.5,
});
