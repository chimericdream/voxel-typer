/**
 * Building voxel models in three.js (task M4-01): the part hierarchy, pivots, atlas UVs, the
 * shared material, tint, dispose, and the instanced builder's draw-call budget.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { tileUv } from "../../../src/render/atlas/build";
import { buildModel, buildModelInstanced } from "../../../src/render/models/build";
import { NO_ATLAS_COLOR } from "../../../src/render/models/geometry";
import { MODEL_UNIT } from "../../../src/render/models/rig";
import type { VoxelModel } from "../../../src/render/models/types";
import { critter, drawCalls, fakeAtlas, oneBox } from "./helpers";

const U = MODEL_UNIT;

function worldPos(obj: THREE.Object3D): THREE.Vector3 {
  obj.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
}

function worldBox(obj: THREE.Mesh): THREE.Box3 {
  obj.updateWorldMatrix(true, false);
  obj.geometry.computeBoundingBox();
  const box = obj.geometry.boundingBox;
  if (!box) throw new Error("no bounding box");
  return box.clone().applyMatrix4(obj.matrixWorld);
}

function expectVec(v: THREE.Vector3, x: number, y: number, z: number): void {
  expect(v.x).toBeCloseTo(x, 5);
  expect(v.y).toBeCloseTo(y, 5);
  expect(v.z).toBeCloseTo(z, 5);
}

/** A two-part arm: a 2×8×2 upper arm pivoting at its top, a hand hanging from its bottom. */
function arm(): VoxelModel {
  return {
    id: "arm",
    parts: [
      { name: "upper", size: [2, 8, 2], pivot: [1, 8, 1], offset: [0, 16, 0], color: "#aa8844" },
      {
        name: "hand",
        parent: "upper",
        size: [2, 2, 2],
        pivot: [1, 2, 1],
        offset: [0, -8, 0],
        color: "#ccaa66",
      },
    ],
    anims: {
      swing: {
        durationMs: 100,
        loop: false,
        tracks: [
          {
            part: "upper",
            prop: "rot",
            keys: [
              { t: 0, v: [0, 0, 0] },
              { t: 100, v: [0, 0, 90] },
            ],
          },
        ],
      },
      lift: {
        durationMs: 100,
        loop: false,
        tracks: [
          {
            part: "upper",
            prop: "pos",
            keys: [
              { t: 0, v: [0, 0, 0] },
              { t: 100, v: [0, 4, 0] },
            ],
          },
          {
            part: "upper",
            prop: "scale",
            keys: [
              { t: 0, v: [1, 1, 1] },
              { t: 100, v: [1, 0.5, 1] },
            ],
          },
        ],
      },
    },
  };
}

