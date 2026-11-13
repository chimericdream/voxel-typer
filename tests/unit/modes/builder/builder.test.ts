/**
 * Builder mode end to end, without a renderer (task M4-07): the real command line, island
 * editor, typing session, HUD store and play host, on a fake scene whose `three` is null.
 */
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { createSilentAudio } from "../../../../src/app/audio";
import { createBreakReminder } from "../../../../src/app/break-reminder";
import { fixedStepClock } from "../../../../src/app/clock";
import { createHudStore } from "../../../../src/app/hud";
import { createPlayHost } from "../../../../src/app/play-host";
import type { PlayStatus } from "../../../../src/app/play-host";
import type { AudioApi, SfxName } from "../../../../src/audio/types";
import { blocks } from "../../../../src/content/blocks";
import {
  ISLAND_MAX,
  countBlocks,
  createIsland,
  footprint,
  islandBlocks,
} from "../../../../src/engine/island";
import type { EngineEvent } from "../../../../src/engine/types";
import { mode } from "../../../../src/modes/builder";
import {
  AUTOSAVE_MS,
  HABIT_MS,
  HINT_MS,
  RING_MS,
  SWEEP_MS,
  TURN_MS,
  create,
} from "../../../../src/modes/builder/builder";
import type { BuilderInstance } from "../../../../src/modes/builder/builder";
import type { BuilderBlueprint } from "../../../../src/modes/builder/blueprints";
import { builderHudOf } from "../../../../src/modes/builder/hud";
import type { BuilderHudSlice } from "../../../../src/modes/builder/hud";
import type { NavEvent, NavTarget } from "../../../../src/modes/builder/keys";
import { BUILDER_LESSON } from "../../../../src/modes/builder/lesson";
import type { ModeContext, ModeResult } from "../../../../src/modes/types";
import { VoxelGrid } from "../../../../src/render/mesher/voxel-grid";
import type { Profile } from "../../../../src/save/schema";
import { createMemoryStore } from "../../../../src/save/store";
import { fakeScene, fixture, flush } from "../../app/helpers";

const lookup = islandBlocks(blocks);
const num = (id: string): number => lookup.numOf(id) ?? -1;
/** Where the cursor starts on a new island: the middle of the clearing, one above the grass. */
const START = { x: 24, y: 5, z: 24 };

interface FakeKeys extends NavTarget {
  /** Sends a keydown. Returns whether Builder cancelled its default. */
  press(key: string, over?: Partial<NavEvent>): boolean;
  listeners(): number;
}

function fakeKeys(): FakeKeys {
  const fns = new Set<(e: KeyboardEvent) => void>();
  return {
    addEventListener: (_type, fn) => void fns.add(fn),
    removeEventListener: (_type, fn) => void fns.delete(fn),
    listeners: () => fns.size,
    press(key, over = {}) {
      let prevented = false;
      const e: NavEvent = {
        key,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        defaultPrevented: false,
        preventDefault: () => {
          prevented = true;
        },
        ...over,
      };
      // reason: the listener reads only NavEvent's fields; a full KeyboardEvent needs a DOM
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      for (const fn of fns) fn(e as unknown as KeyboardEvent);
      return prevented;
    },
  };
}

interface Visit {
  play: ReturnType<typeof createPlayHost>;
  instance(): BuilderInstance;
  scene: ReturnType<typeof fakeScene>;
  keys: FakeKeys;
  saves: Profile[];
  statuses: PlayStatus[];
  finished: ModeResult[];
  events: EngineEvent[];
  sfx: SfxName[];
  dirty: string[];
  loads: VoxelGrid[];
  moves: { yaw: number; distance: number; durationMs: number }[];
  /** The profile as the app has it now. */
  profile(): Profile;
  hud(): BuilderHudSlice;
  /** Types text; `>` is Enter, `<` is Backspace, `^` is Ctrl+Z. */
  type(text: string, gapMs?: number): void;
  /** Runs frames for `ms` of play time. */
  run(ms: number): void;
  grid(): VoxelGrid;
}

async function visit(
  profile: Profile,
  over: { blueprints?: BuilderBlueprint[]; markDirty?: boolean; frozen?: boolean } = {},
): Promise<Visit> {
  const scene = fakeScene();
  const keys = fakeKeys();
  const hud = createHudStore();
  const saves: Profile[] = [];
  const statuses: PlayStatus[] = [];
  const finished: ModeResult[] = [];
  const events: EngineEvent[] = [];
  const sfx: SfxName[] = [];
  const dirty: string[] = [];
  const loads: VoxelGrid[] = [];
  const moves: Visit["moves"] = [];
  let current = profile;
  let instance: BuilderInstance | null = null;
  scene.loadDiorama = (_id, grid) => {
    loads.push(grid);
    return Promise.resolve();
  };
  scene.camera.moveTo = (to, o) =>
    void moves.push({ yaw: to.yaw, distance: to.distance, durationMs: o?.durationMs ?? 0 });
  if (over.markDirty !== false) {
    Object.assign(scene, {
      markDirty: (x: number, y: number, z: number) => void dirty.push(`${x},${y},${z}`),
    });
  }
  const audio: AudioApi = { ...createSilentAudio(), sfx: (name) => void sfx.push(name) };
  const play = createPlayHost({
    acquireScene: () => Promise.resolve(scene),
    resolveMode: () => ({
      id: mode.id,
      load: () =>
        Promise.resolve({
          create(ctx: ModeContext) {
            ctx.bus.on("engine", (e) => events.push(e));
            instance = create(ctx, {
              keys,
              ...(over.blueprints && { blueprints: over.blueprints }),
            });
            return instance;
          },
        }),
    }),
    hud,
    audio,
    clock: fixedStepClock(1000, 1),
    nextSeed: () => 7,
    frozen: over.frozen ?? true,
    record: false,
    reminder: createBreakReminder(),
    currentProfile: () => current,
    saveProfile: (p) => {
      current = p;
      saves.push(p);
      return Promise.resolve(true);
    },
    onStatus: (s) => statuses.push(s),
    onFinished: (r) => finished.push(r),
  });
  await play.start({ lesson: BUILDER_LESSON, profile });
  await flush();
  let now = 50_000;
  return {
    play,
    instance() {
      if (instance === null) throw new Error("no instance");
      return instance;
    },
    scene,
    keys,
    saves,
    statuses,
    finished,
    events,
    sfx,
    dirty,
    loads,
    moves,
    profile: () => current,
    hud() {
      const slice = builderHudOf(hud.get().custom);
      if (slice === null) throw new Error("no builder slice");
      return slice;
    },
    type(text, gapMs = 200) {
      for (const ch of text) {
        now += gapMs;
        const key = ch === ">" ? "Enter" : ch === "<" ? "Backspace" : ch === "^" ? "Undo" : ch;
        play.input({ key, t: now, shift: false });
      }
    },
    run(ms) {
      for (let left = ms; left > 0; left -= 100) scene.tick(100, 0);
    },
    grid() {
      const g = loads[0];
      if (g === undefined) throw new Error("island not loaded");
      return g;
    },
  };
}

