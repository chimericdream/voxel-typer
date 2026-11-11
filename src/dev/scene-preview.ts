// Scene preview (M2-01), served as /scene.html in dev and test builds only (never in `dist/`).
// Shows a seeded random test grid through the render core: chunked meshes, vertex AO, sun and
// hemisphere light, lamps, glass and water.
//
//   ?seed=<n>                 grid and atlas seed (default 1)
//   ?freeze=1                 fixed-step clock, no camera drift (screenshot baselines)
//   ?quality=low|medium|high  default medium
//   ?preset=overview|mine     default overview
//   ?tod=day|dawn|dusk|night  default day
//   ?reducedMotion=1          force reduced motion (otherwise the OS setting)
//
// Developer page: the text here is not kid-facing and doesn't go through t().
import { fixedStepClock, realClock } from "@/app/clock";
import type { BlockDef } from "@/content/blocks/types";
import { createRng } from "@/engine/rng";
import type { Rng } from "@/engine/rng";
import type { PaletteRampId, TextureRecipe } from "@/render/atlas/recipes";
import { VoxelGrid } from "@/render/mesher/voxel-grid";
import { cellCenter, createSceneHandle } from "@/render/scene";
import type { RenderStats, SceneCore } from "@/render/scene";
import type { QualityLevel, TimeOfDay } from "@/types/core";

const noise = (ramp: PaletteRampId, scale = 4, contrast = 1): TextureRecipe => ({
  kind: "noise",
  ramp,
  scale,
  contrast,
});
const custom = (paint: string): TextureRecipe => ({ kind: "custom", paint });

function block(
  id: string,
  num: number,
  top: TextureRecipe,
  side: TextureRecipe = top,
  bottom: TextureRecipe = top,
  tags: string[] = [],
  extra: Partial<BlockDef> = {},
): BlockDef {
  return {
    id,
    num,
    nameKey: `common.${id}`,
    faces: { top, side, bottom },
    material: "stone",
    rarity: "common",
    tags,
    typedName: id.replaceAll(/[^a-z]/g, ""),
    ...extra,
  };
}

const DIRT = noise("dirt", 4, 1);
const STONE = noise("stone", 4, 0.8);

/** Preview blocks (until M2-04's registry lands). */
const B = {
  grass: 1,
  dirt: 2,
  stone: 3,
  sand: 4,
  bricks: 5,
  planks: 6,
  log: 7,
  leaves: 8,
  glass: 9,
  water: 10,
  lamp: 11,
  ore: 12,
  wool: 13,
  pebbles: 14,
} as const;

const BLOCKS: readonly BlockDef[] = [
  block(
    "grass-block",
    B.grass,
    noise("grass", 3, 0.9),
    { kind: "overlay-top", base: DIRT, top: "grass", depth: 3 },
    DIRT,
  ),
  block("dirt", B.dirt, DIRT),
  block("stone", B.stone, STONE),
  block("sand", B.sand, noise("sand", 3, 0.6)),
  block("stone-bricks", B.bricks, { kind: "bricks", ramp: "stone", mortar: "mortar" }),
  block("oak-planks", B.planks, { kind: "planks", ramp: "oak", boards: 4 }),
  block("oak-log", B.log, custom("rings:oak"), custom("bark:oak-bark")),
  block("leaves", B.leaves, custom("leaves:leaf")),
  block("glass", B.glass, custom("glass"), custom("glass"), custom("glass"), ["transparent"]),
  block("water", B.water, custom("ripple:water"), custom("ripple:water"), custom("ripple:water"), [
    "transparent",
  ]),
  block(
    "spark-lamp",
    B.lamp,
    custom("lamp:spark"),
    custom("lamp:spark"),
    custom("lamp:spark"),
    ["light"],
    { light: { color: "#ffcf7a", intensity: 1.5 } },
  ),
  block("gem-ore", B.ore, { kind: "ore", base: STONE, ore: "ore-gem", density: 0.35 }),
  block("red-wool", B.wool, custom("knit:wool-red")),
  block("rubble", B.pebbles, custom("pebbles:stone")),
];

/** Grid size: 3 × 2 × 3 chunks of 16³. */
const SX = 48;
const SY = 24;
const SZ = 48;

function fill(
  g: VoxelGrid,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  id: number,
): void {
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) g.set(x, y, z, id);
    }
  }
}

/** Ground height at (x, z): a few seeded low-frequency waves, terraced to whole blocks. */
function heightField(rng: Rng): (x: number, z: number) => number {
  const waves = Array.from({ length: 4 }, () => ({
    fx: (rng.next() * 2 - 1) * 0.18,
    fz: (rng.next() * 2 - 1) * 0.18,
    phase: rng.next() * Math.PI * 2,
    amp: 0.6 + rng.next() * 1.2,
  }));
  return (x, z) => {
    let h = 5;
    for (const w of waves) h += w.amp * Math.sin(x * w.fx + z * w.fz + w.phase);
    return Math.max(2, Math.min(10, Math.round(h)));
  };
}

