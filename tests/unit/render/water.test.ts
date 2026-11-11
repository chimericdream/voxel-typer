/**
 * Water material (task M2-03): the wobble system never asks for frames, and it is still when
 * motion is off (reduced motion, `?freeze`).
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { WATER_WOBBLE, createWaterMaterial, patchWaterShader } from "../../../src/render/water";

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
    const out = patchWaterShader(
      ["#include <common>", "void main() {", "#include <begin_vertex>", "}"].join("\n"),
    );
    expect(out).toContain("uniform float uWaterTime;");
    expect(out).toContain("uniform float uWaterAmp;");
    expect(out).toContain("if (normal.y > 0.5)");
    // The offset comes after begin_vertex, where `transformed` exists.
    expect(out.indexOf("#include <begin_vertex>")).toBeLessThan(out.indexOf("transformed.y +="));
  });
});
