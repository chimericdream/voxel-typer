/**
 * Effects (task M2-05): the particle pool cap, reduced-motion flags, hit-stop, float text, the
 * idle loop and dispose. Driven by a fake rAF and a seeded Rng, so every run is the same.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/engine/rng";
import type { Atlas } from "../../../src/render/atlas/build";
import { tileUv } from "../../../src/render/atlas/build";
import { createCameraRig } from "../../../src/render/camera";
import {
  breakShake,
  createFx,
  createParticlePool,
  isSingleGlyph,
  labelLook,
} from "../../../src/render/fx";
import type { FxCore } from "../../../src/render/fx";
import {
  MAX_HIT_STOP,
  MAX_PARTICLES,
  PARTICLE_LIFE_MAX,
  PARTICLE_LIFE_MIN,
  REDUCED_MOTION_PARTICLES,
  SHAKE_MAX,
} from "../../../src/render/fx/tuning";
import { createLoop } from "../../../src/render/loop";
import type { LoopDeps } from "../../../src/render/loop";
import type { FxContext } from "../../../src/render/scene";

const AT = { x: 4.5, y: 3.5, z: 2.5 };

function fakeAtlas(): Atlas {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  return {
    texture: new THREE.Texture(),
    canvas,
    tileOf: () => 3,
    uv: () => [0, 0, 1, 1],
    transparent: () => false,
  };
}

/** A scene context with a fake rAF queue and a hand-moved clock. */
function harness(reduced = false, withAtlas = true) {
  let queue: { id: number; cb: (ts: number) => void }[] = [];
  let nextId = 1;
  let now = 0;
  let rm = reduced;
  const hitStops: number[] = [];
  const deps: LoopDeps = {
    raf(cb) {
      const id = nextId++;
      queue.push({ id, cb });
      return id;
    },
    caf(id) {
      queue = queue.filter((q) => q.id !== id);
    },
    now: () => now,
    render: () => {},
  };
  const loop = createLoop(deps);
  const realHitStop = loop.hitStop.bind(loop);
  loop.hitStop = (ms) => {
    hitStops.push(ms);
    realHitStop(ms);
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(4.5, 4, 10);
  camera.lookAt(AT.x, AT.y, AT.z);
  const host = document.createElement("div");
  const canvas = document.createElement("canvas");
  host.append(canvas);
  document.body.append(host);
  let atlas = withAtlas ? fakeAtlas() : null;
  const cameraRig = createCameraRig(camera, { reducedMotion: () => rm, wake: () => loop.wake() });
  // FX never touches the renderer, and happy-dom has no WebGL to build a real one.
  const renderer: unknown = Object.create(THREE.WebGLRenderer.prototype);
  if (!(renderer instanceof THREE.WebGLRenderer)) throw new Error("fake renderer");
  const ctx: FxContext = {
    scene,
    camera,
    renderer,
    canvas,
    loop,
    cameraRig,
    reducedMotion: () => rm,
    atlas: () => atlas,
  };
  const fx = createFx(ctx, { rng: createRng(7).fork("fx") });
  return {
    fx,
    ctx,
    loop,
    scene,
    host,
    get atlas() {
      return atlas;
    },
    hitStops,
    cameraRig,
    setReduced(v: boolean) {
      rm = v;
    },
    /** Swaps the scene's atlas, as a biome change does. */
    setAtlas(a: Atlas | null) {
      atlas = a;
    },
    /** Moves the clock by `ms` and runs the queued frame (if any). */
    tick(ms = 16) {
      now += ms;
      const run = queue;
      queue = [];
      for (const q of run) q.cb(now);
    },
    pending: () => queue.length,
  };
}

const particlesMesh = (scene: THREE.Scene): THREE.InstancedMesh => {
  const m = scene.getObjectByName("fx-particles");
  if (!(m instanceof THREE.InstancedMesh)) throw new Error("no particle mesh");
  return m;
};

const runUntilIdle = (h: ReturnType<typeof harness>, maxFrames = 400): number => {
  let frames = 0;
  while (h.pending() > 0 && frames < maxFrames) {
    h.tick(16);
    frames++;
  }
  return frames;
};

describe("particle pool", () => {
  const spec = { at: AT, count: 40, groundY: 3, uv: [0, 0, 1, 1] as const, reduced: false };

  it("1000 bursts never take the pool past 512 instances", () => {
    const pool = createParticlePool(MAX_PARTICLES);
    const rng = createRng(1);
    let peak = 0;
    for (let i = 0; i < 1000; i++) {
      pool.spawn(spec, rng);
      if (i % 3 === 0) pool.step(16);
      peak = Math.max(peak, pool.alive);
      expect(pool.alive).toBeLessThanOrEqual(MAX_PARTICLES);
    }
    expect(peak).toBe(MAX_PARTICLES);
  });

  it("1000 bursts through createFx keep the InstancedMesh count at or under 512", () => {
    const h = harness();
    const mesh = particlesMesh(h.scene);
    expect(mesh.instanceMatrix.count).toBe(MAX_PARTICLES);
    for (let i = 0; i < 1000; i++) {
      h.fx.burst(AT, { blockId: "stone", count: 1000 });
      if (i % 5 === 0) h.tick(16);
      expect(mesh.count).toBeLessThanOrEqual(MAX_PARTICLES);
      expect(h.fx.stats().particles).toBeLessThanOrEqual(MAX_PARTICLES);
    }
    // The buffers were allocated once, at the pool size.
    expect(mesh.instanceMatrix.count).toBe(MAX_PARTICLES);
    expect(mesh.geometry.getAttribute("iUv").count).toBe(MAX_PARTICLES);
  });

  it("the same seed gives the same burst", () => {
    const a = createParticlePool(64);
    const b = createParticlePool(64);
    a.spawn(spec, createRng(5));
    b.spawn(spec, createRng(5));
    for (let i = 0; i < 20; i++) {
      a.step(16);
      b.step(16);
    }
    expect([...a.pos]).toEqual([...b.pos]);
    expect([...a.uv]).toEqual([...b.uv]);
  });

  it("lives 600–1200 ms and fades by scale", () => {
    const pool = createParticlePool(64);
    pool.spawn(spec, createRng(2));
    const start = pool.alive;
    for (let t = 0; t < PARTICLE_LIFE_MIN - 16; t += 16) pool.step(16);
    expect(pool.alive).toBe(start);
    for (let t = 0; t < PARTICLE_LIFE_MAX; t += 16) pool.step(16);
    expect(pool.alive).toBe(0);

    const one = createParticlePool(1);
    one.spawn({ ...spec, count: 1 }, createRng(3));
    one.step(100);
    const early = one.scaleOf(0);
    one.step(480); // 580 ms: past the fade start for any life up to 1054 ms, still alive
    expect(one.scaleOf(0)).toBeLessThanOrEqual(early);
  });

  it("bounces on the ground and never sinks below it", () => {
    const pool = createParticlePool(64);
    pool.spawn(spec, createRng(4));
    let bounced = 0;
    for (let f = 0; f < 40; f++) {
      pool.step(16);
      for (let i = 0; i < pool.alive; i++) {
        expect(pool.pos[i * 3 + 1] ?? 0).toBeGreaterThanOrEqual(spec.groundY);
        if (pool.bounces(i) > 0) bounced++;
      }
    }
    expect(bounced).toBeGreaterThan(0);
  });

  it("samples a 4×4-texel window inside the block's tile", () => {
    const pool = createParticlePool(64);
    const tile = [0.25, 0.5, 0.3125, 0.5625] as const;
    pool.spawn({ ...spec, uv: tile }, createRng(9));
    for (let i = 0; i < pool.alive; i++) {
      const [u, v, du, dv] = [...pool.uv.subarray(i * 4, i * 4 + 4)];
      expect(du).toBeCloseTo((tile[2] - tile[0]) / 4);
      expect(dv).toBeCloseTo((tile[3] - tile[1]) / 4);
      expect(u).toBeGreaterThanOrEqual(tile[0] - 1e-6);
      expect((u ?? 0) + (du ?? 0)).toBeLessThanOrEqual(tile[2] + 1e-6);
      expect(v).toBeGreaterThanOrEqual(tile[1] - 1e-6);
      expect((v ?? 0) + (dv ?? 0)).toBeLessThanOrEqual(tile[3] + 1e-6);
    }
  });

  it("ignores empty, negative and non-finite counts", () => {
    const pool = createParticlePool(16);
    const rng = createRng(1);
    expect(pool.spawn({ ...spec, count: 0 }, rng)).toBe(0);
    expect(pool.spawn({ ...spec, count: -3 }, rng)).toBe(0);
    expect(pool.spawn({ ...spec, count: Number.NaN }, rng)).toBe(0);
    expect(pool.alive).toBe(0);
  });
});

describe("reduced motion", () => {
  it("a burst spawns at most 6 particles, which never bounce or spin", () => {
    const pool = createParticlePool(64);
    const rot0: number[] = [];
    const n = pool.spawn(
      { at: AT, count: 40, groundY: 3, uv: [0, 0, 1, 1], reduced: true },
      createRng(4),
    );
    expect(n).toBe(REDUCED_MOTION_PARTICLES);
    rot0.push(...pool.rot.subarray(0, n * 3));
    for (let f = 0; f < 60; f++) {
      pool.step(16);
      for (let i = 0; i < pool.alive; i++) {
        expect(pool.bounces(i)).toBe(0);
        expect(pool.pos[i * 3 + 1] ?? 0).toBeGreaterThanOrEqual(3);
      }
    }
    expect([...pool.rot.subarray(0, pool.alive * 3)]).toEqual(rot0.slice(0, pool.alive * 3));
  });

  it("createFx: 6 particles per burst, no hit-stop, no shake", () => {
    const h = harness(true);
    h.fx.burst(AT, { blockId: "stone", count: 30 });
    expect(h.fx.stats().particles).toBe(REDUCED_MOTION_PARTICLES);
    h.fx.hitStop(40);
    expect(h.hitStops).toEqual([]);
    expect(h.fx.stats().holding).toBe(false);
    h.cameraRig.shake(0.5, 300);
    expect(h.cameraRig.system(16, 16)).toBe(false);
  });

  it("is read on every call, so a settings change applies at once", () => {
    const h = harness(false);
    h.fx.burst(AT, { blockId: "stone", count: 30 });
    expect(h.fx.stats().particles).toBe(30);
    h.setReduced(true);
    h.fx.burst(AT, { blockId: "stone", count: 30 });
    expect(h.fx.stats().particles).toBe(30 + REDUCED_MOTION_PARTICLES);
    h.fx.hitStop(40);
    expect(h.hitStops).toEqual([]);
  });

  it("float text fades only: no rise, no scaling", () => {
    for (const t of [0, 0.05, 0.1, 0.2, 0.5, 0.8, 0.99]) {
      const look = labelLook(t, true);
      expect(look.rise).toBe(0);
      expect(look.scale).toBe(1);
    }
    expect(labelLook(0, true).opacity).toBe(0);
    expect(labelLook(0.4, true).opacity).toBe(1);
    expect(labelLook(1, true).opacity).toBe(0);

    const h = harness(true);
    h.fx.floatText(AT, "+1");
    const el = h.host.querySelector("span");
    if (!el) throw new Error("no label");
    const first = el.style.transform;
    h.tick(16);
    h.tick(300);
    expect(el.style.transform).toBe(first);
    expect(first).toContain("scale(1.000)");
  });
});

describe("normal motion", () => {
  it("float text pops (squash-and-stretch), rises and fades out", () => {
    expect(labelLook(0, false).scale).toBeLessThan(1);
    expect(labelLook(0.14, false).scale).toBeGreaterThan(1);
    expect(labelLook(0.5, false).scale).toBe(1);
    expect(labelLook(0.9, false).rise).toBeGreaterThan(labelLook(0.2, false).rise);
    expect(labelLook(0.3, false).opacity).toBe(1);
    expect(labelLook(1, false).opacity).toBe(0);
  });

  it("hit-stop goes through the loop, holds the particles and is capped", () => {
    const h = harness();
    h.fx.burst(AT, { blockId: "stone", count: 10 });
    h.tick(16); // first frame after idle: dt 0
    h.fx.hitStop(40);
    expect(h.hitStops).toEqual([40]);
    const mesh = particlesMesh(h.scene);
    const before = new Float32Array(mesh.instanceMatrix.array);
    h.tick(16);
    expect(h.fx.stats().holding).toBe(true);
    expect([...mesh.instanceMatrix.array]).toEqual([...before]);
    h.tick(16);
    h.tick(16);
    h.tick(16);
    expect(h.fx.stats().holding).toBe(false);
    expect([...mesh.instanceMatrix.array]).not.toEqual([...before]);

    h.fx.hitStop(5000);
    expect(h.hitStops.at(-1)).toBe(MAX_HIT_STOP);
    h.fx.hitStop(0);
    h.fx.hitStop(-1);
    expect(h.hitStops).toHaveLength(2);
  });

  it("break shake is small, grows with the streak and is capped", () => {
    expect(breakShake(0).intensity01).toBeGreaterThan(0);
    expect(breakShake(10).intensity01).toBeGreaterThan(breakShake(0).intensity01);
    expect(breakShake(1000).intensity01).toBe(SHAKE_MAX);
    expect(breakShake(Number.NaN).intensity01).toBe(breakShake(0).intensity01);
    expect(SHAKE_MAX).toBeLessThanOrEqual(0.3);
  });
});

describe("idle loop", () => {
  it("keeps frames coming only while effects are alive", () => {
    const h = harness();
    expect(h.pending()).toBe(0);
    h.fx.burst(AT, { blockId: "stone", count: 20 });
    h.fx.floatText(AT, "a");
    expect(h.pending()).toBe(1);
    const frames = runUntilIdle(h);
    expect(h.pending()).toBe(0);
    expect(frames).toBeGreaterThan(PARTICLE_LIFE_MIN / 16 - 2);
    expect(frames).toBeLessThan(200);
    expect(h.fx.stats()).toMatchObject({ particles: 0, floatTexts: 0 });
    expect(particlesMesh(h.scene).visible).toBe(false);
  });

  it("a hit-stop alone keeps the loop up for its length, then idles", () => {
    const h = harness();
    h.fx.hitStop(40);
    expect(runUntilIdle(h)).toBeLessThan(8);
    expect(h.pending()).toBe(0);
  });

  it("an empty burst does not wake the loop", () => {
    const h = harness();
    h.fx.burst(AT, { blockId: "stone", count: 0 });
    h.fx.floatText(AT, "");
    expect(h.pending()).toBe(0);
  });
});

describe("textures", () => {
  it("uses the scene's atlas texture as is (no clone) and the block's side tile", () => {
    const h = harness();
    h.fx.burst(AT, { blockId: "stone", count: 4 });
    const mesh = particlesMesh(h.scene);
    expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    if (!(mesh.material instanceof THREE.MeshLambertMaterial)) return;
    expect(mesh.material.map).toBe(h.atlas?.texture);
    const [u0, v0] = tileUv(256, 3);
    const uv = mesh.geometry.getAttribute("iUv");
    expect(uv.getX(0)).toBeGreaterThanOrEqual(u0 - 1e-6);
    expect(uv.getY(0)).toBeGreaterThanOrEqual(v0 - 1e-6);
  });

  it("works before an atlas exists (untextured chips)", () => {
    const h = harness(false, false);
    h.fx.burst(AT, { blockId: "stone", count: 4 });
    expect(h.fx.stats().particles).toBe(4);
  });
});

const label = (h: ReturnType<typeof harness>, i = 0): HTMLSpanElement => {
  const el = h.host.querySelectorAll("span")[i];
  if (!el) throw new Error("no label");
  return el;
};

describe("float text", () => {
  it("sits in an aria-hidden, click-through overlay next to the canvas", () => {
    const h = harness();
    h.fx.floatText(AT, "+1");
    const overlay = h.host.querySelector<HTMLDivElement>(".vt-fx-text");
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.style.pointerEvents).toBe("none");
    expect(overlay?.previousElementSibling).toBe(h.ctx.canvas);
  });

  it("uses the body font for a single letter (M2-08) and the pixel font otherwise", () => {
    expect(isSingleGlyph("b")).toBe(true);
    expect(isSingleGlyph(" d ")).toBe(true);
    expect(isSingleGlyph("+1")).toBe(false);
    const h = harness();
    h.fx.floatText(AT, "b");
    h.fx.floatText(AT, "Nice!");
    expect(label(h, 0).style.fontFamily).toContain("var(--font-body");
    expect(label(h, 1).style.fontFamily).toContain("var(--font-pixel");
  });

  it("sets text, never HTML, and takes an optional color", () => {
    const h = harness();
    h.fx.floatText(AT, "<b>hi</b>", { color: "#ffd58a" });
    expect(label(h).textContent).toBe("<b>hi</b>");
    expect(label(h).children).toHaveLength(0);
    expect(label(h).style.color).toBe("#ffd58a");
  });

  it("shows at most 6 at once, reusing the oldest", () => {
    const h = harness();
    for (let i = 0; i < 10; i++) h.fx.floatText(AT, String(i));
    const spans = h.host.querySelectorAll("span");
    expect(spans).toHaveLength(6);
    expect(h.fx.stats().floatTexts).toBe(6);
    expect([...spans].map((s) => s.textContent).toSorted()).toEqual(["4", "5", "6", "7", "8", "9"]);
  });

  it("is a no-op when the canvas has no parent", () => {
    const h = harness();
    h.ctx.canvas.remove();
    h.fx.floatText(AT, "a");
    expect(h.fx.stats().floatTexts).toBe(0);
    expect(h.pending()).toBe(0);
  });
});

