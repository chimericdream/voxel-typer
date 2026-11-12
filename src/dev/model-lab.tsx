// Model Lab (M4-02), served as /lab.html in dev and test builds only (never in `dist/`).
// Lists every `*.model.json` in the repo (src/ and tests/), builds the picked one with the M4-01
// runtime on a small grass floor, and lets you play each anim, scrub its time, orbit the camera,
// switch day/night and copy a screenshot.
//
//   ?model=<id>        open this model first (default: the first by id)
//   ?anim=<name>       play this anim first (default `idle` when the model has it)
//   ?tod=day|night     default day
//   ?reducedMotion=1   models get reduced motion (looping anims hold their first frame)
//
// The time scrubber drives the runtime's own `update(dtMs)`: while paused, the model is taken off
// the driver, and a scrub to `t` replays the anim from 0 with no fade and calls `update(t)`.
// Playing again re-adds it to the driver from that time. No extra runtime API is needed.
//
// Developer page: the text here is not kid-facing and doesn't go through t().
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as THREE from "three";
import { blocks } from "@/content/blocks";
import type { CameraPose } from "@/render/camera";
import { VoxelGrid } from "@/render/mesher/voxel-grid";
import { buildModel, createModelDriver, parseModel } from "@/render/models";
import type { ModelHandle, VoxelModel } from "@/render/models";
import { createSceneHandle } from "@/render/scene";
import type { SceneCore } from "@/render/scene";
import { createSkyEnvironment } from "@/render/sky";
import type { Ms, TimeOfDay } from "@/types/core";

/** Every model file in the repo, by path from the repo root. */
const FILES = import.meta.glob<unknown>(["/src/**/*.model.json", "/tests/**/*.model.json"], {
  eager: true,
  import: "default",
});

/** One model file: parsed, or the validator's message. */
export interface LabEntry {
  path: string;
  id: string;
  model: VoxelModel | null;
  error: string | null;
}

export function loadEntries(files: Readonly<Record<string, unknown>>): LabEntry[] {
  const out: LabEntry[] = [];
  for (const [path, json] of Object.entries(files)) {
    const fallbackId = (path.split("/").pop() ?? path).replace(/\.model\.json$/, "");
    try {
      const model = parseModel(json, path);
      out.push({ path, id: model.id, model, error: null });
    } catch (err) {
      out.push({ path, id: fallbackId, model: null, error: String(err) });
    }
  }
  return out.toSorted((a, b) => a.id.localeCompare(b.id) || a.path.localeCompare(b.path));
}