const saved = (p: Profile): VoxelGrid => {
  if (p.island === null) throw new Error("no island saved");
  return VoxelGrid.fromJSON(p.island.grid);
};

const miner = fixture("meadow-done-miner");
const sprout = fixture("fresh-sprout");
const veteran = fixture("veteran-builder");
const withBlocks = (p: Profile, inventory: Record<string, number>): Profile => ({
  ...p,
  inventory,
});

describe("builder: the card's sequence", () => {
  it("planks, put, east 2, put, undo: one plank on the island, one fewer in the bag", async () => {
    const v = await visit(miner);
    expect(v.hud()).toMatchObject({ status: "ready", armed: "cobble", layer: START.y + 1 });
    v.type("planks");
    expect(v.hud().armed).toBe("oak-planks");
    v.type("put");
    expect(v.grid().get(START.x, START.y, START.z)).toBe(num("oak-planks"));
    v.type("east 2");
    v.type("put");
    expect(v.grid().get(START.x + 2, START.y, START.z)).toBe(num("oak-planks"));
    expect(v.hud().undo).toBe(2);
    v.type("undo");
    expect(v.grid().get(START.x + 2, START.y, START.z)).toBe(0);
    expect(v.hud()).toMatchObject({ undo: 1, line: "" });
    // Undo always says what happened (a Backspace too many lands here as well).
    expect(v.hud().hint).toEqual({ key: "builder.hint.undone", tone: "info" });
    expect(v.hud().palette.find((p) => p.block === "oak-planks")?.count).toBe(11);

    // Nothing is written until the island is left (or 30 s pass, or a pause).
    expect(v.saves).toEqual([]);
    v.play.quit();
    await flush();
    expect(v.saves).toHaveLength(1);
    const p = v.profile();
    expect(saved(p).get(START.x, START.y, START.z)).toBe(num("oak-planks"));
    expect(saved(p).get(START.x + 2, START.y, START.z)).toBe(0);
    expect(p.inventory).toEqual({ "oak-planks": 11, cobble: 30 });
    expect(p.island?.expansions).toBe(0);
    // The save store accepts the profile as written (its validator runs on every save).
    const store = createMemoryStore();
    await store.save(p);
    expect(await store.load(p.id)).toEqual(p);
    // The island's blocks plus the bag are what they were: one plank moved.
    const fresh = VoxelGrid.fromJSON(createIsland(miner.id, lookup, 0).grid);
    expect(countBlocks(saved(p), lookup)).toEqual({
      ...countBlocks(fresh, lookup),
      "oak-planks": 1,
    });
  });

  it("draws only the cells that changed", async () => {
    const v = await visit(miner);
    v.type("put");
    v.type("undo");
    const at = `${START.x},${START.y},${START.z}`;
    expect(v.dirty).toEqual([at, at]);
    expect(v.loads).toHaveLength(1);
  });

  it("without per-cell redraw, shows the grid again", async () => {
    const v = await visit(miner, { markDirty: false });
    v.type("put");
    expect(v.loads).toHaveLength(2);
    expect(v.loads[1]).toBe(v.loads[0]);
  });
});

describe("builder: putting and digging", () => {
  it("Space puts the block in hand; putting again builds a tower", async () => {
    const v = await visit(miner);
    v.type("   ");
    for (const dy of [0, 1, 2]) {
      expect(v.grid().get(START.x, START.y + dy, START.z)).toBe(num("cobble"));
    }
    expect(v.hud().layer).toBe(START.y + 3);
    expect(v.sfx.filter((s) => s === "place")).toHaveLength(3);
  });

  it("dig takes the block under the cursor into the bag, and digging again goes down", async () => {
    const v = await visit(sprout);
    expect(v.hud()).toMatchObject({ armed: null, palette: [] });
    expect(v.hud().hint?.key).toBe("builder.hint.welcomeEmpty");
    v.type("dig");
    expect(v.grid().get(START.x, START.y - 1, START.z)).toBe(0);
    // The first block picked up is in the hand, ready to put back.
    expect(v.hud()).toMatchObject({ armed: "grass", layer: START.y });
    expect(v.hud().palette).toEqual([{ block: "grass", name: "Grass", word: "gras", count: 1 }]);
    v.type("dig");
    expect(v.hud().palette.map((p) => p.block)).toEqual(["grass", "dirt"]);
    v.type("put");
    expect(v.grid().get(START.x, START.y - 2, START.z)).toBe(num("grass"));
  });

  it("a Sprout arms a block with its short code", async () => {
    const v = await visit(withBlocks(sprout, { dirt: 3, "oak-planks": 2 }));
    expect(v.hud().palette.map((p) => p.word)).toEqual(["dir", "pla"]);
    v.type("pla");
    expect(v.hud().armed).toBe("oak-planks");
    v.type("dirt");
    expect(v.hud()).toMatchObject({ armed: "dirt", line: "", hint: null });
  });

  it("a block the player has none of is not armed, and the line says where to find it", async () => {
    const v = await visit(miner);
    v.type("glass");
    expect(v.hud().armed).toBe("cobble");
    expect(v.hud().hint).toEqual({
      key: "builder.hint.noneYet",
      params: { name: "Glass" },
      tone: "info",
    });
  });

  it("the last block of a kind: the next put says so, and nothing changes", async () => {
    const v = await visit(withBlocks(miner, { brick: 1 }));
    v.type("  ");
    expect(v.grid().get(START.x, START.y + 1, START.z)).toBe(0);
    expect(v.hud().hint?.key).toBe("builder.hint.noneLeft");
    // The block in hand keeps its slot, showing 0.
    expect(v.hud().palette).toEqual([{ block: "brick", name: "Brick", word: "brick", count: 0 }]);
    // Still listed at 0, so the bag screen knows the kind.
    v.play.quit();
    await flush();
    expect(v.profile().inventory).toEqual({ brick: 0 });
  });

  it("with nothing in hand, put asks for a block first", async () => {
    const v = await visit(sprout);
    v.type("put");
    expect(v.hud().hint?.key).toBe("builder.hint.pickFirst");
  });

  it("a flower needs a block under it, and not another flower", async () => {
    const v = await visit(withBlocks(miner, { "red-blooms": 3 }));
    v.keys.press("PageUp");
    v.type("put");
    expect(v.hud().hint?.key).toBe("builder.hint.needsGround");
    v.keys.press("PageDown");
    v.type("put");
    expect(v.grid().get(START.x, START.y, START.z)).toBe(num("red-blooms"));
    v.type("put");
    expect(v.hud().hint?.key).toBe("builder.hint.needsGround");
    expect(v.grid().get(START.x, START.y + 1, START.z)).toBe(0);
  });

  it("at the top of the island, put says that is as high as it goes", async () => {
    const v = await visit(miner);
    for (let i = 0; i < ISLAND_MAX.sy; i++) v.keys.press("PageUp");
    expect(v.hud().layer).toBe(ISLAND_MAX.sy);
    expect(v.hud().hint?.key).toBe("builder.hint.top");
    v.type("put");
    expect(v.grid().get(START.x, ISLAND_MAX.sy - 1, START.z)).toBe(num("cobble"));
    v.type("put");
    expect(v.hud().hint?.key).toBe("builder.hint.tooHigh");
  });
});

