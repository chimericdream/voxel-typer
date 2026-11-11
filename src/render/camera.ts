/**
 * Camera rig (task M2-01, PLAN.md §5.1).
 *
 * The camera is described by an orbit pose around a target point (yaw, pitch, distance, fov), so
 * preset tweens move along smooth arcs and `orbit()` is a plain offset. Presets:
 * - `overview`: a gentle isometric-ish three-quarter view of the whole diorama.
 * - `mine`: close and slightly low, looking at the target block (`setTarget`) with the diorama as
 *   a backdrop behind it (the camera sits on the +z side and looks toward −z).
 * - `lane`, `orbit`, `rail` belong to later modes (M4/M5); until those tasks define them they use
 *   the `overview` pose.
 *
 * Reduced motion: preset changes snap instead of tweening, the parallax drift is off and `shake`
 * does nothing.
 */
import * as THREE from "three";
import type { Ms } from "@/types/core";
import type { SystemFn } from "./loop";
import type { CameraRig, Vec3 } from "./types";

export type PresetName = Parameters<CameraRig["preset"]>[0];

/** An orbit pose. Angles in radians; yaw 0 puts the camera on +z looking toward −z. */
export interface CameraPose {
  target: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
}

export const DEFAULT_TWEEN_MS: Ms = 800;
/** Parallax drift amplitude: ±0.5° yaw (card M2-01), ±0.25° pitch. */
export const DRIFT_YAW = THREE.MathUtils.degToRad(0.5);
export const DRIFT_PITCH = THREE.MathUtils.degToRad(0.25);
const DRIFT_PERIOD_YAW: Ms = 17_000;
const DRIFT_PERIOD_PITCH: Ms = 23_000;
const PITCH_MIN = THREE.MathUtils.degToRad(-10);
const PITCH_MAX = THREE.MathUtils.degToRad(85);
const SHAKE_DECAY_PER_S = 1.5;
const SHAKE_MAX_OFFSET = 0.3;
const SHAKE_MAX_ROLL = THREE.MathUtils.degToRad(1.5);

export const easeInOutCubic = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;

/** Shortest signed angle from `a` to `b`. */
const angleDelta = (a: number, b: number): number => {
  const d = (b - a) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
};

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** The pose of a preset for a diorama `box` and a mine `target`. */
export function presetPose(name: PresetName, box: THREE.Box3, target: Vec3): CameraPose {
  if (name === "mine") {
    return {
      target: { x: target.x, y: target.y + 0.35, z: target.z },
      yaw: THREE.MathUtils.degToRad(8),
      pitch: THREE.MathUtils.degToRad(9),
      distance: 4.2,
      fov: 50,
    };
  }
  const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  const size = box.isEmpty() ? new THREE.Vector3(16, 16, 16) : box.getSize(new THREE.Vector3());
  const fov = 35;
  // Fit the footprint's bounding circle, with the height counted at half weight.
  const radius = Math.hypot(size.x, size.z) / 2 + size.y * 0.25;
  const distance = (radius / Math.tan(THREE.MathUtils.degToRad(fov / 2))) * 0.7;
  return {
    target: { x: center.x, y: center.y - size.y * 0.3, z: center.z },
    yaw: THREE.MathUtils.degToRad(35),
    pitch: THREE.MathUtils.degToRad(33),
    distance,
    fov,
  };
}

