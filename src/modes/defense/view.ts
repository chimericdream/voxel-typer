/**
 * Night Defense's 3D stage (task M4-04): the mobs on their lanes, the ring under the locked mob
 * and the shield in front of the camp.
 *
 * **Draw calls.** Each mob type is one `buildModelInstanced` (M4-01): one `InstancedMesh` per part,
 * however many of that mob are on the field, and nothing at all while none is (a hidden instance
 * draws nothing). All eight types together are 85 calls. On High the sun's shadow pass draws every
 * shadow caster again, so here **only a model's root part casts a shadow**: 8 more calls, not 85.
 * A mob's shadow is then its body's, which is what reads on the ground anyway. The lock ring and
 * the shield add one call each and cast no shadow, so everything together is 87 calls, and 95 on
 * High (against 172 with every part casting).
 *
 * Nothing here reads a clock: the mode calls `frame(dt)` from its own frame, so mobs hold still
 * during a hit-stop and while paused. Looping anims hold their first frame under reduced motion
 * (the model runtime does that); one-shots (`hit`, `defeat`) still play, because the mode waits on
 * `defeat`'s end.
 */
import * as THREE from "three";
import { allowFlash } from "@/a11y/flashes";
import type { ArenaLayout } from "@/content/worldgen/defense-arena";
import type { MobDef } from "@/content/mobs";
import type { Atlas } from "@/render/atlas/build";
import { BASE_PALETTE } from "@/render/atlas/palettes";
import { MODEL_UNIT, buildModelInstanced, parseModel } from "@/render/models";
import type { InstancedModelHandle, VoxelModel } from "@/render/models";
import type { Vec3 } from "@/render/types";
import type { Ms } from "@/types/core";
import { walkRate } from "./logic";
import type { FieldMob, LaneView } from "./logic";

/** Mobs are drawn this much bigger than their model, so a 13–17 px creature reads from afar. */
export const MOB_SCALE = 2.2;
/** Instances per mob type: the director never sends more than 18 mobs in a wave. */
export const POOL_SIZE = 18;
/** How long the shield's ripple from a bonk lasts. */
const PULSE_MS: Ms = 320;
/** A bonked mob hops back this far (in lane shares) and this high (world units). */
const HOP_BACK = 0.1;
const HOP_HEIGHT = 0.9;
/** A new mob grows in over this long, with a little overshoot, so it pops up and doesn't blink in. */
const GROW_MS: Ms = 260;

export interface DefenseViewOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  atlas(): Atlas | null;
  layout: ArenaLayout;
  /** The night's mob types. Only these are built. */
  roster: readonly MobDef[];
  reducedMotion(): boolean;
  requestRender(): void;
}

export interface DefenseView {
  /** Puts a new mob at the far end of its lane, walking. False if its type has no free instance. */
  spawn(mob: FieldMob): boolean;
  /** Moves a mob to its `p` and picks `walk` or `idle` from its state. Call each frame. */
  place(mob: FieldMob): void;
  /** A right key on this mob: a small squash, then back to what it was doing. */
  hit(mob: FieldMob): void;
  /** Plays `defeat`, hides the mob, and calls `done` exactly once. */
  defeat(mob: FieldMob, done: () => void): void;
  /** A mob at the base: it hops back as it poofs. Calls `done` exactly once. */
  bonk(mob: FieldMob, done: () => void): void;
  /** The mob with the ring under it, or null. */
  setLocked(id: string | null): void;
  /**
   * How strongly the camp's glow lights the field, 0–1: none by day, full at night. Without it
   * the mobs are dark shapes on a dark lawn, because the night's light comes from behind them.
   */
  setGlow(level01: number): void;
  /** The shield: `level01` is how full it is; `pulse` ripples it (a bonk, or dawn's regrowth). */
  setShield(level01: number, pulse: boolean): void;
  frame(dtMs: Ms): void;
  /** Slides the picture so the field sits where the HUD leaves room. */
  applyShift(view: Pick<LaneView, "shiftX" | "shiftY">): void;
  /** Where a mob's head is on the page, in CSS pixels. False when it is off the field's view. */
  headOf(mob: FieldMob, out: { x: number; y: number }): boolean;
  /** A mob's middle in the world, for effects. */
  worldOf(mob: FieldMob, out: Vec3): Vec3;
  /** Counters for tests and the draw-call note. */
  stats(): { types: number; parts: number; shown: number; shadowCasters: number };
  dispose(): void;
}

