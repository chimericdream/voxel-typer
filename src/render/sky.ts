/**
 * Sky, clouds and day/night (task M2-02, PLAN.md §3.4 and §5.1).
 *
 * `createSkyEnvironment(opts)` returns the `createEnvironment` factory the scene takes
 * (`SceneOptions.createEnvironment`). The controller it makes owns:
 * - a gradient sky dome: a shader with three stops (zenith, horizon, ground) that follows the
 *   camera, drawn first with no depth test or write;
 * - a square sun and moon: flat quads with an 8×8 pixel texture (`NearestFilter`, hard edges);
 * - voxel clouds ({@link createClouds}): one `InstancedMesh`, drifting slowly;
 * - `FogExp2` whose color is the horizon stop, so distant blocks fade into the sky;
 * - the sun and hemisphere lights, through `ctx.lights`.
 *
 * Data comes from `src/content/biomes/env.ts`. `set()` cross-fades to the new biome and time of
 * day over 2 s (`lerpMs`). It snaps instead before the first frame is drawn (nothing was seen
 * yet) and always under `frozen`. Setting the same biome, time and `t01` again does nothing.
 *
 * Idle rule: the system keeps the loop drawing only while it cross-fades or the clouds drift.
 * Clouds drift only when `drift` is on, the scene isn't `frozen` (`?freeze`), and reduced motion
 * is off, so a frozen or reduced-motion scene idles. Under reduced motion the sun and moon also
 * jump to their new place instead of gliding; the color fade stays (it's not motion).
 *
 * Nothing here allocates per frame: the mix state, colors and vectors are made once and updated
 * in place.
 */
import * as THREE from "three";
import { DEFAULT_T01, biomeEnv, celestialFor } from "@/content/biomes/env";
import type { BiomeEnv, SkyPos, TimeEnv } from "@/content/biomes/env";
import type { BiomeId, Ms, TimeOfDay } from "@/types/core";
import { createClouds } from "./clouds";
import type { Clouds } from "./clouds";
import type { EnvironmentContext, EnvironmentController } from "./scene";

export interface SkyOptions {
  /** `?freeze`: no cloud drift, no cross-fade, and `t01` pinned to {@link DEFAULT_T01}. */
  frozen?: boolean;
  /** Cloud drift on at start. Default true (still off under `frozen` and reduced motion). */
  drift?: boolean;
  /** Cross-fade length for `set()`. Default 2000 ms. */
  lerpMs?: Ms;
  /** Cloud layout seed. Default 7. */
  cloudSeed?: number;
  /** Test seam: environment data lookup. Default {@link biomeEnv}. */
  envFor?: (biome: BiomeId) => BiomeEnv;
}

export interface SkyController extends EnvironmentController {
  /** Turns cloud drift on or off (reduced motion and `frozen` still win). */
  setDrift(on: boolean): void;
  /** True while the clouds are moving: drift on, not frozen, no reduced motion. */
  readonly drifting: boolean;
  /** True while a `set()` cross-fade is running. */
  readonly fading: boolean;
  /** The current mix, for tests and dev tools. Don't mutate. */
  readonly mix: Readonly<SkyMix>;
  readonly clouds: Clouds;
  readonly dome: THREE.Mesh;
  readonly sunDisc: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly moonDisc: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
}

/** Everything that cross-fades. Colors are in three's linear working space. */
export interface SkyMix {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  fogDensity: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  cloudColor: THREE.Color;
  cloudOpacity: number;
  sunDiscColor: THREE.Color;
  sunDiscOpacity: number;
  moonDiscColor: THREE.Color;
  moonDiscOpacity: number;
  /** Unit directions from the camera toward the discs. */
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
}

/** Dome radius: inside the camera's far plane (500). */
const DOME_RADIUS = 420;
/** Discs sit just inside the dome. */
const DISC_DISTANCE = 400;
/** Angular size of the sun and moon, in degrees. */
const DISC_DEGREES = 7;
const DEFAULT_LERP_MS = 2000;
/** Below this opacity a disc (or the clouds) is hidden, which also saves its draw call. */
const MIN_VISIBLE = 0.01;

