/**
 * Painters for texture recipes (docs/impl/contracts.md §8.3). Pure: `recipes.ts` is pure and calls
 * into this file. No DOM, no clock, no `Math.random()`: all randomness comes from the `Rng`.
 *
 * Every painter writes a fresh 16 × 16 × 4 RGBA `Uint8ClampedArray`, rows top to bottom. The
 * pixel-art look comes from quantizing seeded value noise to a palette ramp, plus 1-px darker
 * edges on planks and bricks. Every pattern here is original (CLAUDE.md, IP rule).
 *
 * The primitive painters (`paintNoise`, `paintPlanks`, …) back the built-in recipe kinds. Named
 * painters for `{ kind: 'custom' }` recipes are in {@link CUSTOM_PAINTERS}.
 */
import type { Rng } from "@/engine/rng";
import type { Palette, PaletteRampId } from "./recipes";

/** Tiles are square, this many pixels on a side. */
export const TILE_SIZE = 16;
const N = TILE_SIZE;

/** An sRGB color, 0–255 per channel. */
export type Rgb = readonly [r: number, g: number, b: number];

// ---------------------------------------------------------------------------------------------
// Colors and ramps

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parses `#rgb` or `#rrggbb`. Throws on anything else. */
export function parseHex(hex: string): Rgb {
  if (!HEX.test(hex)) throw new Error(`not a hex color: ${hex}`);
  const h = hex.length === 4 ? hex.slice(1).replaceAll(/./g, (c) => c + c) : hex.slice(1);
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

/** Formats a color as `#rrggbb` (lowercase). Channels are rounded and clamped. */
export function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) =>
      Math.round(clamp(c, 0, 255))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Whether `id` names a ramp of `palette`. */
export function isRampId(palette: Palette, id: string): id is PaletteRampId {
  return Object.hasOwn(palette, id);
}

/** A ramp's colors, dark to light. Throws if the palette lacks it or it has fewer than 2. */
function ramp(palette: Palette, id: PaletteRampId): readonly Rgb[] {
  const hexes = isRampId(palette, id) ? palette[id] : undefined;
  if (!hexes || hexes.length < 2) throw new Error(`palette has no usable ramp: ${id}`);
  return hexes.map(parseHex);
}

function rampAt(colors: readonly Rgb[], index: number): Rgb {
  const c = colors[clamp(Math.round(index), 0, colors.length - 1)];
  if (!c) throw new Error("empty ramp");
  return c;
}

/** The ramp color for a value in [0, 1]: the ramp split into equal bands. */
function quantize(colors: readonly Rgb[], v: number): Rgb {
  return rampAt(colors, Math.floor(clamp(v, 0, 0.999_999) * colors.length));
}

