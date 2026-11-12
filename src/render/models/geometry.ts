/**
 * Geometry and material for voxel model parts (task M4-01).
 *
 * Each part is one box. Its origin is the part's pivot, so a mesh rotates and scales about the
 * pivot with no extra node. Flat-colour parts carry their colour as a vertex colour; tiled parts
 * get atlas UVs on all six faces. All parts of one model share one material: a per-vertex
 * `vtTex` weight (0 or 1) decides whether a fragment samples the atlas, so a model mixing flat
 * and tiled parts still needs only one program and one material.
 *
 * **Texel density:** a face shows one atlas texel per model pixel, so a 4×6 face shows the middle
 * 4×6 texels of its tile and doesn't stretch it. Faces over 16 pixels stretch the whole tile.
 */
import * as THREE from "three";
import type { BlockId } from "@/types/core";
import { TILE_SIZE } from "../atlas/painters";
import { tileUv } from "../atlas/build";
import { MODEL_UNIT } from "./rig";
import type { ModelPart } from "./rig";

/** What the models need from an atlas. The scene's `Atlas` fits; tests pass a small fake. */
export interface ModelAtlas {
  texture: THREE.Texture;
  canvas: { readonly width: number };
  tileOf(blockId: BlockId, face: "top" | "bottom" | "side"): number;
}

/** The colour of a tiled part when no atlas is given. */
export const NO_ATLAS_COLOR = "#b8b8b8";

const PROGRAM_KEY = "vt-model-tex";

// BoxGeometry's face order: +x, -x, +y, -y, +z, -z. Each face's (width, height) in the part's
// pixel size, as indices into `size`.
const FACE_DIMS: readonly (readonly [number, number])[] = [
  [2, 1],
  [2, 1],
  [0, 2],
  [0, 2],
  [0, 1],
  [0, 1],
];

/** The box for one part, in world units, with its origin at the pivot. */
export function partGeometry(part: ModelPart, atlas: ModelAtlas | null): THREE.BufferGeometry {
  const [sx, sy, sz] = part.size;
  const geometry = new THREE.BoxGeometry(sx * MODEL_UNIT, sy * MODEL_UNIT, sz * MODEL_UNIT);
  geometry.clearGroups();
  geometry.translate(
    (sx / 2 - part.pivot[0]) * MODEL_UNIT,
    (sy / 2 - part.pivot[1]) * MODEL_UNIT,
    (sz / 2 - part.pivot[2]) * MODEL_UNIT,
  );
  const vertexCount = geometry.getAttribute("position").count;
  const textured = part.tile !== undefined && atlas !== null;
  const color = new THREE.Color(textured ? "#ffffff" : (part.color ?? NO_ATLAS_COLOR));
  const colors = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) colors.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute(
    "vtTex",
    new THREE.BufferAttribute(new Float32Array(vertexCount).fill(textured ? 1 : 0), 1),
  );

  if (textured && part.tile) {
    const [u0, v0, u1, v1] = tileUv(
      atlas.canvas.width,
      atlas.tileOf(part.tile.blockId, part.tile.face),
    );
    const uv = geometry.getAttribute("uv");
    for (let face = 0; face < 6; face++) {
      const dims = FACE_DIMS[face] ?? [0, 1];
      const fu = Math.min((part.size[dims[0]] ?? 0) / TILE_SIZE, 1);
      const fv = Math.min((part.size[dims[1]] ?? 0) / TILE_SIZE, 1);
      for (let k = 0; k < 4; k++) {
        const i = face * 4 + k;
        // BoxGeometry gives each face corner a 0/1 uv; crop to the face's middle texels.
        const a = 0.5 + (uv.getX(i) - 0.5) * fu;
        const b = 0.5 + (uv.getY(i) - 0.5) * fv;
        uv.setXY(i, u0 + (u1 - u0) * a, v0 + (v1 - v0) * b);
      }
    }
  }
  return geometry;
}

/** True if any part of the model would sample the atlas. */
export function needsAtlas(parts: readonly ModelPart[], atlas: ModelAtlas | null): boolean {
  return atlas !== null && parts.some((p) => p.tile !== undefined);
}

/**
 * The one material for a model's parts. With `map` it gets a small shader patch so `vtTex`
 * picks per vertex between the atlas texel and plain white.
 */
export function modelMaterial(map: THREE.Texture | null): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.name = "voxel-model";
  if (!map) return material;
  material.map = map;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <uv_pars_vertex>",
        "#include <uv_pars_vertex>\nattribute float vtTex;\nvarying float vVtTex;",
      )
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n\tvVtTex = vtTex;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <uv_pars_fragment>", "#include <uv_pars_fragment>\nvarying float vVtTex;")
      .replace(
        "#include <map_fragment>",
        [
          "#ifdef USE_MAP",
          "\tvec4 sampledDiffuseColor = texture2D( map, vMapUv );",
          "\tdiffuseColor *= mix( vec4( 1.0 ), sampledDiffuseColor, vVtTex );",
          "#endif",
        ].join("\n"),
      );
  };
  material.customProgramCacheKey = () => PROGRAM_KEY;
  return material;
}
