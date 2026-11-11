/**
 * The particle simulation (task M2-05). No three.js and no DOM, so tests drive it directly.
 *
 * Struct-of-arrays in preallocated `Float32Array`s: spawning and stepping allocate nothing. Live
 * particles stay packed in `[0, alive)`; a dead one is replaced by the last live one. When the pool
 * is full, a new particle takes the slot of the one closest to its end, so the pool never grows.
 *
 * Randomness comes only from the `Rng` passed to `spawn`, so the same seed gives the same burst.
 */
import type { Rng } from "@/engine/rng";
import type { Ms } from "@/types/core";
import type { Vec3 } from "../types";
import {
  BURST_LIFT,
  BURST_SPEED,
  FADE_START,
  GRAVITY,
  GROUND_FRICTION,
  GROW_IN,
  MAX_PER_BURST,
  MAX_SPIN,
  MIN_BOUNCE_SPEED,
  PARTICLE_LIFE_MAX,
  PARTICLE_LIFE_MIN,
  PARTICLE_SIZE_MAX,
  PARTICLE_SIZE_MIN,
  REDUCED_GRAVITY,
  REDUCED_LIFT,
  REDUCED_MOTION_PARTICLES,
  REDUCED_SPEED,
  RESTITUTION,
  SPAWN_SPREAD,
} from "./tuning";

/** A tile's UV rectangle, `[u0, v0, u1, v1]` (as `tileUv` returns it). */
export type UvRect = readonly [u0: number, v0: number, u1: number, v1: number];

export interface BurstSpec {
  at: Vec3;
  count: number;
  /** Speed multiplier, default 1. */
  speed?: number;
  /** World y of the floor the particles bounce on. */
  groundY: number;
  /** The tile each particle takes a small square of. */
  uv: UvRect;
  /** Reduced motion: at most 6 particles, slow drift, no spin, no bounce. */
  reduced: boolean;
}

export interface ParticlePool {
  readonly max: number;
  /** Live particles, packed at the front of every array. */
  readonly alive: number;
  /** Per particle: x, y, z. */
  readonly pos: Float32Array;
  /** Per particle: rotation x, y, z (radians, XYZ Euler). */
  readonly rot: Float32Array;
  /** Per particle: the UV window `u, v, du, dv` it samples (shared with the instance attribute). */
  readonly uv: Float32Array;
  /** True when `uv` changed since the last `takeUvDirty()`. */
  takeUvDirty(): boolean;
  /** Adds one burst. Returns how many particles it spawned. */
  spawn(spec: BurstSpec, rng: Rng): number;
  /** Advances every particle by `dtMs`. Returns true while any particle is alive. */
  step(dtMs: Ms): boolean;
  /** Current edge length of particle `i` (fades by scale towards the end of its life). */
  scaleOf(i: number): number;
  /** Did particle `i` bounce (for tests)? */
  bounces(i: number): number;
  clear(): void;
}

/** A sub-window of the tile: a quarter of each side (4×4 texels of a 16×16 tile). */
const UV_CELLS = 4;

const range = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng.next();

