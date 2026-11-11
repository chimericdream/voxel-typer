/**
 * Effect tuning (task M2-05, PLAN.md §3.4 and §4.6). One place for every "feel" number, so the
 * feel review can read and change them together.
 *
 * Rules these numbers keep:
 * - Juicy but gentle for kids aged 6–13: small chips, short lives, soft bounces.
 * - No flashing at all (PLAN §4.6 allows at most 3 flashes a second; effects here never flash and
 *   never cover the screen).
 * - Mistakes get no effects from this module. A wrong key is a block wobble and a soft thud in
 *   the mode (M2-13), never a burst, shake or hit-stop.
 * - Reduced motion: no shake, no hit-stop, at most 6 particles with no bounce, float text fades
 *   only (no rise, no pop).
 */
import type { Ms } from "@/types/core";

/** Pool size of the particle `InstancedMesh`. A burst never grows it. */
export const MAX_PARTICLES = 512;
/** The most particles one burst spawns, whatever `count` asks for. */
export const MAX_PER_BURST = 40;
/** Under reduced motion a burst spawns at most this many particles. */
export const REDUCED_MOTION_PARTICLES = 6;

/** Particle lifetime range (card: 600–1200 ms). */
export const PARTICLE_LIFE_MIN: Ms = 600;
export const PARTICLE_LIFE_MAX: Ms = 1200;
/** Edge length of a particle cube in world units (a block is 1). */
export const PARTICLE_SIZE_MIN = 0.14;
export const PARTICLE_SIZE_MAX = 0.22;
/** Half the side of the box particles start in, around the burst point. */
export const SPAWN_SPREAD = 0.32;
/** Outward speed at `speed: 1`, world units per second. */
export const BURST_SPEED = 2.6;
/** Extra upward speed at `speed: 1`, so chips pop up before they fall. */
export const BURST_LIFT = 3.4;
/** Downward acceleration, world units per s². */
export const GRAVITY = 16;
/** Bounce: the share of vertical speed kept, and the horizontal speed kept per ground hit. */
export const RESTITUTION = 0.35;
export const GROUND_FRICTION = 0.6;
/** Falls slower than this (units/s) settle instead of bouncing again. */
export const MIN_BOUNCE_SPEED = 0.9;
/** Spin rate cap, radians per second. */
export const MAX_SPIN = 7;
/** From this share of its life on, a particle shrinks to nothing ("fade by scale"). */
export const FADE_START = 0.55;
/** A new particle grows from half size over this long, so a burst pops instead of blinking in. */
export const GROW_IN: Ms = 60;

/** Reduced motion: slower drift, softer fall, no spin. */
export const REDUCED_SPEED = 0.35;
export const REDUCED_LIFT = 0.6;
export const REDUCED_GRAVITY = 5;

/** The longest hit-stop this module honours. Anything longer reads as a hitch, not a hit. */
export const MAX_HIT_STOP: Ms = 120;

/** Float text: how many can show at once (the oldest is reused) and how long each lives. */
export const MAX_FLOAT_TEXTS = 6;
export const FLOAT_LIFE: Ms = 900;
export const FLOAT_LIFE_REDUCED: Ms = 1100;
/** How far float text rises over its life, in CSS pixels. */
export const FLOAT_RISE_PX = 40;
/** Pop: scale starts here, overshoots to POP_PEAK, then settles at 1 (squash-and-stretch). */
export const POP_FROM = 0.6;
export const POP_PEAK = 1.12;
/** Share of life spent popping in, and where the fade-out starts. */
export const POP_IN = 0.14;
export const POP_SETTLE = 0.28;
export const FLOAT_FADE_START = 0.6;
/** Reduced motion: share of life spent fading in. */
export const REDUCED_FADE_IN = 0.15;

/** Shake on a block break, by streak: small, and capped so a long streak never rattles. */
export const SHAKE_BASE = 0.12;
export const SHAKE_PER_STREAK = 0.012;
export const SHAKE_MAX = 0.3;
export const SHAKE_DURATION: Ms = 220;

/**
 * The camera shake for a block break at `streak` (for M2-13). Feed it to `camera.shake`, which is a
 * no-op under reduced motion. The camera's offset is trauma² × noise, so the cap of 0.3 moves the
 * view by at most 0.3² × 0.3 ≈ 0.03 world units. Never call it for a mistake.
 */
export function breakShake(streak: number): { intensity01: number; durationMs: Ms } {
  const s = Number.isFinite(streak) && streak > 0 ? streak : 0;
  return {
    intensity01: Math.min(SHAKE_MAX, SHAKE_BASE + SHAKE_PER_STREAK * s),
    durationMs: SHAKE_DURATION,
  };
}