function shade(c: Rgb, f: number): Rgb {
  return [c[0] * f, c[1] * f, c[2] * f];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------------------------
// Pixel buffers

const smooth = (t: number): number => t * t * (3 - 2 * t);
const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < N && y < N;
const blank = (): Uint8ClampedArray => new Uint8ClampedArray(N * N * 4);
const wrap = (v: number): number => ((v % N) + N) % N;
/** The index of a pixel in a 16×16 grid, wrapping around. */
const cellKey = (x: number, y: number): number => wrap(y) * N + wrap(x);
const offset = (x: number, y: number): number => (wrap(y) * N + wrap(x)) * 4;

/** Writes one pixel. Coordinates wrap around, so patterns tile seamlessly. */
function put(px: Uint8ClampedArray, x: number, y: number, c: Rgb, a = 255): void {
  const i = offset(x, y);
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
  px[i + 3] = a;
}

function read(px: Uint8ClampedArray, x: number, y: number): Rgb {
  const i = offset(x, y);
  return [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0];
}

function alphaAt(px: Uint8ClampedArray, x: number, y: number): number {
  return px[offset(x, y) + 3] ?? 0;
}

function fill(c: Rgb, a = 255): Uint8ClampedArray {
  const px = blank();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(px, x, y, c, a);
  return px;
}

// ---------------------------------------------------------------------------------------------
// Noise

/**
 * Periodic value noise over the tile: a `cx` × `cy` lattice of random values, smoothstep-blended.
 * It wraps at the tile edge, so tiles repeat without seams. Returns values in [0, 1].
 */
function valueNoise(rng: Rng, cx: number, cy: number): (x: number, y: number) => number {
  const lattice = Array.from({ length: cx * cy }, () => rng.next());
  const at = (i: number, j: number): number =>
    lattice[(((j % cy) + cy) % cy) * cx + (((i % cx) + cx) % cx)] ?? 0;
  return (x, y) => {
    const fx = ((x + 0.5) / N) * cx;
    const fy = ((y + 0.5) / N) * cy;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = smooth(fx - i);
    const ty = smooth(fy - j);
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
    return top + (bottom - top) * ty;
  };
}

/**
 * A 16×16 field in [0, 1]: coarse noise with features about `scale` pixels across, finer noise,
 * and per-pixel grain. Stretched so the darkest pixel is 0 and the lightest is 1.
 */
function field(rng: Rng, scale: number, cellsY = 0): Float64Array {
  const cells = clamp(Math.round(N / scale), 1, N);
  const coarse = valueNoise(rng.fork("coarse"), cells, cellsY || cells);
  const fine = valueNoise(
    rng.fork("fine"),
    Math.min(N, cells * 2),
    Math.min(N, (cellsY || cells) * 2),
  );
  const grain = rng.fork("grain");
  const out = new Float64Array(N * N);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = 0.55 * coarse(x, y) + 0.25 * fine(x, y) + 0.2 * grain.next();
      out[y * N + x] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const span = hi - lo || 1;
  for (let i = 0; i < out.length; i++) out[i] = ((out[i] ?? 0) - lo) / span;
  return out;
}

const fieldAt = (f: Float64Array, x: number, y: number): number => f[wrap(y) * N + wrap(x)] ?? 0;

function checkFinite(name: string, v: number, min: number): void {
  if (!Number.isFinite(v) || v < min) throw new RangeError(`${name} must be a number ≥ ${min}`);
}

function checkInt(name: string, v: number, min: number, max: number): void {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Primitive painters (one per built-in recipe kind)

/**
 * Seeded value noise quantized to a ramp. `scale` is the feature size in pixels (1–16);
 * `contrast` 1 uses the whole ramp, 0.5 only its middle half, 0 one flat middle color.
 */
export function paintNoise(
  palette: Palette,
  rng: Rng,
  rampId: PaletteRampId,
  scale: number,
  contrast: number,
): Uint8ClampedArray {
  checkFinite("scale", scale, 1);
  checkFinite("contrast", contrast, 0);
  const colors = ramp(palette, rampId);
  const f = field(rng, scale);
  const px = blank();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      put(px, x, y, quantize(colors, 0.5 + (fieldAt(f, x, y) - 0.5) * contrast));
    }
  }
  return px;
}

/**
 * Horizontal boards with grain. Each board has a lighter top row, a 1-px dark bottom edge, one
 * dark end joint (staggered between boards) and two small nail heads next to the joint.
 */
export function paintPlanks(
  palette: Palette,
  rng: Rng,
  rampId: PaletteRampId,
  boards: number,
): Uint8ClampedArray {
  checkInt("boards", boards, 1, N / 2);
  const colors = ramp(palette, rampId);
  const top = colors.length - 1;
  const grain = field(rng.fork("grain"), 4, 2 * boards);
  const px = blank();
  const height = Math.floor(N / boards);
  let joint = rng.int(0, N - 1);
  for (let b = 0; b < boards; b++) {
    const y0 = b * height;
    const y1 = b === boards - 1 ? N : y0 + height;
    const tone = rng.int(1, Math.max(1, top - 1));
    joint = wrap(joint + rng.int(5, 11));
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < N; x++) {
        let i = tone + Math.round((fieldAt(grain, x, y) - 0.5) * 2);
        if (y === y0) i += 1;
        if (y === y1 - 1 || x === joint) i = 0;
        put(px, x, y, rampAt(colors, clamp(i, 0, top)));
      }
    }
    if (y1 - y0 >= 4) {
      const nail = shade(rampAt(colors, 0), 0.8);
      put(px, joint + 2, y0 + 1, nail);
      put(px, joint - 2, y1 - 2, nail);
    }
  }
  return px;
}

