/**
 * Avatar snapshots (tasks M3-09, M3-FIX-5): the scene built through the model runtime, the
 * read-back math, and that the shared renderer gets its state back.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { BASE_AVATAR, SKIN_TOKEN } from "../../../src/content/cosmetics/base";
import {
  FACE_SHADE,
  SUPERSAMPLE,
  downsampleToSrgb,
  portraitLights,
  renderModelPixels,
  snapshotScene,
  withColors,
} from "../../../src/render/avatar";
import { MODEL_UNIT } from "../../../src/render/models/rig";
import { modelErrors } from "../../../src/render/models/validate";

/** The part meshes of a snapshot scene, by name. */
function meshes(scene: THREE.Scene): Map<string, THREE.Mesh> {
  const out = new Map<string, THREE.Mesh>();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) out.set(o.name, o);
  });
  return out;
}

/** World units to model pixels, rounded off float noise. */
const toPx = (v: THREE.Vector3): number[] =>
  v.toArray().map((n) => Math.round((n / MODEL_UNIT) * 1e6) / 1e6);

/** A mesh's own box (not its children's) in model pixels. */
function boxOf(mesh: THREE.Mesh): { min: number[]; max: number[] } {
  mesh.geometry.computeBoundingBox();
  const box = (mesh.geometry.boundingBox ?? new THREE.Box3())
    .clone()
    .applyMatrix4(mesh.matrixWorld);
  return { min: toPx(box.min), max: toPx(box.max) };
}

describe("snapshotScene", () => {
  it("builds every part through buildModel, nested by parent, with the skin swapped in", () => {
    const { scene, dispose } = snapshotScene(BASE_AVATAR, { colors: { [SKIN_TOKEN]: "#ff0000" } });
    const parts = meshes(scene);
    expect(parts.size).toBe(BASE_AVATAR.parts.length);
    expect(scene.getObjectByName("model:avatar-base")).toBeDefined();
    expect(parts.get("face-0-6")?.parent?.name).toBe("head");
    expect(parts.get("head")?.parent?.name).toBe("torso");
    const hand = parts.get("hand-left");
    if (!(hand?.geometry instanceof THREE.BufferGeometry)) throw new Error("no hand mesh");
    const color = hand.geometry.getAttribute("color");
    expect([color.getX(0), color.getY(0), color.getZ(0)]).toEqual([1, 0, 0]);
    dispose();
  });

  it("puts the boxes where the M3-09 avatar had them (model pixels)", () => {
    const { scene, dispose } = snapshotScene(BASE_AVATAR, {});
    const parts = meshes(scene);
    const at = (name: string) => {
      const m = parts.get(name);
      if (!m) throw new Error(`no part ${name}`);
      return boxOf(m);
    };
    expect(at("torso")).toEqual({ min: [-4, 8, -2], max: [4, 16, 2] });
    expect(at("arm-left")).toEqual({ min: [-6, 9, -1.5], max: [-4, 16, 1.5] });
    // The jaw row sits on the neck; the big hair block above it; the leaf on top.
    expect(at("head")).toEqual({ min: [-3, 16, -4], max: [3, 17, 3] });
    expect(at("head-3")).toEqual({ min: [-5, 18, -4], max: [5, 23, 3] });
    expect(at("head-0")).toEqual({ min: [1, 25, 1], max: [3, 26, 3] });
    // Face pixels make the front layer, z 3–4.
    expect(at("face-5-3")).toEqual({ min: [-2, 20, 3], max: [-1, 21, 4] });
    // The collar stands half a pixel out from the tunic, as before.
    expect(at("collar").max[2]).toBe(2.5);
    dispose();
  });

  it("frames the whole model by default and a given y range when asked", () => {
    const whole = snapshotScene(BASE_AVATAR, {}).camera;
    const bust = snapshotScene(BASE_AVATAR, { frameY: [10, 27] }).camera;
    // The bust camera is closer, and looks at the middle of the range it frames.
    expect(bust.position.length()).toBeLessThan(whole.position.length());
    bust.updateMatrixWorld(true);
    const mid = new THREE.Vector3(0, 18.5 * MODEL_UNIT, 0).project(bust);
    expect(Math.abs(mid.x)).toBeLessThan(1e-9);
    expect(Math.abs(mid.y)).toBeLessThan(1e-9);
  });
});

