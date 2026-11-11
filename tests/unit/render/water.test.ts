/**
 * Water material (task M2-03): the wobble system never asks for frames, and it is still when
 * motion is off (reduced motion, `?freeze`).
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { WATER_WOBBLE, createWaterMaterial } from "../../../src/render/water";

describe("createWaterMaterial", () => {
  it("is a see-through Lambert material that doesn't write depth", () => {
    const { material } = createWaterMaterial(() => true);
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.vertexColors).toBe(true);
  });

  it("wobbles while motion is on, and is still while it is off", () => {
    let on = true;
    const water = createWaterMaterial(() => on);
    water.system(16, 1000);
    expect(water.amplitude()).toBe(WATER_WOBBLE);
    on = false;
    water.system(16, 1016);
    expect(water.amplitude()).toBe(0);
  });

  it("never keeps the loop awake", () => {
    const water = createWaterMaterial(() => true);
    for (let t = 0; t < 100; t += 16) expect(water.system(16, t)).toBe(false);
  });

  it("moves only top faces, in the vertex shader", () => {
    const { material } = createWaterMaterial(() => true);
    const shader = {
      uniforms: {},
      vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n}",
      fragmentShader: "",
    };
    // reason: onBeforeCompile takes three's WebGLProgramParametersWithUniforms; the test passes
    // only the fields the hook reads.
    material.onBeforeCompile(shader as unknown as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain("uniform float uWaterTime;");
    expect(shader.vertexShader).toContain("if (normal.y > 0.5)");
    expect(Object.keys(shader.uniforms).toSorted()).toEqual(["uWaterAmp", "uWaterTime"]);
  });
});
