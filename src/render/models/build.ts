/**
 * Builds three.js objects from voxel models (task M4-01, contracts.md §8.4).
 *
 * - {@link buildModel}: one creature. A mesh per part, nested by `parent`, all sharing one
 *   material. Costs one draw call per part.
 * - {@link buildModelInstanced}: many copies of one model. One `InstancedMesh` per part, so any
 *   number of copies (each with its own anim, place and tint) still costs one draw call per part.
 *
 * Neither reads a clock: time comes in through `update(dtMs)`. To keep the render loop awake only
 * while something moves, add the model to a `createModelDriver` (driver.ts).
 *
 * `dispose()` frees the geometries, materials and instance buffers made here. It never disposes
 * the atlas texture, which the scene owns and shares.
 */
import * as THREE from "three";
import type { Ms } from "@/types/core";
import type { Vec3 } from "../types";
import { Animator } from "./animator";
import type { PlayOptions } from "./animator";
import { modelMaterial, needsAtlas, partGeometry } from "./geometry";
import type { ModelAtlas } from "./geometry";
import { MODEL_UNIT, POSE_STRIDE, compileRig } from "./rig";
import type { CompiledRig, Pose } from "./rig";
import type { VoxelModel } from "./types";

export interface ModelOptions {
  /**
   * Read on every update. While true, looping anims (idle, walk) hold their first frame and stop
   * asking for frames; one-shot anims (hit, defeat) still play. Pass the scene's resolved
   * reduced-motion flag (`Settings.reducedMotion`, 'system' → media query).
   */
  reducedMotion?: () => boolean;
}

/** Something the model driver can run: it updates while `animating` and wakes the loop on play. */
export interface Animatable {
  update(dtMs: Ms): void;
  readonly animating: boolean;
  /** The driver passes the loop's `wake`; `play` calls it. Null unbinds. */
  bindWake(wake: (() => void) | null): void;
}

/** One built model (contracts.md §8.4: `{ root, play, update, setTint, dispose }`). */
export interface ModelHandle extends Animatable {
  /** Add this to the scene and move, turn or scale it as a whole. */
  readonly root: THREE.Group;
  /** Starts an anim (120 ms crossfade by default). False if the model has no such anim. */
  play(anim: string, opts?: PlayOptions): boolean;
  /** Blends back to the rest pose. */
  stop(opts?: { fadeMs?: Ms }): void;
  /** Advances the anims by `dtMs` and poses the parts. */
  update(dtMs: Ms): void;
  /** Multiplies every part's colour by `color`. Null (or white) clears it. */
  setTint(color: THREE.ColorRepresentation | null): void;
  /** The playing anim, or null. */
  readonly current: string | null;
  /** The mesh of each part, by name (for attaching a held item, a plate anchor, tests). */
  part(name: string): THREE.Mesh | undefined;
  dispose(): void;
}

/** Many copies of one model. Instance `i` is 0 ≤ i < count. */
export interface InstancedModelHandle extends Animatable {
  /** Holds one InstancedMesh per part. Instances are placed in this group's space. */
  readonly root: THREE.Group;
  readonly count: number;
  /** Puts instance `i` at `at` (world units, feet on `at.y`), turned `yaw` radians about y. */
  place(i: number, at: Vec3, yaw?: number, scale?: number): void;
  /** Instances start hidden; `place` doesn't show them. A hidden instance draws nothing visible. */
  setVisible(i: number, visible: boolean): void;
  isVisible(i: number): boolean;
  play(i: number, anim: string, opts?: PlayOptions): boolean;
  stop(i: number, opts?: { fadeMs?: Ms }): void;
  current(i: number): string | null;
  update(dtMs: Ms): void;
  setTint(i: number, color: THREE.ColorRepresentation | null): void;
  /** The InstancedMesh of each part, by name. */
  part(name: string): THREE.InstancedMesh | undefined;
  dispose(): void;
}

const DEG = Math.PI / 180;
const WHITE = new THREE.Color(1, 1, 1);

