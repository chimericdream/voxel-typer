/** Shared fixtures for the voxel model tests (task M4-01). */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import type { ModelAtlas } from "../../../src/render/models/geometry";
import type { VoxelModel } from "../../../src/render/models/types";
import { parseModel } from "../../../src/render/models/validate";

export const CRITTER_PATH = new URL("./box-critter.model.json", import.meta.url);

/** The sample box creature, parsed through the real validator. */
export function critter(): VoxelModel {
  const json: unknown = JSON.parse(readFileSync(CRITTER_PATH, "utf8"));
  return parseModel(json, "box-critter.model.json");
}

/** A minimal model: one root part and the given anims. */
export function oneBox(anims: VoxelModel["anims"] = {}): VoxelModel {
  return {
    id: "one-box",
    parts: [
      { name: "box", size: [2, 2, 2], pivot: [1, 0, 1], offset: [0, 0, 0], color: "#ff0000" },
    ],
    anims,
  };
}

/** A 128-px fake atlas whose every face is tile 3. */
export function fakeAtlas(): ModelAtlas & { tileCalls: string[] } {
  const tileCalls: string[] = [];
  return {
    texture: new THREE.Texture(),
    canvas: { width: 128 },
    tileOf(blockId, face) {
      tileCalls.push(`${blockId}:${face}`);
      return 3;
    },
    tileCalls,
  };
}

/**
 * The draw calls three.js's WebGLRenderer would issue for `root`: one per visible mesh with
 * something to draw (one per material group when the material is an array). An InstancedMesh is
 * one call however many instances it has (`renderBufferDirect` uses one instanced draw), and none
 * when its `count` is 0. This mirrors `WebGLRenderer.projectObject` minus frustum culling, which
 * can only lower the number.
 */
export function drawCalls(root: THREE.Object3D): number {
  let calls = 0;
  const visit = (obj: THREE.Object3D): void => {
    if (!obj.visible) return;
    if (obj instanceof THREE.Mesh) {
      const geometry: THREE.BufferGeometry = obj.geometry;
      const drawable = (geometry.index ?? geometry.getAttribute("position")).count > 0;
      const instancesOk = !(obj instanceof THREE.InstancedMesh) || obj.count > 0;
      if (drawable && instancesOk) {
        const material: THREE.Material | THREE.Material[] = obj.material;
        calls += Array.isArray(material) ? geometry.groups.length : 1;
      }
    }
    for (const child of obj.children) visit(child);
  };
  visit(root);
  return calls;
}
