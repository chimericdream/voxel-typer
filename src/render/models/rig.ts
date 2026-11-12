/**
 * A voxel model compiled for playback (task M4-01): parts in parent-first order with numeric
 * parent links, and animations with their tracks bound to part indices.
 *
 * This file has no three.js and no clock, so the animation math stays easy to test.
 *
 * ## Units (decided in M4-01; see `docs/handoffs/M4-01.md`)
 *
 * - Lengths (`size`, `pivot`, `offset`, `pos` keys) are **model pixels**: 16 pixels make one
 *   block, the same scale as a 16×16 tile. The builders scale by {@link MODEL_UNIT}.
 * - `pivot` is a point in the part's own box, measured from its minimum corner (`[0,0,0]` is the
 *   bottom-left-back corner, `size` the opposite one). The part rotates and scales around it.
 * - `offset` is where that pivot sits in the parent's frame, measured from the parent's pivot. For
 *   a root part (no `parent`) it is measured from the model origin, which is the ground point under
 *   the creature (y = 0 is the floor).
 * - Animation values are deltas from the rest pose: `pos` adds pixels to `offset`, `rot` is an XYZ
 *   Euler rotation in **degrees**, `scale` multiplies (rest `[1, 1, 1]`).
 */
import type { VoxelModel } from "./types";

/** One block is 16 model pixels. */
export const MODEL_UNIT = 1 / 16;

/** Floats per part in a {@link Pose}: pos xyz, rot xyz (degrees), scale xyz. */
export const POSE_STRIDE = 9;
/** Where each property starts inside a part's slice of a {@link Pose}. */
export const PROP_SLOT = { pos: 0, rot: 3, scale: 6 } as const;

/**
 * A pose: for every part, its pos delta (pixels), rotation (degrees) and scale, packed as
 * {@link POSE_STRIDE} floats per part in {@link CompiledRig.parts} order.
 */
export type Pose = Float32Array;

export type ModelPart = VoxelModel["parts"][number];
export type ModelAnim = VoxelModel["anims"][string];

export interface CompiledPart {
  readonly def: ModelPart;
  readonly index: number;
  /** Index of the parent part, or -1 for a root part. Always smaller than `index`. */
  readonly parent: number;
}

export interface CompiledTrack {
  /** Float offset into a pose: `part * POSE_STRIDE + PROP_SLOT[prop]`. */
  readonly at: number;
  /** Key times (ms), non-decreasing. */
  readonly times: Float64Array;
  /** Key values, 3 per key. */
  readonly values: Float64Array;
}

export interface CompiledAnim {
  readonly name: string;
  readonly durationMs: number;
  readonly loop: boolean;
  readonly tracks: readonly CompiledTrack[];
}

export interface CompiledRig {
  readonly id: string;
  /** Parent-first order: a part always comes after its parent. */
  readonly parts: readonly CompiledPart[];
  readonly anims: ReadonlyMap<string, CompiledAnim>;
}

/**
 * Orders the parts parent-first and binds the animation tracks. Throws on an unknown parent, a
 * parent cycle or a track naming an unknown part. (`parseModel` reports all of these first, with
 * friendlier messages; this is the last line of defence.)
 */
export function compileRig(def: VoxelModel): CompiledRig {
  const byName = new Map<string, ModelPart>();
  for (const part of def.parts) {
    if (byName.has(part.name)) throw new Error(`${def.id}: duplicate part "${part.name}"`);
    byName.set(part.name, part);
  }
  const order: ModelPart[] = [];
  const indexOf = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (part: ModelPart): void => {
    if (indexOf.has(part.name)) return;
    if (visiting.has(part.name)) throw new Error(`${def.id}: parent cycle at "${part.name}"`);
    visiting.add(part.name);
    if (part.parent !== undefined) {
      const parent = byName.get(part.parent);
      if (!parent) throw new Error(`${def.id}: "${part.name}" has unknown parent "${part.parent}"`);
      visit(parent);
    }
    visiting.delete(part.name);
    indexOf.set(part.name, order.length);
    order.push(part);
  };
  for (const part of def.parts) visit(part);

  const parts = order.map((part, index): CompiledPart => ({
    def: part,
    index,
    parent: part.parent === undefined ? -1 : (indexOf.get(part.parent) ?? -1),
  }));

  const anims = new Map<string, CompiledAnim>();
  for (const [name, anim] of Object.entries(def.anims)) {
    const tracks = anim.tracks.map((track): CompiledTrack => {
      const part = indexOf.get(track.part);
      if (part === undefined) {
        throw new Error(`${def.id}: anim "${name}" animates unknown part "${track.part}"`);
      }
      const times = new Float64Array(track.keys.length);
      const values = new Float64Array(track.keys.length * 3);
      track.keys.forEach((key, i) => {
        times[i] = key.t;
        values.set(key.v, i * 3);
      });
      return { at: part * POSE_STRIDE + PROP_SLOT[track.prop], times, values };
    });
    anims.set(name, { name, durationMs: anim.durationMs, loop: anim.loop, tracks });
  }
  return { id: def.id, parts, anims };
}