function materialFor(rig: CompiledRig, atlas: ModelAtlas | null): THREE.MeshLambertMaterial {
  const parts = rig.parts.map((p) => p.def);
  return modelMaterial(atlas && needsAtlas(parts, atlas) ? atlas.texture : null);
}

/** Writes part `p` of `pose` into an Object3D's position, rotation and scale. */
function applyPart(rig: CompiledRig, pose: Pose, p: number, obj: THREE.Object3D): void {
  const part = rig.parts[p];
  if (!part) return;
  const o = p * POSE_STRIDE;
  const [ox, oy, oz] = part.def.offset;
  obj.position.set(
    (ox + (pose[o] ?? 0)) * MODEL_UNIT,
    (oy + (pose[o + 1] ?? 0)) * MODEL_UNIT,
    (oz + (pose[o + 2] ?? 0)) * MODEL_UNIT,
  );
  obj.rotation.set((pose[o + 3] ?? 0) * DEG, (pose[o + 4] ?? 0) * DEG, (pose[o + 5] ?? 0) * DEG);
  obj.scale.set(pose[o + 6] ?? 1, pose[o + 7] ?? 1, pose[o + 8] ?? 1);
}

/**
 * Builds one model. `atlas` may be null for a model of flat colours (tiled parts then show a
 * neutral grey). The model starts in its rest pose with no anim playing.
 */
