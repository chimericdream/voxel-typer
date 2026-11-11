// "Hello voxel" (M0-04): a spinning cube with a seeded 16×16 procedural texture.
// Throwaway: M2-10 replaces main.ts and this file goes with it.
import {
  BoxGeometry,
  Color,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";

const TEXELS = 16;
const SKY = 0x87ceeb;
// Two tones of grass green, far enough apart that texel edges are sharp at any face tint.
const LIGHT: readonly [number, number, number] = [124, 201, 90];
const DARK: readonly [number, number, number] = [59, 122, 40];
// Per-face tint (+x, -x, +y, -y, +z, -z) so the cube reads as 3D without lights.
const FACE_TINTS = [0.8, 0.8, 1, 0.6, 0.9, 0.9];
// Pose used under ?freeze=1: three faces visible.
const FROZEN_X = 0.55;
const FROZEN_Y = 0.75;

/** mulberry32: tiny seeded PRNG, enough for this demo (the real one is M1-02). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintTexture(seed: number): DataTexture {
  const rand = mulberry32(seed);
  const data = new Uint8Array(TEXELS * TEXELS * 4);
  for (let i = 0; i < TEXELS * TEXELS; i++) {
    const [r, g, b] = rand() < 0.4 ? DARK : LIGHT;
    data.set([r, g, b, 255], i * 4);
  }
  const tex = new DataTexture(data, TEXELS, TEXELS);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function readSeed(params: URLSearchParams): number {
  const raw = params.get("seed");
  const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : Math.floor(Math.random() * 2 ** 32);
}

export function startHelloVoxel(app: HTMLElement, search: string): void {
  const params = new URLSearchParams(search);
  const frozen = params.get("freeze") === "1";
  const texture = paintTexture(readSeed(params));

  // No antialias, so silhouette edges stay hard too. preserveDrawingBuffer lets
  // the e2e test read the canvas pixels.
  const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  renderer.domElement.style.display = "block";
  app.append(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(SKY);
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 2.4;

  const materials = FACE_TINTS.map(
    (k) => new MeshBasicMaterial({ map: texture, color: new Color(k, k, k) }),
  );
  const cube = new Mesh(new BoxGeometry(1, 1, 1), materials);
  cube.rotation.set(FROZEN_X, FROZEN_Y, 0);
  scene.add(cube);

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", () => {
    resize();
    renderer.render(scene, camera);
  });

  let first = true;
  const frame = (ms: number): void => {
    if (!frozen) {
      cube.rotation.x = FROZEN_X + ms * 0.0004;
      cube.rotation.y = FROZEN_Y + ms * 0.0007;
    }
    renderer.render(scene, camera);
    if (first) {
      first = false;
      // Mark ready one frame later, once the first render has been presented.
      requestAnimationFrame(() => {
        app.dataset["ready"] = "1";
      });
    }
    if (!frozen) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
