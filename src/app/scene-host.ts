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
import type { Clock } from "@/app/clock";
import type { SceneCore } from "@/render/scene";
import type { CameraRig, SceneHandle } from "@/render/types";
import type { QualityLevel } from "@/types/core";

/**
 * What the host needs from a scene: the contract handle plus ownership and drift. M2-01's
 * {@link SceneCore} fits it; tests pass a small fake.
 */
export interface AppScene extends SceneHandle {
  readonly camera: CameraRig & { setDrift(on: boolean): void };
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
}

export type SceneFactory = (canvas: HTMLCanvasElement, opts: AppSceneOptions) => Promise<AppScene>;

/** The real factory: the M2-01 render core, loaded on first use. */
export const renderCoreFactory: SceneFactory = async (canvas, opts) => {
  const [{ createSceneHandle }, { blocks }] = await Promise.all([
    import("@/render/scene"),
    import("@/content/blocks"),
  ]);
  // Drift stays off (the default); play-host turns it on only during live play.
  return createSceneHandle(canvas, { blocks, ...opts });
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
