/**
 * Geometry for the world map (task M3-04): island meshes from the shared voxel mesher, and plain
 * colored boxes for the cloud cover and the stepping stones.
 */
import * as THREE from "three";
import { ISLAND_GROUND_Y, ISLAND_SIZE } from "@/content/worldgen/islands";
import { splitByBucket } from "../chunks";
import { meshChunk } from "../mesher/voxel-grid";
import type { AtlasLookup, ChunkMesh, VoxelGrid } from "../mesher/voxel-grid";

function toGeometry(mesh: ChunkMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  g.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return g;
}

/** A part of an island's mesh, moved so the middle of the ground's top surface is the origin. */
function centered(part: ChunkMesh | undefined): THREE.BufferGeometry | null {
  if (!part) return null;
  const g = toGeometry(part);
  g.translate(-ISLAND_SIZE.sx / 2, -(ISLAND_GROUND_Y + 1), -ISLAND_SIZE.sz / 2);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** An island's meshes: everything lit, and (when it has any) its glowing voxels. */
export interface IslandGeometry {
  lit: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
}

/**
 * Meshes one island with AO. The geometry is moved so the middle of the ground's top surface is
 * the origin: the island then stands where its group is placed and turns about its own middle.
 * With `glows`, glowing voxels go to their own geometry, to be drawn unlit.
 */
export function islandGeometry(
  grid: VoxelGrid,
  atlas: AtlasLookup,
  glows: ((kindNum: number) => boolean) | null,
): IslandGeometry {
  const size = Math.max(grid.sx, grid.sy, grid.sz);
  const mesh = meshChunk(grid, { x: 0, y: 0, z: 0 }, size, atlas, { ao: true });
  const parts = splitByBucket(mesh, grid, (num) => (glows?.(num) === true ? "glow" : "opaque"));
  return { lit: centered(parts.opaque), glow: centered(parts.glow) };
}

/** A box for {@link boxesGeometry}: its center, its size and one flat color (0–1 linear RGB). */
export interface ColorBox {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: readonly [number, number, number];
}

/** One geometry holding every box, with a `color` per vertex. One draw call however many boxes. */
export function boxesGeometry(boxes: readonly ColorBox[]): THREE.BufferGeometry {
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const up = unit.getAttribute("position");
  const un = unit.getAttribute("normal");
  const ui = unit.getIndex();
  const per = up.count;
  const perIndex = ui?.count ?? 0;
  const positions = new Float32Array(boxes.length * per * 3);
  const normals = new Float32Array(boxes.length * per * 3);
  const colors = new Float32Array(boxes.length * per * 3);
  const indices = new Uint32Array(boxes.length * perIndex);
  boxes.forEach((box, b) => {
    for (let v = 0; v < per; v++) {
      const o = (b * per + v) * 3;
      positions[o] = box.x + up.getX(v) * box.w;
      positions[o + 1] = box.y + up.getY(v) * box.h;
      positions[o + 2] = box.z + up.getZ(v) * box.d;
      normals[o] = un.getX(v);
      normals[o + 1] = un.getY(v);
      normals[o + 2] = un.getZ(v);
      colors[o] = box.color[0];
      colors[o + 1] = box.color[1];
      colors[o + 2] = box.color[2];
    }
    for (let i = 0; i < perIndex; i++) indices[b * perIndex + i] = (ui?.getX(i) ?? 0) + b * per;
  });
  unit.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
