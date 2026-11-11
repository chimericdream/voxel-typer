/**
 * Light rig (task M2-01): the shadow map's render target is freed when quality drops from high,
 * and the point light cap follows the quality level.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createLightRig } from "../../../src/render/lights";
import { QUALITY_PRESETS } from "../../../src/render/quality";

const lamp = (x: number) => ({ at: { x, y: 1, z: 1 }, color: "#ffcf7a", intensity: 3 });

describe("light rig", () => {
  it("frees the shadow render target when shadows turn off", () => {
    const rig = createLightRig(new THREE.Scene(), QUALITY_PRESETS.high);
    expect(rig.sun.castShadow).toBe(true);
    // three.js allocates the map on the first shadow pass; stand in for that.
    const target = new THREE.WebGLRenderTarget(1024, 1024);
    let freed = false;
    target.addEventListener("dispose", () => {
      freed = true;
    });
    rig.sun.shadow.map = target;

    rig.setQuality(QUALITY_PRESETS.medium);
    expect(rig.sun.castShadow).toBe(false);
    expect(freed).toBe(true);
    expect(rig.sun.shadow.map).toBeNull();

    rig.setQuality(QUALITY_PRESETS.high);
    expect(rig.sun.castShadow).toBe(true);
    rig.dispose();
  });

  it("caps point lights by quality and lights the lamps nearest the focus", () => {
    const scene = new THREE.Scene();
    const rig = createLightRig(scene, QUALITY_PRESETS.medium);
    rig.setLamps(
      Array.from({ length: 10 }, (_, i) => lamp(i * 2)),
      { x: 0, y: 0, z: 0 },
    );
    expect(rig.lamps).toHaveLength(4);
    expect(rig.lamps.map((l) => l.position.x)).toEqual([0.5, 2.5, 4.5, 6.5]);
    rig.setQuality(QUALITY_PRESETS.high);
    expect(rig.lamps).toHaveLength(8);
    rig.setQuality(QUALITY_PRESETS.low);
    expect(rig.lamps).toHaveLength(0);
    expect(scene.children.filter((o) => o instanceof THREE.PointLight)).toHaveLength(0);
    rig.dispose();
  });
});
