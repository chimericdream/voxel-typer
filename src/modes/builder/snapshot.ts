/**
 * A picture of the Home Island (task M4-08, PLAN.md §3.2.4): Builder's `photo` command.
 *
 * The island is drawn once more from the current camera at {@link SNAPSHOT_SCALE}× the canvas's
 * size on screen, with Builder's cursor and ghost hidden, and saved as `my-island-<date>.png`. The
 * picture is made from the WebGL canvas only, so the HUD (`[data-builder="hud"]`, plain DOM) is
 * never in it. The file goes to the browser's downloads as a local Blob URL: nothing leaves the
 * device, ever.
 *
 * The renderer is put back exactly as it was (its pixel ratio, and so its drawing-buffer size), and
 * the caller asks for one more frame to draw the screen again.
 */
import * as THREE from "three";
import type { EpochMs } from "@/types/core";

/** The picture is this many times the canvas's size on screen (CSS pixels). */
export const SNAPSHOT_SCALE = 2;
/** Its longest side never goes past this, nor past the GPU's own limit. */
export const SNAPSHOT_MAX_SIDE = 4096;

/** What a snapshot needs from three.js. A `THREE.WebGLRenderer` and its scene and camera fit. */
export interface SnapshotTarget<S, C> {
  renderer: {
    readonly domElement: { toBlob(callback: BlobCallback, type?: string): void };
    readonly capabilities: { readonly maxTextureSize: number };
    getPixelRatio(): number;
    setPixelRatio(ratio: number): void;
    getSize(target: THREE.Vector2): THREE.Vector2;
    render(scene: S, camera: C): void;
  };
  scene: S;
  camera: C;
}

const two = (n: number): string => String(n).padStart(2, "0");

/** `my-island-2026-11-13.png`, from the device's local date. */
export function snapshotFileName(at: EpochMs): string {
  const d = new Date(at);
  return `my-island-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.png`;
}

/** The pixel ratio for the picture: {@link SNAPSHOT_SCALE}, smaller if the picture would be too big. */
export function snapshotRatio(width: number, height: number, maxTextureSize: number): number {
  const longest = Math.max(1, width, height);
  const cap = Math.min(SNAPSHOT_MAX_SIDE, maxTextureSize > 0 ? maxTextureSize : SNAPSHOT_MAX_SIDE);
  return Math.min(SNAPSHOT_SCALE, cap / longest);
}

/**
 * Draws the island once at the picture's size and returns it as a PNG. `hide` hides what must not
 * be in the picture and returns how to show it again. The renderer's pixel ratio is restored
 * before this returns, even when drawing throws.
 */
export function captureIsland<S, C>(
  target: SnapshotTarget<S, C>,
  hide: () => () => void = () => () => undefined,
): Promise<Blob | null> {
  const { renderer, scene, camera } = target;
  const before = renderer.getPixelRatio();
  const size = renderer.getSize(new THREE.Vector2());
  const show = hide();
  try {
    renderer.setPixelRatio(snapshotRatio(size.x, size.y, renderer.capabilities.maxTextureSize));
    renderer.render(scene, camera);
    // The canvas's pixels are copied when `toBlob` is called, in the same task as the draw, so the
    // picture is safe from the resize below even without `preserveDrawingBuffer`.
    return new Promise((resolve) => {
      renderer.domElement.toBlob(resolve, "image/png");
    });
  } finally {
    renderer.setPixelRatio(before);
    show();
  }
}

/** What saving a file needs from the page. Tests pass fakes. */
export interface SaveDeps {
  document: Pick<Document, "createElement" | "body">;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  later(fn: () => void, ms: number): void;
}

const browserDeps = (): SaveDeps => ({
  document,
  createObjectURL: (b) => URL.createObjectURL(b),
  revokeObjectURL: (u) => URL.revokeObjectURL(u),
  later: (fn, ms) => void setTimeout(fn, ms),
});

/** How long the Blob URL is kept after the download starts. */
const REVOKE_MS = 10_000;

/** Hands the browser a local file to save. No request leaves the device. */
export function saveFile(blob: Blob, name: string, deps: SaveDeps = browserDeps()): void {
  const url = deps.createObjectURL(blob);
  const a = deps.document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  deps.document.body.append(a);
  a.click();
  a.remove();
  deps.later(() => deps.revokeObjectURL(url), REVOKE_MS);
}