const makeMix = (): SkyMix => ({
  zenith: new THREE.Color(),
  horizon: new THREE.Color(),
  ground: new THREE.Color(),
  fogDensity: 0,
  sunColor: new THREE.Color(),
  sunIntensity: 0,
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  hemiIntensity: 0,
  cloudColor: new THREE.Color(),
  cloudOpacity: 0,
  sunDiscColor: new THREE.Color(),
  sunDiscOpacity: 0,
  moonDiscColor: new THREE.Color(),
  moonDiscOpacity: 0,
  sunDir: new THREE.Vector3(0, 1, 0),
  moonDir: new THREE.Vector3(0, 1, 0),
});

/** Azimuth/elevation (degrees) → unit vector. Azimuth 0 looks toward −z, positive toward +x. */
function dirOf(pos: SkyPos, out: THREE.Vector3): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(pos.azimuth);
  const el = THREE.MathUtils.degToRad(pos.elevation);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

function fillMix(out: SkyMix, t: TimeEnv, sun: SkyPos, moon: SkyPos): void {
  out.zenith.set(t.sky.zenith);
  out.horizon.set(t.sky.horizon);
  out.ground.set(t.sky.ground);
  out.fogDensity = t.fogDensity;
  out.sunColor.set(t.sun.color);
  out.sunIntensity = t.sun.intensity;
  out.hemiSky.set(t.hemi.sky);
  out.hemiGround.set(t.hemi.ground);
  out.hemiIntensity = t.hemi.intensity;
  out.cloudColor.set(t.clouds.color);
  out.cloudOpacity = t.clouds.opacity;
  out.sunDiscColor.set(t.sunDisc.color);
  out.sunDiscOpacity = t.sunDisc.opacity;
  out.moonDiscColor.set(t.moonDisc.color);
  out.moonDiscOpacity = t.moonDisc.opacity;
  dirOf(sun, out.sunDir);
  dirOf(moon, out.moonDir);
}

function copyMix(out: SkyMix, a: SkyMix): void {
  out.zenith.copy(a.zenith);
  out.horizon.copy(a.horizon);
  out.ground.copy(a.ground);
  out.fogDensity = a.fogDensity;
  out.sunColor.copy(a.sunColor);
  out.sunIntensity = a.sunIntensity;
  out.hemiSky.copy(a.hemiSky);
  out.hemiGround.copy(a.hemiGround);
  out.hemiIntensity = a.hemiIntensity;
  out.cloudColor.copy(a.cloudColor);
  out.cloudOpacity = a.cloudOpacity;
  out.sunDiscColor.copy(a.sunDiscColor);
  out.sunDiscOpacity = a.sunDiscOpacity;
  out.moonDiscColor.copy(a.moonDiscColor);
  out.moonDiscOpacity = a.moonDiscOpacity;
  out.sunDir.copy(a.sunDir);
  out.moonDir.copy(a.moonDir);
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** `out = a → b` at `k`. With `snapDirs` the disc directions jump straight to `b`. */
function lerpMix(out: SkyMix, a: SkyMix, b: SkyMix, k: number, snapDirs: boolean): void {
  out.zenith.lerpColors(a.zenith, b.zenith, k);
  out.horizon.lerpColors(a.horizon, b.horizon, k);
  out.ground.lerpColors(a.ground, b.ground, k);
  out.fogDensity = lerp(a.fogDensity, b.fogDensity, k);
  out.sunColor.lerpColors(a.sunColor, b.sunColor, k);
  out.sunIntensity = lerp(a.sunIntensity, b.sunIntensity, k);
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, k);
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, k);
  out.hemiIntensity = lerp(a.hemiIntensity, b.hemiIntensity, k);
  out.cloudColor.lerpColors(a.cloudColor, b.cloudColor, k);
  out.cloudOpacity = lerp(a.cloudOpacity, b.cloudOpacity, k);
  out.sunDiscColor.lerpColors(a.sunDiscColor, b.sunDiscColor, k);
  out.sunDiscOpacity = lerp(a.sunDiscOpacity, b.sunDiscOpacity, k);
  out.moonDiscColor.lerpColors(a.moonDiscColor, b.moonDiscColor, k);
  out.moonDiscOpacity = lerp(a.moonDiscOpacity, b.moonDiscOpacity, k);
  if (snapDirs) {
    out.sunDir.copy(b.sunDir);
    out.moonDir.copy(b.moonDir);
  } else {
    out.sunDir.lerpVectors(a.sunDir, b.sunDir, k).normalize();
    out.moonDir.lerpVectors(a.moonDir, b.moonDir, k).normalize();
  }
}

