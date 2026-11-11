/**
 * Scene lights (task M2-01, PLAN.md §5.1): one directional sun, a hemisphere fill, and point
 * lights for `light`-tagged blocks (capped by quality; 0 on `low`, where lamps only glow).
 *
 * The time-of-day values here are neutral defaults. M2-02 feeds per-biome environment data
 * through {@link LightRig.apply}.
 */
import * as THREE from "three";
import type { TimeOfDay } from "@/types/core";
import type { QualityPreset } from "./quality";
import type { Vec3 } from "./types";

/** Light colors and strengths for one moment of the day. Colors are sRGB hex strings. */
export interface LightingState {
  background: string;
  sunColor: string;
  sunIntensity: number;
  skyColor: string;
  groundColor: string;
  hemiIntensity: number;
}

/** Default lighting per time of day. Warm days, cool nights (PLAN.md §5.1). */
export const DEFAULT_LIGHTING: Readonly<Record<TimeOfDay, LightingState>> = {
  day: {
    background: "#87ceeb",
    sunColor: "#fff4e0",
    sunIntensity: 1.6,
    skyColor: "#dcefff",
    groundColor: "#a89878",
    hemiIntensity: 1.5,
  },
  dawn: {
    background: "#f2b28c",
    sunColor: "#ffc89a",
    sunIntensity: 1.5,
    skyColor: "#f6d7c3",
    groundColor: "#6b5a4a",
    hemiIntensity: 1.3,
  },
  dusk: {
    background: "#e0906c",
    sunColor: "#ffb07a",
    sunIntensity: 1.3,
    skyColor: "#e9b9a6",
    groundColor: "#5a4a48",
    hemiIntensity: 1.2,
  },
  night: {
    background: "#1c2448",
    sunColor: "#9fb4ff",
    sunIntensity: 0.5,
    skyColor: "#4a5a8c",
    groundColor: "#262636",
    hemiIntensity: 0.9,
  },
};

/** A light-emitting block cell. */
export interface LampSource {
  at: Vec3;
  color: string;
  intensity: number;
}

/** Direction from the scene toward the sun: up, a bit left and toward the viewer. */
const SUN_DIR = new THREE.Vector3(-0.55, 1, 0.4).normalize();

/** Point light range in blocks. */
const LAMP_RANGE = 8;

export interface LightRig {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly lamps: readonly THREE.PointLight[];
  /** The current state (background included; the scene applies that). */
  readonly state: Readonly<LightingState>;
  apply(state: LightingState): void;
  /** Shadows and the point light cap. */
  setQuality(preset: QualityPreset): void;
  /** Aims the sun at `box` and fits the shadow camera tightly around it. */
  fitTo(box: THREE.Box3): void;
  /** Candidate lamps. The rig lights the ones nearest `focus`, up to the quality cap. */
  setLamps(sources: readonly LampSource[], focus: Vec3): void;
  dispose(): void;
}

export function createLightRig(scene: THREE.Scene, preset: QualityPreset): LightRig {
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.name = "sun";
  sun.shadow.camera.near = 0.5;
  // Hard edges suit the pixel look; bias keeps flat voxel faces free of acne.
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  hemi.name = "hemisphere";
  scene.add(sun, sun.target, hemi);

  let state: LightingState = { ...DEFAULT_LIGHTING.day };
  let quality = preset;
  let lamps: THREE.PointLight[] = [];
  let sources: readonly LampSource[] = [];
  let focus: Vec3 = { x: 0, y: 0, z: 0 };

  const d2 = (a: Vec3): number =>
    (a.x - focus.x) ** 2 + (a.y - focus.y) ** 2 + (a.z - focus.z) ** 2;

  const apply = (next: LightingState): void => {
    state = { ...next };
    sun.color.set(next.sunColor);
    sun.intensity = next.sunIntensity;
    hemi.color.set(next.skyColor);
    hemi.groundColor.set(next.groundColor);
    hemi.intensity = next.hemiIntensity;
  };

  const placeLamps = (): void => {
    for (const lamp of lamps) {
      scene.remove(lamp);
      lamp.dispose();
    }
    // Nearest first; ties by position so the pick is deterministic.
    const chosen = sources
      .toSorted(
        (a, b) => d2(a.at) - d2(b.at) || a.at.y - b.at.y || a.at.z - b.at.z || a.at.x - b.at.x,
      )
      .slice(0, quality.pointLights);
    lamps = chosen.map((s) => {
      const light = new THREE.PointLight(s.color, s.intensity, LAMP_RANGE, 2);
      light.name = "lamp";
      light.position.set(s.at.x + 0.5, s.at.y + 0.5, s.at.z + 0.5);
      scene.add(light);
      return light;
    });
  };

  const setQuality = (next: QualityPreset): void => {
    const lampsChanged = next.pointLights !== quality.pointLights;
    quality = next;
    sun.castShadow = next.shadows;
    if (sun.shadow.mapSize.x !== next.shadowMapSize) {
      sun.shadow.mapSize.set(next.shadowMapSize, next.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    if (lampsChanged) placeLamps();
  };

  apply(state);
  setQuality(preset);

  return {
    sun,
    hemi,
    get lamps() {
      return lamps;
    },
    get state() {
      return state;
    },
    apply,
    setQuality,
    fitTo(box) {
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(1, box.getBoundingSphere(new THREE.Sphere()).radius);
      sun.target.position.copy(center);
      sun.position.copy(center).addScaledVector(SUN_DIR, radius * 2);
      const cam = sun.shadow.camera;
      cam.left = -radius;
      cam.right = radius;
      cam.top = radius;
      cam.bottom = -radius;
      cam.near = radius * 0.5;
      cam.far = radius * 3.5;
      cam.updateProjectionMatrix();
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    },
    setLamps(next, at) {
      sources = next;
      focus = at;
      placeLamps();
    },
    dispose() {
      for (const lamp of lamps) {
        scene.remove(lamp);
        lamp.dispose();
      }
      lamps = [];
      scene.remove(sun, sun.target, hemi);
      sun.dispose();
      hemi.dispose();
    },
  };
}