/** A pose with every part at rest: no offset, no rotation, scale 1. */
export function restPose(partCount: number): Pose {
  const pose = new Float32Array(partCount * POSE_STRIDE);
  for (let p = 0; p < partCount; p++) pose.fill(1, p * POSE_STRIDE + 6, p * POSE_STRIDE + 9);
  return pose;
}

/** Copies the rest pose into `out`. */
export function writeRest(out: Pose): void {
  for (let i = 0; i < out.length; i += POSE_STRIDE) {
    out.fill(0, i, i + 6);
    out.fill(1, i + 6, i + 9);
  }
}

/**
 * Writes `track`'s value at `t` (ms) into `out` at `track.at`, by linear interpolation between
 * the two keys around `t`.
 *
 * - Before the first key or after the last, a clamped track holds the nearest key.
 * - A looping track wraps instead: between its last key and the end of the loop it blends toward
 *   the first key (as if that key came again at `first.t + durationMs`), and before its first key
 *   it blends from the last one. So a loop with no key at 0 still runs seamlessly.
 * - Two keys at the same time make a step: the later key wins from that time on.
 */
export function sampleTrack(
  track: CompiledTrack,
  t: number,
  loop: boolean,
  durationMs: number,
  out: Pose,
): void {
  const { times, values, at } = track;
  const n = times.length;
  const first = times[0] ?? 0;
  const last = times[n - 1] ?? 0;
  if (n === 1 || (!loop && t <= first)) {
    copyKey(values, 0, out, at);
    return;
  }
  if (!loop && t >= last) {
    copyKey(values, n - 1, out, at);
    return;
  }
  if (t < first || t >= last) {
    // Looping, in the wrap gap between the last key and the first one of the next cycle.
    const from = t < first ? last - durationMs : last;
    const to = t < first ? first : first + durationMs;
    lerpKeys(values, n - 1, 0, (t - from) / Math.max(to - from, 1e-9), out, at);
    return;
  }
  // Binary search for the last key with time <= t.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] ?? 0) <= t) lo = mid;
    else hi = mid;
  }
  const t0 = times[lo] ?? 0;
  const t1 = times[hi] ?? 0;
  lerpKeys(values, lo, hi, t1 > t0 ? (t - t0) / (t1 - t0) : 1, out, at);
}

function copyKey(values: Float64Array, key: number, out: Pose, at: number): void {
  out[at] = values[key * 3] ?? 0;
  out[at + 1] = values[key * 3 + 1] ?? 0;
  out[at + 2] = values[key * 3 + 2] ?? 0;
}

function lerpKeys(
  values: Float64Array,
  a: number,
  b: number,
  w: number,
  out: Pose,
  at: number,
): void {
  for (let c = 0; c < 3; c++) {
    const va = values[a * 3 + c] ?? 0;
    const vb = values[b * 3 + c] ?? 0;
    out[at + c] = va + (vb - va) * w;
  }
}

/**
 * Writes the pose of `anim` at time `t` into `out`: the rest pose, then every track on top.
 * Parts and properties without a track stay at rest. `loop` defaults to the anim's own flag.
 */
export function samplePose(anim: CompiledAnim, t: number, out: Pose, loop = anim.loop): void {
  writeRest(out);
  for (const track of anim.tracks) sampleTrack(track, t, loop, anim.durationMs, out);
}
