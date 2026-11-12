/**
 * Night Defense's 3D stage and word plates (task M4-04), on happy-dom and three.js without a GL
 * context: the mob pools, the draw calls (root-only shadows), `defeat` firing once, and the
 * plates' DOM (the font, the lock frame, the typed marks, the shield bar).
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MOBS, rosterFor } from "../../../src/content/mobs";
import { arenaLayout } from "../../../src/content/worldgen/defense-arena";
import type { FieldMob } from "../../../src/modes/defense/logic";
import { LOCKED_SCALE, createPlateLayer } from "../../../src/modes/defense/plates";
import type { PlateItem } from "../../../src/modes/defense/plates";
import { POOL_SIZE, createDefenseView, modelHeight } from "../../../src/modes/defense/view";
import { parseModel } from "../../../src/render/models";
import { drawCalls } from "../models/helpers";

const layout = arenaLayout(5);

function stage(roster = MOBS, reduced = false) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 500);
  camera.position.set(layout.center.x, 26, 62);
  camera.lookAt(layout.center.x, 5, 21);
  camera.updateMatrixWorld();
  const host = document.createElement("div");
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: 1280 });
  Object.defineProperty(canvas, "clientHeight", { value: 720 });
  host.append(canvas);
  document.body.append(host);
  const view = createDefenseView({
    scene,
    camera,
    canvas,
    atlas: () => null,
    layout,
    roster,
    reducedMotion: () => reduced,
    requestRender: () => undefined,
  });
  return { scene, camera, canvas, host, view };
}

const mob = (id: string, mobId: string, over: Partial<FieldMob> = {}): FieldMob => ({
  id,
  mobId,
  slot: 0,
  word: "word",
  speed: 0.1,
  p: 0.5,
  state: "walking",
  ...over,
});

/** Shadow casters three.js would draw again in the sun's shadow pass. */
function shadowCalls(root: THREE.Object3D): number {
  let calls = 0;
  root.traverse((obj) => {
    if (obj instanceof THREE.InstancedMesh && obj.castShadow && obj.count > 0) calls++;
  });
  return calls;
}