describe("buildModel: hierarchy and pivots", () => {
  it("nests each part under its parent and names the root", () => {
    const m = buildModel(critter(), fakeAtlas());
    expect(m.root.name).toBe("model:box-critter");
    expect(m.part("body")?.parent).toBe(m.root);
    expect(m.part("head")?.parent).toBe(m.part("body"));
    expect(m.part("eye-left")?.parent).toBe(m.part("head"));
    expect(m.part("leg-fl")?.parent).toBe(m.part("body"));
    let meshes = 0;
    m.root.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes++;
    });
    expect(meshes).toBe(critter().parts.length);
  });

  it("puts each pivot at its offset from the parent's pivot, in blocks (16 px)", () => {
    const m = buildModel(arm(), null);
    const upper = m.part("upper");
    const hand = m.part("hand");
    if (!upper || !hand) throw new Error("parts");
    expectVec(worldPos(upper), 0, 1, 0); // 16 px up
    expectVec(worldPos(hand), 0, 0.5, 0); // 8 px below the shoulder
    // The upper arm hangs from its pivot: its box spans y 0.5..1, centred on x.
    const box = worldBox(upper);
    expectVec(box.min, -1 * U, 0.5, -1 * U);
    expectVec(box.max, 1 * U, 1, 1 * U);
  });

  it("rotates about the pivot and carries children along", () => {
    const m = buildModel(arm(), null);
    m.play("swing", { fadeMs: 0 });
    m.update(100); // 90° about z at the shoulder
    const upper = m.part("upper");
    const hand = m.part("hand");
    if (!upper || !hand) throw new Error("parts");
    expectVec(worldPos(upper), 0, 1, 0); // the pivot doesn't move
    // The arm now points along +x from the shoulder (rotating -y by +90° about z gives +x).
    expectVec(worldPos(hand), 0.5, 1, 0);
    const box = worldBox(upper);
    expect(box.min.x).toBeCloseTo(0, 5);
    expect(box.max.x).toBeCloseTo(0.5, 5);
  });

  it("pos keys move the pivot in pixels and scale keys scale about the pivot", () => {
    const m = buildModel(arm(), null);
    m.play("lift", { fadeMs: 0 });
    m.update(100);
    const upper = m.part("upper");
    const hand = m.part("hand");
    if (!upper || !hand) throw new Error("parts");
    expectVec(worldPos(upper), 0, 1 + 4 * U, 0);
    // Half height: the box spans 4 px below the pivot, and the hand follows the scaled parent.
    const box = worldBox(upper);
    expect(box.max.y - box.min.y).toBeCloseTo(4 * U, 5);
    expectVec(worldPos(hand), 0, 1 + 4 * U - 4 * U, 0);
  });

  it("starts in the rest pose with nothing playing", () => {
    const m = buildModel(critter(), null);
    expect(m.current).toBe(null);
    expect(m.animating).toBe(false);
    expect(m.part("head")?.rotation.z).toBe(0);
  });
});

function mat(m: ReturnType<typeof buildModel>): THREE.MeshLambertMaterial {
  const material = m.part("body")?.material;
  if (!(material instanceof THREE.MeshLambertMaterial)) throw new Error("material");
  return material;
}

describe("buildModel: geometry, material and tint", () => {
  it("shares one material across every part", () => {
    const m = buildModel(critter(), fakeAtlas());
    const materials = new Set<THREE.Material>();
    m.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.Material)
        materials.add(o.material);
    });
    expect(materials.size).toBe(1);
  });

  it("maps a tiled part's faces inside its atlas tile, one texel per pixel, and leaves flat parts untextured", () => {
    const atlas = fakeAtlas();
    const m = buildModel(critter(), atlas);
    expect(atlas.tileCalls).toEqual(["grass:top"]);
    const [u0, v0, u1, v1] = tileUv(128, 3);
    const tuft = m.part("tuft");
    const body = m.part("body");
    if (!tuft || !body) throw new Error("parts");
    const uv = tuft.geometry.getAttribute("uv");
    const tex = tuft.geometry.getAttribute("vtTex");
    const us: number[] = [];
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(u0);
      expect(uv.getX(i)).toBeLessThanOrEqual(u1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(v0);
      expect(uv.getY(i)).toBeLessThanOrEqual(v1);
      expect(tex.getX(i)).toBe(1);
      us.push(uv.getX(i));
    }
    // The tuft is 4 px wide: its top face shows the middle 4/16 of the tile.
    const top = us.slice(8, 12); // BoxGeometry face 2 is +y
    expect(Math.max(...top) - Math.min(...top)).toBeCloseTo((u1 - u0) * (4 / 16), 6);
    const bodyTex = body.geometry.getAttribute("vtTex");
    for (let i = 0; i < bodyTex.count; i++) expect(bodyTex.getX(i)).toBe(0);
    // The material samples the shared atlas texture through the patch.
    const material = body.material;
    if (!(material instanceof THREE.MeshLambertMaterial)) throw new Error("material");
    expect(material.map).toBe(atlas.texture);
    expect(material.vertexColors).toBe(true);
    expect(material.customProgramCacheKey()).toBe("vt-model-tex");
  });

  it("gives flat parts their colour as vertex colours, and tiled parts grey without an atlas", () => {
    const m = buildModel(critter(), null);
    const body = m.part("body");
    const tuft = m.part("tuft");
    if (!body || !tuft) throw new Error("parts");
    const want = new THREE.Color("#7fb26a");
    const colors = body.geometry.getAttribute("color");
    expect(colors.getX(0)).toBeCloseTo(want.r, 5);
    expect(colors.getY(0)).toBeCloseTo(want.g, 5);
    expect(colors.getZ(0)).toBeCloseTo(want.b, 5);
    const grey = new THREE.Color(NO_ATLAS_COLOR);
    expect(tuft.geometry.getAttribute("color").getX(0)).toBeCloseTo(grey.r, 5);
    const material = body.material;
    if (!(material instanceof THREE.MeshLambertMaterial)) throw new Error("material");
    expect(material.map).toBe(null);
  });

  it("setTint multiplies the shared material colour and null clears it; two models don't share a tint", () => {
    const a = buildModel(critter(), null);
    const b = buildModel(critter(), null);
    a.setTint("#ff8080");
    expect(mat(a).color.getHexString()).toBe("ff8080");
    expect(mat(b).color.getHexString()).toBe("ffffff");
    a.setTint(null);
    expect(mat(a).color.getHexString()).toBe("ffffff");
  });

  it("costs one draw call per part", () => {
    const m = buildModel(critter(), fakeAtlas());
    expect(drawCalls(m.root)).toBe(critter().parts.length);
  });
});

