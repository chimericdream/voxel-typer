/**
 * Builder mode (task M4-07, PLAN.md §3.2.4): the child builds on their Home Island by typing.
 * Words are commands (`commands.ts`): a block's name arms it, `put` places it at the cursor, `dig`
 * takes a block back, directions move the cursor, `undo` steps back. Nothing can be lost: every
 * block dug goes to the inventory, every edit can be undone, and no key is ever an error.
 *
 * This file is the wiring. The command line is `commands.ts` and the cursor rules are `logic.ts`
 * (both pure); the cursor and ghost are `view.ts`; the HUD is `BuilderHud.tsx`, fed through
 * `HudState.custom` (`hud.ts`). The island data and its undo are M4-06's `IslandEditor`.
 *
 * **Never lose an island.** If the saved island can't be opened, the mode shows a calm note and
 * does nothing else: no editor, no fresh island, and no save is ever sent, so the old data stays in
 * the profile exactly as it was for a grown-up (or a later build) to recover. A fresh island is
 * made only for a profile that has none (`island === null`), and it is written only after the
 * first edit.
 *
 * **Saving.** The island and the inventory always travel together ({@link IslandPatch}). While the
 * mode runs they go out on the bus (`BUILDER_SAVE_EVENT`): every {@link AUTOSAVE_MS} of play and
 * on every pause, and only when something changed, so an idle island tab never writes. Leaving
 * hands the last patch to `finish` with the practice session, for one save.
 *
 * **Practice session.** Typing here counts toward key stats. A command's keys are fed to a real
 * typing session when the command runs, as one target (`"east 3"`), with the keys that didn't fit
 * counted as slips on the letter they were typed for. The session is parked between commands, so
 * looking at the island is not typing time. Letters taken back with Backspace are a change of
 * mind, not slips, and leave no trace.
 */
import { reducedMotion } from "@/a11y/motion";
import { blocks } from "@/content/blocks";
import type { BlockDef } from "@/content/blocks/types";
import { UNDO_LIMIT, createIsland, islandBlocks, openIsland } from "@/engine/island";
import type { EditResult, IslandEditor } from "@/engine/island";
import { createSession } from "@/engine/session";
import type { SessionSummary } from "@/engine/stats";
import type { EngineEvent, KeyInput, SessionView } from "@/engine/types";
import { t } from "@/i18n";
import type { Atlas } from "@/render/atlas/build";
import type { CameraRig, SceneHandle } from "@/render/types";
import type { BlockId, Ms } from "@/types/core";
import type { ModeContext, ModeInstance } from "../types";
import { blueprintsFor } from "./blueprints";
import type { BuilderBlueprint } from "./blueprints";
import {
  EMPTY_LINE,
  buildVocabulary,
  completionOf,
  settled,
  typeKey,
  waitsForSpace,
} from "./commands";
import type { Command, Direction, Feedback, LineState } from "./commands";
import { BUILDER_SLICE } from "./hud";
import type { BuilderHint, BuilderHudSlice, PaletteItem } from "./hud";
import { attachNavKeys } from "./keys";
import type { NavKey, NavTarget } from "./keys";
import { BUILDER_ISLAND_EXTRA, BUILDER_SAVE_EVENT } from "./lesson";
import type { IslandPatch } from "./lesson";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_START,
  arrowDirection,
  boxOfCell,
  cameraPose,
  createTouchLog,
  digCell,
  facing,
  followTarget,
  isBuried,
  moveCursor,
  putCell,
  stampOrigin,
  startCursor,
  steadyPalette,
  turn,
} from "./logic";
import type { Cell, CellBox, Pose, Quarter } from "./logic";
import { createBuilderView } from "./view";
import type { BuilderView } from "./view";

/** Play time between autosaves (PLAN §6.6). */
export const AUTOSAVE_MS: Ms = 30_000;
/**
 * How long after a word runs one Space is still the habit space between words. Later than this,
 * Space is a deliberate `put`.
 */