export function createParticlePool(max: number): ParticlePool {
  const pos = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3);
  const rot = new Float32Array(max * 3);
  const spin = new Float32Array(max * 3);
  const uv = new Float32Array(max * 4);
  const size = new Float32Array(max);
  const age = new Float32Array(max);
  const life = new Float32Array(max);
  const ground = new Float32Array(max);
  const gravity = new Float32Array(max);
  // 1 = may bounce, 0 = settles on first contact (reduced motion).
  const bouncy = new Uint8Array(max);
  const hits = new Uint8Array(max);
  let alive = 0;
  let uvDirty = false;

  const copy = (from: number, to: number): void => {
    pos.copyWithin(to * 3, from * 3, from * 3 + 3);
    vel.copyWithin(to * 3, from * 3, from * 3 + 3);
    rot.copyWithin(to * 3, from * 3, from * 3 + 3);
    spin.copyWithin(to * 3, from * 3, from * 3 + 3);
    uv.copyWithin(to * 4, from * 4, from * 4 + 4);
    size[to] = size[from] ?? 0;
    age[to] = age[from] ?? 0;
    life[to] = life[from] ?? 0;
    ground[to] = ground[from] ?? 0;
    gravity[to] = gravity[from] ?? 0;
    bouncy[to] = bouncy[from] ?? 0;
    hits[to] = hits[from] ?? 0;
  };

  /** The slot for a new particle: the next free one, or the one closest to its end. */
  const takeSlot = (): number => {
    if (alive < max) return alive++;
    let best = 0;
    let bestLeft = Infinity;
    for (let i = 0; i < alive; i++) {
      const left = (life[i] ?? 0) - (age[i] ?? 0);
      if (left < bestLeft) {
        bestLeft = left;
        best = i;
      }
    }
    return best;
  };

  return {
    max,
    get alive() {
      return alive;
    },
    pos,
    rot,
    uv,
    takeUvDirty() {
      const was = uvDirty;
      uvDirty = false;
      return was;
    },
    spawn(spec, rng) {
      const asked = Number.isFinite(spec.count) ? Math.floor(spec.count) : 0;
      const cap = spec.reduced ? REDUCED_MOTION_PARTICLES : MAX_PER_BURST;
      const n = Math.min(Math.max(0, asked), cap, max);
      if (n === 0) return 0;
      const mul =
        spec.speed !== undefined && Number.isFinite(spec.speed) ? Math.max(0, spec.speed) : 1;
      const out = (spec.reduced ? REDUCED_SPEED : 1) * BURST_SPEED * mul;
      const lift = (spec.reduced ? REDUCED_LIFT : 1) * BURST_LIFT * mul;
      const [u0, v0, u1, v1] = spec.uv;
      const du = (u1 - u0) / UV_CELLS;
      const dv = (v1 - v0) / UV_CELLS;
      for (let k = 0; k < n; k++) {
        const i = takeSlot();
        const p = i * 3;
        pos[p] = spec.at.x + range(rng, -SPAWN_SPREAD, SPAWN_SPREAD);
        pos[p + 1] = spec.at.y + range(rng, -SPAWN_SPREAD, SPAWN_SPREAD);
        pos[p + 2] = spec.at.z + range(rng, -SPAWN_SPREAD, SPAWN_SPREAD);
        const angle = rng.next() * Math.PI * 2;
        const h = out * range(rng, 0.35, 1);
        vel[p] = Math.cos(angle) * h;
        vel[p + 1] = lift * range(rng, 0.55, 1.1);
        vel[p + 2] = Math.sin(angle) * h;
        rot[p] = rng.next() * Math.PI;
        rot[p + 1] = rng.next() * Math.PI;
        rot[p + 2] = rng.next() * Math.PI;
        const spinMax = spec.reduced ? 0 : MAX_SPIN;
        spin[p] = range(rng, -spinMax, spinMax);
        spin[p + 1] = range(rng, -spinMax, spinMax);
        spin[p + 2] = range(rng, -spinMax, spinMax);
        const q = i * 4;
        uv[q] = u0 + du * rng.int(0, UV_CELLS - 1);
        uv[q + 1] = v0 + dv * rng.int(0, UV_CELLS - 1);
        uv[q + 2] = du;
        uv[q + 3] = dv;
        size[i] = range(rng, PARTICLE_SIZE_MIN, PARTICLE_SIZE_MAX);
        age[i] = 0;
        life[i] = range(rng, PARTICLE_LIFE_MIN, PARTICLE_LIFE_MAX);
        ground[i] = spec.groundY;
        gravity[i] = spec.reduced ? REDUCED_GRAVITY : GRAVITY;
        bouncy[i] = spec.reduced ? 0 : 1;
        hits[i] = 0;
      }
      uvDirty = true;
      return n;
    },
    step(dtMs) {
      if (alive === 0) return false;
      const s = Math.max(0, dtMs) / 1000;
      for (let i = 0; i < alive; i++) {
        const a = (age[i] ?? 0) + dtMs;
        if (a >= (life[i] ?? 0)) {
          alive--;
          if (i !== alive) {
            copy(alive, i);
            uvDirty = true;
          }
          i--;
          continue;
        }
        age[i] = a;
        if (s === 0) continue;
        const p = i * 3;
        let vy = (vel[p + 1] ?? 0) - (gravity[i] ?? 0) * s;
        let x = (pos[p] ?? 0) + (vel[p] ?? 0) * s;
        let y = (pos[p + 1] ?? 0) + vy * s;
        let z = (pos[p + 2] ?? 0) + (vel[p + 2] ?? 0) * s;
        const floor = (ground[i] ?? 0) + (size[i] ?? 0) / 2;
        if (y < floor) {
          y = floor;
          if (bouncy[i] === 1 && -vy > MIN_BOUNCE_SPEED) {
            vy = -vy * RESTITUTION;
            hits[i] = Math.min(255, (hits[i] ?? 0) + 1);
          } else {
            vy = 0;
          }
          vel[p] = (vel[p] ?? 0) * GROUND_FRICTION;
          vel[p + 2] = (vel[p + 2] ?? 0) * GROUND_FRICTION;
          spin[p] = (spin[p] ?? 0) * GROUND_FRICTION;
          spin[p + 1] = (spin[p + 1] ?? 0) * GROUND_FRICTION;
          spin[p + 2] = (spin[p + 2] ?? 0) * GROUND_FRICTION;
          x = (pos[p] ?? 0) + (vel[p] ?? 0) * s;
          z = (pos[p + 2] ?? 0) + (vel[p + 2] ?? 0) * s;
        }
        vel[p + 1] = vy;
        pos[p] = x;
        pos[p + 1] = y;
        pos[p + 2] = z;
        rot[p] = (rot[p] ?? 0) + (spin[p] ?? 0) * s;
        rot[p + 1] = (rot[p + 1] ?? 0) + (spin[p + 1] ?? 0) * s;
        rot[p + 2] = (rot[p + 2] ?? 0) + (spin[p + 2] ?? 0) * s;
      }
      return alive > 0;
    },
    scaleOf(i) {
      const a = age[i] ?? 0;
      const l = life[i] ?? 1;
      const base = size[i] ?? 0;
      const grow = a < GROW_IN ? 0.5 + (0.5 * a) / GROW_IN : 1;
      const t = a / l;
      const fade = t <= FADE_START ? 1 : Math.max(0, 1 - (t - FADE_START) / (1 - FADE_START));
      return base * grow * fade;
    },
    bounces(i) {
      return hits[i] ?? 0;
    },
    clear() {
      alive = 0;
      uvDirty = true;
    },
  };
}