describe("dispose", () => {
  it("frees every geometry and the material, never the shared atlas texture, and leaves the scene", () => {
    const atlas = fakeAtlas();
    const scene = new THREE.Scene();
    const m = buildModel(critter(), atlas);
    scene.add(m.root);
    const freed = { geometries: 0, materials: 0, textures: 0 };
    m.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.addEventListener("dispose", () => freed.geometries++);
    });
    const material = m.part("body")?.material;
    if (!(material instanceof THREE.Material)) throw new Error("material");
    material.addEventListener("dispose", () => freed.materials++);
    atlas.texture.addEventListener("dispose", () => freed.textures++);
    m.play("walk");
    m.dispose();
    expect(freed).toEqual({ geometries: critter().parts.length, materials: 1, textures: 0 });
    expect(m.root.parent).toBe(null);
    expect(m.animating).toBe(false);
    expect(m.play("idle")).toBe(false);
    m.dispose(); // twice is harmless
    expect(freed.geometries).toBe(critter().parts.length);
  });

  it("instanced: frees geometries, the material and the instance buffers, not the atlas", () => {
    const atlas = fakeAtlas();
    const herd = buildModelInstanced(critter(), 30, { atlas });
    const freed = { geometries: 0, materials: 0, meshes: 0, textures: 0 };
    herd.root.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) {
        o.geometry.addEventListener("dispose", () => freed.geometries++);
        o.addEventListener("dispose", () => freed.meshes++);
      }
    });
    const material = herd.part("body")?.material;
    if (!(material instanceof THREE.Material)) throw new Error("material");
    material.addEventListener("dispose", () => freed.materials++);
    atlas.texture.addEventListener("dispose", () => freed.textures++);
    herd.dispose();
    const n = critter().parts.length;
    expect(freed).toEqual({ geometries: n, materials: 1, meshes: n, textures: 0 });
  });
});