/** The palette's blocks, in slot order. */
const slots = (x: Visit): string[] => x.hud().palette.map((p) => p.block);

/** Island blocks plus the bag, per block id. */
const totals = (p: Profile): Record<string, number> => {
  const out: Record<string, number> = { ...countBlocks(saved(p), lookup) };
  for (const [id, n] of Object.entries(p.inventory)) out[id] = (out[id] ?? 0) + n;
  return out;
};

describe("builder: every dug block lands in the bag and the palette (M4-FIX-1)", () => {
  /** Six kinds, each owned by the dozen: a full palette with no grass in it. */
  const full = {
    cobble: 30,
    "oak-planks": 20,
    stone: 18,
    dirt: 16,
    brick: 14,
    glass: 12,
  };

  it("grass dug with a full palette and none in the bag shows up, and is saved", async () => {
    const v = await visit(withBlocks(miner, full));
    expect(v.hud().palette.map((p) => p.block)).not.toContain("grass");
    v.type("dig");
    expect(v.grid().get(START.x, START.y - 1, START.z)).toBe(0);
    const grass = v.hud().palette.find((p) => p.block === "grass");
    expect(grass).toMatchObject({ count: 1, word: "grass" });
    expect(v.hud().palette).toHaveLength(6);
    // The block in hand keeps its slot; the least-owned block makes room.
    expect(v.hud().palette.map((p) => p.block)).toContain("cobble");
    expect(v.hud().palette.map((p) => p.block)).not.toContain("glass");
    // Typing on doesn't push it out again.
    v.type("west 1");
    expect(v.hud().palette.map((p) => p.block)).toContain("grass");

    v.play.quit();
    await flush();
    const p = v.profile();
    expect(p.inventory).toEqual({ ...full, grass: 1 });
    // Nothing gone: the island plus the bag are what they were, block by block.
    const fresh = VoxelGrid.fromJSON(createIsland(miner.id, lookup, 0).grid);
    const before: Record<string, number> = { ...countBlocks(fresh, lookup) };
    for (const [id, n] of Object.entries(full)) before[id] = (before[id] ?? 0) + n;
    expect(totals(p)).toEqual(before);
  });

  it("digging down through grass and dirt keeps each, and the next visit opens with them", async () => {
    const v = await visit(withBlocks(miner, full));
    v.type("digdigdig");
    v.play.quit();
    await flush();
    const after = v.profile();
    expect(after.inventory["grass"]).toBe(1);
    expect(after.inventory["dirt"]).toBe(full.dirt + 2);
    const again = await visit(after);
    expect(again.hud().palette.map((p) => p.block)).toContain("dirt");
    again.type("grass");
    expect(again.hud().armed).toBe("grass");
    expect(again.hud().palette.find((p) => p.block === "grass")?.count).toBe(1);
  });

  it("digging a hole in a full palette keeps every new kind in view, and after a reopen (review)", async () => {
    // The reviewer's bag: six kinds, no grass and no dirt.
    const bag = { cobble: 30, "oak-planks": 20, stone: 18, brick: 14, glass: 12, sand: 10 };
    const v = await visit(withBlocks(miner, bag));
    v.type("dig");
    expect(slots(v)).toContain("grass");
    v.type("dig");
    expect(slots(v)).toEqual(expect.arrayContaining(["grass", "dirt"]));
    expect(slots(v)).toHaveLength(6);
    const shown = slots(v);
    v.play.quit();
    await flush();
    const after = v.profile();
    expect(after.inventory).toMatchObject({ grass: 1, dirt: 1 });
    // The slots are saved with the island, and the next visit opens with them.
    expect(after.island?.palette).toEqual(shown);
    const again = await visit(after);
    expect(slots(again)).toEqual(shown);
    expect(slots(again)).toEqual(expect.arrayContaining(["grass", "dirt"]));
  });

  it("after any run of digs and moves, the newest dug kinds are all in the palette (property)", async () => {
    const bag = { cobble: 30, "oak-planks": 20, stone: 18, brick: 14, glass: 12, sand: 10 };
    const words = ["east 1", "west 1", "north 1", "south 1", "dig", "dig", "dig"] as const;
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...words), { minLength: 1, maxLength: 12 }),
        async (typed) => {
          const v = await visit(withBlocks(miner, bag));
          /** Kinds dug, newest last, each once. */
          const dug: string[] = [];
          for (const w of typed) {
            const g = v.grid();
            const before = Array.from(g.data);
            v.type(w);
            const at = before.findIndex((n, i) => n !== 0 && g.data[i] === 0);
            const id = at === -1 ? undefined : lookup.idOf(before[at] ?? 0);
            if (id !== undefined) dug.splice(0, dug.length, ...dug.filter((d) => d !== id), id);
            // The block in hand keeps one slot; the five newest dug kinds have the rest.
            const now = slots(v);
            for (const kind of dug.slice(-5))
              expect(now, `${typed.join(",")}: ${kind}`).toContain(kind);
          }
        },
      ),
      { seed: 184, numRuns: 25 },
    );
  });

  it("a block armed by name from outside a full palette gets a slot", async () => {
    const v = await visit(withBlocks(miner, { ...full, sand: 2 }));
    expect(v.hud().palette.map((p) => p.block)).not.toContain("sand");
    v.type("sand");
    expect(v.hud().armed).toBe("sand");
    expect(v.hud().palette.find((p) => p.block === "sand")?.count).toBe(2);
    expect(v.hud().palette).toHaveLength(6);
  });

  it("water is left where it is, with a kind word, and nothing changes", async () => {
    const v = await visit(miner);
    const g = v.grid();
    const water = num("water");
    let at: { x: number; z: number } | null = null;
    for (let z = 0; z < g.sz && at === null; z++) {
      for (let x = 0; x < g.sx; x++) {
        if (g.get(x, 4, z) === water) {
          at = { x, z };
          break;
        }
      }
    }
    if (at === null) throw new Error("no pond");
    // Walk there in steps of up to 9, then stand one above the water.
    const walk = (d: number, plus: string, minus: string): void => {
      for (let left = Math.abs(d); left > 0; left -= 9) {
        v.type(`${d > 0 ? plus : minus} ${Math.min(9, left)}`);
      }
    };
    walk(at.x - START.x, "east", "west");
    walk(at.z - START.z, "south", "north");
    expect(v.hud().layer).toBe(START.y + 1);
    v.type("dig");
    expect(v.hud().hint).toEqual({
      key: "builder.hint.cantPickUp",
      params: { name: "Water" },
      tone: "info",
    });
    expect(g.get(at.x, 4, at.z)).toBe(water);
    expect(v.hud().undo).toBe(0);
    v.play.quit();
    await flush();
    expect(v.profile().island).toBeNull();
  });
});