/**
 * Four courses of bricks, 7 × 3 pixels each, in running bond, with 1-px mortar joints. Each brick
 * gets its own tone, a lighter top row and a 1-px darker bottom row and right column.
 */
export function paintBricks(
  palette: Palette,
  rng: Rng,
  rampId: PaletteRampId,
  mortarId: PaletteRampId,
): Uint8ClampedArray {
  const colors = ramp(palette, rampId);
  const mortar = ramp(palette, mortarId);
  const top = colors.length - 1;
  const speck = rng.fork("speck");
  const px = blank();
  const courseH = 4;
  const brickW = 8;
  for (let course = 0; course < N / courseH; course++) {
    const y0 = course * courseH;
    const shift = course % 2 === 0 ? 0 : brickW / 2;
    for (let brick = 0; brick < N / brickW; brick++) {
      const x0 = brick * brickW + shift;
      const tone = rng.int(1, Math.max(1, top - 1));
      for (let dy = 0; dy < courseH; dy++) {
        for (let dx = 0; dx < brickW; dx++) {
          const x = x0 + dx;
          const y = y0 + dy;
          if (dy === courseH - 1 || dx === brickW - 1) {
            put(px, x, y, rampAt(mortar, mortar.length - 2 + speck.int(0, 1)));
            continue;
          }
          let i = tone;
          if (dy === 0) i += 1;
          if (dy === courseH - 2 || dx === brickW - 2) i -= 1;
          const r = speck.next();
          if (r < 0.1) i -= 1;
          else if (r > 0.92) i += 1;
          put(px, x, y, rampAt(colors, clamp(i, 0, top)));
        }
      }
    }
  }
  return px;
}

/** Small cluster shapes for ore veins, as [dx, dy] offsets. The first pixel gets the glint. */
const ORE_SHAPES: readonly (readonly (readonly [number, number])[])[] = [
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
    [1, 2],
  ],
  [
    [0, 0],
    [1, 1],
    [2, 1],
  ],
  [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 2],
  ],
];

/**
 * Scatters ore clusters over a base tile. `density` 0–1 sets how many (1 to 10). Each cluster has
 * a glint pixel and casts a 1-px shadow down and to the right onto the base.
 */
export function paintOre(
  base: Uint8ClampedArray,
  palette: Palette,
  rng: Rng,
  oreId: PaletteRampId,
  density: number,
): Uint8ClampedArray {
  if (!Number.isFinite(density) || density < 0 || density > 1) {
    throw new RangeError("density must be from 0 to 1");
  }
  const colors = ramp(palette, oreId);
  const top = colors.length - 1;
  const px = base.slice();
  const taken = new Set<number>();
  const clusters = Math.max(1, Math.round(density * 10));
  for (let c = 0; c < clusters; c++) {
    const shape = rng.pick(ORE_SHAPES);
    let cx = 0;
    let cy = 0;
    // Look for a spot that doesn't touch another cluster; give up after a few tries.
    for (let attempt = 0; attempt < 12; attempt++) {
      cx = rng.int(0, N - 1);
      cy = rng.int(0, N - 1);
      const clear = shape.every(([dx, dy]) => {
        for (let ny = -1; ny <= 1; ny++) {
          for (let nx = -1; nx <= 1; nx++)
            if (taken.has(cellKey(cx + dx + nx, cy + dy + ny))) return false;
        }
        return true;
      });
      if (clear) break;
    }
    const tone = rng.int(1, Math.max(1, top - 1));
    for (const [dx, dy] of shape) taken.add(cellKey(cx + dx, cy + dy));
    for (const [dx, dy] of shape) {
      const sx = cx + dx + 1;
      const sy = cy + dy + 1;
      if (!taken.has(cellKey(sx, sy))) put(px, sx, sy, shade(read(base, sx, sy), 0.7));
    }
    shape.forEach(([dx, dy], i) => {
      put(px, cx + dx, cy + dy, rampAt(colors, i === 0 ? top : tone + (dx + dy > 2 ? -1 : 0)));
    });
  }
  return px;
}

/**
 * Hangs a layer of the `top` ramp `depth` pixels down over a base tile, with a ragged lower edge
 * (some columns one shorter or longer, a few two longer) and a 1-px shadow under it.
 */