describe("defense view", () => {
  it("draws nothing for mobs until one is on the field", () => {
    const { scene, view } = stage();
    // Only the shield shows: every instance of every type is hidden.
    expect(drawCalls(scene)).toBe(1);
    expect(view.stats()).toMatchObject({ types: 8, parts: 85, shown: 0, shadowCasters: 8 });
    view.dispose();
  });

  it("all eight types cost 85 calls, and 8 more on High with root-only shadows", () => {
    const { scene, view } = stage();
    MOBS.forEach((m, i) => expect(view.spawn(mob(`m${i}`, m.id, { slot: i % 5 }))).toBe(true));
    view.frame(16);
    // 85 parts and the shield. Thirty more of each type add nothing.
    expect(drawCalls(scene)).toBe(86);
    for (let i = 0; i < 9; i++) MOBS.forEach((m) => view.spawn(mob(`x${i}-${m.id}`, m.id)));
    view.frame(16);
    expect(drawCalls(scene)).toBe(86);
    // The shadow pass: one caster per type (the root part), not one per part.
    expect(shadowCalls(scene)).toBe(8);
    view.setLocked("m0");
    expect(drawCalls(scene)).toBe(87);
    view.dispose();
    expect(drawCalls(scene)).toBe(0);
  });

  it("a Meadow night builds one type: 8 parts", () => {
    const { scene, view } = stage(rosterFor("meadow"));
    expect(view.stats()).toMatchObject({ types: 1, parts: 8, shadowCasters: 1 });
    view.spawn(mob("a", "slimeling"));
    view.frame(16);
    expect(drawCalls(scene)).toBe(9);
    expect(view.spawn(mob("b", "cave-bat"))).toBe(false);
    view.dispose();
  });

  it("defeat and bonk call back exactly once, and give the instance back to the pool", () => {
    const { view } = stage(rosterFor("meadow"));
    for (const leave of ["defeat", "bonk"] as const) {
      const m = mob(`m-${leave}`, "slimeling");
      view.spawn(m);
      let done = 0;
      view[leave](m, () => done++);
      expect(done).toBe(0);
      // Game logic waits on the anim's end: 420 ms.
      for (let i = 0; i < 20; i++) view.frame(16);
      expect(done).toBe(0);
      for (let i = 0; i < 20; i++) view.frame(16);
      expect(done).toBe(1);
      for (let i = 0; i < 60; i++) view.frame(16);
      expect(done).toBe(1);
      expect(view.stats().shown).toBe(0);
    }
    // A mob that was never shown still gets its callback.
    let ghost = 0;
    view.defeat(mob("ghost", "slimeling"), () => ghost++);
    expect(ghost).toBe(1);
    view.dispose();
  });

  it("still ends a defeat under reduced motion, and after dispose", () => {
    const { view } = stage(rosterFor("meadow"), true);
    const m = mob("a", "slimeling");
    view.spawn(m);
    let done = 0;
    view.defeat(m, () => done++);
    for (let i = 0; i < 40; i++) view.frame(16);
    expect(done).toBe(1);
    const late = mob("b", "slimeling");
    view.spawn(late);
    view.dispose();
    view.defeat(late, () => done++);
    expect(done).toBe(2);
  });

  it("reuses instances: a pool never runs dry over a night", () => {
    const { view } = stage(rosterFor("meadow"));
    for (let round = 0; round < 5; round++) {
      const mobs = Array.from({ length: POOL_SIZE }, (_, i) => mob(`r${round}-${i}`, "slimeling"));
      for (const m of mobs) expect(view.spawn(m)).toBe(true);
      // The pool is full now.
      expect(view.spawn(mob(`r${round}-extra`, "slimeling"))).toBe(false);
      for (const m of mobs) view.defeat(m, () => undefined);
      for (let i = 0; i < 40; i++) view.frame(16);
      expect(view.stats().shown).toBe(0);
    }
    view.dispose();
  });

  it("finds a mob's head on the page, above its feet", () => {
    const { view } = stage(rosterFor("meadow"));
    const near = mob("near", "slimeling", { p: 1, slot: 2 });
    const far = mob("far", "slimeling", { p: 0, slot: 2 });
    view.spawn(near);
    view.spawn(far);
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    expect(view.headOf(near, a)).toBe(true);
    expect(view.headOf(far, b)).toBe(true);
    // The middle lane is the middle of the screen; the far mob is higher up.
    expect(a.x).toBeCloseTo(640, 0);
    expect(b.y).toBeLessThan(a.y);
    expect(view.headOf(mob("nobody", "slimeling"), a)).toBe(false);
    const at = view.worldOf(near, { x: 0, y: 0, z: 0 });
    expect(at.z).toBeCloseTo(layout.baseZ);
    expect(at.y).toBeGreaterThan(layout.groundY);
    view.dispose();
  });

  it("measures every model's height from its parts", () => {
    for (const m of MOBS) {
      const h = modelHeight(parseModel(m.model, m.id));
      // The handoff's 13–17 px, plus the flyers' hover.
      expect(h, m.id).toBeGreaterThanOrEqual(10);
      expect(h, m.id).toBeLessThanOrEqual(26);
    }
  });

  it("hands the shared camera back without its view shift", () => {
    const { camera, view } = stage(rosterFor("meadow"));
    view.applyShift({ shiftX: 0, shiftY: -80 });
    expect(camera.view?.enabled).toBe(true);
    view.dispose();
    expect(camera.view?.enabled ?? false).toBe(false);
  });
});

const bounds = { left: 0, top: 60, right: 1280, bottom: 400 };
const item = (id: string, over: Partial<PlateItem> = {}): PlateItem => ({
  id,
  word: "frost",
  typed: 0,
  locked: false,
  x: 400,
  y: 300,
  order: 0,
  ...over,
});