describe("builder: the habit space (review B1)", () => {
  it("planks put east 2 put, typed with spaces: two blocks, not five", async () => {
    const v = await visit(miner);
    v.type("planks put east 2 put");
    expect(v.grid().get(START.x, START.y, START.z)).toBe(num("oak-planks"));
    expect(v.grid().get(START.x + 2, START.y, START.z)).toBe(num("oak-planks"));
    expect(v.hud().palette.find((p) => p.block === "oak-planks")?.count).toBe(10);
    expect(v.hud().undo).toBe(2);
    expect(v.sfx.filter((s) => s === "place")).toHaveLength(2);
    expect(v.sfx).not.toContain("thud");
    // The spaces are not part of the words, and not slips.
    v.type(" undo ");
    v.play.quit();
    await flush();
    expect(v.profile().history.at(-1)).toMatchObject({
      keystrokes: 22,
      correct: 22,
      errors: 0,
      targetsCompleted: 5,
    });
    expect(v.profile().inventory["oak-planks"]).toBe(11);
  });

  it("a second Space is a deliberate put", async () => {
    const v = await visit(miner);
    v.type("put  ");
    expect(v.hud().undo).toBe(2);
  });

  it("after a moment's wait, Space is put again", async () => {
    const v = await visit(miner);
    v.type("put");
    v.run(HABIT_MS.miner - 200);
    v.type(" ");
    expect(v.hud().undo).toBe(1);
    v.type("put");
    v.run(HABIT_MS.miner + 200);
    v.type(" ");
    expect(v.hud().undo).toBe(3);
  });

  it("the wait depends on the band: a Sprout gets longest (review N-A)", () => {
    expect(HABIT_MS).toEqual({ sprout: 3000, miner: 2000, builder: 1500 });
  });

  it("a slow Sprout's Space after a look at the island is still the habit space", async () => {
    const v = await visit(withBlocks(sprout, { dirt: 5 }));
    v.type("put");
    // Longer than a Miner's window, inside a Sprout's.
    v.run(HABIT_MS.miner + 500);
    v.type(" ");
    expect(v.hud().undo).toBe(1);
    v.type("put");
    v.run(HABIT_MS.sprout + 200);
    v.type(" ");
    expect(v.hud().undo).toBe(3);
  });

  it("after an arrow key, a camera key or a pause, Space is put", async () => {
    const v = await visit(miner);
    v.type("put");
    v.keys.press("ArrowRight");
    v.type(" ");
    expect(v.grid().get(START.x + 1, START.y, START.z)).toBe(num("cobble"));
    v.type("east 1");
    v.type("] ");
    expect(v.grid().get(START.x + 2, START.y, START.z)).toBe(num("cobble"));
    v.type("east 1");
    v.play.pause(1);
    v.play.resume(2);
    v.type(" ");
    expect(v.grid().get(START.x + 3, START.y, START.z)).toBe(num("cobble"));
  });
});

describe("builder: undo", () => {
  it("Ctrl+Z and Backspace on an empty line both undo; with nothing left it says so", async () => {
    const v = await visit(miner);
    v.type("  ");
    v.type("^");
    expect(v.grid().get(START.x, START.y + 1, START.z)).toBe(0);
    v.type("<");
    expect(v.grid().get(START.x, START.y, START.z)).toBe(0);
    expect(v.sfx.filter((s) => s === "undo")).toHaveLength(2);
    v.type("<");
    expect(v.hud().hint?.key).toBe("builder.hint.nothingToUndo");
  });

  it("Backspace on a half-typed word edits the word and undoes nothing", async () => {
    const v = await visit(miner);
    v.type(" ");
    v.type("pla<");
    expect(v.hud().line).toBe("pl");
    expect(v.grid().get(START.x, START.y, START.z)).toBe(num("cobble"));
  });
});

