/**
 * Mine mode's 3D stage (task M2-13): the floating target block with its crack overlay, the letter
 * painted on its face, the ore glow, a soft shadow on the floor, and the arm with the pickaxe in
 * the lower right.
 *
 * Draw calls: block, crack, letter, glow, shadow and arm are one each, and only the visible ones
 * count (at most 6). Nothing here allocates per frame. All motion is driven by `frame(dt)`, so it
 * holds still during a hit-stop and while paused.
 *
 * Motion rules (PLAN §4.6, orchestrator notes):
 * - `ambient` (the slow bob, sway and glow pulse) runs only in live play with full motion. It is
 *   off under reduced motion and under `?freeze`.
 * - `animate` (swing, wobble, slide-in, recoil) is off under reduced motion: the block and arm
 *   simply change state.
 *
 * The arm and pickaxe are original voxel art built from boxes in palette colors (M1-14).
 */
import * as THREE from "three";
import type { Atlas } from "@/render/atlas/build";
import { buildCrackTextures, tileUv } from "@/render/atlas/build";
import { BASE_PALETTE } from "@/render/atlas/palettes";
import type { PaletteRampId } from "@/render/atlas/recipes";
import type { Vec3 } from "@/render/types";
import type { BlockId, Ms } from "@/types/core";

/** Edge of the target block in world units. A diorama block is 1, so it reads as "the big one". */
export const BLOCK_SIZE = 1.3;
/** Pickaxe swing length (card: 120 ms). */
export const SWING_MS: Ms = 120;
/** How long the next block takes to arrive. */
export const SLIDE_MS: Ms = 220;
/** How long the block's little recoil from a hit lasts. */
export const RECOIL_MS: Ms = 110;

const BOB_PERIOD: Ms = 3400;
const BOB_HEIGHT = 0.06;
const SWAY_PERIOD: Ms = 5600;
const SWAY_ANGLE = THREE.MathUtils.degToRad(9);
const GLOW_PERIOD: Ms = 1500;
/** Wobble spring: a quick, soft shake of the head that settles in about half a second. */
const WOBBLE_KICK = 7.5;
const WOBBLE_STIFFNESS = 230;
const WOBBLE_DAMPING = 13;
const WOBBLE_MAX = THREE.MathUtils.degToRad(14);

export interface BlockSpec {
  blockId: BlockId;
  /** The letter to paint on the front face (single-letter targets), or null. */
  glyph: string | null;
  /** An ore-vein bonus block: it glows. */
  vein: boolean;
}

export interface StageViewOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  atlas(): Atlas | null;
  /** Center of the target cell. */
  at: Vec3;
  /** World y of the floor under the block, for the shadow. */
  floorY: number;
  /** Seed of the crack network. */
  seed: number;
  reducedMotion(): boolean;
  frozen: boolean;
  /** CSS font family for the letter (`--font-body`, M2-08). */
  fontFamily(): string;
  requestRender(): void;
}

export interface StageView {
  /** Shows a new block. `slide` lets it arrive from above (ignored under reduced motion). */
  showBlock(spec: BlockSpec, slide: boolean): void;
  hideBlock(): void;
  /** The crack overlay stage 0–9, or null for a whole block. */
  setCrack(stage: number | null): void;
  /** A correct key: the pickaxe swings and the block gives a little. */
  swing(): void;
  /** A wrong key: the block shakes its head. No-op under reduced motion. */
  wobble(): void;
  frame(dtMs: Ms): void;
  /** Where effects for the block go (its resting center). */
  readonly at: Vec3;
  /** The block's place on the page, in CSS pixels. False when it is behind the camera. */
  project(out: { x: number; y: number }): boolean;
  /** Counters for tests. */
  stats(): { blockVisible: boolean; crack: number | null; glyph: boolean; glow: boolean };
  dispose(): void;
}

interface VoxelBox {
  /** Center, in model voxels. */
  at: readonly [number, number, number];
  size: readonly [number, number, number];
  color: string;
}

const ramp = (id: PaletteRampId, i: number): string => BASE_PALETTE[id][i] ?? "#888888";

/**
 * The arm and pickaxe, in model voxels (y runs up the handle, the arm reaches back along +z).
 * A plain glove and a blue sleeve, so it fits every avatar.
 */
