/**
 * 9-slice bevels for the UI kit (PLAN.md §5.1; task M2-07).
 *
 * A bevel is a tiny pixel-art frame: a 7×7 grid of "art pixels" with a 1-pixel outline (corners
 * notched out), a 1-pixel bevel ring (light top/left and dark bottom/right when raised, swapped when
 * sunk in) and a flat face. It is painted at `BEVEL_SCALE` screen pixels per art pixel onto a small
 * canvas and returned as a PNG data URI for CSS `border-image` (slice `BEVEL_SLICE_PX`, `fill`).
 * Painting at the final size keeps the edges crisp without relying on image smoothing settings.
 *
 * Images are made once per spec and cached for the life of the page.
 */

/** `raised`: buttons and panels. `pressed`: a raised surface pushed in. `inset`: slots and tracks. */
export type BevelKind = "raised" | "pressed" | "inset";

export interface BevelSpec {
  kind: BevelKind;
  /** Hex colors, `#rrggbb`. */
  outline: string;
  shadow: string;
  face: string;
  highlight: string;
}

/** Art pixels per side. */
export const BEVEL_ART = 7;
/** Art pixels in each corner slice (outline + bevel ring + one face pixel). */
export const BEVEL_SLICE_ART = 3;
/** Screen pixels per art pixel. Matches `--bevel-unit` in tokens.css. */
export const BEVEL_SCALE = 3;
/** The `border-image-slice` and border width, in pixels. Matches `--bevel-w` in tokens.css. */
export const BEVEL_SLICE_PX = BEVEL_SLICE_ART * BEVEL_SCALE;

type Rgba = readonly [number, number, number, number];
const CLEAR: Rgba = [0, 0, 0, 0];

function hex(color: string): Rgba {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m?.[1]) throw new Error(`bevel colors must be #rrggbb, got ${color}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/** The color of art pixel (x, y). */
function artPixel(spec: BevelSpec, x: number, y: number): Rgba {
  const last = BEVEL_ART - 1;
  const ring = Math.min(x, y, last - x, last - y);
  if (ring === 0) {
    const corner = (x === 0 || x === last) && (y === 0 || y === last);
    return corner ? CLEAR : hex(spec.outline);
  }
  if (ring === 1) {
    const topLeft = (y === 1 && x < last - 1) || (x === 1 && y < last - 1);
    const bottomRight = (y === last - 1 && x > 1) || (x === last - 1 && y > 1);
    // The two corners where light meets shadow take the face color.
    if (topLeft === bottomRight) return hex(spec.face);
    if (spec.kind === "raised") return hex(topLeft ? spec.highlight : spec.shadow);
    if (spec.kind === "pressed") return hex(topLeft ? spec.shadow : spec.face);
    return hex(topLeft ? spec.shadow : spec.highlight);
  }
  return hex(spec.face);
}

/** The bevel's RGBA pixels at `scale` screen pixels per art pixel (row-major, top-left first). */
export function bevelPixels(spec: BevelSpec, scale = BEVEL_SCALE): Uint8ClampedArray<ArrayBuffer> {
  const size = BEVEL_ART * scale;
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out.set(artPixel(spec, Math.floor(x / scale), Math.floor(y / scale)), (y * size + x) * 4);
    }
  }
  return out;
}

/** What `bevelDataUri` needs from a canvas, so tests can pass a fake one. */
export interface BevelCanvas {
  width: number;
  height: number;
  getContext(id: "2d"): Pick<CanvasRenderingContext2D, "putImageData"> | null;
  toDataURL(type: "image/png"): string;
}

const cache = new Map<string, string | null>();

function domCanvas(): BevelCanvas | null {
  return typeof document === "undefined" ? null : document.createElement("canvas");
}

/**
 * The bevel as a PNG data URI, or `null` where no 2D canvas exists. Cached per spec, so the
 * canvas work happens once per bevel per page load.
 */
export function bevelDataUri(
  spec: BevelSpec,
  makeCanvas: () => BevelCanvas | null = domCanvas,
): string | null {
  const key = `${spec.kind}|${spec.outline}|${spec.shadow}|${spec.face}|${spec.highlight}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const uri = paint(spec, makeCanvas());
  cache.set(key, uri);
  return uri;
}

function paint(spec: BevelSpec, canvas: BevelCanvas | null): string | null {
  if (!canvas) return null;
  const size = BEVEL_ART * BEVEL_SCALE;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof ImageData === "undefined") return null;
  ctx.putImageData(new ImageData(bevelPixels(spec), size, size), 0, 0);
  const uri = canvas.toDataURL("image/png");
  return uri.startsWith("data:image/png") ? uri : null;
}

/** Empties the cache (tests only). */
export function clearBevelCache(): void {
  cache.clear();
}
