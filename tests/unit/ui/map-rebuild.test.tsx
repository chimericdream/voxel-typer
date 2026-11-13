/** @jsxImportSource preact */
/**
 * World map with a (fake) 3D scene (M3-FIX-1, M3-04 review N6): the 3D view is built once per
 * visit and rebuilt only when the player or their open islands change, not whenever the profile
 * object does (a settings save, say). The view module is mocked, so this counts builds.
 *
 * Also (M3-FIX-4): a click on the picture asks the view which island is under it, and does what
 * that island's label does.
 */
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldMapView } from "../../../src/render/map/view";
import type { BiomeId } from "../../../src/types/core";
import { resetMapMemory } from "../../../src/ui/screens/WorldMap";
import { fakeScene } from "../app/helpers";
import type { Harness } from "./screens/harness";
import { fixture, mount } from "./screens/harness";

const built: { unlocked: BiomeId[]; start: BiomeId | null; disposed: boolean }[] = [];
/** What the fake view's `pick` answers, and the points it was asked about. */
const picking: { answer: BiomeId | null; asked: { x: number; y: number }[] } = {
  answer: null,
  asked: [],
};

vi.mock("../../../src/render/map/view", () => ({
  createWorldMapView(
    _stage: unknown,
    opts: { unlocked: ReadonlySet<BiomeId>; start?: BiomeId | null },
  ): WorldMapView {
    const entry = { unlocked: [...opts.unlocked], start: opts.start ?? null, disposed: false };
    built.push(entry);
    let shown = entry.start;
    return {
      root: new THREE.Group(),
      show(biome) {
        shown = biome;
      },
      get shown() {
        return shown;
      },
      select: () => undefined,
      anchors: () => new Map(),
      centers: () => new Map(),
      pick: (at) => {
        picking.asked.push(at);
        return picking.answer;
      },
      hover: () => undefined,
      onMove: () => () => undefined,
      refresh: () => undefined,
      moving: false,
      dispose() {
        entry.disposed = true;
      },
    };
  },
}));

function sceneWithThree() {
  const scene = fakeScene();
  // The map reads only the canvas size from the renderer; happy-dom has no WebGL to build one.
  const renderer: unknown = Object.create(THREE.WebGLRenderer.prototype);
  if (!(renderer instanceof THREE.WebGLRenderer)) throw new Error("fake renderer");
  Object.defineProperty(renderer, "domElement", { value: document.createElement("canvas") });
  return {
    ...scene,
    three: { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), renderer },
  };
}

let h: Harness | null = null;
afterEach(() => {
  h?.unmount();
  h = null;
  built.length = 0;
  picking.answer = null;
  picking.asked.length = 0;
  resetMapMemory();
});

describe("World map 3D view rebuilds", () => {
  it("keeps the view when the profile object changes but the player and islands don't", async () => {
    const sprout = fixture("fresh-sprout");
    h = await mount({
      initial: { id: "map" },
      initialProfile: sprout,
      acquireScene: () => Promise.resolve(sceneWithThree()),
    });
    await h.settle();
    expect(h.root.querySelector("[data-mode]")?.getAttribute("data-mode")).toBe("3d");
    expect(built).toHaveLength(1);

    // A settings save makes a new profile object.
    const s = h.shell.api;
    s.setProfile({ ...sprout, settings: { ...sprout.settings, textScale: 2 } });
    await h.settle();
    expect(built).toHaveLength(1);
    expect(built[0]?.disposed).toBe(false);

    // A new island opens while a path is shown: the view is rebuilt, close on that path.
    await h.press("Enter");
    expect(h.root.querySelector("h2")).not.toBeNull();
    s.setProfile({
      ...sprout,
      progress: { ...sprout.progress, unlockedBiomes: ["meadow", "birch"] },
    });
    await h.settle();
    expect(built).toHaveLength(2);
    expect(built[0]?.disposed).toBe(true);
    expect(built[1]).toMatchObject({ unlocked: ["meadow", "birch"], start: "meadow" });
  });
});

const clickMap = async (harness: Harness, target?: Element): Promise<void> => {
  const map = harness.root.querySelector("[data-mode]");
  if (!map) throw new Error("no map");
  (target ?? map).dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }),
  );
  await harness.settle();
};

describe("World map: the island's model is a target too (M3-FIX-4)", () => {
  it("a click on an open island's model goes in; on one in the clouds, the kind line shows", async () => {
    h = await mount({
      initial: { id: "map" },
      initialProfile: fixture("fresh-sprout"),
      acquireScene: () => Promise.resolve(sceneWithThree()),
    });
    await h.settle();
    expect(h.root.querySelector("[data-mode]")?.getAttribute("data-mode")).toBe("3d");

    // Nothing under the pointer: nothing happens.
    await clickMap(h);
    expect(picking.asked).toHaveLength(1);
    expect(h.root.querySelector("h2")).toBeNull();

    // Birch Forest, still in the clouds: the kind line, and the map stays.
    picking.answer = "birch";
    await clickMap(h);
    expect(h.root.querySelector("[data-note]")?.textContent).toContain("Meadow Home");
    expect(h.root.querySelector("h2")).toBeNull();

    // The same island again: the line is taken away, then put back a moment later (N4).
    await clickMap(h);
    expect(h.root.querySelector("[data-note]")?.textContent).toBe("");
    await new Promise((r) => setTimeout(r, 80));
    await h.settle();
    expect(h.root.querySelector("[data-note]")?.textContent).toContain("Meadow Home");

    // Meadow Home: its lesson path opens.
    picking.answer = "meadow";
    await clickMap(h);
    expect(h.root.querySelector("h2")?.textContent).toContain("Meadow Home");
  });

  it("a click on a label is the label's own; the picture isn't asked", async () => {
    h = await mount({
      initial: { id: "map" },
      initialProfile: fixture("fresh-sprout"),
      acquireScene: () => Promise.resolve(sceneWithThree()),
    });
    await h.settle();
    picking.answer = "birch";
    const label = h.root.querySelector("[data-spot='meadow'] button");
    if (!label) throw new Error("no label");
    await clickMap(h, label);
    expect(picking.asked).toHaveLength(0);
  });
});
