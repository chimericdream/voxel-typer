/**
 * Voxel clouds (task M2-02, PLAN.md §3.4): one `InstancedMesh` of flat boxes, so the whole sky of
 * clouds is a single draw call. Each cloud is a wide slab with up to two smaller slabs stacked on
 * it. The layout is seeded, so a frozen frame is the same every time.
 *
 * Two layers: high clouds in a band behind the diorama (toward −z, where both camera presets look),
 * and low clouds under the diorama's base, which the `overview` camera sees. All drift slowly
 * along +x, wrapping around the band. Faces carry baked shade (top brightest, bottom
 * darkest) as vertex colors, multiplied by the time-of-day cloud color, so they read as blocky
 * without depending on the lights. They take the scene fog, so far clouds melt into the horizon.
 *
 * {@link Clouds.advance} writes the instance matrices in place: no allocation per frame.
 */
import * as THREE from "three";
import { createRng } from "@/engine/rng";
import type { Ms } from "@/types/core";

/** Width of the band clouds wrap around, in blocks. */
export const CLOUD_SPAN = 320;
/** Drift speed in blocks per second. */
export const CLOUD_SPEED = 0.9;
/** Clouds stay this far behind the diorama center (−z) and no farther than `CLOUD_FAR`. */
const CLOUD_NEAR = 36;
const CLOUD_FAR = 170;
/** Height of the high cloud layer above the diorama's top. */
const CLOUD_LIFT = 14;
/**
 * The low layer floats below the diorama (whose base is y = 0), so the `overview` camera, which
 * looks down past the horizon, sees clouds drifting under a floating island.
 */
const LOW_Y = -9;
const LOW_Z_MIN = -130;
const LOW_Z_MAX = 20;

export interface CloudOptions {
  seed?: number;
  /** Number of high clouds, behind the diorama (each 1–3 boxes). */
  count?: number;
  /** Number of low clouds, under the diorama. */
  lowCount?: number;
}

export interface Clouds {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.MeshBasicMaterial;
  /** Current drift offset along x, in blocks (wraps at {@link CLOUD_SPAN}). */
  readonly offset: number;
  /** Moves the clouds by `dtMs` of drift. */
  advance(dtMs: Ms): void;
  /** Centers the band on the diorama: `center` is its middle, `top` its highest y. */
  place(center: THREE.Vector3, top: number): void;
  dispose(): void;
}

/** Face shades for a unit box, in BoxGeometry's face order: +x, −x, +y, −y, +z, −z. */
const FACE_SHADE = [0.88, 0.84, 1, 0.74, 0.92, 0.8] as const;

function cloudGeometry(): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const count = geo.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  // BoxGeometry has 4 vertices per face, faces in FACE_SHADE order.
  for (let v = 0; v < count; v++) {
    const s = FACE_SHADE[Math.floor(v / 4)] ?? 1;
    colors[v * 3] = s;
    colors[v * 3 + 1] = s;
    colors[v * 3 + 2] = s;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

export function createClouds(opts: CloudOptions = {}): Clouds {
  const rng = createRng(opts.seed ?? 7).fork("clouds");
  const high = opts.count ?? 22;
  const low = opts.lowCount ?? 16;

  // Per cloud: x and layer. Per box: its cloud, and dx, y, z, sx, sy, sz (y relative to the layer).
  const cloudX: number[] = [];
  const cloudHigh: boolean[] = [];
  const boxCloud: number[] = [];
  const box: number[] = [];
  for (let c = 0; c < high + low; c++) {
    const isHigh = c < high;
    cloudX.push((rng.next() - 0.5) * CLOUD_SPAN);
    cloudHigh.push(isHigh);
    // High clouds stay behind the diorama; low ones may pass under it (it hides them).
    const z = isHigh
      ? -(CLOUD_NEAR + rng.next() * (CLOUD_FAR - CLOUD_NEAR))
      : LOW_Z_MIN + rng.next() * (LOW_Z_MAX - LOW_Z_MIN);
    const y = isHigh ? rng.next() * 5 : -rng.next() * 6;
    const w = rng.int(10, 26);
    const d = rng.int(6, 14);
    box.push(0, y, z, w, 2, d);
    boxCloud.push(c);
    const extra = rng.int(0, 2);
    for (let e = 0; e < extra; e++) {
      const ew = Math.max(4, Math.round(w * (0.35 + rng.next() * 0.3)));
      const ed = Math.max(3, Math.round(d * (0.4 + rng.next() * 0.3)));
      const dx = (rng.next() - 0.5) * (w - ew);
      const dz = (rng.next() - 0.5) * (d - ed);
      // Stacked on the 2-high base slab (centered on y), each 1.5 high.
      box.push(dx, y + 1.75 + 1.5 * e, z + dz, ew, 1.5, ed);
      boxCloud.push(c);
    }
  }
  const boxes = boxCloud.length;

  const geometry = cloudGeometry();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  material.name = "clouds";
  const mesh = new THREE.InstancedMesh(geometry, material, boxes);
  mesh.name = "clouds";
  // Instances move every frame; a stale bounding sphere would cull them.
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const m = new THREE.Matrix4();
  let offset = 0;
  let highY = CLOUD_LIFT;

  const write = (): void => {
    for (let i = 0; i < boxes; i++) {
      const c = boxCloud[i] ?? 0;
      const base = (cloudX[c] ?? 0) + offset;
      // Wrap the cloud (not each box) into [−span/2, span/2).
      const x = THREE.MathUtils.euclideanModulo(base + CLOUD_SPAN / 2, CLOUD_SPAN) - CLOUD_SPAN / 2;
      const o = i * 6;
      m.makeScale(box[o + 3] ?? 1, box[o + 4] ?? 1, box[o + 5] ?? 1);
      const layerY = cloudHigh[c] ? highY : LOW_Y;
      m.setPosition(x + (box[o] ?? 0), layerY + (box[o + 1] ?? 0), box[o + 2] ?? 0);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  write();

  return {
    mesh,
    material,
    get offset() {
      return offset;
    },
    advance(dtMs) {
      if (!(dtMs > 0)) return;
      offset = (offset + (CLOUD_SPEED * dtMs) / 1000) % CLOUD_SPAN;
      write();
    },
    place(center, top) {
      if (mesh.position.x !== center.x || mesh.position.z !== center.z) {
        mesh.position.set(center.x, 0, center.z);
        mesh.updateMatrixWorld();
      }
      if (highY !== top + CLOUD_LIFT) {
        highY = top + CLOUD_LIFT;
        write();
      }
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
