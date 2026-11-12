/**
 * Plays a model's animations into a {@link Pose} (task M4-01). No three.js and no clock: time only
 * moves through `update(dtMs)`.
 *
 * - Each track interpolates linearly between its keys (`sampleTrack`).
 * - A looping anim wraps; a clamped one holds its last pose and then fires `onEnd` once.
 * - Switching anims crossfades for {@link CROSSFADE_MS}: the pose at the moment of the switch
 *   blends linearly into the new anim, which already runs during the fade.
 * - **Reduced motion:** while `reducedMotion()` is true, a *looping* anim (idle, walk, …) holds
 *   its first frame and stops asking for frames. One-shot anims (hit, defeat) still play, since
 *   they carry feedback and their `onEnd` drives game logic.
 */
import type { Ms } from "@/types/core";
import { restPose, samplePose, writeRest } from "./rig";
import type { CompiledAnim, CompiledRig, Pose } from "./rig";

/** The default blend between two anims. */
export const CROSSFADE_MS: Ms = 120;

export interface PlayOptions {
  /** Overrides the anim's own `loop` flag. */
  loop?: boolean;
  /** Blend time from the current pose. Default {@link CROSSFADE_MS}; 0 snaps. */
  fadeMs?: Ms;
  /** Playback rate. Default 1. */
  speed?: number;
  /** Start again from 0 even if this anim is already playing. Default false. */
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

  /** Time into the current anim (ms), before looping wraps it. */
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
    return !(this.loop && this.reducedMotion());
  }

  /**
   * Starts `name`. Returns false (and changes nothing) for an anim the model doesn't have, so a
   * mode asking a pet for `hit` it lacks never crashes the game. Playing the anim that is already
   * running only updates `onEnd`, unless `restart` is set.
   */
  play(name: string, opts: PlayOptions = {}): boolean {
    const anim = this.rig.anims.get(name);
    if (!anim) return false;
    if (this.anim === anim && !opts.restart && !this.ended) {
      if (opts.onEnd) this.onEnd = opts.onEnd;
      if (opts.speed !== undefined) this.speed = opts.speed;
      return true;
    }
    this.startFade(opts.fadeMs ?? CROSSFADE_MS);
    this.anim = anim;
    this.time = 0;
    this.loop = opts.loop ?? anim.loop;
    this.speed = opts.speed ?? 1;
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
    const dt = Math.max(0, dtMs);
    let finished = false;
    const anim = this.anim;
    if (anim) {
      if (this.loop && this.reducedMotion()) {
        this.time = 0;
      } else if (!this.ended) {
        this.time += dt * this.speed;
        if (this.loop) {
          this.time %= anim.durationMs;
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

  private startFade(fadeMs: Ms): void {
    this.pending = true;
    if (fadeMs > 0) {
      this.from.set(this.pose);
      this.fadeMs = fadeMs;
      this.fadeLeft = fadeMs;
    } else {
      this.fadeLeft = 0;
    }
  }
}
