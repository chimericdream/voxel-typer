/**
 * Building voxel models in three.js (task M4-01): the part hierarchy, pivots, atlas UVs, the
 * shared material, tint, dispose, and the instanced builder's draw-call budget.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { tileUv } from "../../../src/render/atlas/build";
import { buildModel, buildModelInstanced } from "../../../src/render/models/build";
import { NO_ATLAS_COLOR, patchModelShader } from "../../../src/render/models/geometry";
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

// ---------------------------------------------------------------------------------------------
// Review B1 (PR #157): geometry, UVs, GPU uploads and the shader patch, each pinned so the
// mutation it targets fails a test.

/** A model whose pivots are off-centre on every axis, and tiled parts with odd and wide sizes. */
function lopsided(): VoxelModel {
  return {
    id: "lopsided",
    parts: [
      { name: "trunk", size: [6, 5, 8], pivot: [1, 2, 3], offset: [0, 0, 0], color: "#336699" },
      {
        name: "patch",
        parent: "trunk",
        size: [5, 3, 7],
        pivot: [4, 0.5, 6],
        offset: [1, 2, 3],
        tile: { blockId: "grass", face: "side" },
      },
      {
        name: "slab",
        parent: "trunk",
        size: [20, 1, 16],
        pivot: [0, 0, 0],
        offset: [0, 5, 0],
        tile: { blockId: "grass", face: "top" },
      },
    ],
    anims: {},
  };
}

describe("part boxes sit around their pivots on all three axes", () => {
  const models: [string, VoxelModel][] = [
    ["box-critter", critter()],
    ["lopsided", lopsided()],
  ];
  for (const [label, def] of models) {
    it(`${label}: every part spans [-pivot, size - pivot] in model pixels`, () => {
      const m = buildModel(def, fakeAtlas());
      for (const part of def.parts) {
        const geometry = m.part(part.name)?.geometry;
        if (!geometry) throw new Error(part.name);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        if (!box) throw new Error("bbox");
        expectVec(box.min, -part.pivot[0] * U, -part.pivot[1] * U, -part.pivot[2] * U);
        expectVec(
          box.max,
          (part.size[0] - part.pivot[0]) * U,
          (part.size[1] - part.pivot[1]) * U,
          (part.size[2] - part.pivot[2]) * U,
        );
      }
    });
  }
});

interface FaceTexels {
  uAxis: number;
  vAxis: number;
  u: number[];
  v: number[];
}

/**
 * For each of the 6 faces of `mesh`: which axis its u and v run along (found from the vertex
 * positions, not from the code under test) and the texel span they show inside the tile.
 */
function faceTexels(mesh: THREE.Mesh): FaceTexels[] {
  const [u0, v0, u1, v1] = tileUv(128, 3);
  const pos = mesh.geometry.getAttribute("position");
  const uv = mesh.geometry.getAttribute("uv");
  const faces: FaceTexels[] = [];
  for (let f = 0; f < 6; f++) {
    const idx = [0, 1, 2, 3].map((k) => f * 4 + k);
    // Two corners with the same `other` uv and a different `coord` uv: the position axis that
    // differs between them is the one `coord` runs along.
    const axisOf = (coord: (i: number) => number, other: (i: number) => number): number => {
      for (const i of idx) {
        for (const j of idx) {
          if (Math.abs(other(i) - other(j)) < 1e-9 && Math.abs(coord(i) - coord(j)) > 1e-9) {
            const d = [
              pos.getX(i) - pos.getX(j),
              pos.getY(i) - pos.getY(j),
              pos.getZ(i) - pos.getZ(j),
            ];
            return d.findIndex((x) => Math.abs(x) > 1e-9);
          }
        }
      }
      throw new Error(`face ${f}: no axis`);
    };
    faces.push({
      uAxis: axisOf(
        (i) => uv.getX(i),
        (i) => uv.getY(i),
      ),
      vAxis: axisOf(
        (i) => uv.getY(i),
        (i) => uv.getX(i),
      ),
      u: span(idx.map((i) => toTexel(uv.getX(i), u0, u1))),
      v: span(idx.map((i) => toTexel(uv.getY(i), v0, v1))),
    });
  }
  return faces;
}

/** The texel span a face `px` pixels long should show: whole texels, centred, or the whole tile. */
function wantSpan(px: number): number[] {
  if (px >= 16) return [0, 16];
  const start = Math.floor((16 - px) / 2);
  return [start, start + px];
}