export const HABIT_MS: Ms = 1500;
/** How long a hint stays up without another key. */
export const HINT_MS: Ms = 5000;
/** Camera glides: following the cursor, and a quarter turn. Snaps under reduced motion. */
const FOLLOW_MS: Ms = 220;
const TURN_MS: Ms = 360;

export interface BuilderOptions {
  /** The blueprints on offer. Default: {@link blueprintsFor} (none until M4-08). */
  blueprints?: readonly BuilderBlueprint[];
  /** Where the arrow and Page keys come from. Default: `window` when there is one. */
  keys?: NavTarget | null;
}

/** Builder also hands out its session's read model (`__vt.session()`), and can be left. */
export interface BuilderInstance extends ModeInstance {
  /** Null until the island is on screen, and for a damaged island. */
  session(): SessionView | null;
  /**
   * Ends the visit: finishes the practice session and calls `ctx.finish` with it and the last
   * island save. The play host calls this when the child leaves; later calls do nothing.
   */
  leave(): void;
}

type AtlasScene = SceneHandle & { atlas(): Atlas | null };
const hasAtlas = (s: SceneHandle): s is AtlasScene => "atlas" in s && typeof s.atlas === "function";

type DirtyScene = SceneHandle & { markDirty(x: number, y: number, z: number): void };
const canMarkDirty = (s: SceneHandle): s is DirtyScene =>
  "markDirty" in s && typeof s.markDirty === "function";

type FreeCamera = CameraRig & { moveTo(to: Readonly<Pose>, opts?: { durationMs?: Ms }): void };
const canMoveTo = (c: CameraRig): c is FreeCamera =>
  "moveTo" in c && typeof c.moveTo === "function";

const CAMERA_KEYS = new Set(["[", "]", "-", "=", "+", "_"]);

