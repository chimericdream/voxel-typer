/**
 * Builder's cursor frame (M4-FIX-1): how thick its bars are in the open and when the cursor is
 * buried, and how many meshes draw in each case. No renderer: the meshes are read directly.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createBuilderView } from "../../../../src/modes/builder/view";

function setup() {
  const scene = new THREE.Scene();
  const view = createBuilderView({
    scene,
    atlas: () => null,
    reducedMotion: () => true,
    frozen: true,
  });
  const root = scene.getObjectByName("builder");
  if (root === undefined) throw new Error("no builder group");
  const bars = (): THREE.InstancedMesh[] => {
    const out: THREE.InstancedMesh[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) out.push(o);
    });
    return out;
  };
  /** The meshes that draw: visible, with every parent visible. */
  const drawn = (): THREE.InstancedMesh[] =>
    bars().filter((m) => {
      for (let o: THREE.Object3D | null = m; o !== null; o = o.parent) if (!o.visible) return false;
      return true;
    });
  return { scene, view, bars, drawn };
}

/** How thick a frame's bars are: the smallest scale of its first bar. */
function thickness(mesh: THREE.InstancedMesh): number {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(0, m);
  const scale = new THREE.Vector3();
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  return Math.min(scale.x, scale.y, scale.z);
}

describe("the cursor frame", () => {
  it("in the open: two frames of bars 0.085 thick (0.06 before M4-FIX-1)", () => {
    const { view, drawn } = setup();
    view.setCursor({ x: 3, y: 4, z: 5 }, false);
    const shown = drawn();
    expect(shown).toHaveLength(2);
    for (const m of shown) {
      expect(m.count).toBe(12);
      expect(thickness(m)).toBeCloseTo(0.085, 5);
    }
  });

  it("buried: a bold frame 2.5 times as thick over a wider dark outline, three draws", () => {
    const { view, drawn } = setup();
    view.setCursor({ x: 3, y: 4, z: 5 }, true);
    const shown = drawn();
    expect(shown).toHaveLength(3);
    const widths = shown.map(thickness).toSorted((a, b) => a - b);
    expect(widths[0]).toBeCloseTo(0.085, 5);
    expect(widths[1]).toBeCloseTo(0.085 * 2.5, 5);
    expect(widths[2]).toBeGreaterThan(widths[1] ?? 0);
    // Back in the open, the bold frame and the outline go away again.
    view.setCursor({ x: 3, y: 9, z: 5 }, false);
    expect(drawn()).toHaveLength(2);
  });

  it("disposes without leaving anything in the scene", () => {
    const { scene, view } = setup();
    view.dispose();
    expect(scene.getObjectByName("builder")).toBeUndefined();
  });
});