export function paintOverlayTop(
  base: Uint8ClampedArray,
  palette: Palette,
  rng: Rng,
  topId: PaletteRampId,
  depth: number,
): Uint8ClampedArray {
  checkInt("depth", depth, 0, N);
  const layer = paintNoise(palette, rng.fork("top"), topId, 3, 1);
  const px = base.slice();
  for (let x = 0; x < N; x++) {
    let len = depth;
    const r = rng.next();
    if (depth > 0 && r < 0.18) len -= 1;
    else if (depth > 0 && r < 0.36) len += 1;
    else if (depth > 0 && r < 0.46) len += 2;
    len = clamp(len, 0, N);
    for (let y = 0; y < len; y++) put(px, x, y, read(layer, x, y));
    if (len > 0 && len < N) put(px, x, len, shade(read(base, x, len), 0.72));
  }
  return px;
}

// ---------------------------------------------------------------------------------------------
// Cracks

const CRACK: Rgb = [28, 22, 18];
const CHIP: Rgb = [255, 250, 240];
/** Highest crack stage. Stages run 0–9. */
export const MAX_CRACK_STAGE = 9;

/**
 * The fracture network for a crack overlay: pixels in the order they appear. Depends only on the
 * stream, not the stage, so every stage of one stream shares it.
 */
function fracture(rng: Rng): readonly (readonly [number, number])[] {
  const cx = rng.int(6, 9);
  const cy = rng.int(6, 9);
  const branches: { x: number; y: number; angle: number; steps: number }[] = [];
  const count = 5;
  for (let b = 0; b < count; b++) {
    branches.push({
      x: cx,
      y: cy,
      angle: (b / count) * Math.PI * 2 + (rng.next() - 0.5) * 0.9,
      steps: rng.int(6, 9),
    });
  }
  const order: [number, number][] = [[cx, cy]];
  const seen = new Set<number>([cy * N + cx]);
  const add = (x: number, y: number): void => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (rx < 0 || ry < 0 || rx >= N || ry >= N || seen.has(ry * N + rx)) return;
    seen.add(ry * N + rx);
    order.push([rx, ry]);
  };
  const maxSteps = Math.max(...branches.map((b) => b.steps));
  for (let step = 0; step < maxSteps; step++) {
    for (const [i, br] of branches.entries()) {
      if (step >= br.steps) continue;
      br.angle += (rng.next() - 0.5) * 0.8;
      br.x += Math.cos(br.angle);
      br.y += Math.sin(br.angle);
      add(br.x, br.y);
      // Two branches fork once, half-way out.
      if (step === 3 && i % 2 === 0) {
        branches.push({
          x: br.x,
          y: br.y,
          angle: br.angle + (rng.next() < 0.5 ? 1 : -1) * 0.9,
          steps: step + 5,
        });
      }
    }
  }
  return order;
}

/**
 * A crack overlay for mining, stage 0 (a hairline) to 9 (nearly shattered). Transparent except
 * for the crack. From stage 4 the crack casts a faint shadow; from stage 7 chipped edges catch the
 * light. With equally seeded streams, no pixel's alpha ever drops from one stage to the next.
 */
export function paintCrack(rng: Rng, stage: number): Uint8ClampedArray {
  checkInt("stage", stage, 0, MAX_CRACK_STAGE);
  const order = fracture(rng);
  const shown = order.slice(0, Math.ceil((order.length * (stage + 1)) / (MAX_CRACK_STAGE + 1)));
  const px = blank();
  const crack = new Set(shown.map(([x, y]) => y * N + x));
  for (const [x, y] of shown) put(px, x, y, CRACK, 235);
  if (stage >= 4) {
    for (const [x, y] of shown) {
      const sx = x + 1;
      const sy = y + 1;
      if (inside(sx, sy) && !crack.has(sy * N + sx)) put(px, sx, sy, CRACK, 90);
    }
  }
  if (stage >= 7) {
    for (const [x, y] of shown) {
      const hx = x - 1;
      const hy = y - 1;
      if (inside(hx, hy) && alphaAt(px, hx, hy) === 0) put(px, hx, hy, CHIP, 70);
    }
  }
  return px;
}

// ---------------------------------------------------------------------------------------------
// Custom painters

/** A named painter. `arg` is the ramp after the colon in `'<painter>:<rampId>'`, if any. */
export type CustomPainter = (
  palette: Palette,
  rng: Rng,
  arg: PaletteRampId | undefined,
) => Uint8ClampedArray;

