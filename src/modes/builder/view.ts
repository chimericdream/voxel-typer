/**
 * Builder's 3D pieces (task M4-07): the cursor and the ghost of the armed block. The island
 * itself is the scene's chunk meshes.
 *
 * - **Cursor:** a cube frame around the cursor's cell, made of twelve bars in one instanced mesh.
 *   It is drawn twice: once in the world, and once on top of everything, so a cursor behind a
 *   tree or under the ground can still be found. The on-top pass is faint while the cursor is in
 *   the open. When it is buried, a bold on-top frame (bars {@link BURIED_SCALE} times as thick)
 *   with a dark outline takes its place (review N3, M4-FIX-1). Two draw calls in the open, three
 *   when buried.
 * - **Ghost:** the armed block, see-through, in the cell `put` would fill. It is meshed by the
 *   real mesher from a one-cell grid, so a flower shows as its sprig and a cube as a cube. One
 *   draw call.
 *
 * The frame breathes slowly (a small change of size, about once every 1.4 s). Under reduced motion
 * and `?freeze` it holds still.
 */
import * as THREE from "three";
import type { Atlas } from "@/render/atlas/build";
import { VoxelGrid, meshChunk } from "@/render/mesher/voxel-grid";
import type { Ms } from "@/types/core";
import type { Cell } from "./logic";

/** How much bigger than its cell the frame is at rest, so its bars clear the block's faces. */
const FRAME_REST = 1.04;
/** The breath: the frame grows by this share and comes back. */
const FRAME_BREATH = 0.05;
const BREATH_PERIOD_MS: Ms = 1400;
/** Bar thickness, in cells. M4-FIX-1 raised it from 0.06: at playtest zoom the frame was thin. */
const BAR = 0.085;
const FRAME_COLOR = 0xfff1a8;
const GHOST_OPACITY = 0.62;
/** The on-top pass: a hint in the open, the main picture when the cursor is buried. */
const THROUGH_OPEN = 0.28;
const THROUGH_BURIED = 0.9;
/** A buried cursor's on-top frame: bars this many times as thick as the frame in the open. */
const BURIED_SCALE = 2.5;
/** The dark outline behind a buried cursor's frame, a little larger than its bars. */
const OUTLINE_COLOR = 0x1c2430;
const OUTLINE_SCALE = 3.7;

export interface BuilderViewOptions {
  scene: THREE.Scene;
  atlas(): Atlas | null;
  reducedMotion(): boolean;
  /** `?freeze`: no breathing, so screenshots match. */
  frozen: boolean;
}

export interface BuilderView {
  /** `buried`: a block sits somewhere above the cell, so the frame is drawn strong, on top. */
  setCursor(cell: Cell, buried?: boolean): void;
  /** Shows block `blockNum` at `cell`, or hides the ghost when either is null. */
  setGhost(blockNum: number | null, cell: Cell | null): void;
  /** Advances the breath. Returns true while the frame is moving. */
  frame(dtMs: Ms): boolean;
  dispose(): void;
}

/** Twelve bars along the edges of a unit cube centered on the origin, `thick` times as thick. */
function frameMatrices(thick = 1): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  const half = 0.5;
  const axes = [0, 1, 2] as const;
  for (const axis of axes) {
    for (const a of [-half, half]) {
      for (const b of [-half, half]) {
        const pos = [0, 0, 0];
        const scale = [BAR * thick, BAR * thick, BAR * thick];
        const [u, v] = axes.filter((x) => x !== axis);
        pos[u ?? 0] = a;
        pos[v ?? 0] = b;
        scale[axis] = 1 + BAR * thick;
        out.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(pos[0], pos[1], pos[2]),
            new THREE.Quaternion(),
            new THREE.Vector3(scale[0], scale[1], scale[2]),
          ),
        );
      }
    }
  }
  return out;
}