describe("builder: moving", () => {
  it("typed directions use the island's compass", async () => {
    const v = await visit(miner);
    v.type("north 3");
    v.type("west>");
    v.type("up 2");
    v.type("put");
    expect(v.grid().get(START.x - 1, START.y + 2, START.z - 3)).toBe(num("cobble"));
  });

  it("stops at the edge of the island with a kind line", async () => {
    const v = await visit(miner);
    v.type("east 9");
    v.type("east 9");
    expect(v.hud().hint).toBeNull();
    v.type("east 9");
    expect(v.hud().hint?.key).toBe("builder.hint.edge");
    v.type("put");
    // The plot's last column is x = 35.
    const column = Array.from({ length: ISLAND_MAX.sy }, (_, y) => v.grid().get(35, y, START.z));
    expect(column).toContain(num("cobble"));
  });

  it("the arrows follow the screen, and PageUp / PageDown change the layer", async () => {
    const v = await visit(miner);
    expect(v.keys.press("ArrowRight")).toBe(true);
    v.keys.press("ArrowUp");
    v.keys.press("PageUp");
    v.type(" ");
    expect(v.grid().get(START.x + 1, START.y + 1, START.z - 1)).toBe(num("cobble"));
    // After a quarter turn to the right, "right" on screen is south.
    v.type("]");
    v.keys.press("ArrowRight");
    v.type(" ");
    expect(v.grid().get(START.x + 1, START.y + 1, START.z)).toBe(num("cobble"));
  });

  it("leaves alone a key something else handled, and keys with Ctrl", async () => {
    const v = await visit(miner);
    expect(v.keys.press("ArrowRight", { defaultPrevented: true })).toBe(false);
    expect(v.keys.press("ArrowRight", { ctrlKey: true })).toBe(false);
    expect(v.keys.press("a")).toBe(false);
    v.type(" ");
    expect(v.grid().get(START.x, START.y, START.z)).toBe(num("cobble"));
  });

  it("the arrows do nothing while paused, and the listener goes with the mode", async () => {
    const v = await visit(miner);
    v.play.pause(1);
    expect(v.keys.press("ArrowRight")).toBe(false);
    v.play.resume(2);
    expect(v.keys.press("ArrowRight")).toBe(true);
    v.play.quit();
    expect(v.keys.listeners()).toBe(0);
  });
});

describe("builder: camera", () => {
  it("frames the cursor at the start, with no glide", async () => {
    const v = await visit(miner);
    expect(v.moves).toHaveLength(1);
    expect(v.moves[0]?.durationMs).toBe(0);
  });

  it("[ and ] turn a quarter, - and = zoom, only on an empty line", async () => {
    const v = await visit(miner);
    const start = v.moves[0];
    v.type("]");
    expect((start?.yaw ?? 0) - (v.moves.at(-1)?.yaw ?? 0)).toBeCloseTo(Math.PI / 2);
    expect(v.hud().facing).toBe("east");
    v.type("[");
    expect(v.hud().facing).toBe("north");
    v.type("=");
    expect(v.moves.at(-1)?.distance).toBeLessThan(start?.distance ?? 0);
    v.type("--");
    expect(v.moves.at(-1)?.distance).toBeGreaterThan(start?.distance ?? 0);
    const count = v.moves.length;
    v.type("pl]");
    expect(v.moves).toHaveLength(count);
    expect(v.hud().line).toBe("pl");
  });

  it("follows the cursor only once it has wandered", async () => {
    const v = await visit(miner);
    v.type("east 4");
    expect(v.moves).toHaveLength(1);
    v.type("east 4");
    expect(v.moves).toHaveLength(2);
  });
});

describe("builder: hints", () => {
  it("a key that doesn't fit gets a hint and a soft sound, and the line keeps its text", async () => {
    const v = await visit(miner);
    v.type("plx");
    expect(v.hud()).toMatchObject({ line: "pl", completion: "anks" });
    expect(v.hud().hint).toEqual({
      key: "builder.hint.keepGoing",
      params: { word: "planks" },
      tone: "info",
    });
    expect(v.sfx).toContain("thud");
    // The next key that fits clears it.
    v.type("a");
    expect(v.hud().hint).toBeNull();
  });

  it("a hint goes away by itself; the welcome line waits for the first key", async () => {
    const v = await visit(miner);
    expect(v.hud().hint).toMatchObject({ key: "builder.hint.welcome", params: { word: "cobble" } });
    v.run(HINT_MS * 2);
    expect(v.hud().hint?.key).toBe("builder.hint.welcome");
    v.type("o");
    expect(v.hud().hint?.key).toBe("builder.hint.tryWord");
    v.run(HINT_MS + 100);
    expect(v.hud().hint).toBeNull();
  });

  it("shows the Space key for a word that waits", async () => {
    const v = await visit(miner);
    v.type("blue");
    expect(v.hud()).toMatchObject({ line: "blue", waits: true });
    v.type("b");
    expect(v.hud()).toMatchObject({ line: "blueb", waits: false, completion: "ell" });
  });
});