const DOME_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Above the horizon: horizon → zenith, quickly at first so the blue reads. Below: horizon →
// ground. `cameraPosition` is three's built-in uniform.
const DOME_FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
varying vec3 vWorld;
void main() {
  float h = normalize(vWorld - cameraPosition).y;
  vec3 c = h >= 0.0
    ? mix(horizon, zenith, pow(smoothstep(0.0, 1.0, h), 0.55))
    : mix(horizon, ground, smoothstep(0.0, 0.35, -h));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** An 8×8 gray pixel texture for a disc; the material color tints it. */
function discTexture(kind: "sun" | "moon"): THREE.DataTexture {
  const size = 8;
  const data = new Uint8Array(size * size * 4);
  const craters = new Set([2 * size + 2, 3 * size + 5, 5 * size + 3, 5 * size + 6, 6 * size + 5]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ring = Math.min(x, y, size - 1 - x, size - 1 - y);
      let v: number;
      if (kind === "sun") v = ring === 0 ? 0.84 : ring === 1 ? 0.94 : 1;
      else v = craters.has(y * size + x) ? 0.76 : ring === 0 ? 0.86 : 0.96;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.name = `${kind}-disc`;
  tex.needsUpdate = true;
  return tex;
}

type Disc = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

function makeDisc(kind: "sun" | "moon", geometry: THREE.PlaneGeometry): Disc {
  const material = new THREE.MeshBasicMaterial({
    map: discTexture(kind),
    transparent: true,
    // Drawn in the transparent pass, after the diorama: the depth test lets terrain cover a low
    // sun, and no depth write keeps water and glass in front of it.
    depthWrite: false,
    fog: false,
  });
  material.name = `${kind}-disc`;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${kind}-disc`;
  mesh.renderOrder = -90;
  mesh.frustumCulled = false;
  return mesh;
}

const smooth = (k: number): number => k * k * (3 - 2 * k);

export function createSkyEnvironment(
  opts: SkyOptions = {},
): (ctx: EnvironmentContext) => SkyController {
  return (ctx) => {
    const frozen = opts.frozen ?? false;
    const lerpMs = opts.lerpMs ?? DEFAULT_LERP_MS;
    const envFor = opts.envFor ?? biomeEnv;
    let driftOn = opts.drift ?? true;

    const cur = makeMix();
    const from = makeMix();
    const to = makeMix();
    let fadeK = 1;
    /** False until the first frame: until then nothing was seen, so every `set()` snaps. */
    let shown = false;
    let lastKey = "";

    // Dome.
    const domeGeometry = new THREE.SphereGeometry(DOME_RADIUS, 32, 16);
    const domeMaterial = new THREE.ShaderMaterial({
      name: "sky-dome",
      uniforms: {
        zenith: { value: cur.zenith },
        horizon: { value: cur.horizon },
        ground: { value: cur.ground },
      },
      vertexShader: DOME_VERTEX,
      fragmentShader: DOME_FRAGMENT,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const dome = new THREE.Mesh(domeGeometry, domeMaterial);
    dome.name = "sky-dome";
    dome.renderOrder = -100;
    dome.frustumCulled = false;
    // Follow the camera so the sky never ends.
    dome.onBeforeRender = (_r, _s, camera) => {
      dome.position.copy(camera.position);
      dome.updateMatrixWorld();
    };

    // Sun and moon.
    const discGeometry = new THREE.PlaneGeometry(1, 1);
    const sunDisc = makeDisc("sun", discGeometry);
    const moonDisc = makeDisc("moon", discGeometry);
    const discSize = 2 * DISC_DISTANCE * Math.tan(THREE.MathUtils.degToRad(DISC_DEGREES / 2));
    sunDisc.scale.setScalar(discSize);
    moonDisc.scale.setScalar(discSize * 0.8);
    const placeDisc = (disc: Disc, dir: THREE.Vector3, camera: THREE.Camera): void => {
      disc.position.copy(camera.position).addScaledVector(dir, DISC_DISTANCE);
      // Object3D.lookAt keeps world up, so the square stays level with the horizon.
      disc.lookAt(camera.position);
      disc.updateMatrixWorld();
    };
    sunDisc.onBeforeRender = (_r, _s, camera) => placeDisc(sunDisc, cur.sunDir, camera);
    moonDisc.onBeforeRender = (_r, _s, camera) => placeDisc(moonDisc, cur.moonDir, camera);
    const sunMat = sunDisc.material;
    const moonMat = moonDisc.material;

    // Clouds, centered on the diorama (the sun's target is its middle after `fitTo`).
    const clouds = createClouds({ seed: opts.cloudSeed ?? 7 });
    const focus = ctx.lights.sun.target.position;
    clouds.mesh.onBeforeRender = () => clouds.place(focus, focus.y * 2);

    const fog = new THREE.FogExp2(0xffffff, 0);
    ctx.scene.background = null;
    ctx.scene.fog = fog;
    ctx.scene.add(dome, sunDisc, moonDisc, clouds.mesh);

    /** Pushes the current mix to the dome, fog, discs, clouds and lights (no allocation). */
    const push = (): void => {
      fog.color.copy(cur.horizon);
      fog.density = cur.fogDensity;
      const { sun, hemi } = ctx.lights;
      sun.color.copy(cur.sunColor);
      sun.intensity = cur.sunIntensity;
      hemi.color.copy(cur.hemiSky);
      hemi.groundColor.copy(cur.hemiGround);
      hemi.intensity = cur.hemiIntensity;
      clouds.material.color.copy(cur.cloudColor);
      clouds.material.opacity = cur.cloudOpacity;
      clouds.material.transparent = cur.cloudOpacity < 1;
      clouds.mesh.visible = cur.cloudOpacity >= MIN_VISIBLE;
      sunMat.color.copy(cur.sunDiscColor);
      sunMat.opacity = cur.sunDiscOpacity;
      sunDisc.visible = cur.sunDiscOpacity >= MIN_VISIBLE && cur.sunDir.y > -0.1;
      moonMat.color.copy(cur.moonDiscColor);
      moonMat.opacity = cur.moonDiscOpacity;
      moonDisc.visible = cur.moonDiscOpacity >= MIN_VISIBLE && cur.moonDir.y > -0.1;
    };

    /** At the end of a fade (or a snap), hand the exact target to the light rig's state. */
    let target: TimeEnv | null = null;
    const settle = (): void => {
      if (!target) return;
      ctx.lights.apply({
        background: target.sky.horizon,
        sunColor: target.sun.color,
        sunIntensity: target.sun.intensity,
        skyColor: target.hemi.sky,
        groundColor: target.hemi.ground,
        hemiIntensity: target.hemi.intensity,
      });
    };

    const isDrifting = (): boolean => driftOn && !frozen && !ctx.reducedMotion();

    const controller: SkyController = {
      set(env: { biome: BiomeId; timeOfDay: TimeOfDay; t01?: number }) {
        const t01 = frozen ? DEFAULT_T01 : (env.t01 ?? DEFAULT_T01);
        const key = `${env.biome}/${env.timeOfDay}/${t01}`;
        if (key === lastKey) return;
        lastKey = key;
        target = envFor(env.biome).times[env.timeOfDay];
        const { sun, moon } = celestialFor(env.timeOfDay, t01);
        fillMix(to, target, sun, moon);
        if (!shown || frozen || lerpMs <= 0) {
          copyMix(cur, to);
          fadeK = 1;
          push();
          settle();
        } else {
          copyMix(from, cur);
          fadeK = 0;
        }
        ctx.wake();
      },
      system(dt) {
        shown = true;
        if (fadeK < 1) {
          fadeK = Math.min(1, fadeK + dt / lerpMs);
          lerpMix(cur, from, to, smooth(fadeK), ctx.reducedMotion());
          push();
          if (fadeK >= 1) settle();
        }
        const drifting = isDrifting();
        if (drifting) clouds.advance(dt);
        return drifting || fadeK < 1;
      },
      setDrift(on) {
        driftOn = on;
        ctx.wake();
      },
      get drifting() {
        return isDrifting();
      },
      get fading() {
        return fadeK < 1;
      },
      mix: cur,
      clouds,
      dome,
      sunDisc,
      moonDisc,
      dispose() {
        ctx.scene.remove(dome, sunDisc, moonDisc);
        clouds.dispose();
        domeGeometry.dispose();
        domeMaterial.dispose();
        discGeometry.dispose();
        for (const mat of [sunMat, moonMat]) {
          mat.map?.dispose();
          mat.dispose();
        }
        if (ctx.scene.fog === fog) ctx.scene.fog = null;
      },
    };
    return controller;
  };
}
