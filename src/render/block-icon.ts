/**
 * Isometric block icons (task M4-09): one block as a little cube seen from above at a corner, its
 * top and two sides textured from the block atlas, drawn once into an off-screen render target of
 * the app's one renderer and read back as a PNG data URL for an `<img>`.
 *
 * Like the avatar snapshots (`./avatar.ts`), this never makes a renderer of its own (decision 73).
 * It borrows the shared one between frames, synchronously, and puts back everything it changed
 * (render target, clear color and alpha, auto-clear). Callers cache the result: each block is
 * drawn once per session.
 *
 * The atlas is built here with the base palette and the world's default seed, so an icon looks
 * the same whichever island's palette the 3D scene has loaded. Each face gets a fixed shade (top
 * brightest, the left side a little darker, the right side darker again) from one light along
 * each axis, as `portraitLights` does for the avatar. A sprig (a flower) has no cube: the caller
 * shows its flat tile instead ({@link drawsAsCube}).
 */
import * as THREE from "three";
import type { BlockDef } from "@/content/blocks/types";
import { buildAtlas } from "./atlas/build";
import type { Atlas } from "./atlas/build";
import { BASE_PALETTE } from "./atlas/palettes";
import { SUPERSAMPLE, downsampleToSrgb } from "./avatar";

/** The world's default seed (`main.ts`), so icon tiles match the blocks in the world. */
export const ICON_SEED = 1;

/** The shade of each cube face the camera sees, and of the three it doesn't. */
export const ICON_SHADE: readonly { dir: readonly [number, number, number]; shade: number }[] = [
  { dir: [0, 1, 0], shade: 1 },
  { dir: [0, 0, 1], shade: 0.82 },
  { dir: [1, 0, 0], shade: 0.64 },
  { dir: [-1, 0, 0], shade: 0.64 },
  { dir: [0, 0, -1], shade: 0.82 },
  { dir: [0, -1, 0], shade: 0.5 },
];

/** True when the block draws as a cube icon; a sprig shows its flat tile. */
export function drawsAsCube(def: Pick<BlockDef, "shape">): boolean {
  return def.shape !== "sprig";
}

let atlasPromise: Promise<Atlas> | null = null;

/** The icon atlas, built once. A failed build is forgotten, so a later call tries again. */
export function iconAtlas(blocks: readonly BlockDef[]): Promise<Atlas> {
  if (atlasPromise) return atlasPromise;
  const p = buildAtlas(blocks, BASE_PALETTE, ICON_SEED);
  atlasPromise = p;
  p.catch(() => {
    if (atlasPromise === p) atlasPromise = null;
  });
  return p;
}

/** BoxGeometry's face groups, in order: +x, −x, +y, −y, +z, −z. */
const FACE_OF_GROUP = ["side", "side", "top", "bottom", "side", "side"] as const;

/**
 * A unit cube whose faces show the block's atlas tiles. Each BoxGeometry face's 0–1 UVs are
 * mapped into its tile's rectangle (`atlas.uv`), so the cube needs only the one atlas texture.
 */
export function blockCube(def: Pick<BlockDef, "num">, atlas: Atlas): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const uv = geo.getAttribute("uv");
  // Four vertices per face, in group order.
  FACE_OF_GROUP.forEach((face, g) => {
    const [u0, v0, u1, v1] = atlas.uv(def.num, face);
    for (let k = 0; k < 4; k++) {
      const i = g * 4 + k;
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
  });
  uv.needsUpdate = true;
  return geo;
}

/** One directional light per axis: a face lit head-on shows its color times its shade. */
function iconLights(): THREE.DirectionalLight[] {
  return ICON_SHADE.map(({ dir, shade }) => {
    const light = new THREE.DirectionalLight(0xffffff, Math.PI * shade);
    light.position.set(dir[0], dir[1], dir[2]);
    light.target.position.set(0, 0, 0);
    return light;
  });
}

/** The scene an icon draws: the cube at the origin, the lights and an isometric camera. */
export function iconScene(
  def: Pick<BlockDef, "num" | "tags">,
  atlas: Atlas,
): { scene: THREE.Scene; camera: THREE.OrthographicCamera; dispose: () => void } {
  const geo = blockCube(def, atlas);
  const see = def.tags.includes("transparent");
  const material = new THREE.MeshLambertMaterial({
    map: atlas.texture,
    transparent: see,
    alphaTest: see ? 0.02 : 0.5,
    side: see ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: !see,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geo, material), ...iconLights());
  // True isometric: the camera on the (1, 1, 1) diagonal. A unit cube seen this way is √2 wide
  // and about 1.63 tall (√3·cos), so ±0.9 frames it with a small margin.
  const r = 0.9;
  const camera = new THREE.OrthographicCamera(-r, r, r, -r, 0.1, 10);
  camera.position.set(2, 2, 2);
  camera.lookAt(0, 0, 0);
  return {
    scene,
    camera,
    dispose: () => {
      geo.dispose();
      material.dispose();
    },
  };
}

/**
 * Draws the block's icon into a square off-screen target of `renderer` and returns its pixels
 * (sRGB, straight alpha, top row first), or null if the context is lost. Synchronous: call it
 * between frames, never from inside a render.
 */
export function renderBlockIconPixels(
  renderer: THREE.WebGLRenderer,
  def: Pick<BlockDef, "num" | "tags">,
  atlas: Atlas,
  px: number,
): Uint8ClampedArray<ArrayBuffer> | null {
  if (renderer.getContext().isContextLost()) return null;
  const size = Math.max(1, Math.round(px));
  const big = size * SUPERSAMPLE;
  const target = new THREE.WebGLRenderTarget(big, big, {
    depthBuffer: true,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  const { scene, camera, dispose } = iconScene(def, atlas);
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
    dispose();
    target.dispose();
  }
  return downsampleToSrgb(buf, size, SUPERSAMPLE);
}

/** {@link renderBlockIconPixels} as a PNG data URL, or null if it can't be drawn. */
export function blockIconDataUrl(
  renderer: THREE.WebGLRenderer,
  def: Pick<BlockDef, "num" | "tags">,
  atlas: Atlas,
  px: number,
): string | null {
  const pixels = renderBlockIconPixels(renderer, def, atlas, px);
  if (pixels === null) return null;
  const size = Math.max(1, Math.round(px));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  ctx.putImageData(new ImageData(pixels, size, size), 0, 0);
  return canvas.toDataURL("image/png");
}