function need(arg: PaletteRampId | undefined, painter: string): PaletteRampId {
  if (arg === undefined) throw new Error(`painter ${painter} needs a ramp: '${painter}:<rampId>'`);
  return arg;
}

function rampNamed(palette: Palette, id: string): readonly Rgb[] {
  if (!isRampId(palette, id)) throw new Error(`palette has no ramp: ${id}`);
  return ramp(palette, id);
}

/** A magenta-and-ink checkerboard for tiles that have no recipe. Unmissable on purpose. */
const missing: CustomPainter = () => {
  const px = blank();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      put(
        px,
        x,
        y,
        (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? [240, 40, 200] : [30, 20, 40],
      );
    }
  }
  return px;
};

/** Glass: a solid 1-px frame, a faint see-through pane and two short diagonal glints. */
const glass: CustomPainter = (palette, rng, arg) => {
  const colors = ramp(palette, arg ?? "glass");
  const light = rampAt(colors, colors.length - 1);
  const px = fill(light, 46);
  for (let i = 0; i < N; i++) {
    const edge = rampAt(colors, colors.length - 3 + (i % 5 === 0 ? 1 : 0));
    put(px, i, 0, edge);
    put(px, i, N - 1, edge);
    put(px, 0, i, edge);
    put(px, N - 1, i, edge);
  }
  const gx = rng.int(3, 5);
  const gy = rng.int(4, 6);
  for (let i = 0; i < 4; i++) put(px, gx + i, gy - i, light, 210);
  for (let i = 0; i < 2; i++) put(px, gx + 3 + i, gy + 3 - i, light, 170);
  return px;
};

/** A log's cut end: bark rim, then slightly off-center growth rings. Bark is `<ramp>-bark`. */
const rings: CustomPainter = (palette, rng, arg) => {
  const id = need(arg, "rings");
  const wood = ramp(palette, id);
  const bark = rampNamed(palette, `${id}-bark`);
  const grain = field(rng.fork("grain"), 2);
  const cx = 7.5 + rng.int(-1, 1) * 0.5;
  const cy = 7.5 + rng.int(-1, 1) * 0.5;
  const px = blank();
  const top = wood.length - 1;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (x === 0 || y === 0 || x === N - 1 || y === N - 1) {
        put(px, x, y, rampAt(bark, 1 + Math.round(fieldAt(grain, x, y))));
        continue;
      }
      const d = Math.hypot(x - cx, y - cy) + (fieldAt(grain, x, y) - 0.5) * 0.9;
      let i = Math.floor(d / 1.6) % 2 === 0 ? top - 1 : top - 2;
      if (x === 1 || y === 1 || x === N - 2 || y === N - 2) i = 1;
      if (d < 1) i = top - 3;
      put(px, x, y, rampAt(wood, i));
    }
  }
  return px;
};

/** Bark: long vertical furrows, darker in the cracks. */
const bark: CustomPainter = (palette, rng, arg) => {
  const colors = ramp(palette, need(arg, "bark"));
  const f = field(rng, 2, 2);
  const cols = field(rng.fork("cols"), 2, 1);
  const px = blank();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++)
      put(px, x, y, quantize(colors, 0.65 * fieldAt(cols, x, 0) + 0.35 * fieldAt(f, x, y)));
  }
  return px;
};

/** Pale bark with short dark horizontal dashes. */
const dashedBark: CustomPainter = (palette, rng, arg) => {
  const colors = ramp(palette, need(arg, "dashed-bark"));
  const top = colors.length - 1;
  const f = field(rng.fork("pale"), 3);
  const px = blank();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++)
      put(px, x, y, rampAt(colors, top - 1 + Math.round(fieldAt(f, x, y))));
  }
  const dashes = rng.int(5, 7);
  for (let d = 0; d < dashes; d++) {
    const x = rng.int(0, N - 1);
    const y = rng.int(0, N - 1);
    const len = rng.int(2, 4);
    for (let i = 0; i < len; i++)
      put(px, x + i, y, rampAt(colors, i === 0 || i === len - 1 ? 1 : 0));
  }
  return px;
};

