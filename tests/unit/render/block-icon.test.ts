/**
 * Isometric block icons (task M4-09): each cube face shows its own atlas tile, the camera sees the
 * top and two sides, and the shared renderer gets its state back after a draw.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { blocks } from "../../../src/content/blocks";
import type { Atlas } from "../../../src/render/atlas/build";
import { SUPERSAMPLE } from "../../../src/render/avatar";
import {
  ICON_SHADE,
  blockCube,
  drawsAsCube,
  iconScene,
  renderBlockIconPixels,
} from "../../../src/render/block-icon";

/** Each face's tile is a distinct UV box: top in one quarter, side in another, bottom in a third. */
const TILES = {
  top: [0, 0.5, 0.5, 1],
  side: [0.5, 0.5, 1, 1],
  bottom: [0, 0, 0.5, 0.5],
} as const;

function fakeAtlas(): Atlas {
  const atlas = {
    texture: new THREE.Texture(),
    uv: (_num: number, face: "top" | "side" | "bottom") => [...TILES[face]],
    transparent: () => false,
    tileOf: () => 0,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reason: a stand-in with only the parts the icon reads
  return atlas as unknown as Atlas;
}

const grass = blocks.find((b) => b.id === "grass");
if (!grass) throw new Error("no grass block");

describe("blockCube", () => {
  it("maps each face's UVs into that face's tile", () => {
    const geo = blockCube(grass, fakeAtlas());
    const uv = geo.getAttribute("uv");
    const faces = ["side", "side", "top", "bottom", "side", "side"] as const;
    faces.forEach((face, g) => {
      const [u0, v0, u1, v1] = TILES[face];
      for (let k = 0; k < 4; k++) {
        const i = g * 4 + k;
        expect(uv.getX(i)).toBeGreaterThanOrEqual(u0);
        expect(uv.getX(i)).toBeLessThanOrEqual(u1);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(v0);
        expect(uv.getY(i)).toBeLessThanOrEqual(v1);
      }
    });
    geo.dispose();
  });
});

describe("iconScene", () => {
  it("looks down the (1, 1, 1) diagonal and frames the whole cube", () => {
    const { camera, scene, dispose } = iconScene(grass, fakeAtlas());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    expect(dir.x).toBeCloseTo(-1 / Math.sqrt(3));
    expect(dir.y).toBeCloseTo(-1 / Math.sqrt(3));
    expect(dir.z).toBeCloseTo(-1 / Math.sqrt(3));
    camera.updateMatrixWorld(true);
    // Every corner of the unit cube lands inside the view.
    for (const x of [-0.5, 0.5])
      for (const y of [-0.5, 0.5])
        for (const z of [-0.5, 0.5]) {
          const p = new THREE.Vector3(x, y, z).project(camera);
          expect(Math.abs(p.x)).toBeLessThan(1);
          expect(Math.abs(p.y)).toBeLessThan(1);
        }
    expect(scene.children.filter((o) => o instanceof THREE.DirectionalLight)).toHaveLength(
      ICON_SHADE.length,
    );
    dispose();
  });

  it("draws a flower flat, not as a cube", () => {
    expect(drawsAsCube({ shape: "sprig" })).toBe(false);
    expect(drawsAsCube({})).toBe(true);
  });
});

describe("renderBlockIconPixels", () => {
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
      render: vi.fn((): void => {
        throw new Error("draw failed");
      }),
      readRenderTargetPixels: vi.fn(),
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reason: a stand-in with only the renderer methods the icon uses
    const r = renderer as unknown as THREE.WebGLRenderer;
    // Even when the draw throws, the renderer is put back.
    expect(() => renderBlockIconPixels(r, grass, fakeAtlas(), 4)).toThrow("draw failed");
    expect(target).toBe(before);
    expect(clear.getHex()).toBe(0x123456);
    expect(alpha).toBe(1);
    expect(renderer.autoClear).toBe(false);

    renderer.render.mockImplementation(() => undefined);
    renderer.readRenderTargetPixels.mockImplementation(
      (_t: unknown, _x: number, _y: number, w: number, h: number, buf: Uint8Array) => {
        expect(w * h * 4).toBe(buf.length);
        buf.fill(255);
      },
    );
    const pixels = renderBlockIconPixels(r, grass, fakeAtlas(), 4);
    expect(pixels).toHaveLength(4 * 4 * 4);
    expect(renderer.readRenderTargetPixels.mock.calls[0]?.[3]).toBe(4 * SUPERSAMPLE);
    expect(target).toBe(before);
    expect(renderer.autoClear).toBe(false);
  });

  it("draws nothing when the context is lost", () => {
    const render = vi.fn();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reason: a stand-in with only the renderer methods the icon uses
    const r = {
      getContext: () => ({ isContextLost: () => true }),
      render,
    } as unknown as THREE.WebGLRenderer;
    expect(renderBlockIconPixels(r, grass, fakeAtlas(), 8)).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });
});