/** Writes a pose into a camera (no drift or shake). */
export function applyPose(camera: THREE.PerspectiveCamera, pose: CameraPose): void {
  const { target: tg, yaw, pitch, distance } = pose;
  const cp = Math.cos(pitch);
  camera.position.set(
    tg.x + distance * cp * Math.sin(yaw),
    tg.y + distance * Math.sin(pitch),
    tg.z + distance * cp * Math.cos(yaw),
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(tg.x, tg.y, tg.z);
  if (camera.fov !== pose.fov) {
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }
}

export interface CameraRigOptions {
  /** Read on every use, so a settings change applies at once. */
  reducedMotion: () => boolean;
  /** Ambient parallax drift (off under `?freeze`). Reduced motion turns it off regardless. */
  drift?: boolean;
  /** Called when the rig starts moving, so the loop schedules frames. */
  wake: () => void;
}

/** The contract's rig plus what the scene needs to drive it. */
export interface CameraRigCore extends CameraRig {
  /** The diorama bounds the presets frame. Re-applies the current preset. */
  setBounds(box: THREE.Box3): void;
  /** The mine target block's center. Re-applies the current preset. */
  setTarget(at: Vec3): void;
  setDrift(on: boolean): void;
  readonly current: PresetName;
  /** The base pose (without drift and shake). */
  pose(): Readonly<CameraPose>;
  /** Per-frame update; the scene registers it with the loop. */
  readonly system: SystemFn;
}

interface Tween {
  from: CameraPose;
  to: CameraPose;
  elapsed: Ms;
  duration: Ms;
}

export function createCameraRig(
  camera: THREE.PerspectiveCamera,
  opts: CameraRigOptions,
): CameraRigCore {
  let box = new THREE.Box3();
  let target: Vec3 = { x: 0, y: 0, z: 0 };
  let current: PresetName = "overview";
  let pose = presetPose(current, box, target);
  let tween: Tween | null = null;
  let drift = opts.drift ?? true;
  let trauma = 0;
  let shakeLeft: Ms = 0;

  const driftOn = (): boolean => drift && !opts.reducedMotion();

  const write = (t: Ms): void => {
    const p = { ...pose };
    if (driftOn()) {
      p.yaw += DRIFT_YAW * Math.sin((t / DRIFT_PERIOD_YAW) * Math.PI * 2);
      p.pitch += DRIFT_PITCH * Math.sin((t / DRIFT_PERIOD_PITCH) * Math.PI * 2);
    }
    applyPose(camera, p);
    if (trauma > 0 && !opts.reducedMotion()) {
      // offset = trauma² × noise; sums of incommensurate sines give smooth, deterministic noise.
      const k = trauma * trauma;
      const s = t / 1000;
      const nx = Math.sin(s * 37.1) * 0.6 + Math.sin(s * 71.3 + 1.7) * 0.4;
      const ny = Math.sin(s * 43.7 + 0.9) * 0.6 + Math.sin(s * 89.9 + 2.3) * 0.4;
      const nr = Math.sin(s * 29.3 + 3.1) * 0.6 + Math.sin(s * 61.7 + 0.4) * 0.4;
      camera.translateX(nx * k * SHAKE_MAX_OFFSET);
      camera.translateY(ny * k * SHAKE_MAX_OFFSET);
      camera.rotateZ(nr * k * SHAKE_MAX_ROLL);
    }
    camera.updateMatrixWorld();
  };

  const goTo = (name: PresetName, durationMs: Ms): void => {
    current = name;
    const to = presetPose(name, box, target);
    if (durationMs <= 0 || opts.reducedMotion()) {
      tween = null;
      pose = to;
    } else {
      tween = {
        from: { ...pose, target: { ...pose.target } },
        to,
        elapsed: 0,
        duration: durationMs,
      };
    }
    opts.wake();
  };

  const system: SystemFn = (dt, t) => {
    if (tween) {
      tween.elapsed += dt;
      const k = easeInOutCubic(Math.min(1, tween.elapsed / tween.duration));
      const { from, to } = tween;
      pose = {
        target: {
          x: lerp(from.target.x, to.target.x, k),
          y: lerp(from.target.y, to.target.y, k),
          z: lerp(from.target.z, to.target.z, k),
        },
        yaw: from.yaw + angleDelta(from.yaw, to.yaw) * k,
        pitch: lerp(from.pitch, to.pitch, k),
        distance: lerp(from.distance, to.distance, k),
        fov: lerp(from.fov, to.fov, k),
      };
      if (tween.elapsed >= tween.duration) {
        pose = to;
        tween = null;
      }
    }
    if (trauma > 0) {
      shakeLeft -= dt;
      trauma = shakeLeft <= 0 ? 0 : Math.max(0, trauma - (SHAKE_DECAY_PER_S * dt) / 1000);
    }
    write(t);
    return tween !== null || trauma > 0 || driftOn();
  };

  // Place the camera before the first frame.
  write(0);

  return {
    preset(name, presetOpts) {
      goTo(name, presetOpts?.durationMs ?? DEFAULT_TWEEN_MS);
    },
    orbit(dYaw, dPitch, dZoom) {
      tween = null;
      pose = {
        ...pose,
        yaw: pose.yaw + dYaw,
        pitch: THREE.MathUtils.clamp(pose.pitch + dPitch, PITCH_MIN, PITCH_MAX),
        // Positive dZoom moves closer.
        distance: Math.max(1, pose.distance * Math.exp(-dZoom)),
      };
      opts.wake();
    },
    shake(intensity01, durationMs) {
      if (opts.reducedMotion() || !(intensity01 > 0) || !(durationMs > 0)) return;
      trauma = Math.min(1, trauma + intensity01);
      shakeLeft = Math.max(shakeLeft, durationMs);
      opts.wake();
    },
    setBounds(next) {
      box = next.clone();
      goTo(current, 0);
    },
    setTarget(at) {
      target = { ...at };
      goTo(current, 0);
    },
    setDrift(on) {
      drift = on;
      opts.wake();
    },
    get current() {
      return current;
    },
    pose: () => pose,
    system,
  };
}
