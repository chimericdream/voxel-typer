/**
 * Still avatar snapshots (tasks M3-09, M3-FIX-5): the voxel avatar built by the model runtime
 * (`buildModel`, contracts.md §8.4), drawn once into an off-screen render target of the app's one
 * renderer, read back, and handed out as a PNG data URL for an `<img>`.
 *
 * There is one WebGL context for the whole app (decision 73), so this never makes a renderer of
 * its own. It borrows the shared one between frames, synchronously, and puts back everything it
 * changed (render target, clear color and alpha). Callers cache the result: a snapshot is drawn
 * once per look, never per frame.
 *
 * The snapshot scene has its own lights, one along each axis, so each box face gets a fixed shade
 * (top brightest, sides darker, as the world's blocks are lit) and the portrait doesn't depend on
 * the game scene's lights or sky. The render target stores linear color; the read-back converts
 * to sRGB and averages {@link SUPERSAMPLE}² samples per pixel for smooth edges.
 */
import * as THREE from "three";
import { buildModel } from "./models/build";
import { MODEL_UNIT } from "./models/rig";
import type { VoxelModel } from "./models/types";

/** Samples per pixel along each axis. */
export const SUPERSAMPLE = 3;

/** The shade of each box face, by the axis direction it faces. */
export const FACE_SHADE: readonly { dir: readonly [number, number, number]; shade: number }[] = [
  { dir: [1, 0, 0], shade: 0.8 },
  { dir: [-1, 0, 0], shade: 0.72 },
  { dir: [0, 1, 0], shade: 1 },
  { dir: [0, -1, 0], shade: 0.55 },
  { dir: [0, 0, 1], shade: 1 },
  { dir: [0, 0, -1], shade: 0.65 },
];

export interface SnapshotOptions {
  /** Width and height of the image, in pixels. */
  px: number;
  /** Replaces `color` values equal to a key (the skin token, say). */
  colors?: Readonly<Record<string, string>>;
  /** What to frame, in model pixels: the bottom and top y. Default: the whole model. */
  frameY?: readonly [number, number];
}

/** `model` with every part color that is a key of `colors` swapped for its value. */
export function withColors(
  model: Readonly<VoxelModel>,
  colors: Readonly<Record<string, string>> = {},
): VoxelModel {
  return {
    ...model,
    parts: model.parts.map((p) => {
      const color = p.color === undefined ? undefined : colors[p.color];
      return color === undefined ? p : { ...p, color };
    }),
  };
}

/**
 * One directional light per axis. A Lambert face lit head-on by a light of intensity `π · shade`
 * shows its color times `shade` exactly (three.js divides diffuse light by π), and a light along
 * one axis doesn't touch faces along the other two.
 */
export function portraitLights(): THREE.DirectionalLight[] {
  return FACE_SHADE.map(({ dir, shade }) => {
    const light = new THREE.DirectionalLight(0xffffff, Math.PI * shade);
    light.position.set(dir[0], dir[1], dir[2]);
    light.target.position.set(0, 0, 0);
    return light;
  });
}