/** A seeded test grid with terrain, steps, an arch, a lamp-lit hut, a pond, trees and scatter. */
export function testGrid(seed: number): {
  grid: VoxelGrid;
  target: { x: number; y: number; z: number };
} {
  const rng = createRng(seed).fork("scene-preview");
  const g = new VoxelGrid(SX, SY, SZ);
  const height = heightField(rng.fork("height"));
  const ground = new Int32Array(SX * SZ);

  for (let z = 0; z < SZ; z++) {
    for (let x = 0; x < SX; x++) {
      const h = height(x, z);
      ground[x + SX * z] = h;
      for (let y = 0; y < h; y++) {
        g.set(x, y, z, y === h - 1 ? B.grass : y >= h - 4 ? B.dirt : B.stone);
      }
    }
  }
  const top = (x: number, z: number): number => ground[x + SX * z] ?? 0;

  // Pond: dig a basin and fill it with water, sand around the rim.
  const px = 10 + rng.int(0, 4);
  const pz = 30 + rng.int(0, 4);
  const pondY = Math.max(3, top(px, pz) - 1);
  for (let z = pz - 4; z <= pz + 4; z++) {
    for (let x = px - 5; x <= px + 5; x++) {
      const d = ((x - px) / 5) ** 2 + ((z - pz) / 4) ** 2;
      if (d > 1.3) continue;
      for (let y = pondY - 1; y < SY; y++) g.set(x, y, z, 0);
      g.set(x, pondY - 2, z, B.sand);
      if (d <= 1) g.set(x, pondY - 1, z, B.water);
      else g.set(x, pondY - 1, z, B.sand);
    }
  }

  // Stepped pyramid of bricks: lots of inside corners for AO.
  const sx0 = 28;
  const sz0 = 8;
  const base = top(sx0 + 4, sz0 + 4);
  for (let step = 0; step < 4; step++) {
    fill(
      g,
      sx0 + step,
      base + step,
      sz0 + step,
      sx0 + 9 - step,
      base + step,
      sz0 + 9 - step,
      B.bricks,
    );
  }

  // Arch of planks.
  const ax = 8;
  const az = 10;
  const ay = top(ax, az);
  fill(g, ax, ay, az, ax, ay + 4, az + 1, B.planks);
  fill(g, ax + 5, ay, az, ax + 5, ay + 4, az + 1, B.planks);
  fill(g, ax, ay + 5, az, ax + 5, ay + 5, az + 1, B.planks);

  // Hut: stone walls, a glass window, a lamp inside and a log roof with an overhang.
  const hx = 32;
  const hz = 28;
  const hy = top(hx + 3, hz + 3);
  fill(g, hx, hy - 1, hz, hx + 6, hy - 1, hz + 6, B.pebbles);
  fill(g, hx, hy, hz, hx + 6, hy + 3, hz + 6, B.pebbles);
  fill(g, hx + 1, hy, hz + 1, hx + 5, hy + 3, hz + 5, 0);
  fill(g, hx + 2, hy + 1, hz + 6, hx + 4, hy + 2, hz + 6, B.glass);
  fill(g, hx + 3, hy, hz + 6, hx + 3, hy, hz + 6, 0);
  fill(g, hx - 1, hy + 4, hz - 1, hx + 7, hy + 4, hz + 7, B.log);
  g.set(hx + 3, hy, hz + 3, B.lamp);
  g.set(hx + 7, hy, hz + 8, B.lamp);

  // Trees: log trunk with a leaf blob.
  const trees = rng.fork("trees");
  for (let i = 0; i < 4; i++) {
    const tx = 4 + trees.int(0, 38);
    const tz = 4 + trees.int(0, 16);
    const ty = top(tx, tz);
    if (g.get(tx, ty, tz) !== 0) continue;
    fill(g, tx, ty, tz, tx, ty + 3, tz, B.log);
    fill(g, tx - 2, ty + 3, tz - 2, tx + 2, ty + 4, tz + 2, B.leaves);
    fill(g, tx - 1, ty + 5, tz - 1, tx + 1, ty + 5, tz + 1, B.leaves);
    g.set(tx, ty + 3, tz, B.log);
  }

  // Random scatter: single blocks and short columns on the ground.
  const scatter = rng.fork("scatter");
  const kinds = [B.stone, B.pebbles, B.wool, B.ore, B.planks, B.dirt];
  for (let i = 0; i < 40; i++) {
    const x = scatter.int(1, SX - 2);
    const z = scatter.int(1, SZ - 2);
    const y = top(x, z);
    if (g.get(x, y, z) !== 0 || g.get(x, y - 1, z) === B.water || g.get(x, y - 1, z) === 0)
      continue;
    const id = scatter.pick(kinds);
    fill(g, x, y, z, x, y + scatter.int(0, 2), z, id);
  }

  // The Mine-mode target: an ore block on a little pedestal at the front.
  const mx = 24;
  const mz = 42;
  const my = top(mx, mz);
  fill(g, mx - 1, my, mz - 1, mx + 1, my, mz + 1, B.bricks);
  g.set(mx, my + 1, mz, B.ore);
  return { grid: g, target: cellCenter(mx, my + 1, mz) };
}