describe("builder: the practice session", () => {
  it("records the typed words as a builder session with no stars", async () => {
    const v = await visit(miner);
    v.type("planks");
    v.type("put");
    v.type("east 2");
    v.type("put");
    v.type("undo");
    v.play.quit();
    await flush();
    const p = v.profile();
    expect(p.sessionCounter).toBe(miner.sessionCounter + 1);
    const last = p.history.at(-1);
    expect(last).toMatchObject({
      mode: "builder",
      keystrokes: 22,
      correct: 22,
      errors: 0,
      targetsCompleted: 5,
    });
    expect(last?.lessonId).toBeUndefined();
    expect(p.progress.lessons).toEqual(miner.progress.lessons);
    expect(p.keyStats["p"]?.attempts).toBeGreaterThan(miner.keyStats["p"]?.attempts ?? 0);
    expect(v.play.lastResult()).toMatchObject({ stars: 0, loot: {} });
    const done = v.events.filter((e) => e.type === "targetComplete");
    expect(done).toHaveLength(5);
  });

  it("only typing time counts: looking at the island is not typing", async () => {
    const v = await visit(miner);
    v.type("put", 200);
    v.type("p", 60_000);
    v.type("ut", 200);
    v.play.quit();
    await flush();
    // Two words of three keys, 200 ms apart: 400 ms each.
    expect(v.profile().history.at(-1)?.activeMs).toBe(800);
  });

  it("a key that didn't fit is a slip on the letter it was typed for", async () => {
    const v = await visit(miner);
    v.type("plxanks");
    v.play.quit();
    await flush();
    expect(v.profile().history.at(-1)).toMatchObject({ keystrokes: 7, correct: 6, errors: 1 });
    const wrong = v.events.find((e) => e.type === "wrong");
    expect(wrong).toMatchObject({ expected: "a", got: "x" });
  });

  it("letters taken back are a change of mind, not slips", async () => {
    const v = await visit(miner);
    v.type("plx<<dig");
    v.play.quit();
    await flush();
    expect(v.profile().history.at(-1)).toMatchObject({ keystrokes: 3, correct: 3, errors: 0 });
  });

  it("a pause drops a half-typed word, so no false slips reach key stats (review N2)", async () => {
    const v = await visit(miner);
    v.type("pla");
    v.play.pause(1);
    // The line is cleared with its keys: the picture and the record agree.
    expect(v.hud().line).toBe("");
    v.play.resume(2);
    v.type("nks");
    // `n` starts north; `k` and `s` fit nothing after it. Nothing ran, so nothing is recorded.
    expect(v.hud().armed).toBe("cobble");
    v.type("<planks");
    expect(v.hud().armed).toBe("oak-planks");
    v.play.quit();
    await flush();
    const last = v.profile().history.at(-1);
    expect(last).toMatchObject({ keystrokes: 6, correct: 6, errors: 0, targetsCompleted: 1 });
    expect(v.events.filter((e) => e.type === "wrong")).toEqual([]);
    expect(v.profile().keyStats["p"]?.errors ?? 0).toBe(miner.keyStats["p"]?.errors ?? 0);
  });

  it("Sprout: letters given back to a new word are that word's keys, not slips (review N1)", async () => {
    const v = await visit(withBlocks(sprout, { "oak-planks": 3 }));
    v.type("pla");
    v.type("north>");
    v.type("put");
    expect(v.grid().get(START.x, START.y, START.z - 1)).toBe(num("oak-planks"));
    v.play.quit();
    await flush();
    // pla (3) + north (5) + put (3).
    expect(v.profile().history.at(-1)).toMatchObject({
      keystrokes: 11,
      correct: 11,
      errors: 0,
      targetsCompleted: 3,
    });
  });

  it("Sprout: the rest of a block's name is typed quietly and is no part of the record", async () => {
    const v = await visit(withBlocks(sprout, { "oak-planks": 3 }));
    v.type("planks put");
    expect(v.hud().undo).toBe(1);
    v.play.quit();
    await flush();
    expect(v.profile().history.at(-1)).toMatchObject({ keystrokes: 6, correct: 6, errors: 0 });
  });

  it("Space as put, the arrows and the camera keys type no word", async () => {
    const v = await visit(miner);
    v.type(" ]-");
    v.keys.press("ArrowLeft");
    v.play.quit();
    await flush();
    expect(v.profile().history).toEqual(miner.history);
    expect(v.profile().sessionCounter).toBe(miner.sessionCounter);
    // The block placed is still saved.
    expect(v.profile().inventory["cobble"]).toBe(29);
  });

  it("a visit with no typing and no building writes nothing at all", async () => {
    const v = await visit(miner);
    v.keys.press("ArrowLeft");
    v.type("]");
    v.run(AUTOSAVE_MS * 3);
    v.play.pause(1);
    v.play.quit();
    await flush();
    expect(v.saves).toEqual([]);
    expect(v.profile()).toBe(miner);
  });
});

describe("builder: saving", () => {
  it("autosaves 30 s after a change, the island and the bag together, then rests", async () => {
    const v = await visit(miner);
    v.type(" ");
    v.run(AUTOSAVE_MS - 200);
    expect(v.saves).toEqual([]);
    v.run(400);
    expect(v.saves).toHaveLength(1);
    expect(saved(v.saves[0] ?? miner).get(START.x, START.y, START.z)).toBe(num("cobble"));
    expect(v.saves[0]?.inventory["cobble"]).toBe(29);
    // No history yet: the session is written when the island is left.
    expect(v.saves[0]?.history).toEqual(miner.history);
    v.run(AUTOSAVE_MS * 3);
    expect(v.saves).toHaveLength(1);
  });

  it("saves on a pause, which is also what a hidden tab looks like", async () => {
    const v = await visit(miner);
    v.type(" ");
    v.play.pause(1);
    expect(v.saves).toHaveLength(1);
    v.play.resume(2);
    v.play.pause(3);
    expect(v.saves).toHaveLength(1);
  });

  it("the save on leaving builds on the profile as it is now, not as it was at the start", async () => {
    const v = await visit(miner);
    v.type(" ");
    v.play.pause(1);
    v.play.resume(2);
    v.type("put");
    v.play.quit();
    await flush();
    expect(v.saves).toHaveLength(2);
    const p = v.profile();
    expect(saved(p).get(START.x, START.y + 1, START.z)).toBe(num("cobble"));
    expect(p.inventory["cobble"]).toBe(28);
    expect(p.history).toHaveLength(miner.history.length + 1);
  });

  it("writes lifetime finds once, from the bag as it was before the first change", async () => {
    expect(miner.found).toBeUndefined();
    const v = await visit(miner);
    v.type("dig");
    v.type("  ");
    v.play.pause(1);
    expect(v.profile().found).toEqual({ "oak-planks": 12, cobble: 30 });
    v.play.resume(2);
    v.type("dig");
    v.play.quit();
    await flush();
    // Digging put grass in the bag; it was never found in play.
    expect(v.profile().inventory["grass"]).toBeGreaterThan(0);
    expect(v.profile().found).toEqual({ "oak-planks": 12, cobble: 30 });
  });

  it("keeps finds that are already recorded", async () => {
    const v = await visit({ ...miner, found: { cobble: 99 } });
    v.type(" ");
    v.play.quit();
    await flush();
    expect(v.profile().found).toEqual({ cobble: 99 });
  });

  it("a profile with no island gets one only when something is built", async () => {
    expect(miner.island).toBeNull();
    const idle = await visit(miner);
    idle.play.quit();
    await flush();
    expect(idle.profile().island).toBeNull();
    const built = await visit(miner);
    built.type(" ");
    built.play.quit();
    await flush();
    expect(built.profile().island?.grid).toMatchObject(ISLAND_MAX);
  });

  it("leaving twice, or after the mode is gone, saves once", async () => {
    const v = await visit(miner);
    v.type(" ");
    const instance = v.instance();
    v.play.quit();
    instance.leave();
    v.play.quit();
    await flush();
    expect(v.saves).toHaveLength(1);
    expect(v.finished).toEqual([]);
    expect(v.statuses.at(-1)).toBe("idle");
  });

  it("starting something else also leaves the island first", async () => {
    const v = await visit(miner);
    v.type(" ");
    await v.play.start({ lesson: BUILDER_LESSON, profile: v.profile() });
    await flush();
    expect(v.saves).toHaveLength(1);
    expect(v.profile().inventory["cobble"]).toBe(29);
  });
});