/** Linear 0–1 to an sRGB byte. */
function toSrgbByte(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/**
 * Averages `ss`² samples per output pixel of a bottom-up linear RGBA buffer, flips it top-down
 * and converts it to sRGB with straight alpha. Exported for tests.
 */
export function downsampleToSrgb(
  src: Uint8Array,
  px: number,
  ss: number,
): Uint8ClampedArray<ArrayBuffer> {
  const big = px * ss;
  const out = new Uint8ClampedArray(px * px * 4);
  const n = ss * ss;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        const row = (px - 1 - y) * ss + sy;
        for (let sx = 0; sx < ss; sx++) {
          const i = (row * big + x * ss + sx) * 4;
          const alpha = (src[i + 3] ?? 0) / 255;
          // Weight by alpha so the transparent background doesn't darken the edges.
          r += ((src[i] ?? 0) / 255) * alpha;
          g += ((src[i + 1] ?? 0) / 255) * alpha;
          b += ((src[i + 2] ?? 0) / 255) * alpha;
          a += alpha;
        }
      }
      const o = (y * px + x) * 4;
      if (a > 0) {
        out[o] = toSrgbByte(r / a);
        out[o + 1] = toSrgbByte(g / a);
        out[o + 2] = toSrgbByte(b / a);
      }
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

/**
 * A camera that frames `y0`–`y1` (world units) above the model origin from a friendly
 * three-quarter angle.
 */
function frameCamera(y0: number, y1: number): THREE.PerspectiveCamera {
  const fov = 20;
  // A little room around the subject; the turn makes the box look wider than it is.
  const half = ((y1 - y0) / 2) * 1.2;
  const dist = half / Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const target = new THREE.Vector3(0, (y0 + y1) / 2, 0);
  const yaw = THREE.MathUtils.degToRad(28);
  const pitch = THREE.MathUtils.degToRad(12);
  const camera = new THREE.PerspectiveCamera(fov, 1, dist / 4, dist * 4);
  camera.position.set(
    target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    target.y + Math.sin(pitch) * dist,
    target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  camera.lookAt(target);
  return camera;
}

/** The scene a snapshot draws: the model at the origin in its rest pose, and the lights. */
export function snapshotScene(
  model: Readonly<VoxelModel>,
  opts: Pick<SnapshotOptions, "colors" | "frameY">,
): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; dispose: () => void } {
  const scene = new THREE.Scene();
  const handle = buildModel(withColors(model, opts.colors), null);
  scene.add(handle.root, ...portraitLights());
  let y0: number;
  let y1: number;
  if (opts.frameY) {
    [y0, y1] = [opts.frameY[0] * MODEL_UNIT, opts.frameY[1] * MODEL_UNIT];
  } else {
    const box = new THREE.Box3().setFromObject(handle.root);
    [y0, y1] = [box.min.y, box.max.y];
  }
  return { scene, camera: frameCamera(y0, y1), dispose: () => handle.dispose() };
}

/**
 * Draws `model` into a square off-screen target of `renderer` and returns the pixels (sRGB,
 * straight alpha, top row first), or null if the context is lost. Synchronous: call it between
 * frames, never from inside a render.
 */
export function renderModelPixels(
  renderer: THREE.WebGLRenderer,
  model: Readonly<VoxelModel>,
  opts: SnapshotOptions,
): Uint8ClampedArray<ArrayBuffer> | null {
  if (renderer.getContext().isContextLost()) return null;
  const px = Math.max(1, Math.round(opts.px));
  const big = px * SUPERSAMPLE;
  const target = new THREE.WebGLRenderTarget(big, big, {
    depthBuffer: true,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  const before = {
    target: renderer.getRenderTarget(),
    color: renderer.getClearColor(new THREE.Color()),
    alpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
  };
  const buf = new Uint8Array(big * big * 4);
  // Built inside the `try`: `buildModel` can throw on a bad rig, and the target must still go.
  let dispose: (() => void) | null = null;
  try {
    const built = snapshotScene(model, opts);
    dispose = built.dispose;
    const { scene, camera } = built;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, big, big, buf);
  } finally {
    renderer.setRenderTarget(before.target);
    renderer.setClearColor(before.color, before.alpha);
    renderer.autoClear = before.autoClear;
    dispose?.();
    target.dispose();
  }
  return downsampleToSrgb(buf, px, SUPERSAMPLE);
}

/** {@link renderModelPixels} as a PNG data URL, or null if it can't be drawn. */
export function snapshotModel(
  renderer: THREE.WebGLRenderer,
  model: Readonly<VoxelModel>,
  opts: SnapshotOptions,
): string | null {
  const pixels = renderModelPixels(renderer, model, opts);
  if (pixels === null) return null;
  const px = Math.max(1, Math.round(opts.px));
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  ctx.putImageData(new ImageData(pixels, px, px), 0, 0);
  return canvas.toDataURL("image/png");
}