/** Knitted wool: columns of little stacked chevrons, every other column half a stitch lower. */
const STITCH: readonly (readonly number[])[] = [
  [3, 2, 2, 3],
  [2, 3, 3, 2],
  [1, 2, 2, 1],
  [0, 1, 1, 0],
];
const knit: CustomPainter = (palette, rng, arg) => {
  const colors = ramp(palette, need(arg, "knit"));
  const lift = Math.max(0, colors.length - 4);
  const px = blank();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const column = Math.floor(x / 4);
      const sy = (y + (column % 2) * 2) % 4;
      let level = STITCH[sy]?.[x % 4] ?? 0;
      const r = rng.next();
      if (r < 0.06) level -= 1;
      else if (r > 0.95) level += 1;
      put(px, x, y, rampAt(colors, clamp(level, 0, 3) + lift));
    }
  }
  return px;
};

/** Crystal: a dark bed with three diamond shards, lit from the top left. */
const facets: CustomPainter = (palette, rng, arg) => {
  const colors = ramp(palette, need(arg, "facets"));
  const top = colors.length - 1;
  const bed = field(rng.fork("bed"), 4);
  const px = blank();
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) put(px, x, y, rampAt(colors, Math.round(fieldAt(bed, x, y))));
  for (let s = 0; s < 3; s++) {
    const cx = rng.int(0, N - 1);
    const cy = rng.int(0, N - 1);
    const r = rng.int(2, 4);
    for (let dy = -r - 1; dy <= r + 1; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.abs(dx) * 1.6 + Math.abs(dy);
        if (d > r + 1) continue;
        let i = dx < 0 ? top - 1 : dx === 0 ? top : top - 2;
        if (dy > 0) i -= 1;
        if (d > r) i = 1;
        if (dx === 0 && dy === -r) i = top;
        put(px, cx + dx, cy + dy, rampAt(colors, i));
      }
    }
  }
  return px;
};

/** A mushroom cap: soft mottled color with round pale spots. Spots use `mushroom-stem`. */
const cap: CustomPainter = (palette, rng, arg) => {
  const colors = ramp(palette, need(arg, "cap"));
  const stem = rampNamed(palette, "mushroom-stem");
  const spot = rampAt(stem, stem.length - 1);
  const spotEdge = rampAt(stem, stem.length - 2);
  const base = field(rng.fork("base"), 5);
  const px = blank();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) put(px, x, y, quantize(colors, 0.25 + 0.6 * fieldAt(base, x, y)));
  }
  const spots = rng.int(4, 6);
  for (let s = 0; s < spots; s++) {
    const x = rng.int(0, N - 1);
    const y = rng.int(0, N - 1);
    if (rng.next() < 0.5) {
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const)
        put(px, x + dx, y + dy, spot);
    } else {
      put(px, x, y, spot);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        put(px, x + dx, y + dy, spotEdge);
    }
  }
  return px;
};

/** A lantern block: a metal frame and cross bars over four glowing panes, brightest in the middle. */
const lamp: CustomPainter = (palette, rng, arg) => {
  const glow = ramp(palette, need(arg, "lamp"));
  const metal = ramp(palette, "metal");
  const top = glow.length - 1;
  const flicker = rng.fork("flicker");
  const px = blank();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const ring = Math.min(x, y, N - 1 - x, N - 1 - y);
      if (ring === 0) put(px, x, y, rampAt(metal, 0));
      else if (ring === 1 || x === 7 || x === 8 || y === 7 || y === 8) {
        put(px, x, y, rampAt(metal, ring === 1 && (x + y) % 6 === 0 ? 3 : 2));
      } else {
        const d = Math.hypot(x - 7.5, y - 7.5);
        const i = top - Math.floor(d / 2.2) + (flicker.next() < 0.12 ? -1 : 0);
        put(px, x, y, rampAt(glow, clamp(i, 1, top)));
      }
    }
  }
  return px;
};

/** Water: soft horizontal bands and a few glints, slightly see-through. */
const ripple: CustomPainter = (palette, rng, arg) => {
  const colors = ramp(palette, need(arg, "ripple"));
  const top = colors.length - 1;
  const bands = field(rng, 4, 8);
  const px = blank();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++)
      put(px, x, y, quantize(colors.slice(0, top), fieldAt(bands, x, y)), 205);
  }
  const glints = rng.int(3, 5);
  for (let g = 0; g < glints; g++) {
    const x = rng.int(0, N - 1);
    const y = rng.int(0, N - 1);
    const len = rng.int(2, 3);
    for (let i = 0; i < len; i++) put(px, x + i, y, rampAt(colors, top), 225);
  }
  return px;
};