/** Standard anims first (contracts.md §8.4), then the model's own, by name. */
const STANDARD = ["idle", "walk", "hit", "defeat"];
const rank = (n: string): number => {
  const i = STANDARD.indexOf(n);
  return i < 0 ? STANDARD.length : i;
};
function animNames(model: VoxelModel): string[] {
  const names = Object.keys(model.anims);
  return names.toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** The floor: 16 × 16 grass, one block thick. Its top is at y = 1. */
const FLOOR = 16;
const STAGE = { x: FLOOR / 2, y: 1, z: FLOOR / 2 };
const PITCH_MIN = THREE.MathUtils.degToRad(-10);
const PITCH_MAX = THREE.MathUtils.degToRad(85);

function floorGrid(): VoxelGrid {
  const grass = blocks.find((b) => b.id === "grass");
  if (!grass) throw new Error("model lab: no grass block in the registry");
  const g = new VoxelGrid(FLOOR, FLOOR, FLOOR);
  for (let z = 0; z < FLOOR; z++) for (let x = 0; x < FLOOR; x++) g.set(x, 0, z, grass.num);
  return g;
}

interface Params {
  model: string | null;
  anim: string | null;
  tod: TimeOfDay;
  reducedMotion: boolean;
}

function readParams(search: string): Params {
  const p = new URLSearchParams(search);
  return {
    model: p.get("model"),
    anim: p.get("anim"),
    tod: p.get("tod") === "night" ? "night" : "day",
    reducedMotion: p.get("reducedMotion") === "1",
  };
}

/** What the sidebar shows. */
export interface LabState {
  entry: LabEntry | null;
  anims: string[];
  anim: string | null;
  playing: boolean;
  timeMs: Ms;
  durationMs: Ms;
  loop: boolean;
  tod: TimeOfDay;
  status: string;
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

interface Lab {
  readonly handle: SceneCore;
  readonly entries: readonly LabEntry[];
  state(): LabState;
  onChange(fn: () => void): void;
  open(id: string): void;
  /** Plays `anim` from its start (with the runtime's crossfade). */
  play(anim: string): void;
  /** Blends back to the rest pose. */
  rest(): void;
  pause(): void;
  resume(): void;
  /** Pauses and shows the current anim at `t` ms. */
  scrub(t: Ms): void;
  setTimeOfDay(tod: TimeOfDay): void;
  /** A PNG of the canvas as it is now. */
  screenshot(): Promise<Blob>;
  orbit(dyaw: number, dpitch: number): void;
  zoom(factor: number): void;
}

function createLab(canvas: HTMLCanvasElement, params: Params, entries: LabEntry[]): Lab {
  const handle = createSceneHandle(canvas, {
    blocks,
    seed: 1,
    reducedMotion: () => params.reducedMotion,
    preserveDrawingBuffer: true,
    createEnvironment: createSkyEnvironment({ drift: false, lerpMs: 400 }),
  });
  const driver = createModelDriver(handle.loop);
  const listeners: (() => void)[] = [];
  const changed = (): void => {
    for (const fn of listeners) fn();
  };

  let entry: LabEntry | null = null;
  let model: ModelHandle | null = null;
  let unbind: (() => void) | null = null;
  let anim: string | null = null;
  let playing = false;
  let timeMs = 0;
  let tod = params.tod;
  let status = "";
  const camera: CameraPose = {
    target: { ...STAGE },
    yaw: THREE.MathUtils.degToRad(30),
    pitch: THREE.MathUtils.degToRad(18),
    distance: 3,
    fov: 35,
  };
  const current = (): VoxelModel["anims"][string] | undefined =>
    anim && entry?.model ? entry.model.anims[anim] : undefined;

  const bind = (): void => {
    if (model && !unbind) unbind = driver.add(model);
  };
  const unbindModel = (): void => {
    unbind?.();
    unbind = null;
  };
  const moveCamera = (): void => handle.camera.moveTo(camera);

  // Mirrors the anim's time for the scrubber. Never asks for frames itself.
  handle.loop.addSystem((dt) => {
    const a = current();
    if (!playing || !a) return false;
    if (a.loop) {
      timeMs = params.reducedMotion ? 0 : (timeMs + Math.max(0, dt)) % a.durationMs;
    } else {
      timeMs = Math.min(a.durationMs, timeMs + Math.max(0, dt));
      if (timeMs >= a.durationMs) playing = false;
    }
    changed();
    return false;
  });

  /** Shows `name` at `t` with no fade, not bound to the driver. */
  const pose = (name: string, t: Ms): void => {
    if (!model) return;
    model.play(name, { restart: true, fadeMs: 0 });
    model.update(t);
  };

  const lab: Lab = {
    handle,
    entries,
    state: () => {
      const a = current();
      return {
        entry,
        anims: entry?.model ? animNames(entry.model) : [],
        anim,
        playing,
        timeMs,
        durationMs: a?.durationMs ?? 0,
        loop: a?.loop ?? false,
        tod,
        status,
      };
    },
    onChange(fn) {
      listeners.push(fn);
    },
    open(id) {
      const next = entries.find((e) => e.id === id);
      if (!next) return;
      unbindModel();
      model?.dispose();
      model = null;
      entry = next;
      anim = null;
      playing = false;
      timeMs = 0;
      status = "";
      if (next.model) {
        model = buildModel(next.model, handle.atlas(), {
          reducedMotion: () => params.reducedMotion,
        });
        model.root.position.set(STAGE.x, STAGE.y, STAGE.z);
        handle.three.scene.add(model.root);
        // Frame it: aim at the middle of its rest box, far enough to fit it.
        const box = new THREE.Box3().setFromObject(model.root);
        const size = box.getSize(new THREE.Vector3());
        const mid = box.getCenter(new THREE.Vector3());
        camera.target = { x: mid.x, y: mid.y, z: mid.z };
        camera.distance = Math.max(1.2, Math.max(size.x, size.y, size.z) * 4);
        moveCamera();
        bind();
        const names = animNames(next.model);
        const first = params.anim && names.includes(params.anim) ? params.anim : "idle";
        if (names.includes(first)) lab.play(first);
      }
      handle.requestRender();
      changed();
    },
    play(name) {
      if (!model?.play(name, { restart: true })) return;
      bind();
      anim = name;
      timeMs = 0;
      playing = true;
      changed();
    },
    rest() {
      if (!model) return;
      bind();
      model.stop();
      anim = null;
      playing = false;
      timeMs = 0;
      changed();
    },
    pause() {
      if (!anim) return;
      lab.scrub(timeMs);
    },
    resume() {
      const a = current();
      if (!a || !anim || !model) return;
      if (!a.loop && timeMs >= a.durationMs) timeMs = 0;
      pose(anim, timeMs);
      playing = true;
      bind();
      handle.loop.wake();
      changed();
    },
    scrub(t) {
      const a = current();
      if (!a || !anim) return;
      playing = false;
      unbindModel();
      timeMs = Math.max(0, Math.min(a.durationMs, t));
      pose(anim, timeMs);
      handle.requestRender();
      changed();
    },
    setTimeOfDay(next) {
      tod = next;
      handle.setEnvironment({ biome: "meadow", timeOfDay: next });
      changed();
    },
    async screenshot() {
      handle.requestRender();
      await nextFrame();
      await nextFrame();
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/png");
      });
      if (!blob) throw new Error("model lab: the canvas gave no image");
      return blob;
    },
    orbit(dyaw, dpitch) {
      camera.yaw += dyaw;
      camera.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, camera.pitch + dpitch));
      moveCamera();
    },
    zoom(factor) {
      camera.distance = Math.min(40, Math.max(0.5, camera.distance * factor));
      moveCamera();
    },
  };
  return lab;
}