describe("builder: an island that won't open", () => {
  it("shows the calm note, builds nothing and never writes", async () => {
    // The veteran fixture's island is 16×8×16, not the 48×32×48 grid (and its run-length data is
    // `[2048, 0]`, a count of 0), so it can't be opened.
    expect(veteran.island?.grid).toMatchObject({ sx: 16, sy: 8, sz: 16 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const v = await visit(veteran);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(v.hud()).toMatchObject({ status: "damaged", palette: [] });
    expect(v.loads).toEqual([]);
    expect(v.instance().session()).toBeNull();

    v.type("planks");
    v.type("put");
    v.type(" ^<");
    v.keys.press("ArrowRight");
    v.run(AUTOSAVE_MS * 2);
    v.play.pause(1);
    v.play.resume(2);
    expect(v.hud().status).toBe("damaged");
    v.play.quit();
    await flush();

    expect(v.saves).toEqual([]);
    expect(v.profile()).toBe(veteran);
    expect(v.profile().island).toEqual(veteran.island);
    expect(v.sfx).toEqual([]);
  });

  it("a grid of the right size but with broken data is left alone too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken: Profile = {
      ...miner,
      island: { grid: { ...ISLAND_MAX, rle: [5, 1] }, expansions: 0, lastEdited: 1 },
    };
    const v = await visit(broken);
    warn.mockRestore();
    expect(v.hud().status).toBe("damaged");
    v.type(" ");
    v.play.quit();
    await flush();
    expect(v.saves).toEqual([]);
  });
});

const hut = (): BuilderBlueprint => {
  const grid = new VoxelGrid(3, 1, 3);
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) grid.set(x, 0, z, num("oak-planks"));
  return { typedName: "hut", nameKey: "builder.title", grid };
};

/** Empties everything above the ground, so nothing but `wall` can hide the build. */
const clearSky = (g: VoxelGrid): void => {
  for (let y = START.y; y < g.sy; y++)
    for (let z = 0; z < g.sz; z++) for (let x = 0; x < g.sx; x++) g.set(x, y, z, 0);
};
/** A tall wall south of the cursor: between the build and the starting camera (view 0). */
const wallSouth = (g: VoxelGrid): void => {
  for (let y = START.y; y < START.y + 14; y++)
    for (let z = START.z + 3; z <= START.z + 4; z++)
      for (let x = START.x - 2; x <= START.x + 3; x++) g.set(x, y, z, num("cobble"));
};

describe("builder: blueprints (the M4-08 hook)", () => {
  it("stamps centered on the cursor, pays for it, and undoes as one step", async () => {
    const v = await visit(miner, { blueprints: [hut()] });
    v.type("hut");
    expect(v.grid().get(START.x - 1, START.y, START.z - 1)).toBe(num("oak-planks"));
    expect(v.grid().get(START.x + 1, START.y, START.z + 1)).toBe(num("oak-planks"));
    expect(v.hud().palette.find((p) => p.block === "oak-planks")?.count).toBe(3);
    expect(v.hud().hint).toMatchObject({ key: "builder.hint.built", tone: "cheer" });
    // The island's blocks plus the bag stay the same through the stamp and its undo (N9).
    const sum = (): Record<string, number> => {
      const total: Record<string, number> = { ...countBlocks(v.grid(), lookup) };
      for (const item of v.hud().palette) total[item.block] = (total[item.block] ?? 0) + item.count;
      return total;
    };
    const fresh = VoxelGrid.fromJSON(createIsland(miner.id, lookup, 0).grid);
    const before: Record<string, number> = { ...countBlocks(fresh, lookup) };
    for (const [id, n] of Object.entries(miner.inventory)) before[id] = (before[id] ?? 0) + n;
    expect(sum()).toEqual(before);
    expect(v.dirty).toHaveLength(9);
    v.type("undo");
    expect(sum()).toEqual(before);
    expect(v.grid().get(START.x, START.y, START.z)).toBe(0);
    expect(v.dirty).toHaveLength(18);
    expect(v.hud().palette.find((p) => p.block === "oak-planks")?.count).toBe(12);
  });

  describe("a clear view of the new build (M4-FIX-5)", () => {
    it("nothing in the way: the camera stays where the player put it", async () => {
      const v = await visit(miner, { blueprints: [hut()], frozen: false });
      clearSky(v.grid());
      const moves = v.moves.length;
      v.type("hut");
      expect(v.hud().hint).toMatchObject({ key: "builder.hint.built" });
      expect(v.moves).toHaveLength(moves);
      expect(v.hud().facing).toBe("north");
    });

    it("a wall in front: one gentle quarter turn, and [ ] carry on from there", async () => {
      const v = await visit(miner, { blueprints: [hut()], frozen: false });
      clearSky(v.grid());
      wallSouth(v.grid());
      v.type("hut");
      expect(v.hud().hint).toMatchObject({ key: "builder.hint.built" });
      const glide = v.moves.at(-1);
      expect(glide?.durationMs).toBe(TURN_MS);
      const after = v.hud().facing;
      expect(["east", "west"]).toContain(after);
      // The camera keys turn from the new view, not the old one.
      v.type("]");
      expect(v.hud().facing).toBe(after === "east" ? "south" : "north");
    });

    it("reduced motion: a cut, not a swing", async () => {
      const still = { ...miner, settings: { ...miner.settings, reducedMotion: true } };
      const v = await visit(still, { blueprints: [hut()], frozen: false });
      clearSky(v.grid());
      wallSouth(v.grid());
      v.type("hut");
      expect(v.hud().facing).not.toBe("north");
      expect(v.moves.at(-1)?.durationMs).toBe(0);
    });
  });

  it("says what is still missing, and changes nothing", async () => {
    const v = await visit(withBlocks(miner, { "oak-planks": 4 }), { blueprints: [hut()] });
    v.type("hut");
    expect(v.hud().hint).toEqual({
      key: "builder.hint.needMore",
      params: { count: 5, name: "Oak Planks" },
      tone: "info",
    });
    expect(v.grid().get(START.x, START.y, START.z)).toBe(0);
    expect(v.hud().undo).toBe(0);
  });

  it("at the edge there is no room, and nothing is written", async () => {
    const v = await visit(miner, { blueprints: [hut()] });
    for (let i = 0; i < 3; i++) v.type("west 9");
    v.type("hut");
    expect(v.hud().hint?.key).toBe("builder.hint.noRoom");
  });
});