export function buildModel(
  def: VoxelModel,
  atlas: ModelAtlas | null,
  opts: ModelOptions = {},
): ModelHandle {
  const rig = compileRig(def);
  const animator = new Animator(
    rig,
    opts.reducedMotion ? { reducedMotion: opts.reducedMotion } : {},
  );
  const material = materialFor(rig, atlas);
  const root = new THREE.Group();
  root.name = `model:${def.id}`;
  const meshes: THREE.Mesh[] = [];
  const byName = new Map<string, THREE.Mesh>();
  for (const part of rig.parts) {
    const mesh = new THREE.Mesh(partGeometry(part.def, atlas), material);
    mesh.name = part.def.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    (meshes[part.parent] ?? root).add(mesh);
    meshes.push(mesh);
    byName.set(part.def.name, mesh);
  }
  const pose = (): void => {
    for (let p = 0; p < meshes.length; p++) {
      const mesh = meshes[p];
      if (mesh) applyPart(rig, animator.pose, p, mesh);
    }
  };
  pose();

  let wake: (() => void) | null = null;
  let disposed = false;
  return {
    root,
    play(anim, playOpts) {
      if (disposed) return false;
      const ok = animator.play(anim, playOpts);
      if (ok) wake?.();
      return ok;
    },
    stop(stopOpts) {
      if (disposed) return;
      animator.stop(stopOpts);
      wake?.();
    },
    update(dtMs) {
      if (!disposed && animator.update(dtMs)) pose();
    },
    get animating() {
      return !disposed && animator.animating;
    },
    get current() {
      return animator.current;
    },
    bindWake(fn) {
      wake = fn;
    },
    setTint(color) {
      material.color.copy(color === null ? WHITE : new THREE.Color(color));
      wake?.();
    },
    part: (name) => byName.get(name),
    dispose() {
      if (disposed) return;
      disposed = true;
      wake = null;
      root.removeFromParent();
      for (const mesh of meshes) mesh.geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Builds `count` copies of a model with one `InstancedMesh` per part. Each copy has its own anim
 * state, place, visibility and tint. Instances start hidden.
 */
export function buildModelInstanced(
  def: VoxelModel,
  count: number,
  opts: ModelOptions & { atlas?: ModelAtlas | null } = {},
): InstancedModelHandle {
  if (!Number.isInteger(count) || count < 1)
    throw new RangeError(`count must be ≥ 1, got ${count}`);
  const rig = compileRig(def);
  const atlas = opts.atlas ?? null;
  const animOpts = opts.reducedMotion ? { reducedMotion: opts.reducedMotion } : {};
  const animators = Array.from({ length: count }, () => new Animator(rig, animOpts));
  const material = materialFor(rig, atlas);
  const root = new THREE.Group();
  root.name = `model-instanced:${def.id}`;
  const meshes = rig.parts.map((part) => {
    const mesh = new THREE.InstancedMesh(partGeometry(part.def, atlas), material, count);
    mesh.name = part.def.name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instances move every frame; a stale bounding sphere would cull live ones.
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Allocate the colour buffer up front so a later tint doesn't recompile the program.
    for (let i = 0; i < count; i++) mesh.setColorAt(i, WHITE);
    root.add(mesh);
    return mesh;
  });
  const byName = new Map(meshes.map((m) => [m.name, m]));

  const places = Array.from({ length: count }, () => new THREE.Matrix4());
  const visible = Array.from({ length: count }, () => false);
  const dirty = Array.from({ length: count }, () => true);
  // Reused per update.
  const world = rig.parts.map(() => new THREE.Matrix4());
  const local = new THREE.Matrix4();
  const tmp = new THREE.Object3D();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const color = new THREE.Color();

  const check = (i: number): void => {
    if (!Number.isInteger(i) || i < 0 || i >= count) {
      throw new RangeError(`instance ${i} is outside 0..${count - 1}`);
    }
  };

  const writeInstance = (i: number): void => {
    const animator = animators[i];
    const place = places[i];
    if (!animator || !place) return;
    if (!visible[i]) {
      for (const mesh of meshes) mesh.setMatrixAt(i, zero);
      return;
    }
    for (let p = 0; p < rig.parts.length; p++) {
      const part = rig.parts[p];
      const out = world[p];
      const mesh = meshes[p];
      if (!part || !out || !mesh) continue;
      applyPart(rig, animator.pose, p, tmp);
      local.compose(tmp.position, tmp.quaternion.setFromEuler(tmp.rotation), tmp.scale);
      out.multiplyMatrices(world[part.parent] ?? place, local);
      mesh.setMatrixAt(i, out);
    }
  };

  let wake: (() => void) | null = null;
  let disposed = false;

  const flush = (dtMs: Ms): void => {
    let any = false;
    for (let i = 0; i < count; i++) {
      const moved = animators[i]?.update(dtMs) ?? false;
      if (moved || dirty[i]) {
        dirty[i] = false;
        writeInstance(i);
        any = true;
      }
    }
    if (any) for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  };
  flush(0);

  const touch = (i: number): void => {
    dirty[i] = true;
    wake?.();
  };

  return {
    root,
    count,
    place(i, at, yaw = 0, scale = 1) {
      check(i);
      tmp.position.set(at.x, at.y, at.z);
      tmp.rotation.set(0, yaw, 0);
      tmp.scale.setScalar(scale);
      tmp.updateMatrix();
      places[i]?.copy(tmp.matrix);
      touch(i);
    },
    setVisible(i, show) {
      check(i);
      if (visible[i] === show) return;
      visible[i] = show;
      touch(i);
    },
    isVisible(i) {
      check(i);
      return visible[i] ?? false;
    },
    play(i, anim, playOpts) {
      check(i);
      if (disposed) return false;
      const ok = animators[i]?.play(anim, playOpts) ?? false;
      if (ok) wake?.();
      return ok;
    },
    stop(i, stopOpts) {
      check(i);
      if (disposed) return;
      animators[i]?.stop(stopOpts);
      wake?.();
    },
    current(i) {
      check(i);
      return animators[i]?.current ?? null;
    },
    update(dtMs) {
      if (!disposed) flush(dtMs);
    },
    get animating() {
      return !disposed && (dirty.includes(true) || animators.some((a) => a.animating));
    },
    bindWake(fn) {
      wake = fn;
    },
    setTint(i, tint) {
      check(i);
      color.copy(tint === null ? WHITE : new THREE.Color(tint));
      for (const mesh of meshes) {
        mesh.setColorAt(i, color);
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      wake?.();
    },
    part: (name) => byName.get(name),
    dispose() {
      if (disposed) return;
      disposed = true;
      wake = null;
      root.removeFromParent();
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
      material.dispose();
    },
  };
}
