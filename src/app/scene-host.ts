/**
 * The app's one canvas and renderer (task M2-10).
 *
 * The scene is made the first time play needs it and reused for every later lesson. It is
 * disposed only on app teardown, because `SceneCore.dispose()` releases the WebGL context
 * (`forceContextLoss`). Between lessons the canvas is hidden and the scene idles: with no frame
 * subscriber, no drift and no tween, the render loop requests no frames.
 *
 * The render core is loaded with a dynamic import, so three.js stays out of the initial bundle.
 */
import type * as THREE from "three";
import type { Clock } from "@/app/clock";
import { createRng } from "@/engine/rng";
import type { CameraPose } from "@/render/camera";
import type { SceneCore } from "@/render/scene";
import type { CameraRig, SceneHandle } from "@/render/types";
import type { Ms, QualityLevel } from "@/types/core";

/**
 * World y of the top of the highest solid block at or below `at` in its column. Without a
 * diorama, or over a bottomless column, the bottom of `at`'s own cell (the effects' default).
 */
export function groundUnder(
  grid: { get(x: number, y: number, z: number): number } | null,
  at: { x: number; y: number; z: number },
): number {
  const fallback = at.y - 0.5;
  if (grid === null) return fallback;
  const x = Math.floor(at.x);
  const z = Math.floor(at.z);
  for (let y = Math.floor(at.y); y >= 0; y--) {
    if (grid.get(x, y, z) !== 0) return y + 1;
  }
  return fallback;
}

/**
 * What the host needs from a scene: the contract handle plus ownership and drift. M2-01's
 * {@link SceneCore} fits it; tests pass a small fake.
 */
export interface AppScene extends SceneHandle {
  readonly camera: CameraRig & {
    setDrift(on: boolean): void;
    /** Glides to a free pose (the world map frames its own islands, M3-04). */
    moveTo(to: Readonly<CameraPose>, opts?: { durationMs?: Ms }): void;
  };
  /** Aims the sun, and with it the sky's clouds and fog, at a box (M3-04). Fakes may omit it. */
  readonly lights?: { fitTo(box: THREE.Box3): void };
  renderStats(): { calls: number };
  dispose(): void;
}

// Compile-time check that the real render core still fits.
const fitsRenderCore = (s: SceneCore): AppScene => s;
void fitsRenderCore;

export interface AppSceneOptions {
  seed: number;
  quality: QualityLevel;
  reducedMotion: () => boolean;
  /** `fixedStepClock` under `?freeze`, else the real clock. */
  clock: Clock;
  /** `?freeze`: sky pinned and still, no water wobble, effects seeded from `seed`. */
  frozen?: boolean;
}

export type SceneFactory = (canvas: HTMLCanvasElement, opts: AppSceneOptions) => Promise<AppScene>;

/** The real factory: the M2-01 render core, loaded on first use. */
export const renderCoreFactory: SceneFactory = async (canvas, opts) => {
  const [{ createSceneHandle }, { blocks }, { createSkyEnvironment }, { createFx }] =
    await Promise.all([
      import("@/render/scene"),
      import("@/content/blocks"),
      import("@/render/sky"),
      import("@/render/fx"),
    ]);
  const frozen = opts.frozen ?? false;
  // One switch for all ambient motion: play-host turns the camera's drift on only during live play,
  // and the clouds read it every frame, so the loop idles in menus, on pause and under `?freeze`.
  // The camera wakes the loop when drift turns on, and the sky's next frame sees it (M2-13 N8).
  let rig: { readonly drifting: boolean } | null = null;
  const skyFactory = createSkyEnvironment({ frozen, drift: () => rig?.drifting ?? false });
  const core: SceneCore = createSceneHandle(canvas, {
    blocks,
    seed: opts.seed,
    quality: opts.quality,
    reducedMotion: opts.reducedMotion,
    clock: opts.clock,
    waterMotion: !frozen,
    createEnvironment: skyFactory,
    createFx: (ctx) =>
      createFx(ctx, {
        rng: createRng(opts.seed).fork("fx"),
        // Chips land on the ground under the burst, not on the bottom of a floating block's cell.
        groundY: (at) => groundUnder(core.grid(), at),
      }),
  });
  rig = core.camera;
  return core;
};

export interface SceneHost {
  /** The shared canvas. The app mounts it once and shows it only during play. */
  readonly canvas: HTMLCanvasElement;
  /** The scene, made on the first call. Every later call returns the same one. */
  acquire(): Promise<AppScene>;
  /** The scene if it exists yet. */
  current(): AppScene | null;
  /** App teardown only: frees the scene and its GL context. */
  dispose(): void;
}

export function createSceneHost(
  canvas: HTMLCanvasElement,
  factory: SceneFactory,
  opts: AppSceneOptions,
): SceneHost {
  let pending: Promise<AppScene> | null = null;
  let scene: AppScene | null = null;
  let disposed = false;
  return {
    canvas,
    acquire() {
      if (disposed) return Promise.reject(new Error("scene host is disposed"));
      pending ??= factory(canvas, opts).then((s) => {
        if (disposed) {
          s.dispose();
          throw new Error("scene host is disposed");
        }
        scene = s;
        return s;
      });
      // A failed start (no WebGL, say) may be retried by the next lesson.
      pending.catch(() => {
        if (scene === null) pending = null;
      });
      return pending;
    },
    current: () => scene,
    dispose() {
      if (disposed) return;
      disposed = true;
      scene?.dispose();
      scene = null;
    },
  };
}
