/**
 * Avatar snapshots (task M3-09): model → meshes, the read-back math, and that the shared renderer
 * gets its state back.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { BASE_AVATAR, SKIN_TOKEN } from "../../../src/content/cosmetics/base";
import {
  SUPERSAMPLE,
  buildModelGroup,
  disposeModelGroup,
  downsampleToSrgb,
  renderModelPixels,
} from "../../../src/render/avatar";

describe("buildModelGroup", () => {
  it("one box per part, centred on its box, with the skin token swapped in", () => {
    const g = buildModelGroup(BASE_AVATAR, { [SKIN_TOKEN]: "#ff0000" });
    expect(g.children).toHaveLength(BASE_AVATAR.parts.length);
    const torso = g.getObjectByName("torso");
    expect(torso?.position.toArray()).toEqual([0, 12, 0]);
    const hand = g.getObjectByName("hand-left");
    if (!(hand instanceof THREE.Mesh) || !(hand.geometry instanceof THREE.BufferGeometry)) {
      throw new Error("no hand mesh");
    }
    const color = hand.geometry.getAttribute("color");
    // The top face (group 2, vertices 8–11) is unshaded: pure red in linear space.
    expect([color.getX(8), color.getY(8), color.getZ(8)]).toEqual([1, 0, 0]);
    // Sides are darker than the top.
    expect(color.getX(0)).toBeLessThan(1);
    disposeModelGroup(g);
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