const QUALITIES: readonly QualityLevel[] = ["low", "medium", "high"];
const TIMES: readonly TimeOfDay[] = ["day", "dawn", "dusk", "night"];

function readParams(search: string): {
  seed: number;
  freeze: boolean;
  quality: QualityLevel;
  preset: "overview" | "mine";
  tod: TimeOfDay;
  reducedMotion: boolean | null;
} {
  const p = new URLSearchParams(search);
  const n = Number.parseInt(p.get("seed") ?? "", 10);
  const rm = p.get("reducedMotion");
  return {
    seed: Number.isFinite(n) ? n : 1,
    freeze: p.get("freeze") === "1",
    quality: QUALITIES.find((q) => q === p.get("quality")) ?? "medium",
    preset: p.get("preset") === "mine" ? "mine" : "overview",
    tod: TIMES.find((t) => t === p.get("tod")) ?? "day",
    reducedMotion: rm === null ? null : rm === "1",
  };
}

/** e2e hooks for this page. */
export interface ScenePreviewHooks {
  handle: SceneCore;
  /** Renderer counters right after the handle was made, before any diorama. */
  baseline: RenderStats;
  stats(): RenderStats;
  /** Clears and reloads the diorama `times` times (leak check), then renders. */
  reload(times: number): Promise<void>;
  /** Draws a frame and waits until it's on screen. */
  frame(): Promise<void>;
  /**
   * Makes, loads, draws and disposes `count` extra scenes in a row, each with default options
   * (only blocks and seed). Reports how many went idle after loading (no frame pending within 10
   * frames) and how
   * many had lost their WebGL context after `dispose()`.
   */
  cycle(count: number): Promise<{ idle: number; contextLost: number }>;
  /** Block nums of the preview blocks, for edit tests. */
  blocks: Readonly<Record<keyof typeof B, number>>;
  dispose(): void;
}

declare global {
  interface Window {
    vtScene?: ScenePreviewHooks;
  }
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

async function start(root: HTMLElement): Promise<void> {
  const params = readParams(window.location.search);
  const canvas = document.createElement("canvas");
  canvas.id = "scene-canvas";
  root.append(canvas);

  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const handle = createSceneHandle(canvas, {
    blocks: BLOCKS,
    seed: params.seed,
    quality: params.quality,
    clock: params.freeze ? fixedStepClock(0, 16) : realClock,
    ambientMotion: !params.freeze,
    reducedMotion: () => params.reducedMotion ?? media.matches,
    preserveDrawingBuffer: true,
  });
  const baseline = handle.renderStats();
  const { grid, target } = testGrid(params.seed);

  handle.setEnvironment({ biome: "meadow", timeOfDay: params.tod });
  await handle.loadDiorama(`test-${params.seed}`, grid);
  handle.camera.setTarget(target);
  handle.camera.preset(params.preset, { durationMs: 0 });
  handle.requestRender();

  window.vtScene = {
    handle,
    baseline,
    stats: () => handle.renderStats(),
    async reload(times) {
      for (let i = 0; i < times; i++) {
        handle.clearDiorama();
        await handle.loadDiorama(`test-${params.seed}`, testGrid(params.seed).grid);
      }
      handle.requestRender();
      await nextFrame();
      await nextFrame();
    },
    async frame() {
      handle.requestRender();
      await nextFrame();
      await nextFrame();
    },
    async cycle(count) {
      let idle = 0;
      let contextLost = 0;
      for (let i = 0; i < count; i++) {
        const c = document.createElement("canvas");
        c.width = 320;
        c.height = 180;
        root.append(c);
        const h = createSceneHandle(c, { blocks: BLOCKS, seed: params.seed });
        await h.loadDiorama(`cycle-${i}`, testGrid(params.seed).grid);
        // Idle = stops requesting frames once loaded (a resize may ask for one more first).
        for (let f = 0; f < 10 && (f < 2 || h.loop.scheduled); f++) await nextFrame();
        if (!h.loop.scheduled) idle++;
        const gl = h.three.renderer.getContext();
        h.dispose();
        if (gl.isContextLost()) contextLost++;
        c.remove();
      }
      return { idle, contextLost };
    },
    blocks: B,
    dispose: () => handle.dispose(),
  };

  // Two frames: the requested render, then one more so the canvas is composited.
  await nextFrame();
  await nextFrame();
  const stats = handle.renderStats();
  root.dataset.calls = String(stats.calls);
  root.dataset.ready = "1";
}

const root = document.querySelector<HTMLElement>("#scene");
if (root) {
  start(root).catch((err: unknown) => {
    console.error(err);
    root.dataset.error = String(err);
  });
}