export function create(ctx: ModeContext, opts: BuilderOptions = {}): BuilderInstance {
  const { band, settings, scene, hud, audio, bus, profile } = ctx;
  const frozen = ctx.params["frozen"] === true;
  const reduced = (): boolean => reducedMotion(settings.reducedMotion);
  const lookup = islandBlocks(blocks);
  const defById = new Map<BlockId, BlockDef>(blocks.map((b) => [b.id, b]));
  const placeable = blocks.filter((b) => b.tags.includes("placeable"));
  const placeableIds = placeable.map((b) => b.id);
  const blueprints = opts.blueprints ?? blueprintsFor(profile);
  const vocab = buildVocabulary({
    blocks: placeable,
    blueprints: blueprints.map((b) => b.typedName),
    band,
  });
  const nameOf = (id: BlockId): string => {
    const def = defById.get(id);
    return def ? t(def.nameKey) : id;
  };

  // --- the island ---

  let status: BuilderHudSlice["status"] = "loading";
  let editor: IslandEditor | null = null;
  try {
    // A fresh island only for a profile that has none. A saved one that won't open is left alone.
    const island = profile.island ?? createIsland(profile.id, lookup, ctx.clock.epoch());
    editor = openIsland({
      island,
      inventory: profile.inventory,
      blocks: lookup,
      profileId: profile.id,
    });
  } catch (err) {
    console.warn("[builder] the saved island did not open; leaving it untouched", err);
    status = "damaged";
  }
  /** True once this visit changed the island, so leaving writes it even after a failed autosave. */
  let edited = false;
  let sinceSave: Ms = 0;
  const touches = createTouchLog(UNDO_LIMIT);

  const patch = (): IslandPatch | null => {
    if (editor === null) return null;
    return { island: editor.save(ctx.clock.epoch()), inventory: editor.inventory() };
  };

  /** Sends the island out to be saved, when something changed since the last time. */
  const autosave = (): void => {
    sinceSave = 0;
    if (editor === null || !editor.dirty) return;
    const p = patch();
    if (p !== null) bus.emit(BUILDER_SAVE_EVENT, p);
  };

  // --- the practice session ---

  const session = createSession(
    {
      policy: "stay",
      targeting: "sequential",
      caseSensitive: false,
      end: { kind: "manual" },
      mode: "builder",
      seed: ctx.rng.seed,
    },
    [],
  );
  let summary: SessionSummary | null = null;
  /** The session is paused between commands. */
  let parked = false;
  let commands = 0;
  /** Keys of the line being typed: the ones that went in, and the ones that didn't fit. */
  let keys: { input: KeyInput; accepted: boolean }[] = [];
  /** Letters taken quietly after a Sprout code (the rest of the block's name), newest last. */
  let quiet: KeyInput[] = [];
  /** How long one Space after a word that ran still counts as the habit space. */
  let habitLeft: Ms = 0;

  const emit = (events: readonly EngineEvent[]): void => {
    for (const e of events) {
      if (e.type === "sessionEnd") summary = e.summary;
      bus.emit("engine", e);
    }
  };

  /**
   * Takes the first `n` letters of `text` from the quietly taken keys: they turned out to start
   * this word, so they are its first keys.
   */
  const adopt = (n: number, text: string): void => {
    const want = Array.from(text).slice(0, n);
    const found: typeof keys = [];
    for (const q of quiet) {
      if (found.length < want.length && q.key.toLowerCase() === want[found.length]) {
        found.push({ input: q, accepted: true });
      }
    }
    keys = found;
  };

  /** Feeds a finished command to the session as one target. */
  const record = (text: string): void => {
    const typed = keys.map((k) => k.input);
    keys = [];
    const first = typed[0];
    const last = typed.at(-1);
    if (first === undefined || last === undefined || summary !== null) return;
    if (parked) emit(session.resume(first.t));
    commands += 1;
    const id = `command-${commands}`;
    session.addTargets([{ id, text, trailingSpace: false }]);
    for (const k of typed) emit(session.feed(k));
    // Every command's own keys complete it; this only guards the queue against a stuck target.
    if (session.view().active?.id === id) emit(session.removeTarget(id, last.t));
    emit(session.pause(last.t));
    parked = true;
  };

  // --- state ---

  let disposed = false;
  let paused = false;
  let left = false;
  let view: BuilderView | null = null;
  let line: LineState = EMPTY_LINE;
  let hint: BuilderHint | null = null;
  let hintLeft: Ms = 0;
  let armed: BlockId | null = null;
  let cursor: Cell = { x: 0, y: 0, z: 0 };
  let target: Cell = { x: 0, y: 0, z: 0 };
  let quarter: Quarter = 0;
  let zoom = ZOOM_START;
  let shown: BlockId[] = [];
  let inventory: Record<BlockId, number> = editor?.inventory() ?? {};

  /** Something other than typing happened: no habit space is expected, no name being finished. */
  const calm = (): void => {
    line = settled(line);
    quiet = [];
    habitLeft = 0;
  };

  const live = (): boolean => status === "ready" && !paused && !left && !disposed;

  // --- HUD ---

  const publish = (): void => {
    shown = steadyPalette(shown, inventory, placeableIds, undefined, armed);
    const palette: PaletteItem[] = shown.map((block) => ({
      block,
      name: nameOf(block),
      word: vocab.wordOf(block) ?? "",
      count: inventory[block] ?? 0,
    }));
    const slice: BuilderHudSlice = {
      status,
      band,
      line: line.text,
      completion: completionOf(line.text, vocab),
      waits: waitsForSpace(line.text, vocab),
      hint,
      armed,
      palette,
      layer: cursor.y + 1,
      facing: facing(quarter),
      undo: editor?.undoDepth ?? 0,
    };
    hud.set({ custom: { ...hud.get().custom, [BUILDER_SLICE]: slice } });
  };

  const say = (f: Feedback | null, tone: BuilderHint["tone"] = "info"): void => {
    hint = f === null ? null : { ...f, tone };
    hintLeft = f === null ? 0 : HINT_MS;
  };

  // --- scene ---

  const applyCamera = (durationMs: Ms): void => {
    const camera = scene.camera;
    if (!canMoveTo(camera)) return;
    camera.moveTo(cameraPose(target, quarter, zoom), { durationMs });
  };

  const showCursor = (): void => {
    const grid = editor?.grid ?? null;
    view?.setCursor(cursor, grid !== null && isBuried(grid, cursor));
    const at = grid === null || armed === null ? null : putCell(grid, cursor);
    view?.setGhost(armed === null ? null : (lookup.numOf(armed) ?? null), at);
    const next = followTarget(target, cursor);
    if (next.x !== target.x || next.y !== target.y || next.z !== target.z) {
      target = next;
      applyCamera(FOLLOW_MS);
    }
    scene.requestRender();
  };

  /** Redraws the chunks a box of cells belongs to. */
  const redraw = (box: CellBox | null): void => {
    if (editor === null) return;
    if (box === null || !canMarkDirty(scene)) {
      // No per-cell redraw on this scene (or no record of the cells): show the grid again.
      void scene.loadDiorama("island", editor.grid).catch(() => undefined);
      return;
    }
    for (let y = box.min.y; y <= box.max.y; y++) {
      for (let z = box.min.z; z <= box.max.z; z++) {
        for (let x = box.min.x; x <= box.max.x; x++) scene.markDirty(x, y, z);
      }
    }
  };

  // --- commands ---

  const afterEdit = (box: CellBox | null): void => {
    if (editor === null) return;
    edited = true;
    inventory = editor.inventory();
    redraw(box);
  };

  /** A kind line for an edit the island refused. */
  const refusal = (res: Extract<EditResult, { ok: false }>, block: BlockId | null): Feedback => {
    switch (res.reason) {
      case "not-enough": {
        const [id, count] = Object.entries(res.missing ?? {}).toSorted(
          (a, b) => b[1] - a[1],
        )[0] ?? [block ?? "", 1];
        return block !== null && id === block && count === 1
          ? { key: "builder.hint.noneLeft", params: { name: nameOf(id) } }
          : { key: "builder.hint.needMore", params: { count, name: nameOf(id) } };
      }
      case "out-of-bounds":
        return { key: "builder.hint.noRoom" };
      case "empty":
        return { key: "builder.hint.nothingToDig" };
      case "nothing-to-do":
        return { key: "builder.hint.alreadyThere" };
      case "occupied":
        return { key: "builder.hint.tooHigh" };
      default:
        return { key: "builder.hint.cantMove" };
    }
  };

  const put = (): void => {
    if (editor === null) return;
    if (armed === null) {
      say({ key: "builder.hint.pickFirst" });
      return;
    }
    const cell = putCell(editor.grid, cursor);
    if (cell === null) {
      say({ key: "builder.hint.tooHigh" });
      return;
    }
    const def = defById.get(armed);
    if (def?.shape === "sprig") {
      // A flower sits on something: never in the air, and never on another flower.
      const under = lookup.idOf(editor.grid.get(cell.x, cell.y - 1, cell.z));
      if (under === undefined || defById.get(under)?.shape === "sprig") {
        say({ key: "builder.hint.needsGround" });
        return;
      }
    }
    const res = editor.apply({ kind: "place", ...cell, block: armed });
    if (!res.ok) {
      say(refusal(res, armed));
      return;
    }
    touches.push(boxOfCell(cell));
    cursor = cell;
    audio.sfx("place", def ? { material: def.material } : undefined);
    say(null);
    afterEdit(boxOfCell(cell));
  };

  const dig = (): void => {
    if (editor === null) return;
    const cell = digCell(editor.grid, cursor);
    if (cell === null) {
      say({ key: "builder.hint.nothingToDig" });
      return;
    }
    const id = lookup.idOf(editor.grid.get(cell.x, cell.y, cell.z));
    const res = editor.apply({ kind: "remove", ...cell });
    if (!res.ok) {
      say(refusal(res, null));
      return;
    }
    touches.push(boxOfCell(cell));
    cursor = cell;
    const def = id === undefined ? undefined : defById.get(id);
    audio.sfx("chip", def ? { material: def.material } : undefined);
    if (id !== undefined) {
      scene.fx.burst(
        { x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 },
        { blockId: id, count: 6, speed: 0.6 },
      );
      // The first block a child picks up is ready to put down again.
      if (armed === null && placeableIds.includes(id)) armed = id;
    }
    say(null);
    afterEdit(boxOfCell(cell));
  };

  const undo = (): void => {
    if (editor === null) return;
    if (!editor.undo()) {
      say({ key: "builder.hint.nothingToUndo" });
      return;
    }
    audio.sfx("undo");
    // Backspace one time too many also lands here, so always say what happened.
    say({ key: "builder.hint.undone" });
    afterEdit(touches.pop());
  };

  const move = (dir: Direction, steps: number): void => {
    if (editor === null) return;
    const { cell, moved } = moveCursor(cursor, dir, steps, editor.footprint, editor.grid.sy);
    if (moved === 0) {
      say({
        key:
          dir === "up"
            ? "builder.hint.top"
            : dir === "down"
              ? "builder.hint.bottom"
              : "builder.hint.edge",
      });
      return;
    }
    cursor = cell;
    audio.sfx("click", { gain: 0.5 });
    say(null);
  };

  const arm = (block: BlockId): void => {
    if ((inventory[block] ?? 0) <= 0) {
      say({ key: "builder.hint.noneYet", params: { name: nameOf(block) } });
      return;
    }
    armed = block;
    audio.sfx("pop", { gain: 0.6 });
    say(null);
  };

  const stamp = (name: string): void => {
    const bp = blueprints.find((b) => b.typedName === name);
    if (editor === null || bp === undefined) return;
    const at = stampOrigin(cursor, bp.grid);
    const res = editor.apply({ kind: "stamp", ...at, blueprint: bp.grid });
    if (!res.ok) {
      say(refusal(res, null));
      return;
    }
    const box: CellBox = {
      min: at,
      max: { x: at.x + bp.grid.sx - 1, y: at.y + bp.grid.sy - 1, z: at.z + bp.grid.sz - 1 },
    };
    touches.push(box);
    audio.sfx("place");
    audio.sfx("star", { gain: 0.35 });
    say({ key: "builder.hint.built", params: { name: t(bp.nameKey) } }, "cheer");
    afterEdit(box);
  };

  const run = (command: Command): void => {
    switch (command.kind) {
      case "put":
        put();
        break;
      case "dig":
        dig();
        break;
      case "undo":
        undo();
        break;
      case "move":
        move(command.dir, command.steps);
        break;
      case "arm":
        arm(command.block);
        break;
      case "blueprint":
        stamp(command.name);
        break;
      default:
        break;
    }
  };

  /** `[` `]` turn the camera a quarter; `-` `=` zoom. Only on an empty line. */
  const cameraKey = (key: string): void => {
    if (key === "[" || key === "]") {
      quarter = turn(quarter, key === "]" ? 1 : -1);
      applyCamera(TURN_MS);
    } else {
      const next = Math.max(
        ZOOM_MIN,
        Math.min(ZOOM_MAX, zoom + (key === "-" || key === "_" ? -1 : 1)),
      );
      if (next === zoom) return;
      zoom = next;
      applyCamera(FOLLOW_MS);
    }
    scene.requestRender();
  };

  const onNav = (nav: NavKey): void => {
    if (!live()) return;
    calm();
    if (nav === "up" || nav === "down") move(nav, 1);
    else move(arrowDirection(nav, quarter), 1);
    showCursor();
    publish();
  };
  const offKeys = attachNavKeys(
    opts.keys === undefined ? (typeof window === "undefined" ? null : window) : opts.keys,
    live,
    onNav,
  );

  // --- world ---

  const ready = (): void => {
    if (disposed || status !== "loading" || editor === null) return;
    status = "ready";
    cursor = startCursor(editor.grid, editor.footprint);
    target = { ...cursor };
    armed = steadyPalette([], inventory, placeableIds, 1)[0] ?? null;
    const three = scene.three;
    if (three && hasAtlas(scene)) {
      view = createBuilderView({
        scene: three.scene,
        atlas: () => scene.atlas(),
        reducedMotion: reduced,
        frozen,
      });
    }
    scene.camera.preset("orbit", { durationMs: 0 });
    applyCamera(0);
    showCursor();
    const first = armed === null ? null : vocab.wordOf(armed);
    say(
      first === null || first === undefined
        ? { key: "builder.hint.welcomeEmpty" }
        : { key: "builder.hint.welcome", params: { word: first } },
    );
    // The welcome line stays until the first key.
    hintLeft = Number.POSITIVE_INFINITY;
    publish();
  };

  return {
    start() {
      scene.setEnvironment({ biome: "meadow", timeOfDay: "day" });
      publish();
      if (editor === null) return;
      scene.loadDiorama("island", editor.grid).then(ready, (err: unknown) => {
        console.warn("[builder] the island did not draw; building without the picture", err);
        ready();
      });
    },

    input(k: KeyInput) {
      if (!live() || editor === null) return;
      if (k.key === "Undo" || (k.key === "Backspace" && line.text === "")) {
        line = EMPTY_LINE;
        keys = [];
        quiet = [];
        undo();
      } else if (line.text === "" && CAMERA_KEYS.has(k.key)) {
        calm();
        cameraKey(k.key);
      } else {
        const out = typeKey(line, k.key, vocab);
        // A letter taken quietly as the rest of a Sprout block's name.
        const quietly = out.state.eaten.length > line.eaten.length;
        let before = line.text;
        if (out.replayed > 0) {
          // Those quiet letters began a new word after all: they are its first keys.
          adopt(out.replayed, out.run === null ? out.state.text : (out.ran ?? ""));
          before = Array.from(out.state.text).slice(0, out.replayed).join("");
        }
        const wholeReplay =
          out.run !== null && out.replayed > 0 && Array.from(out.ran ?? "").length === out.replayed;
        line = out.state;
        if (quietly) quiet.push(k);
        else quiet = [];
        habitLeft = line.habit ? HABIT_MS : 0;
        if (k.key === "Backspace") {
          // A change of mind: forget the letter taken back and the misses typed after it.
          while (keys.length > 0 && keys.at(-1)?.accepted === false) keys.pop();
          keys.pop();
        } else if (!wholeReplay && (out.run === null || (k.key !== " " && k.key !== "Enter"))) {
          // The key that only runs the line is not part of the word, and neither is the habit
          // space. A miss on an empty line has no word to belong to.
          const taken = out.accepted && (out.run !== null || line.text !== before);
          if (taken || (!out.accepted && before !== "")) keys.push({ input: k, accepted: taken });
        }
        if (out.feedback !== null) {
          say(out.feedback);
          audio.sfx("thud", { gain: 0.4 });
        } else if (out.accepted) {
          say(null);
        }
        if (out.run !== null) {
          if (out.ran === null) keys = [];
          else record(out.ran);
          run(out.run);
        }
      }
      showCursor();
      publish();
    },

    frame(dtMs: Ms) {
      if (disposed || status !== "ready") return;
      view?.frame(dtMs);
      if (hintLeft > 0 && Number.isFinite(hintLeft)) {
        hintLeft -= dtMs;
        if (hintLeft <= 0) {
          hint = null;
          publish();
        }
      }
      if (habitLeft > 0) {
        habitLeft -= dtMs;
        // After a moment's wait, Space is a deliberate `put` again.
        if (habitLeft <= 0) line = { ...line, habit: false };
      }
      sinceSave += dtMs;
      if (sinceSave >= AUTOSAVE_MS) autosave();
    },

    pause() {
      if (paused) return;
      paused = true;
      // A half-typed word is dropped. Its keys can't be timed across the pause, and feeding only
      // the letters typed afterwards would count them as slips on the word's first letters.
      line = EMPTY_LINE;
      keys = [];
      quiet = [];
      habitLeft = 0;
      if (status === "ready") publish();
      // A pause is also what a hidden or closing tab looks like: save now.
      autosave();
    },

    resume() {
      paused = false;
    },

    leave() {
      if (left) return;
      left = true;
      emit(session.end(ctx.clock.now()));
      if (summary === null) return;
      const last = edited ? patch() : null;
      ctx.finish({
        summary,
        loot: {},
        stars: 0,
        ...(last !== null && { extra: { [BUILDER_ISLAND_EXTRA]: last } }),
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      offKeys();
      view?.dispose();
      view = null;
    },

    session: () => (status === "ready" ? session.view() : null),
  };
}
