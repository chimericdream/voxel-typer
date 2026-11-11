/**
 * Noise and sampling for diorama worldgen (task M2-03, PLAN.md §6.4). Pure: no clock, no
 * `Math.random()`. Every function takes its seed or `Rng` as a parameter.
 *
 * - {@link valueNoise2} is lattice value noise: a hashed value at each integer corner, blended
 *   with a smoothstep. Cheap and blocky-friendly.
 * - {@link fbm2} sums octaves of it (the Meadow uses 2).
 * - {@link terrace} pulls heights toward flat steps, for the stepped hills of a voxel diorama.
 * - {@link poissonDisk} is Bridson's sampler: points no closer than `r`, in a seeded order.
 */
import type { Rng } from "@/engine/rng";

/** A uint32 hash of an integer lattice point and a seed. */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = (seed ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ ix, 0x85ebca6b);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h ^ iz, 0xc2b2ae35);
  h = (h ^ (h >>> 16)) | 0;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 15;
  return h >>> 0;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** 2D value noise in `[0, 1)`. Continuous; equal to the lattice hash at integer points. */
export function valueNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const v = (a: number, b: number): number => hash2(a, b, seed) / 4294967296;
  const top = v(ix, iz) + (v(ix + 1, iz) - v(ix, iz)) * fx;
  const bottom = v(ix, iz + 1) + (v(ix + 1, iz + 1) - v(ix, iz + 1)) * fx;
  return top + (bottom - top) * fz;
}

/**
 * Fractal sum of `octaves` value-noise layers, each at twice the frequency and half the weight of
 * the one before. Normalized to `[0, 1)`.
 */
export function fbm2(x: number, z: number, seed: number, octaves = 2): number {
  let sum = 0;
  let weight = 1;
  let total = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2(x * freq, z * freq, (seed + Math.imul(o, 0x632be5ab)) | 0) * weight;
    total += weight;
    weight *= 0.5;
    freq *= 2;
  }
  return sum / total;
}

/**
 * Pulls `v` toward multiples of `step`: the middle `1 - 2 × flat` of each step is a smooth riser
 * and the rest is flat. `flat` in `[0, 0.5)`.
 */
export function terrace(v: number, step: number, flat = 0.3): number {
  const k = Math.floor(v / step);
  const f = v / step - k;
  const t = f <= flat ? 0 : f >= 1 - flat ? 1 : smooth((f - flat) / (1 - 2 * flat));
  return (k + t) * step;
}

export interface Point2 {
  x: number;
  z: number;
}

/**
 * Bridson's Poisson-disk sampler over `[0, w) × [0, h)`. Every pair of points is at least `r`
 * apart. `accept` filters candidates (exclusion zones); rejected spots are never sampled again.
 * The result is deterministic for a given `rng` state.
 */
export function poissonDisk(
  w: number,
  h: number,
  r: number,
  rng: Rng,
  accept: (p: Point2) => boolean = () => true,
  tries = 24,
): Point2[] {
  const cell = r / Math.SQRT2;
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const points: Point2[] = [];
  const active: number[] = [];
  const r2 = r * r;

  const fits = (p: Point2): boolean => {
    if (p.x < 0 || p.z < 0 || p.x >= w || p.z >= h) return false;
    const gx = Math.floor(p.x / cell);
    const gz = Math.floor(p.z / cell);
    for (let z = Math.max(0, gz - 2); z <= Math.min(gh - 1, gz + 2); z++) {
      for (let x = Math.max(0, gx - 2); x <= Math.min(gw - 1, gx + 2); x++) {
        const i = grid[x + gw * z] ?? -1;
        if (i < 0) continue;
        const q = points[i];
        if (q && (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < r2) return false;
      }
    }
    return true;
  };
  const add = (p: Point2): void => {
    const i = points.length;
    points.push(p);
    active.push(i);
    grid[Math.floor(p.x / cell) + gw * Math.floor(p.z / cell)] = i;
  };

  // Seed points: a few random tries, so a large exclusion zone can't leave the set empty.
  for (let i = 0; i < tries && points.length === 0; i++) {
    const p = { x: rng.next() * w, z: rng.next() * h };
    if (accept(p)) add(p);
  }
  while (active.length > 0) {
    const slot = rng.int(0, active.length - 1);
    const base = points[active[slot] ?? 0];
    let placed = false;
    if (base) {
      for (let t = 0; t < tries; t++) {
        // A spot in the annulus [r, 2r) around the base, by rejection. No trig, so the result
        // can't drift between JS engines (Math.sin/cos are not exactly specified).
        const dx = (rng.next() * 2 - 1) * 2 * r;
        const dz = (rng.next() * 2 - 1) * 2 * r;
        const d2 = dx * dx + dz * dz;
        if (d2 < r2 || d2 >= 4 * r2) continue;
        const p = { x: base.x + dx, z: base.z + dz };
        if (fits(p) && accept(p)) {
          add(p);
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      active[slot] = active[active.length - 1] ?? 0;
      active.pop();
    }
  }
  return points;
}