export function createBuilderView(opts: BuilderViewOptions): BuilderView {
  const root = new THREE.Group();
  root.name = "builder";

  const bar = new THREE.BoxGeometry(1, 1, 1);
  const solid = new THREE.MeshBasicMaterial({ color: FRAME_COLOR, fog: false });
  const through = new THREE.MeshBasicMaterial({
    color: FRAME_COLOR,
    fog: false,
    transparent: true,
    opacity: THROUGH_OPEN,
    depthTest: false,
    depthWrite: false,
  });
  const dark = new THREE.MeshBasicMaterial({
    color: OUTLINE_COLOR,
    fog: false,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  const frame = new THREE.Group();
  /** One frame of twelve bars, `thick` times as thick, as one instanced mesh. */
  const bars = (material: THREE.Material, thick: number, order: number): THREE.InstancedMesh => {
    const matrices = frameMatrices(thick);
    const mesh = new THREE.InstancedMesh(bar, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    frame.add(mesh);
    return mesh;
  };
  bars(solid, 1, 10);
  const thin = bars(through, 1, 20);
  // A buried cursor: a bold frame on top, over a dark outline drawn just before it.
  const bold = bars(through, BURIED_SCALE, 20);
  const outline = bars(dark, OUTLINE_SCALE, 19);
  bold.visible = false;
  outline.visible = false;
  frame.scale.setScalar(FRAME_REST);
  root.add(frame);

  const ghostMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: GHOST_OPACITY,
    depthWrite: false,
    vertexColors: true,
    alphaTest: 0.05,
  });
  const ghost = new THREE.Mesh(new THREE.BufferGeometry(), ghostMaterial);
  ghost.visible = false;
  ghost.renderOrder = 15;
  root.add(ghost);
  const ghostGeometry = new Map<number, THREE.BufferGeometry>();
  const empty = ghost.geometry;

  const geometryOf = (blockNum: number, atlas: Atlas): THREE.BufferGeometry => {
    const cached = ghostGeometry.get(blockNum);
    if (cached) return cached;
    const one = new VoxelGrid(1, 1, 1);
    one.set(0, 0, 0, blockNum);
    const mesh = meshChunk(one, { x: 0, y: 0, z: 0 }, 16, atlas, { ao: false });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
    g.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    ghostGeometry.set(blockNum, g);
    return g;
  };

  opts.scene.add(root);
  let phase: Ms = 0;

  return {
    setCursor(cell, buried = false) {
      frame.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
      outline.visible = buried;
      bold.visible = buried;
      thin.visible = !buried;
      through.opacity = buried ? THROUGH_BURIED : THROUGH_OPEN;
    },
    setGhost(blockNum, cell) {
      const atlas = opts.atlas();
      if (blockNum === null || cell === null || atlas === null) {
        ghost.visible = false;
        return;
      }
      if (ghostMaterial.map !== atlas.texture) {
        ghostMaterial.map = atlas.texture;
        ghostMaterial.needsUpdate = true;
      }
      ghost.geometry = geometryOf(blockNum, atlas);
      ghost.position.set(cell.x, cell.y, cell.z);
      ghost.visible = true;
    },
    frame(dtMs) {
      if (opts.frozen || opts.reducedMotion()) {
        if (frame.scale.x !== FRAME_REST) frame.scale.setScalar(FRAME_REST);
        return false;
      }
      phase = (phase + Math.max(0, dtMs)) % BREATH_PERIOD_MS;
      const wave = (1 - Math.cos((phase / BREATH_PERIOD_MS) * Math.PI * 2)) / 2;
      frame.scale.setScalar(FRAME_REST + FRAME_BREATH * wave);
      return true;
    },
    dispose() {
      opts.scene.remove(root);
      bar.dispose();
      solid.dispose();
      through.dispose();
      dark.dispose();
      ghostMaterial.dispose();
      empty.dispose();
      for (const g of ghostGeometry.values()) g.dispose();
      ghostGeometry.clear();
    },
  };
}
