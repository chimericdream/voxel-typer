/**
 * The render loop (task M2-01).
 *
 * The loop runs `requestAnimationFrame` only while something needs frames: an `onFrame`
 * subscriber, a busy system (a camera tween, an effect) or a hit-stop. Otherwise it is idle and
 * draws one frame per `requestRender()` call, so static screens don't burn battery.
 *
 * It reads the clock exactly once per frame and passes that time down (contracts.md §13), so a
 * `fixedStepClock` under `?freeze` gives the same frames every run.
 */
import type { Ms } from "@/types/core";

/** The largest `dt` a frame reports. A slow or backgrounded tab never jumps further. */
export const MAX_FRAME_DT: Ms = 50;

/** A frame callback. `dtMs` is the time since the previous frame (0 on the first frame). */
export type FrameFn = (dtMs: Ms, t: Ms) => void;

/**
 * An internal per-frame system (camera rig, chunk rebuilds, effects). Gets the real, clamped `dt`
 * (hit-stop doesn't freeze it) and returns `true` while it needs more frames.
 */
export type SystemFn = (dtMs: Ms, t: Ms) => boolean;

/** What the loop needs from the browser. Tests pass fakes. */
export interface LoopDeps {
  raf(cb: (ts: number) => void): number;
  caf(id: number): void;
  /** Read once per frame. */
  now(): Ms;
  /** Draws the frame. Called last, after systems and subscribers. */
  render(dtMs: Ms, t: Ms): void;
  /** Receives errors thrown by subscribers, so one bad subscriber can't stop the loop. */
  onError?(err: unknown): void;
}

export interface RenderLoop {
  /** Subscribes to frames. The loop runs continuously while any subscriber is active. */
  onFrame(fn: FrameFn): () => void;
  /** Adds an internal system. Systems that become busy while the loop is idle call `wake()`. */
  addSystem(fn: SystemFn): () => void;
  /** Draws one frame soon. Several calls before that frame share it. */
  requestRender(): void;
  /** Same as `requestRender`. Systems call it when they start work. */
  wake(): void;
  /** Subscribers get `dt = 0` for the next `ms` of real time. Systems and rendering continue. */
  hitStop(ms: Ms): void;
  /** True while a frame is scheduled. */
  readonly scheduled: boolean;
  /** Number of frames drawn so far (for tests and debug). */
  readonly frames: number;
  /** Cancels any pending frame and drops every subscriber and system. */
  dispose(): void;
}

export function createLoop(deps: LoopDeps): RenderLoop {
  const subscribers = new Set<FrameFn>();
  const systems = new Set<SystemFn>();
  let handle: number | null = null;
  let lastT: Ms | null = null;
  let hitStopLeft: Ms = 0;
  let frames = 0;
  let disposed = false;

  const schedule = (): void => {
    if (disposed || handle !== null) return;
    handle = deps.raf(frame);
  };

  const report = (err: unknown): void => {
    if (deps.onError) deps.onError(err);
    else console.error(err);
  };

  function frame(): void {
    handle = null;
    if (disposed) return;
    const t = deps.now();
    const raw = lastT === null ? 0 : Math.max(0, t - lastT);
    lastT = t;
    const dt = Math.min(raw, MAX_FRAME_DT);

    const frozen = hitStopLeft > 0;
    hitStopLeft = Math.max(0, hitStopLeft - raw);
    const subDt = frozen ? 0 : dt;

    let busy = false;
    // Snapshot: a callback may (un)subscribe during the frame.
    for (const system of Array.from(systems)) {
      try {
        if (system(dt, t)) busy = true;
      } catch (err) {
        report(err);
      }
    }
    for (const fn of Array.from(subscribers)) {
      try {
        fn(subDt, t);
      } catch (err) {
        report(err);
      }
    }
    deps.render(dt, t);
    frames++;

    if (subscribers.size > 0 || busy || hitStopLeft > 0) {
      schedule();
    } else {
      // Idle: the next frame (after a requestRender) starts with dt = 0, not the idle gap.
      lastT = null;
    }
  }

  return {
    onFrame(fn) {
      const wrapped: FrameFn = (dt, t) => fn(dt, t);
      subscribers.add(wrapped);
      schedule();
      return () => {
        subscribers.delete(wrapped);
      };
    },
    addSystem(fn) {
      const wrapped: SystemFn = (dt, t) => fn(dt, t);
      systems.add(wrapped);
      return () => {
        systems.delete(wrapped);
      };
    },
    requestRender: schedule,
    wake: schedule,
    hitStop(ms) {
      if (!(ms > 0)) return;
      hitStopLeft = Math.max(hitStopLeft, ms);
      schedule();
    },
    get scheduled() {
      return handle !== null;
    },
    get frames() {
      return frames;
    },
    dispose() {
      disposed = true;
      if (handle !== null) deps.caf(handle);
      handle = null;
      subscribers.clear();
      systems.clear();
    },
  };
}