describe("builder: the registered mode", () => {
  it("is found as `builder` and loads the real create", async () => {
    expect(mode.id).toBe("builder");
    const loaded = await mode.load();
    expect(Object.is(Reflect.get(loaded, "create"), create)).toBe(true);
  });
});

const withBadges = (p: Profile, ids: string[]): Profile => ({
  ...p,
  achievements: Object.fromEntries(ids.map((id) => [id, 1])),
});
/** A ring cell's column is outside the starter footprint: count its ground. */
const ringGround = (g: VoxelGrid): number => {
  const f = footprint(0);
  let n = 0;
  for (let z = 0; z < ISLAND_MAX.sz; z++) {
    for (let x = 0; x < ISLAND_MAX.sx; x++) {
      if (x >= f.x0 && x < f.x1 && z >= f.z0 && z < f.z1) continue;
      if (g.get(x, 0, z) !== 0) n += 1;
    }
  }
  return n;
};

describe("builder: the island grows when a biome is completed (M4-08)", () => {
  it("adds nothing for the Meadow alone (its ring is the starter plot)", async () => {
    const v = await visit(withBadges(miner, ["meadow-master"]), { frozen: false });
    expect(v.moves.some((m) => m.durationMs === SWEEP_MS)).toBe(false);
    v.play.quit();
    await flush();
    // Nothing changed, so nothing is written.
    expect(v.saves).toEqual([]);
  });

  it("sweeps out, adds one ring per completed biome, comes back, then takes keys", async () => {
    const v = await visit(withBadges(miner, ["meadow-master", "birch-master", "shore-master"]), {
      frozen: false,
    });
    // The camera sweeps out over the whole island first; the new land is not there yet.
    const out = v.moves.at(-1);
    expect(out).toMatchObject({ durationMs: SWEEP_MS });
    expect(out?.distance).toBeGreaterThan(60);
    expect(ringGround(v.grid())).toBe(0);
    // Keys wait for the ceremony.
    v.type("planks");
    expect(v.hud().line).toBe("");
    v.run(SWEEP_MS);
    expect(ringGround(v.grid())).toBeGreaterThan(0);
    expect(v.hud().hint).toEqual({ key: "builder.hint.grew", tone: "cheer" });
    expect(v.sfx).toContain("star");
    const first = ringGround(v.grid());
    v.run(RING_MS);
    expect(ringGround(v.grid())).toBeGreaterThan(first);
    // The new cells were redrawn, not the whole island.
    expect(v.loads).toHaveLength(1);
    expect(v.dirty.length).toBeGreaterThan(0);
    v.run(RING_MS + SWEEP_MS + 200);
    expect(v.moves.at(-1)).toMatchObject({ durationMs: SWEEP_MS });
    v.type("planks");
    expect(v.hud().armed).toBe("oak-planks");
    v.play.quit();
    await flush();
    expect(v.profile().island?.expansions).toBe(2);
  });

  it("is instant without motion: the land is there when the island appears", async () => {
    const v = await visit(withBadges(miner, ["birch-master"]));
    expect(ringGround(v.grid())).toBeGreaterThan(0);
    expect(v.moves.some((m) => m.durationMs === SWEEP_MS)).toBe(false);
    expect(v.hud().hint).toEqual({ key: "builder.hint.grew", tone: "cheer" });
    v.type("planks");
    expect(v.hud().armed).toBe("oak-planks");
    v.play.quit();
    await flush();
    expect(v.profile().island?.expansions).toBe(1);
  });

  it("never adds a ring twice", async () => {
    const p = withBadges(miner, ["birch-master"]);
    const v = await visit(p);
    v.play.quit();
    await flush();
    const again = await visit(v.profile());
    again.play.quit();
    await flush();
    // The second visit owed nothing and changed nothing, so it wrote nothing.
    expect(again.saves).toEqual([]);
    expect(v.profile().island?.expansions).toBe(1);
  });

  it("a pause mid-ceremony finishes it and saves the new land", async () => {
    const v = await visit(withBadges(miner, ["birch-master", "shore-master"]), { frozen: false });
    v.play.pause(60_000);
    await flush();
    const last = v.saves.at(-1);
    expect(last?.island?.expansions).toBe(2);
    expect(v.moves.at(-1)?.durationMs).toBe(0);
  });

  it("a damaged island is left alone: no ring and no save", async () => {
    const v = await visit(withBadges(veteran, ["birch-master", "shore-master"]), {
      frozen: false,
    });
    v.run(SWEEP_MS * 3);
    v.play.quit();
    await flush();
    expect(v.profile().island).toEqual(veteran.island);
  });
});

describe("builder: blueprints and the picture (M4-08)", () => {
  it("offers unlocked blueprints by name; a stamp spends the bag and undo gives it back", async () => {
    const bag = { cobble: 30, "oak-log": 4, "oak-planks": 3 };
    const p: Profile = { ...withBlocks(miner, bag), achievements: { "first-lesson": 1 } };
    const v = await visit(p);
    expect(v.hud().plans).toEqual(["well"]);
    const before = { ...countBlocks(v.grid(), lookup) };
    v.type("well");
    expect(v.hud().hint).toEqual({
      key: "builder.hint.built",
      params: { name: "Well" },
      tone: "cheer",
    });
    const after = countBlocks(v.grid(), lookup);
    expect((after["cobble"] ?? 0) - (before["cobble"] ?? 0)).toBe(16);
    expect((after["oak-log"] ?? 0) - (before["oak-log"] ?? 0)).toBe(4);
    v.play.pause(60_000);
    await flush();
    expect(v.saves.at(-1)?.inventory).toEqual({ cobble: 14, "oak-log": 0, "oak-planks": 0 });
    v.play.resume(61_000);
    v.type("undo");
    expect(countBlocks(v.grid(), lookup)).toEqual(before);
    v.play.quit();
    await flush();
    expect(v.profile().inventory).toEqual(bag);
  });

  it("a locked blueprint is not a word", async () => {
    const v = await visit(miner);
    expect(v.hud().plans).toEqual([]);
    v.type("well");
    expect(v.hud().line).not.toBe("well");
  });

  it("offers no photo where there is no 3D scene", async () => {
    const v = await visit(miner);
    expect(v.hud().photo).toBe(false);
    v.type("ph");
    // `p` starts put and planks; `h` fits no word here.
    expect(v.hud().line).toBe("p");
  });
});