/** Copies the screenshot to the clipboard, or downloads it where the clipboard can't take it. */
async function copyScreenshot(lab: Lab): Promise<string> {
  const blob = await lab.screenshot();
  const s = lab.state();
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "Screenshot copied.";
  } catch {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${s.entry?.id ?? "model"}-${s.anim ?? "rest"}-${Math.round(s.timeMs)}ms.png`;
    a.click();
    URL.revokeObjectURL(url);
    return "Clipboard unavailable: screenshot downloaded.";
  }
}

function Sidebar({ lab }: { lab: Lab }) {
  const [, setTick] = useState(0);
  const [note, setNote] = useState("");
  useEffect(() => {
    lab.onChange(() => setTick((n) => n + 1));
  }, [lab]);
  const s = lab.state();
  const id = s.entry?.id ?? null;
  return (
    <aside>
      <h2>Models</h2>
      <div class="models">
        {lab.entries.map((e) => (
          <button
            key={e.path}
            type="button"
            aria-pressed={e.id === id && e.path === s.entry?.path}
            data-model={e.id}
            onClick={() => lab.open(e.id)}
          >
            {e.id}
            {e.error ? " (invalid)" : ""}
          </button>
        ))}
      </div>
      {lab.entries.length === 0 && <p class="meta">No *.model.json files found.</p>}
      {s.entry && (
        <p class="meta" data-path>
          {s.entry.path}
          {s.entry.model && ` · ${s.entry.model.parts.length} parts`}
        </p>
      )}
      {s.entry?.error && <p class="bad">{s.entry.error}</p>}

      {s.entry?.model && (
        <>
          <h2>Animations</h2>
          {s.anims.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={name === s.anim}
              data-anim={name}
              onClick={() => lab.play(name)}
            >
              {name}
            </button>
          ))}
          <button type="button" aria-pressed={s.anim === null} onClick={() => lab.rest()}>
            rest
          </button>

          <h2>Time</h2>
          <input
            type="range"
            id="scrubber"
            aria-label="Anim time (ms)"
            min={0}
            max={s.durationMs}
            step={1}
            value={Math.round(s.timeMs)}
            disabled={s.anim === null}
            onInput={(e) => lab.scrub(Number(e.currentTarget.value))}
          />
          <p class="meta">
            {s.anim
              ? `${Math.round(s.timeMs)} / ${s.durationMs} ms · ${s.loop ? "loop" : "one-shot"}`
              : "rest pose"}
          </p>
          <button
            type="button"
            id="play-pause"
            disabled={s.anim === null}
            onClick={() => (s.playing ? lab.pause() : lab.resume())}
          >
            {s.playing ? "Pause" : "Play"}
          </button>
        </>
      )}

      <h2>Background</h2>
      {(["day", "night"] as const).map((tod) => (
        <button
          key={tod}
          type="button"
          aria-pressed={s.tod === tod}
          data-tod={tod}
          onClick={() => lab.setTimeOfDay(tod)}
        >
          {tod}
        </button>
      ))}

      <h2>Screenshot</h2>
      <button
        type="button"
        id="copy-screenshot"
        onClick={() => {
          copyScreenshot(lab).then(setNote, (err: unknown) => setNote(String(err)));
        }}
      >
        Copy screenshot
      </button>
      {note && <p class="status">{note}</p>}

      <h2>Camera</h2>
      <p class="meta">Drag to orbit, wheel to zoom.</p>
    </aside>
  );
}

function Stage({ canvas, lab }: { canvas: HTMLCanvasElement; lab: Lab }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.append(canvas);
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent): void => {
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent): void => {
      if (!drag) return;
      lab.orbit(-(e.clientX - drag.x) * 0.01, (e.clientY - drag.y) * 0.01);
      drag = { x: e.clientX, y: e.clientY };
    };
    const up = (): void => {
      drag = null;
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      lab.zoom(Math.exp(e.deltaY * 0.001));
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
  }, [canvas, lab]);
  return <div class="stage" ref={ref} />;
}

/** e2e hooks for this page. */
export interface ModelLabHooks {
  /** Every model file found, with the validator's message for a bad one. */
  entries: { path: string; id: string; error: string | null; anims: string[] }[];
  /** Opens a model and waits until it's on screen. Returns the last frame's draw calls. */
  open(id: string): Promise<number>;
  play(anim: string): Promise<void>;
  scrub(t: Ms): Promise<void>;
  setTimeOfDay(tod: TimeOfDay): Promise<void>;
  state(): Omit<LabState, "entry"> & { id: string | null };
  /** True while a frame is scheduled (false once the scene is idle). */
  scheduled(): boolean;
  /** The PNG's size in bytes. */
  screenshot(): Promise<number>;
}

declare global {
  interface Window {
    vtLab?: ModelLabHooks;
  }
}

async function start(root: HTMLElement): Promise<void> {
  const params = readParams(window.location.search);
  const entries = loadEntries(FILES);
  const canvas = document.createElement("canvas");
  canvas.id = "lab-canvas";
  const lab = createLab(canvas, params, entries);
  lab.setTimeOfDay(params.tod);
  await lab.handle.loadDiorama("model-lab", floorGrid());

  const drawn = async (): Promise<void> => {
    lab.handle.requestRender();
    await nextFrame();
    await nextFrame();
  };
  window.vtLab = {
    entries: entries.map((e) => ({
      path: e.path,
      id: e.id,
      error: e.error,
      anims: e.model ? animNames(e.model) : [],
    })),
    async open(id) {
      lab.open(id);
      await drawn();
      return lab.handle.renderStats().calls;
    },
    async play(anim) {
      lab.play(anim);
      await drawn();
    },
    async scrub(t) {
      lab.scrub(t);
      await drawn();
    },
    async setTimeOfDay(tod) {
      lab.setTimeOfDay(tod);
      await drawn();
    },
    state() {
      const { entry, ...rest } = lab.state();
      return { ...rest, id: entry?.id ?? null };
    },
    scheduled: () => lab.handle.loop.scheduled,
    async screenshot() {
      return (await lab.screenshot()).size;
    },
  };

  render(
    <>
      <Sidebar lab={lab} />
      <Stage canvas={canvas} lab={lab} />
    </>,
    root,
  );
  const first = entries.find((e) => e.id === params.model) ?? entries[0];
  if (first) lab.open(first.id);
  await drawn();
  root.dataset["models"] = String(entries.length);
  root.dataset["ready"] = "1";
}

const root = document.querySelector<HTMLElement>("#lab");
if (root) {
  start(root).catch((err: unknown) => {
    console.error(err);
    root.dataset["error"] = String(err);
  });
}
