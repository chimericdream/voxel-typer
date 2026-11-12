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
 * 4×6 texels of its tile and doesn't stretch it. The crop starts on a whole texel
 * (`floor((16 - n) / 2)`), so an odd size such as 5 shows texels 5–9 and never half a texel.
 * Faces over 16 pixels stretch the whole tile.
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
      const [su, lu] = cropSpan(part.size[dims[0]] ?? 0);
      const [sv, lv] = cropSpan(part.size[dims[1]] ?? 0);
      for (let k = 0; k < 4; k++) {
        const i = face * 4 + k;
        // BoxGeometry gives each face corner a 0/1 uv; crop to the face's middle texels.
        const a = su + uv.getX(i) * lu;
        const b = sv + uv.getY(i) * lv;
        uv.setXY(i, u0 + (u1 - u0) * a, v0 + (v1 - v0) * b);
      }
    }
  }
  return geometry;
}

/**
 * The part of a tile (as fractions: start and length) that a face `px` model pixels long shows:
 * the middle `px` texels, starting on a whole texel; the whole tile from 16 px up.
 */
export function cropSpan(px: number): [start: number, length: number] {
  if (!(px < TILE_SIZE)) return [0, 1];
  return [Math.floor((TILE_SIZE - px) / 2) / TILE_SIZE, px / TILE_SIZE];
}

/** True if any part of the model would sample the atlas. */
export function needsAtlas(parts: readonly ModelPart[], atlas: ModelAtlas | null): boolean {
  return atlas !== null && parts.some((p) => p.tile !== undefined);
}

/** One edit of the shader patch: `anchor` must occur exactly once and is replaced by `code`. */
interface ShaderEdit {
  stage: "vertexShader" | "fragmentShader";
  anchor: string;
  code: string;
}

const SHADER_EDITS: readonly ShaderEdit[] = [
  {
    stage: "vertexShader",
    anchor: "#include <uv_pars_vertex>",
    code: "#include <uv_pars_vertex>\nattribute float vtTex;\nvarying float vVtTex;",
  },
  {
    stage: "vertexShader",
    anchor: "#include <uv_vertex>",
    code: "#include <uv_vertex>\n\tvVtTex = vtTex;",
  },
  {
    stage: "fragmentShader",
    anchor: "#include <uv_pars_fragment>",
    code: "#include <uv_pars_fragment>\nvarying float vVtTex;",
  },
  {
    // three's own map_fragment multiplies by the texel unconditionally; ours weights it by vtTex.
    // (Its DECODE_VIDEO_TEXTURE branch is dropped: the atlas is never a video.)
    stage: "fragmentShader",
    anchor: "#include <map_fragment>",
    code: [
      "#ifdef USE_MAP",
      "\tvec4 sampledDiffuseColor = texture2D( map, vMapUv );",
      "\tdiffuseColor *= mix( vec4( 1.0 ), sampledDiffuseColor, vVtTex );",
      "#endif",
    ].join("\n"),
  },
];

/**
 * Applies the `vtTex` patch to a Lambert shader. Throws, naming the anchor, if three.js has
 * renamed or split a chunk it relies on, so an upgrade fails loudly instead of letting flat parts
 * sample the atlas.
 */
export function patchModelShader(shader: { vertexShader: string; fragmentShader: string }): void {
  for (const { stage, anchor, code } of SHADER_EDITS) {
    const src = shader[stage];
    const at = src.indexOf(anchor);
    if (at < 0 || src.includes(anchor, at + anchor.length)) {
      throw new Error(
        `voxel model shader patch: "${anchor}" must occur exactly once in the ${stage} ` +
          "(three.js changed its shader chunks; update SHADER_EDITS in src/render/models/geometry.ts)",
      );
    }
    shader[stage] = src.slice(0, at) + code + src.slice(at + anchor.length);
  }
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
  // The hook is the patch itself (it only reads the two shader strings), so tests can check it.
  material.onBeforeCompile = patchModelShader;
  material.customProgramCacheKey = () => PROGRAM_KEY;
  return material;
}