export const ARM_MODEL: readonly VoxelBox[] = [
  // handle, with a darker grip under the hand
  { at: [0, 8.5, 0], size: [2, 13, 2], color: ramp("oak", 2) },
  { at: [0, 1, 0], size: [2, 2, 2], color: ramp("oak", 0) },
  // head: a stone bar that steps down at both ends, bound with copper in the middle
  { at: [0, 15, 0], size: [8, 2, 2], color: ramp("stone", 3) },
  { at: [-5, 14, 0], size: [2, 2, 2], color: ramp("stone", 2) },
  { at: [5, 14, 0], size: [2, 2, 2], color: ramp("stone", 2) },
  { at: [-6.5, 12.5, 0], size: [1, 1, 2], color: ramp("stone", 4) },
  { at: [6.5, 12.5, 0], size: [1, 1, 2], color: ramp("stone", 4) },
  { at: [0, 15, 0], size: [3, 3, 3], color: ramp("ore-copper", 2) },
  // glove, cuff and sleeve
  { at: [0, 4, 0.5], size: [4, 4, 5], color: ramp("wool-white", 3) },
  { at: [0, 4, 3.75], size: [4.6, 4.6, 1.5], color: ramp("wool-blue", 4) },
  { at: [0, 4, 10], size: [4, 4, 11], color: ramp("wool-blue", 2) },
];