interface Kind {
  def: VoxelModel;
  handle: InstancedModelHandle;
  /** Height of the model's top above its feet, world units at scale 1. */
  height: number;
  free: number[];
}

interface Shown {
  kind: Kind;
  index: number;
  /** What the loop anim should be, and what is playing. */
  loop: "walk" | "idle";
  playing: "walk" | "idle" | "hit" | "defeat" | null;
  /** Bonk hop progress 0–1, or −1. */
  hop: number;
  /** Arrival: 0 when it appears, 1 when it is full size. */
  grow: number;
  /** The walk clip's playback rate: slower for a slow mob ({@link walkRate}). */
  rate: number;
}

/** The top of a model above the ground, in model pixels: the highest part box at rest. */
export function modelHeight(def: VoxelModel): number {
  const byName = new Map(def.parts.map((p) => [p.name, p]));
  const pivotY = (name: string | undefined, seen: number): number => {
    const part = name === undefined ? undefined : byName.get(name);
    if (part === undefined || seen > def.parts.length) return 0;
    return pivotY(part.parent, seen + 1) + part.offset[1];
  };
  let top = 0;
  for (const p of def.parts) top = Math.max(top, pivotY(p.name, 0) - p.pivot[1] + p.size[1]);
  return top;
}

const ramp = (id: keyof typeof BASE_PALETTE, i: number): string => BASE_PALETTE[id][i] ?? "#ffffff";

/** A blocky lattice for the shield: bright cell edges on a faint fill, 8 × 8 texels. */
function shieldTexture(): THREE.DataTexture {
  const n = 8;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const edge = x === 0 || y === 0;
      const i = (x + n * y) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = edge ? 255 : 90;
    }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

const loopOf = (mob: FieldMob): "walk" | "idle" => (mob.state === "waiting" ? "idle" : "walk");

