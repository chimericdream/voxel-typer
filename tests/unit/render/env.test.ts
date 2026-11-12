/**
 * Biome environment data and the sky controller (task M2-02).
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  BIOME_ENVS,
  DEFAULT_T01,
  TIMES_OF_DAY,
  biomeEnv,
  celestialFor,
  hexToRgb01,
  relativeLuminance,
} from "../../../src/content/biomes/env";
import type { TimeEnv } from "../../../src/content/biomes/env";
import { MEADOW_ENV } from "../../../src/content/biomes/meadow";
import { CLOUD_SPAN, createClouds } from "../../../src/render/clouds";
import { DEFAULT_LIGHTING, createLightRig } from "../../../src/render/lights";
import type { LightingState } from "../../../src/render/lights";
import { QUALITY_PRESETS } from "../../../src/render/quality";
import { FOG_BOOST, FOG_NEAR_DIST, createSkyEnvironment, fogFor } from "../../../src/render/sky";
import type { SkyOptions } from "../../../src/render/sky";
import { BIOME_ORDER } from "../../../src/types/core";

const HEX = /^#[0-9a-f]{6}$/;
const cmp = (a: string, b: string): number => a.localeCompare(b);

function colorsOf(t: TimeEnv): string[] {
  return [
    t.sky.zenith,
    t.sky.horizon,
    t.sky.ground,
    t.sun.color,
    t.hemi.sky,
    t.hemi.ground,
    t.clouds.color,
    t.sunDisc.color,
    t.moonDisc.color,
  ];
}

const matrices = (seed: number): number[] => {
  const c = createClouds({ seed });
  const out = Array.from(c.mesh.instanceMatrix.array);
  c.dispose();
  return out;
};

function setup(opts: SkyOptions = {}) {
  const scene = new THREE.Scene();
  const lights = createLightRig(scene, QUALITY_PRESETS.medium);
  let reduced = false;
  let wakes = 0;
  const sky = createSkyEnvironment(opts)({
    scene,
    lights,
    wake: () => {
      wakes++;
    },
    reducedMotion: () => reduced,
  });
  return {
    scene,
    lights,
    sky,
    setReduced: (v: boolean): void => {
      reduced = v;
    },
    wakes: (): number => wakes,
  };
}

const nightLights = (): LightingState => {
  const n = MEADOW_ENV.times.night;
  return {
    background: n.sky.horizon,
    sunColor: n.sun.color,
    sunIntensity: n.sun.intensity,
    skyColor: n.hemi.sky,
    groundColor: n.hemi.ground,
    hemiIntensity: n.hemi.intensity,
  };
};

describe("biome environment data", () => {
  it("every biome resolves to data with all four times of day (others fall back to meadow)", () => {
    for (const biome of BIOME_ORDER) {
      const env = biomeEnv(biome);
      for (const tod of TIMES_OF_DAY) expect(env.times[tod]).toBeDefined();
      if (!BIOME_ENVS[biome]) expect(env).toBe(MEADOW_ENV);
    }
    expect(Object.keys(MEADOW_ENV.times).toSorted(cmp)).toEqual([...TIMES_OF_DAY].toSorted(cmp));
  });

  it("every biome with data names itself and has well-formed values", () => {
    for (const [id, env] of Object.entries(BIOME_ENVS)) {
      expect(env.biome).toBe(id);
      for (const tod of TIMES_OF_DAY) {
        const t = env.times[tod];
        for (const c of colorsOf(t)) expect(c).toMatch(HEX);
        expect(t.fogDensity).toBeGreaterThan(0);
        expect(t.fogDensity).toBeLessThanOrEqual(0.01);
        for (const v of [t.sun.intensity, t.hemi.intensity]) {
          expect(v).toBeGreaterThan(0);
          expect(v).toBeLessThanOrEqual(4);
        }
        for (const o of [t.clouds.opacity, t.sunDisc.opacity, t.moonDisc.opacity]) {
          expect(o).toBeGreaterThanOrEqual(0);
          expect(o).toBeLessThanOrEqual(1);
        }
      }
      if (env.particle) {
        expect(env.particle.color).toMatch(HEX);
        expect(env.particle.density).toBeGreaterThan(0);
      }
    }
  });

  it("the meadow has pollen", () => {
    expect(MEADOW_ENV.particle?.kind).toBe("pollen");
  });

  it("meadow day lighting is exactly what M2-01 tuned", () => {
    const day = MEADOW_ENV.times.day;
    const ref = DEFAULT_LIGHTING.day;
    expect(day.sun).toEqual({ color: ref.sunColor, intensity: ref.sunIntensity });
    expect(day.hemi).toEqual({
      sky: ref.skyColor,
      ground: ref.groundColor,
      intensity: ref.hemiIntensity,
    });
  });

  it("night is cool and never near-black, so the HUD reads over it", () => {
    const night = MEADOW_ENV.times.night;
    for (const c of [night.sky.zenith, night.sky.horizon, night.sky.ground]) {
      const [r, , b] = hexToRgb01(c);
      expect(b).toBeGreaterThan(r);
      expect(relativeLuminance(c)).toBeGreaterThanOrEqual(0.03);
    }
    // Something still lights the diorama.
    expect(night.sun.intensity + night.hemi.intensity).toBeGreaterThanOrEqual(2);
    expect(night.moonDisc.opacity).toBe(1);
    expect(night.sunDisc.opacity).toBe(0);
  });

  it("days are warm: the day sunlight leans red over blue", () => {
    const [r, , b] = hexToRgb01(MEADOW_ENV.times.day.sun.color);
    expect(r).toBeGreaterThan(b);
  });

  it("hex helpers", () => {
    expect(hexToRgb01("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(() => hexToRgb01("red")).toThrow();
  });
});

describe("celestialFor", () => {
  it("keeps the visible disc low and near the middle of the view, so the mine view shows it", () => {
    for (const tod of TIMES_OF_DAY) {
      for (let i = 0; i <= 10; i++) {
        const { sun, moon } = celestialFor(tod, i / 10);
        const shown = tod === "night" ? moon : sun;
        expect(shown.elevation).toBeGreaterThanOrEqual(2);
        expect(shown.elevation).toBeLessThanOrEqual(12);
        expect(Math.abs(shown.azimuth)).toBeLessThanOrEqual(32);
      }
    }
  });

  it("the sun rises at dawn, crosses at day and sinks at dusk", () => {
    expect(celestialFor("dawn", 1).sun.elevation).toBeGreaterThan(
      celestialFor("dawn", 0).sun.elevation,
    );
    expect(celestialFor("day", 1).sun.azimuth).toBeGreaterThan(celestialFor("day", 0).sun.azimuth);
    expect(celestialFor("dusk", 1).sun.elevation).toBeLessThan(
      celestialFor("dusk", 0).sun.elevation,
    );
    expect(celestialFor("night", 0.5).sun.elevation).toBeLessThan(0);
    expect(celestialFor("day", 0.5).moon.elevation).toBeLessThan(0);
  });

  it("clamps t01 and treats NaN as the default", () => {
    expect(celestialFor("day", -3)).toEqual(celestialFor("day", 0));
    expect(celestialFor("day", 7)).toEqual(celestialFor("day", 1));
    expect(celestialFor("day", Number.NaN)).toEqual(celestialFor("day", DEFAULT_T01));
  });
});

describe("clouds", () => {
  it("lays out the same clouds for the same seed, different for another", () => {
    expect(matrices(7)).toEqual(matrices(7));
    expect(matrices(7)).not.toEqual(matrices(8));
  });

  it("drifts along +x and wraps around the band", () => {
    const c = createClouds();
    c.advance(1000);
    expect(c.offset).toBeGreaterThan(0);
    c.advance(0);
    c.advance(-50);
    const before = c.offset;
    c.advance(1000 * 1000);
    expect(c.offset).toBeGreaterThanOrEqual(0);
    expect(c.offset).toBeLessThan(CLOUD_SPAN);
    expect(c.offset).not.toBe(before);
    // Every cloud stays inside the band.
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < c.mesh.count; i++) {
      c.mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(CLOUD_SPAN / 2 + 26);
    }
    c.dispose();
  });
});

/** How much FogExp2 hides a block `dist` away, for a camera `d` from the diorama's middle. */
const haze = (d: number, dist: number): number => 1 - Math.exp(-((fogFor(0.0042, d) * dist) ** 2));