/** A plate layer on a fresh page. */
function layer(reduced = false) {
  const { canvas, host, view } = stage(rosterFor("meadow"));
  view.dispose();
  return { plates: createPlateLayer({ canvas, reducedMotion: () => reduced }), host };
}

describe("word plates", () => {
  it("uses the body font for words, never the pixel font (decision 68)", () => {
    const { plates, host } = layer();
    plates.sync([item("a")], bounds);
    const root = host.querySelector<HTMLElement>(".vt-defense-plates");
    expect(root?.style.fontFamily).toBe("var(--font-body)");
    expect(host.innerHTML).not.toContain("--font-pixel");
    plates.dispose();
    expect(host.querySelector(".vt-defense-plates")).toBeNull();
  });

  it("shows one plate per mob, with the word as real text and a spoken name", () => {
    const { plates, host } = layer();
    plates.sync([item("a"), item("b", { word: "ice", x: 800 })], bounds);
    expect(plates.count).toBe(2);
    const els = [...host.querySelectorAll<HTMLElement>(".vt-defense-plate")];
    expect(els.map((e) => e.textContent)).toEqual(["frost", "ice"]);
    expect(els[0]?.getAttribute("aria-label")).toBe("Type: frost");
    // A mob that left takes its plate with it.
    plates.sync([item("b", { word: "ice", x: 800 })], bounds);
    expect(plates.count).toBe(1);
    expect(host.querySelectorAll(".vt-defense-plate")).toHaveLength(1);
    plates.sync([], bounds);
    expect(host.querySelectorAll(".vt-defense-plate")).toHaveLength(0);
    plates.dispose();
  });

  it("marks the locked plate with a frame and a bigger size, and the typed chars", () => {
    const { plates, host } = layer();
    plates.sync([item("a", { locked: true, typed: 2 })], bounds);
    const el = host.querySelector<HTMLElement>(".vt-defense-plate");
    expect(el?.dataset["locked"]).toBe("1");
    expect(el?.dataset["typed"]).toBe("2");
    expect(el?.style.boxShadow).toContain("--c-focus");
    expect(el?.style.transform).toContain(`scale(${LOCKED_SCALE})`);
    const chars = [...(el?.querySelectorAll<HTMLElement>("span") ?? [])];
    // Typed chars step back; the next one has a bar, the only underline on the plate.
    expect(chars.map((c) => c.style.opacity)).toEqual(["0.55", "0.55", "1", "1", "1"]);
    expect(chars.map((c) => c.style.boxShadow.includes("inset"))).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
    for (const c of chars) expect(c.style.textDecoration).toBe("");
    // Unlocked again: the frame and the marks go.
    plates.sync([item("a")], bounds);
    expect(el?.dataset["locked"]).toBe("0");
    expect(el?.style.boxShadow).not.toContain("--c-focus");
    expect(el?.style.transform).toContain("scale(1)");
    plates.dispose();
  });

  it("draws the shield bar with full and empty segments that differ by shape", () => {
    const { plates, host } = layer();
    plates.setShield(3, 5, { left: 20, top: 300 });
    const bar = host.querySelector<HTMLElement>(".vt-defense-shield");
    expect(bar?.getAttribute("aria-label")).toBe("Shield: 3 of 5");
    expect(bar?.textContent).toBe("Shield");
    const cells = [...(bar?.querySelectorAll<HTMLElement>("span span") ?? [])];
    expect(cells).toHaveLength(5);
    expect(cells.map((c) => c.style.border.includes("dashed"))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
    plates.setShield(0, 5, { left: 20, top: 300 });
    expect(bar?.getAttribute("aria-label")).toBe("Shield: 0 of 5");
    plates.dispose();
  });

  it("does nothing on a wobble under reduced motion or for a plate that is gone", () => {
    const { plates, host } = layer(true);
    plates.sync([item("a")], bounds);
    expect(() => plates.wobble("a")).not.toThrow();
    expect(() => plates.wobble("nobody")).not.toThrow();
    plates.dispose();
    expect(host.querySelector(".vt-defense-plate")).toBeNull();
  });
});
