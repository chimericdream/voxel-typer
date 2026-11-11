/**
 * Water material (task M2-03, PLAN.md §6.4).
 *
 * A transparent Lambert material like the `transparent` bucket's, plus a small vertex wobble on
 * top faces: each top vertex bobs by a sine of time and its world x/z, so neighboring quads that
 * share a corner move together and the surface never cracks. Top faces also sit a little below
 * the block top, so a pond reads as water inside its sand rim.
 *
 * The wobble never keeps the render loop awake. Its system only copies the frame time into a
 * uniform and returns `false`, so the water moves only while something else (a mode's `onFrame`,
 * a camera tween) is already drawing frames. It is still when `motion()` is false (reduced motion,
 * `?freeze`).
 */
import * as THREE from "three";
import type { SystemFn } from "./loop";

/** Wobble height in blocks. */
export const WATER_WOBBLE = 0.05;
/** How far top faces sit below the block top, in blocks. */
export const WATER_SINK = 0.12;
/** Radians per millisecond. One bob takes about 4 s. */
const WATER_SPEED = 0.0016;

export interface WaterMaterial {
  material: THREE.MeshLambertMaterial;
  /** Loop system: updates the wobble each drawn frame. Always returns false. */
  system: SystemFn;
  /** Current wobble amplitude (0 when motion is off). For tests. */
  amplitude(): number;
}

export function createWaterMaterial(motion: () => boolean): WaterMaterial {
  const uniforms = {
    uWaterTime: { value: 0 },
    uWaterAmp: { value: 0 },
  };
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  material.name = "voxel-water";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = uniforms.uWaterTime;
    shader.uniforms.uWaterAmp = uniforms.uWaterAmp;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uWaterTime;
uniform float uWaterAmp;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
if (normal.y > 0.5) {
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  float phase = uWaterTime * ${WATER_SPEED.toFixed(4)} + wp.x * 0.9 + wp.z * 0.7;
  transformed.y += -${WATER_SINK.toFixed(2)} + uWaterAmp * sin(phase) * cos(phase * 0.6 + wp.z * 0.4);
}`,
      );
  };
  material.customProgramCacheKey = () => "voxel-water";

  return {
    material,
    system(_dt, t) {
      uniforms.uWaterTime.value = t;
      uniforms.uWaterAmp.value = motion() ? WATER_WOBBLE : 0;
      return false;
    },
    amplitude: () => uniforms.uWaterAmp.value,
  };
}