/** One geometry for a list of colored boxes (positions, normals and vertex colors). */
export function boxesGeometry(boxes: readonly VoxelBox[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();
  for (const b of boxes) {
    const g = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
    g.translate(b.at[0], b.at[1], b.at[2]);
    const base = positions.length / 3;
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    color.set(b.color);
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      colors.push(color.r, color.g, color.b);
    }
    const idx = g.getIndex();
    if (idx) for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  out.setIndex(indices);
  return out;
}

/** BoxGeometry face order: +x, −x, +y, −y, +z, −z; 4 vertices each. */
const FACE_OF_GROUP = ["side", "side", "top", "bottom", "side", "side"] as const;

const GLYPH_PX = 128;

/** Paints the letter on a dark plate (the kit's plate look), so it reads on any block. */
export function paintGlyph(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  glyph: string,
  fontFamily: string,
): void {
  const s = GLYPH_PX;
  const px = s / 16;
  ctx.clearRect(0, 0, s, s);
  // A blocky plate: dark face, a lighter edge on top and left, a darker one below and right.
  ctx.fillStyle = "rgba(20, 20, 24, 0.86)";
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
  ctx.fillRect(0, 0, s, px);
  ctx.fillRect(0, 0, px, s);
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, s - px, s, px);
  ctx.fillRect(s - px, 0, px, s);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${Math.round(s * 0.72)}px ${fontFamily}`;
  // Center the ink itself, so a `j` or a `;` doesn't sit low.
  const m = ctx.measureText(glyph);
  const ascent = m.actualBoundingBoxAscent;
  const descent = m.actualBoundingBoxDescent;
  const y = s / 2 + (ascent - descent) / 2;
  ctx.fillText(glyph, s / 2, Number.isFinite(y) ? y : s * 0.72);
}

const easeOutBack = (u: number): number => {
  const c = 1.4;
  const v = u - 1;
  return 1 + (c + 1) * v * v * v + c * v * v;
};

export function createStageView(opts: StageViewOptions): StageView {
  const { scene, camera, canvas } = opts;
  const ambient = (): boolean => !opts.frozen && !opts.reducedMotion();
  const animate = (): boolean => !opts.reducedMotion();

  // --- the block ---
  const root = new THREE.Group();
  root.name = "mine-target";
  root.position.set(opts.at.x, opts.at.y, opts.at.z);
  root.visible = false;
  scene.add(root);

  const blockGeo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
  const baseUv = Float32Array.from(blockGeo.getAttribute("uv").array);
  const blockMat = new THREE.MeshLambertMaterial({ alphaTest: 0.5 });
  blockMat.name = "mine-block";
  const block = new THREE.Mesh(blockGeo, blockMat);
  root.add(block);

  const crackTextures = buildCrackTextures(opts.seed);
  const crackSize = BLOCK_SIZE + 0.01;
  const crackGeo = new THREE.BoxGeometry(crackSize, crackSize, crackSize);
  const crackMat = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false });
  crackMat.name = "mine-crack";
  const crack = new THREE.Mesh(crackGeo, crackMat);
  crack.visible = false;
  crack.renderOrder = 1;
  root.add(crack);
  let crackShown: number | null = null;

  const glyphCanvas = canvas.ownerDocument.createElement("canvas");
  glyphCanvas.width = GLYPH_PX;
  glyphCanvas.height = GLYPH_PX;
  const glyphCtx = glyphCanvas.getContext("2d");
  const glyphTex = new THREE.CanvasTexture(glyphCanvas);
  glyphTex.colorSpace = THREE.SRGBColorSpace;
  const glyphGeo = new THREE.PlaneGeometry(BLOCK_SIZE * 0.62, BLOCK_SIZE * 0.62);
  const glyphMat = new THREE.MeshBasicMaterial({
    map: glyphTex,
    transparent: true,
    depthWrite: false,
  });
  glyphMat.name = "mine-glyph";
  const glyph = new THREE.Mesh(glyphGeo, glyphMat);
  glyph.position.z = BLOCK_SIZE / 2 + 0.012;
  glyph.visible = false;
  glyph.renderOrder = 2;
  root.add(glyph);
  let glyphSerial = 0;

  const glowGeo = new THREE.BoxGeometry(BLOCK_SIZE * 1.16, BLOCK_SIZE * 1.16, BLOCK_SIZE * 1.16);
  const glowMat = new THREE.MeshBasicMaterial({
    color: ramp("ore-amber", 4),
    transparent: true,
    opacity: 0.4,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  glowMat.name = "mine-glow";
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.visible = false;
  root.add(glow);

  // --- the shadow on the floor ---
  const shadowGeo = new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  shadowMat.name = "mine-shadow";
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.set(opts.at.x, opts.floorY + 0.015, opts.at.z);
  shadow.visible = false;
  scene.add(shadow);

  // --- the arm and pickaxe, in camera space ---
  // The camera must be in the scene graph for its children to draw.
  const cameraWasInScene = camera.parent !== null;
  if (!cameraWasInScene) scene.add(camera);
  const armGeo = boxesGeometry(ARM_MODEL);
  const armMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  armMat.name = "mine-arm";
  const arm = new THREE.Mesh(armGeo, armMat);
  arm.frustumCulled = false;
  const armPivot = new THREE.Group();
  armPivot.name = "mine-arm";
  armPivot.add(arm);
  camera.add(armPivot);
  const ARM_SCALE = 0.034;
  const ARM_DEPTH = 1.3;
  arm.scale.setScalar(ARM_SCALE);
  // The pivot is the elbow, behind and below the hand, so a swing chops forward and down.
  arm.position.set(0, -4 * ARM_SCALE, -12 * ARM_SCALE);
  const ARM_REST = { x: -0.42, y: 0.5, z: 0.3 };
  const ARM_HIT = { x: -1.02, y: 0.34, z: 0.42 };

  let swingLeft: Ms = 0;
  let recoilLeft: Ms = 0;
  let slideLeft: Ms = 0;
  let wobbleAngle = 0;
  let wobbleSpeed = 0;
  let phase: Ms = 0;
  let veinOn = false;
  let disposed = false;
  const v = new THREE.Vector3();

  const placeArm = (): void => {
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * ARM_DEPTH;
    const halfW = halfH * camera.aspect;
    armPivot.position.set(Math.min(halfW * 0.6, halfH * 1.15), -halfH * 0.92, -ARM_DEPTH);
    let k = 0;
    if (swingLeft > 0) {
      const u = 1 - swingLeft / SWING_MS;
      // Down fast, back a little slower.
      k = u < 0.4 ? 1 - (1 - u / 0.4) ** 2 : 1 - (u - 0.4) / 0.6;
    }
    armPivot.rotation.set(
      ARM_REST.x + (ARM_HIT.x - ARM_REST.x) * k,
      ARM_REST.y + (ARM_HIT.y - ARM_REST.y) * k,
      ARM_REST.z + (ARM_HIT.z - ARM_REST.z) * k,
    );
  };

  const placeBlock = (): void => {
    const live = ambient();
    const bob = live ? Math.sin((phase / BOB_PERIOD) * Math.PI * 2) * BOB_HEIGHT : 0;
    const sway = live ? Math.sin((phase / SWAY_PERIOD) * Math.PI * 2) * SWAY_ANGLE : 0;
    let drop = 0;
    let scale = 1;
    if (slideLeft > 0) {
      const u = 1 - slideLeft / SLIDE_MS;
      const e = easeOutBack(u);
      drop = (1 - e) * 1.1;
      scale = 0.55 + 0.45 * e;
    }
    let back = 0;
    if (recoilLeft > 0) {
      const u = recoilLeft / RECOIL_MS;
      back = 0.05 * u;
      scale *= 1 - 0.035 * u;
    }
    root.position.set(opts.at.x, opts.at.y + bob + drop, opts.at.z - back);
    root.rotation.set(0, sway, wobbleAngle);
    root.scale.setScalar(scale);
    // The shadow tightens a little as the block rises.
    const s = 0.9 - bob * 1.2 - drop * 0.25;
    shadow.scale.set(s, 1, s);
    if (veinOn) {
      glowMat.opacity = live ? 0.36 + 0.12 * Math.sin((phase / GLOW_PERIOD) * Math.PI * 2) : 0.4;
    }
  };

  const setUvs = (atlas: Atlas, blockId: BlockId): void => {
    const uv = blockGeo.getAttribute("uv");
    const size = atlas.canvas.width;
    for (let face = 0; face < 6; face++) {
      const [u0, v0, u1, v1] = tileUv(size, atlas.tileOf(blockId, FACE_OF_GROUP[face] ?? "side"));
      for (let i = face * 4; i < face * 4 + 4; i++) {
        const bu = baseUv[i * 2] ?? 0;
        const bv = baseUv[i * 2 + 1] ?? 0;
        uv.setXY(i, u0 + bu * (u1 - u0), v0 + bv * (v1 - v0));
      }
    }
    uv.needsUpdate = true;
  };

  const drawGlyph = (text: string): void => {
    if (!glyphCtx) return;
    paintGlyph(glyphCtx, text, opts.fontFamily());
    glyphTex.needsUpdate = true;
  };

  placeArm();
  placeBlock();

  return {
    at: opts.at,
    showBlock(spec, slide) {
      if (disposed) return;
      const atlas = opts.atlas();
      if (atlas) {
        if (blockMat.map !== atlas.texture) {
          blockMat.map = atlas.texture;
          blockMat.needsUpdate = true;
        }
        setUvs(atlas, spec.blockId);
      }
      root.visible = true;
      shadow.visible = true;
      crack.visible = false;
      crackShown = null;
      veinOn = spec.vein;
      glow.visible = spec.vein;
      glyph.visible = spec.glyph !== null;
      if (spec.glyph !== null) {
        const text = spec.glyph;
        const serial = ++glyphSerial;
        drawGlyph(text);
        // The web font may still be loading (font-display: swap); a canvas doesn't repaint on its
        // own, so paint again once it is there.
        const fonts = canvas.ownerDocument.fonts;
        void fonts
          ?.load(`700 64px ${opts.fontFamily()}`, text)
          .then(() => {
            if (disposed || serial !== glyphSerial) return;
            drawGlyph(text);
            opts.requestRender();
          })
          .catch(() => undefined);
      }
      wobbleAngle = 0;
      wobbleSpeed = 0;
      recoilLeft = 0;
      slideLeft = slide && animate() ? SLIDE_MS : 0;
      placeBlock();
      opts.requestRender();
    },
    hideBlock() {
      root.visible = false;
      shadow.visible = false;
      opts.requestRender();
    },
    setCrack(stage) {
      if (stage === crackShown) return;
      crackShown = stage;
      const tex = stage === null ? undefined : crackTextures[stage];
      crack.visible = tex !== undefined;
      if (tex && crackMat.map !== tex) {
        crackMat.map = tex;
        crackMat.needsUpdate = true;
      }
      opts.requestRender();
    },
    swing() {
      if (!animate()) return;
      swingLeft = SWING_MS;
      recoilLeft = RECOIL_MS;
    },
    wobble() {
      if (!animate()) return;
      // Alternate sides is not needed: the spring swings through both.
      wobbleSpeed += WOBBLE_KICK;
    },
    frame(dtMs) {
      if (disposed) return;
      if (ambient()) phase += dtMs;
      swingLeft = Math.max(0, swingLeft - dtMs);
      recoilLeft = Math.max(0, recoilLeft - dtMs);
      slideLeft = Math.max(0, slideLeft - dtMs);
      if (wobbleAngle !== 0 || wobbleSpeed !== 0) {
        const dt = dtMs / 1000;
        wobbleSpeed += (-WOBBLE_STIFFNESS * wobbleAngle - WOBBLE_DAMPING * wobbleSpeed) * dt;
        wobbleAngle = THREE.MathUtils.clamp(
          wobbleAngle + wobbleSpeed * dt,
          -WOBBLE_MAX,
          WOBBLE_MAX,
        );
        if (Math.abs(wobbleAngle) < 0.002 && Math.abs(wobbleSpeed) < 0.05) {
          wobbleAngle = 0;
          wobbleSpeed = 0;
        }
      }
      placeBlock();
      placeArm();
    },
    project(out) {
      v.set(opts.at.x, opts.at.y, opts.at.z).project(camera);
      if (v.z > 1) return false;
      out.x = canvas.offsetLeft + ((v.x + 1) / 2) * canvas.clientWidth;
      out.y = canvas.offsetTop + ((1 - v.y) / 2) * canvas.clientHeight;
      return true;
    },
    stats: () => ({
      blockVisible: root.visible,
      crack: crackShown,
      glyph: root.visible && glyph.visible,
      glow: root.visible && glow.visible,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(root, shadow);
      camera.remove(armPivot);
      if (!cameraWasInScene) scene.remove(camera);
      for (const g of [blockGeo, crackGeo, glyphGeo, glowGeo, shadowGeo, armGeo]) g.dispose();
      // The atlas texture on blockMat belongs to the scene; materials don't own their maps.
      for (const m of [blockMat, crackMat, glyphMat, glowMat, shadowMat, armMat]) m.dispose();
      for (const t of crackTextures) t.dispose();
      glyphTex.dispose();
      opts.requestRender();
    },
  };
}
