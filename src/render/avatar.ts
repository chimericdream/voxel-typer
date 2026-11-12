/**
 * Still avatar snapshots (task M3-09): the voxel avatar drawn once into an off-screen render target
 * of the app's one renderer, read back, and handed out as a PNG data URL for an `<img>`.
 *
 * There is one WebGL context for the whole app (decision 73), so this never makes a renderer of
 * its own. It borrows the shared one between frames, synchronously, and puts back everything it
 * changed (render target, clear color and alpha). Callers cache the result: a snapshot is drawn
 * once per look, never per frame.
 *
 * The boxes use flat face shading baked into vertex colors (top brightest, sides darker, as the
 * world's blocks are lit), so the portrait doesn't depend on the scene's lights or sky. The render
 * target stores linear color; the read-back converts to sRGB and averages {@link SUPERSAMPLE}²
 * samples per pixel for smooth edges.
 */
import * as THREE from "three";
import type { VoxelModel } from "./models/types";

/** Samples per pixel along each axis. */
export const SUPERSAMPLE = 3;

/** Shading per box face, in BoxGeometry's group order: +x, −x, +y, −y, +z, −z. */
const FACE_SHADE = [0.8, 0.72, 1, 0.55, 1, 0.65] as const;

export interface SnapshotOptions {
  /** Width and height of the image, in pixels. */
  px: number;
  /** Replaces `color` values equal to a key (the skin token, say). */
  colors?: Readonly<Record<string, string>>;
  /** What to frame, in model units: the box min and max y. Default: the whole model. */
  frameY?: readonly [number, number];
}

/** Box meshes for a model's parts, in model space, sharing nothing with the scene. */
export function buildModelGroup(
  model: Readonly<VoxelModel>,
  colors: Readonly<Record<string, string>> = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = model.id;
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  const tint = new THREE.Color();
  for (const part of model.parts) {
    const [w, h, d] = part.size;
    const geo = new THREE.BoxGeometry(w, h, d);
    const hex = part.color === undefined ? "#ff00ff" : (colors[part.color] ?? part.color);
    tint.set(hex);
    const rgb = new Float32Array(24 * 3);
    for (let v = 0; v < 24; v++) {
      const shade = FACE_SHADE[Math.floor(v / 4)] ?? 1;
      rgb[v * 3] = tint.r * shade;
      rgb[v * 3 + 1] = tint.g * shade;
      rgb[v * 3 + 2] = tint.b * shade;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = part.name;
    const [x, y, z] = part.offset;
    mesh.position.set(x + w / 2, y + h / 2, z + d / 2);
    group.add(mesh);
  }
  return group;
}

/** Frees the geometry and material of {@link buildModelGroup}. */
export function disposeModelGroup(group: THREE.Group): void {
  const materials = new Set<THREE.Material>();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      if (o.geometry instanceof THREE.BufferGeometry) o.geometry.dispose();
      if (o.material instanceof THREE.Material) materials.add(o.material);
    }
  });
  for (const m of materials) m.dispose();
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

/** A camera that frames the model's y range from a friendly three-quarter angle. */
function frameCamera(model: Readonly<VoxelModel>, frameY?: readonly [number, number]) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of model.parts) {
    lo = Math.min(lo, p.offset[1]);
    hi = Math.max(hi, p.offset[1] + p.size[1]);
  }
  const [y0, y1] = frameY ?? [lo, hi];
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
  const scene = new THREE.Scene();
  const group = buildModelGroup(model, opts.colors);
  scene.add(group);
  const camera = frameCamera(model, opts.frameY);

  const before = {
    target: renderer.getRenderTarget(),
    color: renderer.getClearColor(new THREE.Color()),
    alpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
  };
  const buf = new Uint8Array(big * big * 4);
  try {
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
    disposeModelGroup(group);
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
