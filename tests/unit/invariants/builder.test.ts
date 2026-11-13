/**
 * No failure on My Island, through the real play host and the real save store (task M4-10,
 * PLAN.md §1 pillar 2, decision 99). Builder is the one mode that takes blocks out of the bag: a
 * placed block (or a stamped blueprint) moves to the island, and digging it up moves it back. So
 * here the invariant is the conservation sum: the island's blocks plus the bag, per block, never
 * change across any run of commands, autosaves, pauses and visits (the island only ever grows a
 * ring, which adds terrain). `found`, the biomes, the lesson records and the badges never go down.
 *
 * A damaged island (one that won't open) is never written, whatever the child types.
 */
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { createSilentAudio } from "../../../src/app/audio";
import { createBreakReminder } from "../../../src/app/break-reminder";
import type { Clock } from "../../../src/app/clock";
import { createHudStore } from "../../../src/app/hud";
import { createPlayHost } from "../../../src/app/play-host";
import { blocks } from "../../../src/content/blocks";
import { foundBlocks } from "../../../src/engine/achievements";
import { ISLAND_MAX } from "../../../src/engine/island";
import { mode } from "../../../src/modes/builder";
import { AUTOSAVE_MS } from "../../../src/modes/builder/builder";
import { blueprintsFor } from "../../../src/modes/builder/blueprints";
import { buildVocabulary } from "../../../src/modes/builder/commands";
import { BUILDER_LESSON } from "../../../src/modes/builder/lesson";
import type { VoxelGrid } from "../../../src/render/mesher/voxel-grid";
import type { Profile } from "../../../src/save/schema";
import { createMemoryStore } from "../../../src/save/store";
import type { SaveStore } from "../../../src/save/store";
import { fakeScene, fixture, flush } from "../app/helpers";
import { expectNeverLess, liveTotals, totals } from "./never-less";

const T0 = 1_800_000_000_000;

type Step =
  | { kind: "type"; text: string }
  | { kind: "autosave" }
  | { kind: "pause" }
  | { kind: "revisit" };

/** Every word a child can type on this profile's island, plus a few that mean nothing. */
function wordsFor(profile: Profile): string[] {
  const vocab = buildVocabulary({
    blocks: blocks.filter((b) => b.tags.includes("placeable")),
    blueprints: blueprintsFor(profile).map((b) => b.typedName),
    band: profile.ageBand,
  });
  return [...vocab.words.map((w) => w.word), "zzz", "pu", "di"];
}

/** `>` is Enter, `<` Backspace, `^` Ctrl+Z (the host's "Undo" key). */
function stepArb(words: readonly string[]): fc.Arbitrary<Step> {
  const text = fc
    .tuple(
      fc.constantFrom(...words),
      fc.constantFrom("", " ", " 1", " 3", " 9", ">", "<", "^", "  ", "x"),
    )
    .map(([w, tail]) => w + tail);
  return fc.oneof(
    { weight: 12, arbitrary: text.map((t): Step => ({ kind: "type", text: t })) },
    // Put and dig more often than any one block name, so the island really changes.
    {
      weight: 6,
      arbitrary: fc
        .constantFrom("put", "dig", "put ", "dig ", "^")
        .map((t): Step => ({ kind: "type", text: t })),
    },
    { weight: 1, arbitrary: fc.constant<Step>({ kind: "autosave" }) },
    { weight: 1, arbitrary: fc.constant<Step>({ kind: "pause" }) },
    { weight: 1, arbitrary: fc.constant<Step>({ kind: "revisit" }) },
  );
}

interface Visit {
  /** The grid as it opened (live: it changes with every edit), or null for a damaged island. */
  grid: VoxelGrid | null;
  type(text: string): void;
  run(ms: number): void;
  pause(): void;
  /** Leaves the island, and resolves once its save has landed. */
  leave(): Promise<void>;
  saves(): number;
}

async function visit(store: SaveStore, profile: Profile): Promise<Visit> {
  const scene = fakeScene();
  let grid: VoxelGrid | null = null;
  scene.loadDiorama = (_id, g) => {
    grid = g;
    return Promise.resolve();
  };
  let now = 50_000;
  let current = profile;
  let saves = 0;
  const clock: Clock = { now: () => now, epoch: () => T0 + now };
  const host = createPlayHost({
    acquireScene: () => Promise.resolve(scene),
    resolveMode: () => mode,
    hud: createHudStore(),
    audio: createSilentAudio(),
    clock,
    nextSeed: () => 7,
    frozen: true,
    record: false,
    reminder: createBreakReminder(),
    currentProfile: () => current,
    saveProfile: async (p) => {
      await store.save(p);
      current = p;
      saves += 1;
      return true;
    },
    onStatus: () => undefined,
    onFinished: () => undefined,
  });
  await host.start({ lesson: BUILDER_LESSON, profile });
  await flush();
  const run = (ms: number): void => {
    for (let left = ms; left > 0; left -= 100) {
      now += 100;
      scene.tick(100, now);
    }
  };
  return {
    grid,
    type(text) {
      for (const ch of text) {
        run(200);
        const key = ch === ">" ? "Enter" : ch === "<" ? "Backspace" : ch === "^" ? "Undo" : ch;
        host.input({ key, t: now, shift: false });
      }
    },
    run,
    pause() {
      host.pause(now);
      host.resume(now + 1);
    },
    async leave() {
      host.quit();
      await flush();
    },
    saves: () => saves,
  };
}

