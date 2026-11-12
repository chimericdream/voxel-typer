/**
 * Camera rig and quality table (task M2-01): preset tweens, reduced motion, drift and shake.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DRIFT_YAW, createCameraRig, easeInOutCubic, presetPose } from "../../../src/render/camera";
import { QUALITY_PRESETS, pixelRatioFor } from "../../../src/render/quality";

const BOX = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(48, 24, 48));

function rig(reduced = false, drift = false) {
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 500);
  let wakes = 0;
  let rm = reduced;
  const r = createCameraRig(camera, {
    reducedMotion: () => rm,
    drift,
    wake: () => wakes++,
  });
  r.setBounds(BOX);
  r.setTarget({ x: 24.5, y: 6.5, z: 42.5 });
  return {
    camera,
    rig: r,
    wakes: () => wakes,
    setReduced: (v: boolean) => {
      rm = v;
    },
  };
}

/** Runs the rig's system for `frames` frames of 16 ms; returns how many reported busy. */
function run(system: (dt: number, t: number) => boolean, frames: number, t0 = 0): boolean[] {
  return Array.from({ length: frames }, (_, i) => system(16, t0 + (i + 1) * 16));
}

describe("camera rig", () => {
  it("ease-in-out is symmetric and pinned at the ends", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(0.25)).toBeCloseTo(1 - easeInOutCubic(0.75));
  });

  it("mine is close and low; overview frames the whole diorama from above", () => {
    const target = { x: 24.5, y: 6.5, z: 42.5 };
    const mine = presetPose("mine", BOX, target);
    const overview = presetPose("overview", BOX, target);
    expect(mine.distance).toBeLessThan(6);
    expect(mine.pitch).toBeLessThan(THREE.MathUtils.degToRad(15));
    expect(mine.pitch).toBeGreaterThan(0);
    expect(overview.distance).toBeGreaterThan(40);
    expect(overview.pitch).toBeGreaterThan(THREE.MathUtils.degToRad(25));
    // Modes without their own preset yet use overview.
    for (const name of ["lane", "orbit", "rail"] as const) {
      expect(presetPose(name, BOX, target)).toEqual(overview);
    }
  });

  it("tweens to a preset over its duration, then goes idle", () => {
    const { rig: r, camera, wakes } = rig();
    const before = camera.position.clone();
    const w = wakes();
    r.preset("mine", { durationMs: 160 });
    expect(wakes()).toBe(w + 1);
    const busy = run(r.system, 12);
    expect(busy.slice(0, 9).every(Boolean)).toBe(true);
    expect(busy.at(-1)).toBe(false);
    const end = presetPose("mine", BOX, { x: 24.5, y: 6.5, z: 42.5 });
    expect(r.pose()).toEqual(end);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(10);
    expect(r.current).toBe("mine");
  });

  it("reduced motion snaps presets instead of tweening", () => {
    const { rig: r } = rig(true);
    r.preset("mine", { durationMs: 800 });
    expect(r.pose()).toEqual(presetPose("mine", BOX, { x: 24.5, y: 6.5, z: 42.5 }));
    expect(run(r.system, 1)).toEqual([false]);
  });

  it("drift moves the camera by at most ±0.5° yaw and keeps the loop busy", () => {
    const { rig: r, camera } = rig(false, true);
    r.preset("overview", { durationMs: 0 });
    const base = r.pose();
    const yaws: number[] = [];
    for (let t = 0; t < 20_000; t += 250) {
      expect(r.system(16, t)).toBe(true);
      const dx = camera.position.x - base.target.x;
      const dz = camera.position.z - base.target.z;
      yaws.push(Math.atan2(dx, dz) - base.yaw);
    }
    const max = Math.max(...yaws.map(Math.abs));
    expect(max).toBeGreaterThan(DRIFT_YAW * 0.9);
    expect(max).toBeLessThanOrEqual(DRIFT_YAW + 1e-9);
  });

  it("drift is off by default, so a resting rig never keeps the loop busy", () => {
    const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 500);
    const r = createCameraRig(camera, { reducedMotion: () => false, wake: () => {} });
    r.setBounds(BOX);
    const at = (t: number) => {
      expect(r.system(16, t)).toBe(false);
      return camera.position.clone();
    };
    expect(at(1000).equals(at(9000))).toBe(true);
    expect(r.drifting).toBe(false);
    r.setDrift(true);
    expect(r.drifting).toBe(true);
    expect(r.system(16, 10_000)).toBe(true);
  });

  it("setTarget snaps by default and glides when given a duration", () => {
    const { rig: r } = rig();
    r.preset("mine", { durationMs: 0 });
    const next = { x: 10.5, y: 6.5, z: 30.5 };
    r.setTarget(next, { durationMs: 160 });
    // Mid-glide: between the old and the new target.
    run(r.system, 5);
    expect(r.pose().target.x).toBeGreaterThan(10.5);
    expect(r.pose().target.x).toBeLessThan(24.5);
    expect(run(r.system, 6).at(-1)).toBe(false);
    expect(r.pose()).toEqual(presetPose("mine", BOX, next));
    // No duration: an immediate snap.
    r.setTarget({ x: 24.5, y: 6.5, z: 42.5 });
    expect(r.pose()).toEqual(presetPose("mine", BOX, { x: 24.5, y: 6.5, z: 42.5 }));
  });

  it("moveTo glides to a free pose and then goes idle; the next preset moves on from it", () => {
    const { rig: r, camera } = rig();
    const free = { target: { x: 5, y: 2, z: -30 }, yaw: 0.3, pitch: 0.4, distance: 90, fov: 35 };
    r.moveTo(free, { durationMs: 320 });
    const busy = run(r.system, 30);
    expect(busy.slice(0, 19).every(Boolean)).toBe(true);
    expect(busy.slice(20).some(Boolean)).toBe(false);
    expect(r.pose()).toEqual(free);
    expect(r.current).toBe("overview");
    expect(camera.position.distanceTo(new THREE.Vector3(5, 2, -30))).toBeCloseTo(90, 4);
    // The caller's pose object is copied, never kept.
    free.target.x = 99;
    expect(r.pose().target.x).toBe(5);
    r.preset("overview", { durationMs: 0 });
    expect(r.pose()).toEqual(presetPose("overview", BOX, { x: 24.5, y: 6.5, z: 42.5 }));
  });

  it("moveTo snaps by default and under reduced motion", () => {
    const free = { target: { x: 1, y: 2, z: 3 }, yaw: 0, pitch: 0.2, distance: 40, fov: 35 };
    const a = rig();
    const wakes = a.wakes();
    a.rig.moveTo(free);
    expect(a.rig.pose()).toEqual(free);
    expect(a.wakes()).toBe(wakes + 1);
    expect(run(a.rig.system, 2)).toEqual([false, false]);
    const b = rig(true);
    b.rig.moveTo(free, { durationMs: 500 });
    expect(b.rig.pose()).toEqual(free);
    expect(run(b.rig.system, 2)).toEqual([false, false]);
  });

  it("reduced motion makes a setTarget glide a snap", () => {
    const { rig: r } = rig(true);
    r.preset("mine", { durationMs: 0 });
    r.setTarget({ x: 10.5, y: 6.5, z: 30.5 }, { durationMs: 800 });
    expect(r.pose()).toEqual(presetPose("mine", BOX, { x: 10.5, y: 6.5, z: 30.5 }));
  });

  it("reduced motion turns drift off", () => {
    const { rig: r, camera } = rig(true, true);
    r.preset("overview", { durationMs: 0 });
    const at = (t: number) => {
      r.system(16, t);
      return camera.position.clone();
    };
    expect(at(1000).equals(at(5000))).toBe(true);
    expect(r.system(16, 6000)).toBe(false);
  });

  it("shake offsets the camera, decays to rest, and is a no-op under reduced motion", () => {
    const { rig: r, camera, setReduced } = rig();
    r.preset("overview", { durationMs: 0 });
    r.system(16, 0);
    const rest = camera.position.clone();
    r.shake(1, 400);
    r.system(16, 100);
    expect(camera.position.distanceTo(rest)).toBeGreaterThan(0.001);
    const busy = run(r.system, 40, 100);
    expect(busy.at(-1)).toBe(false);
    expect(camera.position.distanceTo(rest)).toBeLessThan(1e-9);

    setReduced(true);
    r.shake(1, 400);
    expect(r.system(16, 2000)).toBe(false);
    expect(camera.position.distanceTo(rest)).toBeLessThan(1e-9);
  });

  it("orbit offsets yaw and pitch, clamps pitch and zooms in for positive dZoom", () => {
    const { rig: r } = rig();
    r.preset("overview", { durationMs: 0 });
    const p0 = { ...r.pose() };
    r.orbit(0.1, 10, 0.5);
    const p1 = r.pose();
    expect(p1.yaw).toBeCloseTo(p0.yaw + 0.1);
    expect(p1.pitch).toBeCloseTo(THREE.MathUtils.degToRad(85));
    expect(p1.distance).toBeLessThan(p0.distance);
  });
});

describe("quality presets", () => {
  it("matches the card's table", () => {
    expect(QUALITY_PRESETS.low).toMatchObject({ shadows: false, pointLights: 0, post: false });
    expect(QUALITY_PRESETS.medium).toMatchObject({ shadows: false, pointLights: 4 });
    expect(QUALITY_PRESETS.high).toMatchObject({
      shadows: true,
      shadowMapSize: 1024,
      pointLights: 8,
    });
  });

  it("pixel ratio is min(devicePixelRatio, high ? 2 : 1)", () => {
    expect(pixelRatioFor("low", 3)).toBe(1);
    expect(pixelRatioFor("medium", 2)).toBe(1);
    expect(pixelRatioFor("high", 3)).toBe(2);
    expect(pixelRatioFor("high", 1.5)).toBe(1.5);
    expect(pixelRatioFor("high", 0.75)).toBe(0.75);
    expect(pixelRatioFor("medium", Number.NaN)).toBe(1);
  });
});