describe("tiled faces: one texel per pixel, centred on whole texels, on the right axes", () => {
  const cases: [string, VoxelModel, string][] = [
    ["the 4×2×4 tuft", critter(), "tuft"],
    ["an odd 5×3×7 patch", lopsided(), "patch"],
    ["a 20×1×16 slab (wider than a tile)", lopsided(), "slab"],
  ];
  for (const [label, def, name] of cases) {
    it(label, () => {
      const m = buildModel(def, fakeAtlas());
      const mesh = m.part(name);
      const size = def.parts.find((p) => p.name === name)?.size;
      if (!mesh || !size) throw new Error(name);
      const faces = faceTexels(mesh);
      // Every face runs along two different axes, and together the faces cover all three.
      expect(new Set(faces.flatMap((f) => [f.uAxis, f.vAxis]))).toEqual(new Set([0, 1, 2]));
      for (const face of faces) {
        expect(face.uAxis).not.toBe(face.vAxis);
        const u = face.u.map((x) => Math.round(x * 1000) / 1000);
        const v = face.v.map((x) => Math.round(x * 1000) / 1000);
        expect(u).toEqual(wantSpan(size[face.uAxis] ?? Number.NaN));
        expect(v).toEqual(wantSpan(size[face.vAxis] ?? Number.NaN));
      }
    });
  }
});

describe("instanced GPU uploads", () => {
  it("bumps instanceMatrix.version when an update moves an instance, and not when nothing moved", () => {
    const herd = buildModelInstanced(critter(), 3);
    const body = herd.part("body");
    const leg = herd.part("leg-fl");
    if (!body || !leg) throw new Error("parts");
    const v0 = body.instanceMatrix.version;
    herd.place(0, { x: 1, y: 0, z: 2 });
    herd.setVisible(0, true);
    herd.update(16);
    const v1 = body.instanceMatrix.version;
    expect(v1).toBeGreaterThan(v0);
    herd.update(16); // nothing changed
    expect(body.instanceMatrix.version).toBe(v1);
    const legBefore = leg.instanceMatrix.version;
    herd.play(0, "walk", { fadeMs: 0 });
    herd.update(16); // animation alone also uploads
    expect(leg.instanceMatrix.version).toBeGreaterThan(legBefore);
  });

  it("bumps instanceColor.version on setTint", () => {
    const herd = buildModelInstanced(critter(), 3);
    const head = herd.part("head");
    const before = head?.instanceColor?.version ?? Number.NaN;
    herd.setTint(2, "#ffaa00");
    expect(head?.instanceColor?.version).toBeGreaterThan(before);
  });
});

/** Runs the model material's own onBeforeCompile hook on a copy of three's Lambert shader. */
function patchedLambert(): { vertexShader: string; fragmentShader: string } {
  const material = buildModel(critter(), fakeAtlas()).part("body")?.material;
  if (!(material instanceof THREE.MeshLambertMaterial)) throw new Error("material");
  // The hook is patchModelShader itself, which only reads and writes the two shader strings.
  const hook: unknown = Reflect.get(material, "onBeforeCompile");
  expect(hook).toBe(patchModelShader);
  const shader = {
    vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
  };
  patchModelShader(shader);
  return shader;
}

const toTexel = (x: number, a: number, b: number): number => ((x - a) / (b - a)) * 16;
const span = (vals: number[]): number[] => [Math.min(...vals), Math.max(...vals)];