describe("sky controller", () => {
  it("adds the dome, discs, clouds and horizon-colored fog; the first set snaps", () => {
    const { scene, lights, sky } = setup({ drift: false });
    sky.set({ biome: "meadow", timeOfDay: "night" });
    expect(scene.getObjectByName("sky-dome")).toBe(sky.dome);
    expect(scene.getObjectByName("clouds")).toBe(sky.clouds.mesh);
    expect(scene.background).toBeNull();
    const fog = scene.fog;
    expect(fog).toBeInstanceOf(THREE.FogExp2);
    expect(fog?.color.getHex()).toBe(new THREE.Color(MEADOW_ENV.times.night.sky.horizon).getHex());
    expect(lights.state).toEqual(nightLights());
    expect(sky.fading).toBe(false);
    expect(sky.moonDisc.visible).toBe(true);
    expect(sky.sunDisc.visible).toBe(false);
    expect(sky.system?.(16, 16)).toBe(false);
  });

  it("snaps every set until the first frame is drawn", () => {
    const { lights, sky } = setup({ drift: false });
    sky.set({ biome: "meadow", timeOfDay: "day" });
    sky.set({ biome: "meadow", timeOfDay: "night" });
    expect(sky.fading).toBe(false);
    expect(lights.state).toEqual(nightLights());
  });

  it("cross-fades a later set over 2 s, then settles the light rig on the target", () => {
    const { lights, sky, wakes } = setup({ drift: false });
    sky.set({ biome: "meadow", timeOfDay: "day" });
    sky.system?.(16, 16);
    // The same values again: nothing to do.
    sky.set({ biome: "meadow", timeOfDay: "day" });
    expect(sky.fading).toBe(false);
    const day = sky.mix.zenith.getHex();
    const before = wakes();
    sky.set({ biome: "meadow", timeOfDay: "night" });
    expect(wakes()).toBeGreaterThan(before);
    expect(sky.fading).toBe(true);
    expect(sky.system?.(1000, 1000)).toBe(true);
    const mid = sky.mix.zenith.getHex();
    expect(mid).not.toBe(day);
    expect(mid).not.toBe(new THREE.Color(MEADOW_ENV.times.night.sky.zenith).getHex());
    expect(sky.system?.(1000, 2000)).toBe(false);
    expect(sky.fading).toBe(false);
    expect(sky.mix.zenith.getHex()).toBe(
      new THREE.Color(MEADOW_ENV.times.night.sky.zenith).getHex(),
    );
    expect(lights.state).toEqual(nightLights());
  });

  it("an unknown-data biome falls back to the meadow", () => {
    const { lights, sky } = setup({ drift: false });
    sky.set({ biome: "frosty", timeOfDay: "night" });
    expect(lights.state).toEqual(nightLights());
  });

  it("frozen: every set snaps, t01 is pinned and the clouds never move", () => {
    const { sky } = setup({ frozen: true });
    sky.set({ biome: "meadow", timeOfDay: "day", t01: 0.95 });
    const pinned = sky.mix.sunDir.clone();
    sky.set({ biome: "meadow", timeOfDay: "night" });
    expect(sky.fading).toBe(false);
    sky.set({ biome: "meadow", timeOfDay: "day" });
    expect(sky.mix.sunDir.toArray()).toEqual(pinned.toArray());
    expect(sky.drifting).toBe(false);
    const offset = sky.clouds.offset;
    expect(sky.system?.(16, 16)).toBe(false);
    expect(sky.clouds.offset).toBe(offset);
  });

  it("clouds drift (keeping the loop busy) unless drift is off or reduced motion is on", () => {
    const { sky, setReduced } = setup();
    sky.set({ biome: "meadow", timeOfDay: "day" });
    expect(sky.drifting).toBe(true);
    expect(sky.system?.(100, 100)).toBe(true);
    expect(sky.clouds.offset).toBeGreaterThan(0);

    setReduced(true);
    const held = sky.clouds.offset;
    expect(sky.system?.(100, 200)).toBe(false);
    expect(sky.clouds.offset).toBe(held);

    setReduced(false);
    sky.setDrift(false);
    expect(sky.system?.(100, 300)).toBe(false);
    expect(sky.clouds.offset).toBe(held);
    sky.setDrift(true);
    expect(sky.system?.(100, 400)).toBe(true);
  });

  it("reduced motion: discs jump to their new place while colors still fade", () => {
    const { sky, setReduced } = setup({ drift: false });
    sky.set({ biome: "meadow", timeOfDay: "day", t01: 0 });
    sky.system?.(16, 16);
    setReduced(true);
    sky.set({ biome: "meadow", timeOfDay: "day", t01: 1 });
    sky.system?.(16, 16);
    const target = celestialFor("day", 1).sun;
    expect(sky.mix.sunDir.y).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(target.elevation)), 6);
    expect(sky.fading).toBe(true);
  });

  it("dispose removes everything it added and frees its GPU objects (M2-02 review N2)", () => {
    const { scene, sky } = setup();
    sky.set({ biome: "meadow", timeOfDay: "day" });
    const freed = [
      sky.dome.geometry,
      sky.dome.material,
      sky.sunDisc.geometry,
      sky.sunDisc.material,
      sky.moonDisc.material,
      sky.sunDisc.material.map,
      sky.moonDisc.material.map,
      sky.clouds.mesh.geometry,
      sky.clouds.material,
    ].map((o) => {
      if (!o || Array.isArray(o)) throw new Error("expected one disposable");
      return vi.spyOn(o, "dispose");
    });
    sky.dispose();
    for (const name of ["sky-dome", "clouds", "sun-disc", "moon-disc"]) {
      expect(scene.getObjectByName(name), name).toBeUndefined();
    }
    expect(scene.fog).toBeNull();
    for (const spy of freed) expect(spy).toHaveBeenCalled();
    // The background stays null: the scene's default environment sets its own (scene.ts).
    expect(scene.background).toBeNull();
  });

  it("fog is full strength near the diorama and thins in proportion further out (M2-02 N4)", () => {
    expect(fogFor(0.004, 4)).toBeCloseTo(0.004 * FOG_BOOST, 9);
    expect(fogFor(0.004, FOG_NEAR_DIST)).toBeCloseTo(0.004 * FOG_BOOST, 9);
    expect(fogFor(0.004, FOG_NEAR_DIST * 4)).toBeCloseTo((0.004 * FOG_BOOST) / 4, 9);
    expect(fogFor(0.004, 0)).toBeCloseTo(0.004 * FOG_BOOST, 9);
    // A far block in the Mine view (about 50 away) is hazed by a fifth or more; the overview's
    // nearest edge (about 80 away from a camera 120 out) by under a tenth.
    expect(haze(22, 50)).toBeGreaterThan(0.2);
    expect(haze(120, 80)).toBeLessThan(0.1);
  });

  it("the dome's update sets the fog for the camera that draws it", () => {
    const { scene, sky } = setup({ drift: false });
    sky.set({ biome: "meadow", timeOfDay: "day" });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 400, 0);
    // The renderer, geometry, material and group arguments go unused, so the test passes none.
    const hook: unknown = Reflect.get(sky.dome, "onBeforeRender");
    if (typeof hook !== "function") throw new Error("no dome hook");
    Reflect.apply(hook, sky.dome, [null, scene, camera]);
    const fog = scene.fog;
    if (!(fog instanceof THREE.FogExp2)) throw new Error("no fog");
    expect(fog.density).toBeLessThan(MEADOW_ENV.times.day.fogDensity * FOG_BOOST);
    expect(fog.density).toBeGreaterThan(0);
    // The dome still follows the camera.
    expect(sky.dome.position.y).toBe(400);
  });
});