describe("withColors", () => {
  it("swaps only matching colors and leaves the model alone", () => {
    const out = withColors(BASE_AVATAR, { [SKIN_TOKEN]: "#123456" });
    expect(out.parts.some((p) => p.color === SKIN_TOKEN)).toBe(false);
    expect(BASE_AVATAR.parts.some((p) => p.color === SKIN_TOKEN)).toBe(true);
    expect(out.parts.find((p) => p.name === "torso")).toBe(
      BASE_AVATAR.parts.find((p) => p.name === "torso"),
    );
  });

  it("with the skin filled in, the avatar is a valid §8.4 model apart from its part count", () => {
    const errors = modelErrors(withColors(BASE_AVATAR, { [SKIN_TOKEN]: "#d29c72" }));
    // The face is one box per run of a color, which is more than a mob's 32 parts.
    expect(errors).toEqual(["$.parts: has more than 32 parts"]);
  });

  it("every size is a whole number of pixels", () => {
    for (const p of BASE_AVATAR.parts)
      for (const n of p.size) expect(Number.isInteger(n)).toBe(true);
  });
});

describe("portraitLights", () => {
  it("light each face from its own axis, at π × its shade", () => {
    const lights = portraitLights();
    expect(lights).toHaveLength(6);
    lights.forEach((light, i) => {
      const face = FACE_SHADE[i];
      expect(light.position.toArray()).toEqual(face?.dir);
      expect(light.intensity / Math.PI).toBeCloseTo(face?.shade ?? 0, 9);
      expect(light.castShadow).toBe(false);
    });
  });
});

describe("downsampleToSrgb", () => {
  it("flips rows, averages samples by alpha and converts linear to sRGB", () => {
    // 2×2 output from a 4×4 linear buffer, bottom row first.
    const ss = 2;
    const px = 2;
    const big = px * ss;
    const src = new Uint8Array(big * big * 4);
    // Bottom-left output pixel (rows 0–1 of the source, cols 0–1): two opaque mid-grey samples.
    for (const [x, y] of [
      [0, 0],
      [1, 0],
    ]) {
      const i = ((y ?? 0) * big + (x ?? 0)) * 4;
      src.set([55, 55, 55, 255], i);
    }
    const out = downsampleToSrgb(src, px, ss);
    // The bottom-left of the source is the bottom-left of the image: output row 1.
    const o = (1 * px + 0) * 4;
    // Half covered → half alpha; color unaffected by the transparent samples.
    expect(out[o + 3]).toBe(128);
    // Linear 55/255 ≈ 0.216 → sRGB ≈ 0.5 → 128.
    expect(out[o]).toBeGreaterThan(124);
    expect(out[o]).toBeLessThan(132);
    // The top-left output pixel saw nothing.
    expect(out[3]).toBe(0);
  });
});

describe("renderModelPixels", () => {
  it("renders off-screen, then gives the shared renderer its target and clear color back", () => {
    const before = { name: "app target" };
    let target: unknown = before;
    let clear = new THREE.Color(0x123456);
    let alpha = 1;
    const renderer = {
      autoClear: false,
      getContext: () => ({ isContextLost: () => false }),
      getRenderTarget: () => target,
      setRenderTarget: vi.fn((t: unknown) => {
        target = t;
      }),
      getClearColor: (c: THREE.Color) => c.copy(clear),
      getClearAlpha: () => alpha,
      setClearColor: vi.fn((c: THREE.ColorRepresentation, a: number) => {
        clear = new THREE.Color(c);
        alpha = a;
      }),
      clear: vi.fn(),
      render: vi.fn(),
      readRenderTargetPixels: vi.fn(
        (_t: unknown, _x: number, _y: number, w: number, h: number, buf: Uint8Array) => {
          // Everything opaque white.
          expect(w * h * 4).toBe(buf.length);
          buf.fill(255);
        },
      ),
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reason: a stand-in with only the renderer methods the snapshot uses
    const r = renderer as unknown as THREE.WebGLRenderer;
    const px = 4;
    const pixels = renderModelPixels(r, BASE_AVATAR, { px });
    expect(pixels).toHaveLength(px * px * 4);
    expect([...(pixels ?? [])].every((v) => v === 255)).toBe(true);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.readRenderTargetPixels.mock.calls[0]?.[3]).toBe(px * SUPERSAMPLE);
    expect(target).toBe(before);
    expect(clear.getHex()).toBe(0x123456);
    expect(alpha).toBe(1);
    expect(renderer.autoClear).toBe(false);
  });

  it("draws nothing when the context is lost", () => {
    const render = vi.fn();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reason: a stand-in with only the renderer methods the snapshot uses
    const r = {
      getContext: () => ({ isContextLost: () => true }),
      render,
    } as unknown as THREE.WebGLRenderer;
    expect(renderModelPixels(r, BASE_AVATAR, { px: 8 })).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });
});