describe("dispose", () => {
  it("drops live chips when the atlas changes, and never draws the old texture (M2-05 N4)", () => {
    const h = harness();
    const old = h.atlas?.texture;
    h.fx.burst(AT, { blockId: "stone", count: 12 });
    expect(h.fx.stats().particles).toBe(12);
    const mesh = particlesMesh(h.scene);
    if (!(mesh.material instanceof THREE.MeshLambertMaterial)) throw new Error("material");
    expect(mesh.material.map).toBe(old);
    // A biome change: the scene builds a new atlas and disposes the old texture.
    const next = fakeAtlas();
    h.setAtlas(next);
    h.tick(16);
    expect(h.fx.stats().particles).toBe(0);
    expect(mesh.material.map).toBeNull();
    expect(mesh.count).toBe(0);
    // The next burst takes the new atlas.
    h.fx.burst(AT, { blockId: "stone", count: 4 });
    expect(mesh.material.map).toBe(next.texture);
    h.fx.dispose();
  });

  it("keeps chips made before any atlas when the first atlas loads (M2-FIX-3)", () => {
    const h = harness(false, false);
    h.fx.burst(AT, { blockId: "stone", count: 6 });
    expect(h.fx.stats().particles).toBe(6);
    const mesh = particlesMesh(h.scene);
    if (!(mesh.material instanceof THREE.MeshLambertMaterial)) throw new Error("material");
    expect(mesh.material.map).toBeNull();
    // The world finishes loading: the scene's first atlas appears while the chips still fly.
    h.setAtlas(fakeAtlas());
    h.tick(16);
    expect(h.fx.stats().particles).toBe(6);
    expect(mesh.count).toBe(6);
    h.fx.dispose();
  });

  it("drops live chips when their atlas goes away (no atlas after one)", () => {
    const h = harness();
    h.fx.burst(AT, { blockId: "stone", count: 6 });
    h.setAtlas(null);
    h.tick(16);
    expect(h.fx.stats().particles).toBe(0);
    h.fx.dispose();
  });

  it("frees the mesh, its geometry and material, removes the overlay, keeps the atlas", () => {
    const h = harness();
    h.fx.burst(AT, { blockId: "stone", count: 10 });
    h.fx.floatText(AT, "+1");
    const mesh = particlesMesh(h.scene);
    const freed: string[] = [];
    mesh.geometry.addEventListener("dispose", () => freed.push("geometry"));
    if (mesh.material instanceof THREE.Material) {
      mesh.material.addEventListener("dispose", () => freed.push("material"));
    }
    mesh.addEventListener("dispose", () => freed.push("mesh"));
    h.atlas?.texture.addEventListener("dispose", () => freed.push("atlas"));
    h.fx.dispose();
    expect(freed.toSorted()).toEqual(["geometry", "material", "mesh"]);
    expect(h.scene.getObjectByName("fx-particles")).toBeUndefined();
    expect(h.host.querySelector(".vt-fx-text")).toBeNull();
    // Dead after dispose: no effects, no frames.
    h.fx.burst(AT, { blockId: "stone", count: 10 });
    h.fx.floatText(AT, "x");
    runUntilIdle(h);
    expect(h.pending()).toBe(0);
    h.fx.dispose();
  });

  it("drops its loop system", () => {
    const h: { fx: FxCore } & ReturnType<typeof harness> = harness();
    h.fx.burst(AT, { blockId: "stone", count: 10 });
    h.fx.dispose();
    runUntilIdle(h);
    expect(h.pending()).toBe(0);
  });
});
