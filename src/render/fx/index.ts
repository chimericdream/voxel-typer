/**
 * Effects (task M2-05, contracts.md §8 `FxApi`, PLAN.md §3.4 and §4.6).
 *
 * `createFx(ctx, { rng })` is what the app passes to `createSceneHandle` as `opts.createFx`:
 *
 * ```ts
 * createSceneHandle(canvas, { …, createFx: (ctx) => createFx(ctx, { rng: createRng(seed).fork("fx") }) });
 * ```
 *
 * - `burst`: cube particles from the pooled `InstancedMesh` (at most 512 live; one draw call).
 * - `hitStop`: the loop's hit-stop (M2-01). Particles hold still for it too, so the break lands.
 * - `floatText`: a DOM label over the canvas, projected from the world point every frame.
 * - Shake lives on the camera rig (`CameraRig.shake`, M2-01); {@link breakShake} gives the size
 *   for a block break.
 *
 * Effects keep the loop drawing only while something is alive (a system that returns `true`),
 * then let it idle. Randomness comes only from the `rng` passed in.
 *
 * Reduced motion (read on every call): no hit-stop, at most 6 particles that drift down without
 * bouncing, float text fades in place. Shake is already a no-op on the rig.
 */
import type { Texture } from "three";
import type { Rng } from "@/engine/rng";
import type { Ms } from "@/types/core";
import { tileUv } from "../atlas/build";
import type { FxContext, FxModule } from "../scene";
import type { Vec3 } from "../types";
import { createFloatTextLayer } from "./float-text";
import { createParticlePool } from "./particle-pool";
import type { UvRect } from "./particle-pool";
import { createParticleMesh } from "./particles";
import { MAX_HIT_STOP, MAX_PARTICLES } from "./tuning";

export { breakShake } from "./tuning";
export { isSingleGlyph, labelLook } from "./float-text";
export { createParticlePool } from "./particle-pool";
export type { ParticlePool, BurstSpec, UvRect } from "./particle-pool";

export interface FxOptions {
  /** The only source of randomness for every effect. */
  rng: Rng;
  /**
   * World y of the floor a burst's particles bounce on. Default: the bottom of the burst point's
   * cell (`at.y - 0.5`), so chips from a broken block land where it stood.
   */
  groundY?: (at: Vec3) => number;
  /** Pool size, default 512. Tests only. */
  maxParticles?: number;
}

/** The effects module, plus counters for tests and `__vt`. */
export interface FxCore extends FxModule {
  stats(): { particles: number; maxParticles: number; floatTexts: number; holding: boolean };
  dispose(): void;
}

/** The UV window of an untextured chip, before any atlas exists. */
const NO_TILE: UvRect = [0, 0, 1, 1];

export function createFx(ctx: FxContext, opts: FxOptions): FxCore {
  const rng = opts.rng;
  const groundY = opts.groundY ?? ((at: Vec3) => at.y - 0.5);
  const pool = createParticlePool(opts.maxParticles ?? MAX_PARTICLES);
  const particles = createParticleMesh(pool);
  ctx.scene.add(particles.mesh);
  const texts = createFloatTextLayer(ctx.canvas, ctx.camera);
  let holdLeft: Ms = 0;
  let disposed = false;
  /** The atlas texture the live chips were cut from. */
  let chipTexture: Texture | null = null;

  const system = (dtMs: Ms): boolean => {
    // Particles hold still during a hit-stop; float text keeps going.
    const holding = holdLeft > 0;
    holdLeft = Math.max(0, holdLeft - dtMs);
    // A new atlas (a biome change) while chips are alive: drop them rather than keep drawing the
    // old texture, which the scene has disposed and would upload again (M2-05 review N4). Their
    // UVs point into the old atlas, so they couldn't simply switch over.
    if (pool.alive > 0 && (ctx.atlas()?.texture ?? null) !== chipTexture) {
      pool.clear();
      particles.sync(pool);
      chipTexture = null;
      particles.setTexture(null);
    }
    const hadParticles = pool.alive > 0;
    pool.step(holding ? 0 : dtMs);
    if (hadParticles) particles.sync(pool);
    const textBusy = texts.step(dtMs);
    return pool.alive > 0 || textBusy || holdLeft > 0;
  };
  const removeSystem = ctx.loop.addSystem(system);

  const fx: FxCore = {
    burst(at, { blockId, count, speed }) {
      if (disposed) return;
      const atlas = ctx.atlas();
      chipTexture = atlas?.texture ?? null;
      particles.setTexture(chipTexture);
      const uv = atlas ? tileUv(atlas.canvas.width, atlas.tileOf(blockId, "side")) : NO_TILE;
      const spawned = pool.spawn(
        {
          at,
          count,
          ...(speed !== undefined && { speed }),
          groundY: groundY(at),
          uv,
          reduced: ctx.reducedMotion(),
        },
        rng,
      );
      if (spawned === 0) return;
      particles.sync(pool);
      ctx.loop.wake();
    },
    hitStop(ms) {
      if (disposed || ctx.reducedMotion() || !(ms > 0)) return;
      const capped = Math.min(ms, MAX_HIT_STOP);
      holdLeft = Math.max(holdLeft, capped);
      ctx.loop.hitStop(capped);
    },
    floatText(at, text, o) {
      if (disposed || text.length === 0) return;
      const shown = texts.add(at, text, {
        ...(o?.color !== undefined && { color: o.color }),
        reduced: ctx.reducedMotion(),
      });
      if (shown) ctx.loop.wake();
    },
    stats() {
      return {
        particles: pool.alive,
        maxParticles: pool.max,
        floatTexts: texts.active,
        holding: holdLeft > 0,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeSystem();
      pool.clear();
      particles.dispose();
      texts.dispose();
    },
  };
  return fx;
}
