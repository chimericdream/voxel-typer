/**
 * Plays a model's animations into a {@link Pose} (task M4-01). No three.js and no clock: time only
 * moves through `update(dtMs)`.
 *
 * - Each track interpolates linearly between its keys (`sampleTrack`).
 * - A looping anim wraps; a clamped one holds its last pose and then fires `onEnd` once.
 * - Switching anims crossfades for {@link CROSSFADE_MS}: the pose at the moment of the switch
 *   blends linearly into the new anim, which already runs during the fade.
 * - **Reduced motion:** while `reducedMotion()` is true, a *looping* anim (idle, walk, …) snaps to
 *   its first frame (also when the setting turns on mid-loop) and stops asking for frames.
 *   One-shot anims (hit, defeat) still play, since they carry feedback and their `onEnd` drives
 *   game logic.
 * - **Bad timing input is safe:** a `dtMs` that is negative, NaN or infinite counts as 0. A `speed`
 *   that isn't a positive finite number means "no playback": a looping anim holds its first frame
 *   (like reduced motion) and a one-shot jumps to its end pose and fires `onEnd`, so nothing waits
 *   forever and the loop can idle.
 */
import type { Ms } from "@/types/core";
import { restPose, samplePose, writeRest } from "./rig";
import type { CompiledAnim, CompiledRig, Pose } from "./rig";

/** The default blend between two anims. */
export const CROSSFADE_MS: Ms = 120;

export interface PlayOptions {
  /** Overrides the anim's own `loop` flag. */
  loop?: boolean;
  /** Blend time from the current pose. Default {@link CROSSFADE_MS}; 0 (or a bad value) snaps. */
  fadeMs?: Ms;
  /**
   * Playback rate. Default 1. Zero, negative or non-finite means no playback: a loop holds its
   * first frame, a one-shot jumps to its end (and fires `onEnd`).
   */
  speed?: number;
  /**
   * Start again from 0 even if this anim is already playing. Default false. A one-shot that has
   * already ended always starts again.
   */
  restart?: boolean;
  /**
   * Called once when a clamped (non-looping) anim reaches its end. Not called for a looping anim,
   * or when another `play`/`stop` replaces this one first.
   */
  onEnd?: () => void;
}

export interface AnimatorOptions {
  /** Read on every update. True holds looping anims still (see the file comment). */
  reducedMotion?: () => boolean;
}

export class Animator {
  /** The pose to draw. Written by `update`. */
  readonly pose: Pose;
  private readonly target: Pose;
  private readonly from: Pose;
  private anim: CompiledAnim | null = null;
  private time = 0;
  private loop = false;
  private speed = 1;
  private ended = false;
  private onEnd: (() => void) | null = null;
  private fadeMs = 0;
  private fadeLeft = 0;
  /** A pose change waits to be written (after `play`/`stop`, even with no time passing). */
  private pending = false;
  private readonly reducedMotion: () => boolean;

  constructor(
    readonly rig: CompiledRig,
    opts: AnimatorOptions = {},
  ) {
    const n = rig.parts.length;
    this.pose = restPose(n);
    this.target = restPose(n);
    this.from = restPose(n);
    this.reducedMotion = opts.reducedMotion ?? (() => false);
  }

  /** The playing anim's name, or null when stopped. A finished clamped anim still counts. */
  get current(): string | null {
    return this.anim?.name ?? null;
  }

  /** Time into the current anim (ms). A loop's time wraps into [0, durationMs). */
  get timeMs(): Ms {
    return this.time;
  }

  /**
   * True while the pose still changes: a fade, a running anim, or a pose not written yet. A
   * finished clamped anim, a stopped model and (under reduced motion) a looping anim are still.
   */
  get animating(): boolean {
    if (this.pending || this.fadeLeft > 0) return true;
    if (!this.anim || this.ended) return false;
    // A held loop needs one more update if it isn't on its first frame yet (reduced motion
    // switched on mid-loop), then it is still.
    if (this.loop && this.holding()) return this.time !== 0;
    return true;
  }

  /**
   * Starts `name`. Returns false (and changes nothing) for an anim the model doesn't have, so a
   * mode asking a pet for `hit` it lacks never crashes the game. Playing the anim that is already
   * running keeps its time and only applies the given `onEnd`, `speed` and `loop`, unless
   * `restart` is set.
   */
  play(name: string, opts: PlayOptions = {}): boolean {
    const anim = this.rig.anims.get(name);
    if (!anim) return false;
    if (this.anim === anim && !opts.restart && !this.ended) {
      if (opts.onEnd) this.onEnd = opts.onEnd;
      if (opts.speed !== undefined) this.speed = safeSpeed(opts.speed);
      if (opts.loop !== undefined) this.loop = opts.loop;
      return true;
    }
    this.startFade(opts.fadeMs ?? CROSSFADE_MS);
    this.anim = anim;
    this.time = 0;
    this.loop = opts.loop ?? anim.loop;
    this.speed = safeSpeed(opts.speed ?? 1);
    this.ended = false;
    this.onEnd = opts.onEnd ?? null;
    return true;
  }

  /** Blends back to the rest pose and stops. */
  stop(opts: { fadeMs?: Ms } = {}): void {
    this.startFade(opts.fadeMs ?? CROSSFADE_MS);
    this.anim = null;
    this.ended = false;
    this.onEnd = null;
  }

  /** Advances time by `dtMs` and writes {@link pose}. Returns true if the pose may have changed. */
  update(dtMs: Ms): boolean {
    if (!this.animating) return false;
    this.pending = false;
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
    let finished = false;
    const anim = this.anim;
    if (anim) {
      if (this.loop && this.holding()) {
        this.time = 0;
      } else if (!this.ended) {
        // speed 0 marks "no playback": a one-shot goes straight to its end.
        this.time = this.speed > 0 ? this.time + dt * this.speed : anim.durationMs;
        if (this.loop) {
          const d = anim.durationMs;
          this.time = ((this.time % d) + d) % d;
        } else if (this.time >= anim.durationMs) {
          this.time = anim.durationMs;
          this.ended = true;
          finished = true;
        }
      }
      samplePose(anim, this.time, this.target, this.loop);
    } else {
      writeRest(this.target);
    }

    if (this.fadeLeft > 0) {
      this.fadeLeft = Math.max(0, this.fadeLeft - dt);
      const w = 1 - this.fadeLeft / this.fadeMs;
      const { pose, from, target } = this;
      for (let i = 0; i < pose.length; i++) {
        const a = from[i] ?? 0;
        pose[i] = a + ((target[i] ?? 0) - a) * w;
      }
    } else {
      this.pose.set(this.target);
    }

    if (finished && this.onEnd) {
      const cb = this.onEnd;
      this.onEnd = null;
      cb();
    }
    return true;
  }

  /** True when a looping anim should sit still on its first frame. */
  private holding(): boolean {
    return this.speed <= 0 || this.reducedMotion();
  }

  private startFade(fadeMs: Ms): void {
    this.pending = true;
    if (Number.isFinite(fadeMs) && fadeMs > 0) {
      this.from.set(this.pose);
      this.fadeMs = fadeMs;
      this.fadeLeft = fadeMs;
    } else {
      this.fadeLeft = 0;
    }
  }
}

/** A playback rate, or 0 for "no playback" when `speed` isn't a positive finite number. */
function safeSpeed(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? speed : 0;
}