export function createDefenseView(opts: DefenseViewOptions): DefenseView {
  const { scene, camera, canvas, layout } = opts;
  const root = new THREE.Group();
  root.name = "defense";
  scene.add(root);

  // --- mob types ---
  const kinds = new Map<string, Kind>();
  let parts = 0;
  let shadowCasters = 0;
  for (const mob of opts.roster) {
    const def = parseModel(mob.model, mob.id);
    const handle = buildModelInstanced(def, POOL_SIZE, {
      atlas: opts.atlas(),
      reducedMotion: () => opts.reducedMotion(),
    });
    // Root-only shadows (see the file comment).
    for (const part of def.parts) {
      const mesh = handle.part(part.name);
      if (mesh === undefined) continue;
      mesh.castShadow = part.parent === undefined;
      parts++;
      if (mesh.castShadow) shadowCasters++;
    }
    root.add(handle.root);
    kinds.set(mob.id, {
      def,
      handle,
      height: modelHeight(def) * MODEL_UNIT,
      free: Array.from({ length: POOL_SIZE }, (_, i) => POOL_SIZE - 1 - i),
    });
  }
  const shown = new Map<string, Shown>();

  // --- the ring under the locked mob ---
  const ringGeo = new THREE.RingGeometry(0.95, 1.25, 4, 1);
  ringGeo.rotateX(-Math.PI / 2);
  ringGeo.rotateY(Math.PI / 4);
  const ringMat = new THREE.MeshBasicMaterial({
    color: ramp("ore-amber", 4),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  ringMat.name = "defense-ring";
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.visible = false;
  ring.renderOrder = 2;
  root.add(ring);
  let lockedId: string | null = null;
  let ringPhase: Ms = 0;

  // --- the shield ---
  const shieldH = 2.8;
  const shieldGeo = new THREE.PlaneGeometry(layout.width, shieldH);
  const shieldTex = shieldTexture();
  shieldTex.repeat.set(layout.width / 2, shieldH / 2);
  const shieldMat = new THREE.MeshBasicMaterial({
    color: ramp("wool-cyan", 4),
    map: shieldTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  shieldMat.name = "defense-shield";
  const shield = new THREE.Mesh(shieldGeo, shieldMat);
  shield.position.set(layout.center.x, layout.groundY + shieldH / 2, layout.baseZ + 0.2);
  shield.renderOrder = 1;
  root.add(shield);
  let shieldLevel = 1;
  let pulseLeft: Ms = 0;

  const paintShield = (): void => {
    const pulse = pulseLeft > 0 ? (pulseLeft / PULSE_MS) * 0.3 : 0;
    // An empty shield is still faintly there: mobs bounce off something.
    shieldMat.opacity = 0.05 + 0.2 * shieldLevel + pulse;
    shield.visible = shieldMat.opacity > 0.01;
  };
  paintShield();

  // --- the camp's glow: a warm light from the camera's side, onto the mobs' faces ---
  const glow = new THREE.DirectionalLight(ramp("ore-amber", 4), 0);
  glow.name = "defense-glow";
  glow.position.set(layout.center.x, layout.groundY + 9, layout.baseZ + 16);
  glow.target.position.set(layout.center.x, layout.groundY, layout.center.z);
  root.add(glow, glow.target);

  const v = new THREE.Vector3();
  let disposed = false;

  const zOf = (p: number): number => layout.farZ + (layout.baseZ - layout.farZ) * p;
  const xOf = (slot: number): number =>
    layout.laneX[Math.min(layout.laneX.length - 1, Math.max(0, slot))] ?? layout.center.x;

  const release = (id: string): void => {
    const s = shown.get(id);
    if (s === undefined) return;
    shown.delete(id);
    s.kind.handle.setVisible(s.index, false);
    s.kind.free.push(s.index);
    if (lockedId === id) {
      lockedId = null;
      ring.visible = false;
    }
    opts.requestRender();
  };

  const put = (mob: FieldMob, s: Shown): void => {
    let p = mob.p;
    let y = layout.groundY;
    if (s.hop >= 0) {
      p = mob.p - HOP_BACK * s.hop;
      y += HOP_HEIGHT * 4 * s.hop * (1 - s.hop);
    }
    // Ease out with a small overshoot: 0 → 1.08 → 1.
    const g = s.grow;
    const size = g >= 1 ? 1 : 1 + 1.9 * (g - 1) ** 3 + 0.9 * (g - 1) ** 2;
    s.kind.handle.place(s.index, { x: xOf(mob.slot), y, z: zOf(p) }, 0, MOB_SCALE * size);
    if (lockedId === mob.id) ring.position.set(xOf(mob.slot), layout.groundY + 0.04, zOf(p));
  };

  /** Plays `defeat` and frees the instance when it ends. `done` fires once, whatever happens. */
  const leave = (mob: FieldMob, done: () => void): void => {
    const s = shown.get(mob.id);
    let fired = false;
    const end = (): void => {
      if (fired) return;
      fired = true;
      release(mob.id);
      done();
    };
    if (s === undefined || disposed) {
      end();
      return;
    }
    s.playing = "defeat";
    if (!s.kind.handle.play(s.index, "defeat", { restart: true, onEnd: end })) end();
  };

  return {
    spawn(mob) {
      if (disposed) return false;
      const kind = kinds.get(mob.mobId);
      const index = kind?.free.pop();
      if (kind === undefined || index === undefined) return false;
      const grow = opts.reducedMotion() ? 1 : 0;
      const rate = walkRate(mob.speed);
      const s: Shown = { kind, index, loop: "walk", playing: null, hop: -1, grow, rate };
      shown.set(mob.id, s);
      put(mob, s);
      kind.handle.setVisible(index, true);
      kind.handle.play(index, "walk", { speed: rate });
      s.playing = "walk";
      opts.requestRender();
      return true;
    },
    place(mob) {
      const s = shown.get(mob.id);
      if (s === undefined) return;
      put(mob, s);
      const want = loopOf(mob);
      if (want !== s.loop) {
        s.loop = want;
        if (s.playing === "walk" || s.playing === "idle") {
          s.kind.handle.play(s.index, want, { speed: want === "walk" ? s.rate : 1 });
          s.playing = want;
        }
      }
    },
    hit(mob) {
      const s = shown.get(mob.id);
      if (s === undefined || s.playing === "defeat") return;
      s.playing = "hit";
      s.kind.handle.play(s.index, "hit", {
        restart: true,
        onEnd: () => {
          if (s.playing !== "hit") return;
          s.kind.handle.play(s.index, s.loop, { speed: s.loop === "walk" ? s.rate : 1 });
          s.playing = s.loop;
        },
      });
    },
    defeat: leave,
    bonk(mob, done) {
      const s = shown.get(mob.id);
      if (s !== undefined && !opts.reducedMotion()) s.hop = 0;
      leave(mob, done);
    },
    setLocked(id) {
      lockedId = id;
      const s = id === null ? undefined : shown.get(id);
      ring.visible = s !== undefined;
      opts.requestRender();
    },
    setGlow(level01) {
      glow.intensity = 1.5 * Math.min(1, Math.max(0, level01));
      opts.requestRender();
    },
    setShield(level01, pulse) {
      shieldLevel = Math.min(1, Math.max(0, level01));
      // A ripple is a flash: at most 3 a second across the whole app, and none under reduced motion.
      if (pulse && !opts.reducedMotion() && allowFlash()) pulseLeft = PULSE_MS;
      paintShield();
      opts.requestRender();
    },
    frame(dtMs) {
      if (disposed) return;
      for (const s of shown.values()) {
        if (s.hop >= 0) s.hop = Math.min(1, s.hop + dtMs / 420);
        if (s.grow < 1) s.grow = Math.min(1, s.grow + dtMs / GROW_MS);
      }
      for (const kind of kinds.values()) kind.handle.update(dtMs);
      if (pulseLeft > 0) {
        pulseLeft = Math.max(0, pulseLeft - dtMs);
        paintShield();
      }
      if (ring.visible && !opts.reducedMotion()) {
        ringPhase += dtMs;
        ring.scale.setScalar(1 + 0.06 * Math.sin((ringPhase / 900) * Math.PI * 2));
      }
    },
    applyShift(view) {
      if (disposed) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      camera.clearViewOffset();
      // A view offset slides the picture on the screen without changing its perspective.
      if (w > 0 && h > 0 && (view.shiftX !== 0 || view.shiftY !== 0))
        camera.setViewOffset(w, h, -view.shiftX, -view.shiftY, w, h);
      opts.requestRender();
    },
    headOf(mob, out) {
      const s = shown.get(mob.id);
      if (s === undefined) return false;
      v.set(xOf(mob.slot), layout.groundY + s.kind.height * MOB_SCALE + 0.15, zOf(mob.p));
      v.project(camera);
      if (v.z > 1 || v.z < -1) return false;
      out.x = canvas.offsetLeft + ((v.x + 1) / 2) * canvas.clientWidth;
      out.y = canvas.offsetTop + ((1 - v.y) / 2) * canvas.clientHeight;
      return true;
    },
    worldOf(mob, out) {
      const h = (kinds.get(mob.mobId)?.height ?? 1) * MOB_SCALE;
      out.x = xOf(mob.slot);
      out.y = layout.groundY + h / 2;
      out.z = zOf(mob.p);
      return out;
    },
    stats: () => ({ types: kinds.size, parts, shown: shown.size, shadowCasters }),
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      for (const kind of kinds.values()) kind.handle.dispose();
      kinds.clear();
      shown.clear();
      ringGeo.dispose();
      ringMat.dispose();
      shieldGeo.dispose();
      shieldMat.dispose();
      shieldTex.dispose();
      glow.dispose();
      // The camera is shared: hand it back without the view shift.
      camera.clearViewOffset();
      opts.requestRender();
    },
  };
}