describe("buildModelInstanced", () => {
  it("30 identical mobs add no more draw calls than the model has parts", () => {
    const def = critter();
    const parts = def.parts.length;
    const scene = new THREE.Scene();
    const before = drawCalls(scene);
    const herd = buildModelInstanced(def, 30, { atlas: fakeAtlas() });
    scene.add(herd.root);
    for (let i = 0; i < 30; i++) {
      herd.place(i, { x: (i % 6) * 2, y: 0, z: Math.floor(i / 6) * 2 }, i * 0.3);
      herd.setVisible(i, true);
      herd.play(i, i % 2 === 0 ? "walk" : "idle");
    }
    herd.update(16);
    const added = drawCalls(scene) - before;
    expect(added).toBeLessThanOrEqual(parts);
    expect(added).toBe(parts);
    // The same 30 built one by one would cost 30 × parts.
    const singles = new THREE.Group();
    for (let i = 0; i < 30; i++) singles.add(buildModel(def, null).root);
    expect(drawCalls(singles)).toBe(30 * parts);
    // One InstancedMesh per part, each holding all 30.
    const meshes = herd.root.children.filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes).toHaveLength(parts);
    for (const mesh of meshes) expect(mesh instanceof THREE.InstancedMesh && mesh.count).toBe(30);
  });

  it("poses each instance exactly as a single model with the same place and anim", () => {
    const def = critter();
    const herd = buildModelInstanced(def, 3);
    const at = { x: 3, y: 1, z: -2 };
    const yaw = 0.7;
    herd.place(1, at, yaw, 1.5);
    herd.setVisible(1, true);
    herd.play(1, "walk", { fadeMs: 0 });
    const single = buildModel(def, null);
    single.root.position.set(at.x, at.y, at.z);
    single.root.rotation.y = yaw;
    single.root.scale.setScalar(1.5);
    single.play("walk", { fadeMs: 0 });
    for (const dt of [0, 40, 70]) {
      herd.update(dt);
      single.update(dt);
    }
    single.root.updateMatrixWorld(true);
    const m = new THREE.Matrix4();
    for (const part of def.parts) {
      herd.part(part.name)?.getMatrixAt(1, m);
      const want = single.part(part.name)?.matrixWorld;
      if (!want) throw new Error(part.name);
      for (let k = 0; k < 16; k++)
        expect(m.elements[k]).toBeCloseTo(want.elements[k] ?? Number.NaN, 5);
    }
  });

  it("instances start hidden (zero matrices); setVisible shows and hides them", () => {
    const herd = buildModelInstanced(critter(), 2);
    const m = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    herd.part("body")?.getMatrixAt(0, m);
    expect(m.equals(zero)).toBe(true);
    expect(herd.isVisible(0)).toBe(false);
    herd.setVisible(0, true);
    herd.update(0);
    herd.part("body")?.getMatrixAt(0, m);
    expect(m.equals(zero)).toBe(false);
    herd.setVisible(0, false);
    herd.update(0);
    herd.part("body")?.getMatrixAt(0, m);
    expect(m.equals(zero)).toBe(true);
  });

  it("each instance has its own anim, and a tint per instance", () => {
    const herd = buildModelInstanced(critter(), 3);
    herd.play(0, "walk");
    herd.play(2, "hit");
    expect([herd.current(0), herd.current(1), herd.current(2)]).toEqual(["walk", null, "hit"]);
    herd.setTint(1, "#ff0000");
    const c = new THREE.Color();
    herd.part("head")?.getColorAt(1, c);
    expect(c.getHexString()).toBe("ff0000");
    herd.part("head")?.getColorAt(0, c);
    expect(c.getHexString()).toBe("ffffff");
    herd.setTint(1, null);
    herd.part("head")?.getColorAt(1, c);
    expect(c.getHexString()).toBe("ffffff");
  });

  it("goes still once every instance's anim ends", () => {
    const herd = buildModelInstanced(critter(), 4);
    herd.update(0);
    expect(herd.animating).toBe(false);
    herd.setVisible(0, true);
    herd.play(0, "hit");
    expect(herd.animating).toBe(true);
    for (let i = 0; i < 30; i++) herd.update(16);
    expect(herd.animating).toBe(false);
  });

  it("rejects a bad count or instance index", () => {
    expect(() => buildModelInstanced(oneBox(), 0)).toThrow(RangeError);
    const herd = buildModelInstanced(oneBox(), 2);
    expect(() => herd.place(2, { x: 0, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => herd.play(-1, "idle")).toThrow(RangeError);
  });
});
