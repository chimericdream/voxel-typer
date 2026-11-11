/**
 * Rendering interfaces (docs/impl/contracts.md §8). Modes draw through {@link SceneHandle}; they
 * never create a renderer themselves.
 */
import type * as THREE from "three";
import type { BiomeId, BlockId, Ms, QualityLevel, TimeOfDay } from "@/types/core";
import type { VoxelGrid } from "./mesher/voxel-grid";

/** A point or direction in world space. y is up. */
export type Vec3 = { x: number; y: number; z: number };

/**
 * The 2D fallback renderer (M6), used when WebGL is unavailable or `?lite=1` is set.
 *
 * PROVISIONAL: the contracts name `LiteCanvas` in `SceneHandle` but never define it. This is the
 * smallest useful shape; M6 settles it.
 */
export interface LiteCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** The scene a mode draws into. The app creates it and passes it in `ModeContext.scene`. */
export interface SceneHandle {
  /** The three.js objects. `null` in lite mode. */
  three: {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
  } | null;
  /** The 2D fallback (M6). Exactly one of `three` and `lite` is non-null. */
  lite: LiteCanvas | null;
  /** Sets sky, fog, lights and palette. `t01` is the position in the day/night cycle, 0–1. */
  setEnvironment(env: { biome: BiomeId; timeOfDay: TimeOfDay; t01?: number }): void;
  /** Meshes and shows a static world. */
  loadDiorama(id: string, grid: VoxelGrid): Promise<void>;
  clearDiorama(): void;
  camera: CameraRig;
  fx: FxApi;
  /** Render-on-demand, for when the loop is idle. */
  requestRender(): void;
  setQuality(q: QualityLevel): void;
  /** Subscribes to the render loop. Returns the unsubscribe function. */
  onFrame(fn: (dtMs: Ms, t: Ms) => void): () => void;
}

/** Camera control. */
export interface CameraRig {
  /** Moves to a named camera position. */
  preset(name: "mine" | "overview" | "lane" | "orbit" | "rail", opts?: { durationMs?: Ms }): void;
  orbit(dYaw: number, dPitch: number, dZoom: number): void;
  /** Screen shake. A no-op when reduced motion is on. */
  shake(intensity01: number, durationMs: Ms): void;
}

/** Short visual effects. */
export interface FxApi {
  /** A burst of cube particles, textured like `blockId`. */
  burst(at: Vec3, opts: { blockId: BlockId; count: number; speed?: number }): void;
  /** Freezes the mode's `frame` dt for `ms`. A no-op when reduced motion is on. */
  hitStop(ms: Ms): void;
  floatText(at: Vec3, text: string, opts?: { color?: string }): void;
}