/** Leaves: overlapping little leaf clusters with a highlight, deep shade in the gaps. */
const leaves: CustomPainter = (palette, rng, arg) => {
  const colors = ramp(palette, need(arg, "leaves"));
  const top = colors.length - 1;
  const px = fill(rampAt(colors, 0));
  const clusters = 22;
  for (let c = 0; c < clusters; c++) {
    const x = rng.int(0, N - 1);
    const y = rng.int(0, N - 1);
    const tone = rng.int(1, Math.max(1, top - 1));
    const shape = rng.pick(ORE_SHAPES);
    for (const [dx, dy] of shape) put(px, x + dx, y + dy, rampAt(colors, tone));
    put(px, x + (shape[0]?.[0] ?? 0), y + (shape[0]?.[1] ?? 0), rampAt(colors, tone + 1));
  }
  return px;
};

/** Pebbles: rounded stones lit from the top left on a darker bed. */
const pebbles: CustomPainter = (palette, rng, arg) => {
  const colors = ramp(palette, need(arg, "pebbles"));
  const top = colors.length - 1;
  const bed = field(rng.fork("bed"), 2);
  const px = blank();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) put(px, x, y, rampAt(colors, Math.round(fieldAt(bed, x, y))));
  }
  const count = rng.int(9, 12);
  for (let p = 0; p < count; p++) {
    const x = rng.int(0, N - 1);
    const y = rng.int(0, N - 1);
    const w = rng.int(2, 3);
    const h = rng.int(2, 3);
    const tone = rng.int(2, Math.max(2, top - 1));
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        let i = tone;
        if (dx === 0 && dy === 0) i = Math.min(top, tone + 1);
        else if (dx === w - 1 && dy === h - 1) i = tone - 1;
        put(px, x + dx, y + dy, rampAt(colors, i));
      }
    }
    put(px, x + w, y + h, rampAt(colors, 0));
  }
  return px;
};

/**
 * Painters for `{ kind: 'custom', paint }` recipes. `paint` is `'<name>'` or `'<name>:<rampId>'`:
 *
 * | name | ramp | paints |
 * |---|---|---|
 * | `missing` | — | magenta checkerboard for tiles with no recipe |
 * | `glass` | optional (default `glass`) | frame, faint pane (alpha 46), glints |
 * | `rings` | wood, plus `<ramp>-bark` | log end |
 * | `bark` | bark | vertical furrows |
 * | `dashed-bark` | bark | pale bark with dark dashes |
 * | `knit` | wool | knitted stitches |
 * | `facets` | crystal | diamond shards |
 * | `cap` | cap color, plus `mushroom-stem` | mushroom cap with spots |
 * | `lamp` | glow, plus `metal` | lantern block |
 * | `ripple` | water | bands and glints, alpha 205 |
 * | `leaves` | leaf | leaf clusters |
 * | `pebbles` | stone | rounded stones |
 */
export const CUSTOM_PAINTERS: Readonly<Record<string, CustomPainter>> = {
  missing,
  glass,
  rings,
  bark,
  "dashed-bark": dashedBark,
  knit,
  facets,
  cap,
  lamp,
  ripple,
  leaves,
  pebbles,
};

/** Runs the custom painter named by `paint` (`'<name>'` or `'<name>:<rampId>'`). */
export function paintCustom(paint: string, palette: Palette, rng: Rng): Uint8ClampedArray {
  const colon = paint.indexOf(":");
  const name = colon < 0 ? paint : paint.slice(0, colon);
  const arg = colon < 0 ? undefined : paint.slice(colon + 1);
  const painter = Object.hasOwn(CUSTOM_PAINTERS, name) ? CUSTOM_PAINTERS[name] : undefined;
  if (!painter) throw new Error(`no painter named ${name}`);
  if (arg !== undefined && !isRampId(palette, arg)) throw new Error(`palette has no ramp: ${arg}`);
  return painter(palette, rng, arg);
}