async function load(store: SaveStore, id: string): Promise<Profile> {
  const p = await store.load(id);
  if (p === null) throw new Error("the player is gone from the store");
  return p;
}

const miner = fixture("meadow-done-miner");
const sprout = fixture("fresh-sprout");
const islander = fixture("island-builder");
const bags: Record<string, number>[] = [
  {},
  { cobble: 40, "oak-planks": 40, clay: 30, glass: 8, "oak-log": 8, "mossy-cobble": 12 },
  { dirt: 3, grass: 1 },
];

describe("no failure: Builder through the play host and the save store (M4-10)", () => {
  it("island + bag per block stay the same across any commands, saves and visits", async () => {
    const words = [...new Set([miner, sprout, islander].flatMap(wordsFor))];
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(miner, sprout, islander),
        fc.constantFrom(...bags),
        fc.boolean(),
        fc.array(stepArb(words), { minLength: 1, maxLength: 30 }),
        async (base, extra, keepBag, steps) => {
          const start: Profile = keepBag
            ? { ...base, inventory: { ...base.inventory, ...extra } }
            : { ...base, inventory: extra };
          await runSteps(start, steps);
        },
      ),
      { seed: 20261113, numRuns: 30 },
    );
  }, 120_000);

  it("the same for long runs on the badge fixture, where plans stamp and the island grows", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(stepArb(wordsFor(islander)), { minLength: 20, maxLength: 60 }),
        async (steps) => {
          await runSteps(islander, [{ kind: "type", text: "house" }, ...steps]);
        },
      ),
      { seed: 46, numRuns: 15 },
    );
  }, 120_000);

  it("a damaged island is never written, whatever is typed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken: Profile = {
      ...miner,
      island: { grid: { ...ISLAND_MAX, rle: [5, 1] }, expansions: 0, lastEdited: 1 },
    };
    // The veteran's island is 16×8×16, not the island grid, so it can't be opened either.
    const veteran = fixture("veteran-builder");
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(broken, veteran),
        fc.array(stepArb(wordsFor(miner)), { minLength: 1, maxLength: 20 }),
        async (before, steps) => {
          const store = createMemoryStore();
          await store.save(before);
          const stored = await load(store, before.id);
          const v = await visit(store, stored);
          expect(v.grid).toBeNull();
          for (const s of steps) {
            if (s.kind === "type") v.type(s.text);
            else if (s.kind === "autosave") v.run(AUTOSAVE_MS + 200);
            else v.pause();
          }
          await v.leave();
          expect(v.saves()).toBe(0);
          const after = await load(store, before.id);
          expect(after.island).toEqual(stored.island);
          expect(after.inventory).toEqual(stored.inventory);
          expectNeverLess(stored, after);
        },
      ),
      { seed: 77, numRuns: 20 },
    );
    warn.mockRestore();
  }, 120_000);
});

/** Plays `steps` from `start` (saved first), checking the invariant at every visit's end. */
async function runSteps(start: Profile, steps: readonly Step[]): Promise<void> {
  const store = createMemoryStore();
  await store.save(start);
  let profile = await load(store, start.id);
  const found = foundBlocks(profile);
  let v = await visit(store, profile);
  // What every visit must add up to: the island as it opened (a fresh one from starter terrain,
  // with any rings it was owed) plus the bag it opened with.
  let expected = openTotals(v, profile);

  const close = async (): Promise<void> => {
    await v.leave();
    const after = await load(store, start.id);
    expectNeverLess(profile, after, { building: true });
    // The island and the bag are written together. With nothing built (no island yet), nothing
    // was written and the bag is as it was.
    expect(totals(after)).toEqual(after.island === null ? totals(profile) : expected);
    // Building never counts as finding.
    expect(foundBlocks(after)).toEqual(found);
    expect(after.progress).toEqual(profile.progress);
    profile = after;
  };

  for (const s of steps) {
    if (s.kind === "type") v.type(s.text);
    else if (s.kind === "autosave") v.run(AUTOSAVE_MS + 200);
    else if (s.kind === "pause") v.pause();
    else {
      await close();
      v = await visit(store, profile);
      expected = openTotals(v, profile);
    }
    // An autosave writes the island and the bag together, so the stored copy always adds up:
    // to this visit's sum once it saved, or to the last visit's before that.
    const stored = await load(store, start.id);
    expectNeverLess(profile, stored, { building: true });
    expect([expected, totals(profile)]).toContainEqual(totals(stored));
  }
  await close();
  expectNeverLess(start, profile, { building: true });
}

function openTotals(v: Visit, profile: Profile): Record<string, number> {
  if (v.grid === null) throw new Error("the island did not open");
  return liveTotals(v.grid, profile.inventory);
}