describe("the shader patch", () => {
  it("declares and passes vVtTex, and weights the atlas texel by it instead of three's map_fragment", () => {
    const { vertexShader, fragmentShader } = patchedLambert();
    expect(vertexShader).toContain("attribute float vtTex;");
    expect(vertexShader).toContain("varying float vVtTex;");
    expect(vertexShader).toMatch(/#include <uv_vertex>\s*vVtTex = vtTex;/);
    expect(fragmentShader).toContain("varying float vVtTex;");
    expect(fragmentShader).toContain(
      "diffuseColor *= mix( vec4( 1.0 ), sampledDiffuseColor, vVtTex );",
    );
    // three's own chunk (diffuseColor *= sampledDiffuseColor for every fragment) is gone.
    expect(fragmentShader).not.toContain("#include <map_fragment>");
    expect(fragmentShader).not.toMatch(/diffuseColor \*= sampledDiffuseColor/);
    // Declared before use: the varying comes before main() in both stages.
    for (const src of [vertexShader, fragmentShader]) {
      expect(src.indexOf("varying float vVtTex;")).toBeLessThan(src.indexOf("void main()"));
    }
  });

  it("throws, naming the anchor, when three.js no longer has a chunk it patches", () => {
    for (const anchor of [
      "#include <uv_pars_vertex>",
      "#include <uv_vertex>",
      "#include <uv_pars_fragment>",
      "#include <map_fragment>",
    ]) {
      const shader = {
        vertexShader: THREE.ShaderLib.lambert.vertexShader.replace(anchor, ""),
        fragmentShader: THREE.ShaderLib.lambert.fragmentShader.replace(anchor, ""),
      };
      expect(() => patchModelShader(shader), anchor).toThrow(anchor);
    }
    const twice = {
      vertexShader: `${THREE.ShaderLib.lambert.vertexShader}\n#include <uv_vertex>`,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    };
    expect(() => patchModelShader(twice)).toThrow(/exactly once/);
  });

  it("a model of flat colours only gets a plain material with no patch and no map", () => {
    const material = buildModel(arm(), fakeAtlas()).part("upper")?.material;
    if (!(material instanceof THREE.MeshLambertMaterial)) throw new Error("material");
    expect(material.map).toBe(null);
    expect(material.customProgramCacheKey()).not.toBe("vt-model-tex");
  });
});

describe("hidden instances", () => {
  it("don't advance, don't keep the herd animating, and resume when shown", () => {
    const herd = buildModelInstanced(critter(), 4);
    herd.setVisible(1, true);
    herd.play(1, "walk", { fadeMs: 0 });
    herd.update(50);
    expect(herd.animating).toBe(true);
    const leg = herd.part("leg-fl");
    if (!leg) throw new Error("leg");
    const before = new THREE.Matrix4();
    leg.getMatrixAt(1, before);
    herd.setVisible(1, false);
    herd.update(0); // writes the zero matrix
    expect(herd.animating).toBe(false);
    const version = leg.instanceMatrix.version;
    for (let i = 0; i < 10; i++) herd.update(16);
    expect(leg.instanceMatrix.version).toBe(version);
    herd.setVisible(1, true);
    herd.update(0);
    const after = new THREE.Matrix4();
    leg.getMatrixAt(1, after);
    expect(after.equals(before)).toBe(true); // paused at the same point of the walk
    expect(herd.animating).toBe(true);
  });

  it("draw only up to the last visible instance", () => {
    const herd = buildModelInstanced(critter(), 10);
    const parts = critter().parts.length;
    expect(drawCalls(herd.root)).toBe(0);
    herd.setVisible(3, true);
    expect(herd.part("body")?.count).toBe(4);
    expect(drawCalls(herd.root)).toBe(parts);
    herd.setVisible(7, true);
    herd.setVisible(3, false);
    expect(herd.part("body")?.count).toBe(8);
    herd.setVisible(7, false);
    expect(herd.part("body")?.count).toBe(0);
    expect(drawCalls(herd.root)).toBe(0);
  });

  it("setTint after dispose does nothing", () => {
    const herd = buildModelInstanced(critter(), 2);
    const head = herd.part("head");
    const version = head?.instanceColor?.version;
    herd.dispose();
    herd.setTint(0, "#ff0000");
    expect(head?.instanceColor?.version).toBe(version);
    const single = buildModel(critter(), null);
    const material = single.part("body")?.material;
    if (!(material instanceof THREE.MeshLambertMaterial)) throw new Error("material");
    single.dispose();
    single.setTint("#ff0000");
    expect(material.color.getHexString()).toBe("ffffff");
  });
});

describe("facing: +z is the front", () => {
  it("the critter's head is at +z, and yaw = atan2(dx, dz) turns it toward (dx, dz), as Object3D.lookAt does", () => {
    const def = critter();
    const single = buildModel(def, null);
    expect(worldPos(single.part("head") ?? single.root).z).toBeGreaterThan(0);
    const target = new THREE.Vector3(3, 0, -4);
    const herd = buildModelInstanced(def, 1);
    herd.place(0, { x: 0, y: 0, z: 0 }, Math.atan2(target.x, target.z));
    herd.setVisible(0, true);
    herd.update(0);
    const m = new THREE.Matrix4();
    herd.part("head")?.getMatrixAt(0, m);
    const head = new THREE.Vector3().setFromMatrixPosition(m);
    const dir = new THREE.Vector2(head.x, head.z).normalize();
    expect(dir.x).toBeCloseTo(0.6, 5);
    expect(dir.y).toBeCloseTo(-0.8, 5);
    // The same front three's own lookAt gives a non-camera object (its local +z).
    const probe = new THREE.Object3D();
    probe.lookAt(target);
    const front = probe.getWorldDirection(new THREE.Vector3());
    expect(front.x).toBeCloseTo(0.6, 5);
    expect(front.z).toBeCloseTo(-0.8, 5);
  });
});
