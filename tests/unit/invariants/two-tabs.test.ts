/**
 * No failure with two tabs open (task M4-10, M3-FIX-9). A save may find that another tab changed
 * the player since; the play host then redoes the result on the newer copy (`updateProfile`'s
 * `derive`, which may run once per newer copy). For any number of such changes, at any moment,
 * every result is applied exactly once: never lost, never counted twice, and nothing another tab
 * earned meanwhile goes down.
 *
 * The other tab here is a fake save path in front of one shared copy. Each save first lets the
 * other tab change the player any number of times, calling `derive` on each newer copy (as the
 * real retry does), and only the last one is written.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createSilentAudio } from "../../../src/app/audio";
import { createBreakReminder } from "../../../src/app/break-reminder";
import { fixedStepClock } from "../../../src/app/clock";
import { createHudStore } from "../../../src/app/hud";
import { createPlayHost } from "../../../src/app/play-host";
import { applyResult } from "../../../src/app/progress";
import { blocks } from "../../../src/content/blocks";
import { lessons } from "../../../src/content/lessons";
import type { Lesson } from "../../../src/content/lessons/types";
import { foundBlocks } from "../../../src/engine/achievements";
import { createIsland, islandBlocks, openIsland } from "../../../src/engine/island";
import { remedialId } from "../../../src/engine/remedial";
import {
  BUILDER_ISLAND_EXTRA,
  BUILDER_LESSON,
  BUILDER_SAVE_EVENT,
} from "../../../src/modes/builder/lesson";
import type { IslandPatch } from "../../../src/modes/builder/lesson";
import { putCell } from "../../../src/modes/builder/logic";
import { PLACEMENT_LESSON } from "../../../src/modes/placement/lesson";
import type { ModeResult } from "../../../src/modes/types";
import type { Profile } from "../../../src/save/schema";
import type { BlockId } from "../../../src/types/core";
import { fakeMode, fakeScene, fixture, flush, summary } from "../app/helpers";
import { expectNeverLess, totals } from "./never-less";

const T0 = 1_800_000_000_000;
const lookup = islandBlocks(blocks);
const BLOCKS = ["dirt", "cobble", "oak-planks", "glass", "clay"];

/** One thing the other tab does to the player. */
interface Change {
  loot: Record<BlockId, number>;
  /** It also finishes a lesson there. */
  lesson: Lesson | null;
  stars: 0 | 1 | 2 | 3;
  /** It changes a setting (a plain save). */
  textScale: boolean;
}

const changeArb: fc.Arbitrary<Change> = fc.record({
  loot: fc.dictionary(fc.constantFrom(...BLOCKS), fc.integer({ min: 1, max: 9 }), { maxKeys: 3 }),
  lesson: fc.option(fc.constantFrom(...lessons), { nil: null }),
  stars: fc.constantFrom(0, 1, 2, 3),
  textScale: fc.boolean(),
});

/** Before each save: how many changes the other tab makes, and whether derive also sees `base`. */
const raceArb = fc.record({
  changes: fc.array(changeArb, { maxLength: 4 }),
  // The first try is on the copy the save started from, then the newer ones come in.
  triesBase: fc.boolean(),
});

const addTo = (bag: Record<BlockId, number>, loot: Readonly<Record<BlockId, number>>): void => {
  for (const [id, n] of Object.entries(loot)) bag[id] = (bag[id] ?? 0) + n;
};

/** The other tab's change, as its own save would write it. */
function otherTab(p: Profile, c: Change, at: number): Profile {
  const loot = { ...c.loot };
  const r: ModeResult = { summary: summary(), loot, stars: c.stars };
  const changed = c.lesson === null ? applyResult(p, null, r, at) : applyResult(p, c.lesson, r, at);
  return c.textScale
    ? {
        ...changed,
        settings: { ...changed.settings, textScale: changed.settings.textScale === 1 ? 1.25 : 1 },
      }
    : changed;
}

/** A shared copy of the player, and a save path that races another tab in front of it. */
function sharedCopy(start: Profile) {
  let stored = start;
  let at = T0;
  /** Every block the other tab added, all saves together. */
  const otherLoot: Record<BlockId, number> = {};
  let otherSessions = 0;
  let plan: { changes: Change[]; triesBase: boolean }[] = [];
  const updateProfile = (
    base: Profile,
    derive: (b: Profile) => Profile | null,
  ): Promise<Profile | null> => {
    const race = plan.shift() ?? { changes: [], triesBase: false };
    if (race.triesBase) {
      const frozen = structuredClone(base);
      derive(base);
      // `derive` must not change what it is given.
      expect(base).toEqual(frozen);
    }
    for (const c of race.changes) {
      at += 1000;
      stored = otherTab(stored, c, at);
      addTo(otherLoot, c.loot);
      otherSessions += 1;
      // A try on each newer copy as it arrives; only the last one is written.
      const frozen = structuredClone(stored);
      derive(stored);
      expect(stored).toEqual(frozen);
    }
    const next = derive(stored);
    if (next === null) return Promise.resolve(null);
    stored = next;
    return Promise.resolve(next);
  };
  return {
    updateProfile,
    current: () => stored,
    otherLoot,
    otherSessions: () => otherSessions,
    setPlan(p: typeof plan) {
      plan = [...p];
    },
  };
}

function host(shared: ReturnType<typeof sharedCopy>) {
  const mode = fakeMode();
  const play = createPlayHost({
    acquireScene: () => Promise.resolve(fakeScene()),
    resolveMode: () => mode.module,
    hud: createHudStore(),
    audio: createSilentAudio(),
    clock: fixedStepClock(1000, 1),
    nextSeed: () => 1,
    frozen: true,
    record: false,
    reminder: createBreakReminder(),
    currentProfile: shared.current,
    saveProfile: () => Promise.resolve(true),
    updateProfile: shared.updateProfile,
    onStatus: () => undefined,
    onFinished: () => undefined,
  });
  return { play, mode };
}

const resultArb: fc.Arbitrary<ModeResult> = fc.record({
  summary: fc.constant(summary()),
  loot: fc.dictionary(fc.constantFrom(...BLOCKS), fc.integer({ min: 1, max: 20 }), { maxKeys: 4 }),
  stars: fc.constantFrom(0, 1, 2, 3),
});

type Kind = "lesson" | "remedial" | "placement";

describe("no failure: two tabs, a result redone on a newer copy (M4-10)", () => {
  it("each lesson, remedial or placement result is applied exactly once", async () => {
    const starts = ["fresh-sprout", "meadow-done-miner", "veteran-builder"].map(fixture);
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...starts),
        fc.constantFrom<Kind>("lesson", "lesson", "remedial", "placement"),
        fc.constantFrom(...lessons),
        resultArb,
        raceArb,
        async (start, kind, anchor, result, race) => {
          const shared = sharedCopy(start);
          shared.setPlan([race]);
          const { play, mode } = host(shared);
          const lesson =
            kind === "placement"
              ? PLACEMENT_LESSON
              : kind === "remedial"
                ? { ...anchor, id: remedialId(["f"], start.sessionCounter + 1) }
                : anchor;
          await play.start({ lesson, profile: start });
          await flush();
          mode.ctx().finish(result);
          await flush();
          const after = shared.current();

          expectNeverLess(start, after);
          // Every session counted once: the other tab's and this one.
          expect(after.sessionCounter).toBe(start.sessionCounter + shared.otherSessions() + 1);
          expect(after.history).toHaveLength(start.history.length + shared.otherSessions() + 1);
          // Every block counted once: the other tab's loot and this result's.
          const want = { ...start.inventory };
          addTo(want, shared.otherLoot);
          addTo(want, result.loot);
          expect(after.inventory).toEqual(want);
          const wantFound = foundBlocks(start);
          addTo(wantFound, shared.otherLoot);
          addTo(wantFound, result.loot);
          expect(foundBlocks(after)).toEqual(wantFound);
          if (kind === "lesson") {
            const others = race.changes.filter((c) => c.lesson?.id === lesson.id).length;
            const was = start.progress.lessons[lesson.id]?.plays ?? 0;
            expect(after.progress.lessons[lesson.id]?.plays).toBe(was + others + 1);
          }
          if (kind === "remedial") expect(after.progress.lessons[lesson.id]).toBeUndefined();
        },
      ),
      { seed: 9109, numRuns: 150 },
    );
  });

  it("Builder's saves and its last save keep island + bag right with loot found elsewhere", async () => {
    const base = fixture("island-builder");
    const island = createIsland(base.id, lookup, T0);
    const start: Profile = { ...base, island };
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            puts: fc.array(
              fc.record({
                x: fc.integer({ min: 14, max: 33 }),
                z: fc.integer({ min: 14, max: 33 }),
                block: fc.constantFrom("cobble", "oak-planks", "clay", "glass"),
              }),
              { maxLength: 6 },
            ),
            race: raceArb,
          }),
          { minLength: 1, maxLength: 4 },
        ),
        raceArb,
        fc.boolean(),
        async (saves, lastRace, typed) => {
          const shared = sharedCopy(start);
          shared.setPlan([...saves.map((s) => s.race), lastRace]);
          const { play, mode } = host(shared);
          await play.start({ lesson: BUILDER_LESSON, profile: start });
          await flush();
          // The editor stands in for Builder: real moves from the bag to the island.
          const editor = openIsland({
            island,
            inventory: start.inventory,
            blocks: lookup,
            profileId: start.id,
          });
          let now = T0;
          let patch: IslandPatch | null = null;
          for (const s of saves) {
            for (const p of s.puts) {
              const at = putCell(editor.grid, { x: p.x, y: 9, z: p.z });
              if (at !== null) editor.apply({ kind: "place", ...at, block: p.block });
            }
            now += 30_000;
            patch = { island: editor.save(now), inventory: editor.inventory() };
            mode.ctx().bus.emit(BUILDER_SAVE_EVENT, patch);
            await flush();
          }
          mode.ctx().finish({
            summary: summary({ lessonId: "builder", mode: "builder", keystrokes: typed ? 9 : 0 }),
            loot: {},
            stars: 0,
            ...(patch !== null && { extra: { [BUILDER_ISLAND_EXTRA]: patch } }),
          });
          await flush();
          const after = shared.current();

          expectNeverLess(start, after, { building: true });
          // The island and the bag add up to the start plus what the other tab found: this tab's
          // building moved blocks once, and the other tab's loot is in the bag once.
          const want = totals(start);
          addTo(want, shared.otherLoot);
          expect(totals(after)).toEqual(want);
          // What this tab built is on the island.
          expect(after.island).toEqual(patch?.island ?? start.island);
          // Building is never a find; the other tab's loot is.
          const wantFound = foundBlocks(start);
          addTo(wantFound, shared.otherLoot);
          expect(foundBlocks(after)).toEqual(wantFound);
          // The visit's practice session, once, and only when something was typed.
          const visit = typed ? 1 : 0;
          expect(after.sessionCounter).toBe(start.sessionCounter + shared.otherSessions() + visit);
        },
      ),
      { seed: 9110, numRuns: 80 },
    );
  });

  it("when the other tab changed the island itself, its island and bag stay as they are", async () => {
    const base = fixture("island-builder");
    const island = createIsland(base.id, lookup, T0);
    const start: Profile = { ...base, island };
    const open = () =>
      openIsland({ island, inventory: start.inventory, blocks: lookup, profileId: start.id });
    // The other tab built on the island first and spent 3 cobble on it; this tab never heard.
    const other = open();
    for (const x of [20, 21, 22]) {
      const at = putCell(other.grid, { x, y: 9, z: 20 });
      if (at !== null) other.apply({ kind: "place", ...at, block: "cobble" });
    }
    const theirs: Profile = { ...start, island: other.save(T0 + 5), inventory: other.inventory() };
    // This tab's own building, from the copy it started with.
    const editor = open();
    const at = putCell(editor.grid, { x: 30, y: 9, z: 30 });
    if (at !== null) editor.apply({ kind: "place", ...at, block: "glass" });
    const mine: IslandPatch = { island: editor.save(T0 + 9), inventory: editor.inventory() };
    expect(totals(theirs)).toEqual(totals(start));

    await fc.assert(
      fc.asyncProperty(raceArb, raceArb, fc.boolean(), async (first, last, typed) => {
        const shared = sharedCopy(theirs);
        shared.setPlan([first, last]);
        const { play, mode } = host(shared);
        await play.start({ lesson: BUILDER_LESSON, profile: start });
        await flush();
        mode.ctx().bus.emit(BUILDER_SAVE_EVENT, mine);
        await flush();
        mode.ctx().finish({
          summary: summary({ lessonId: "builder", mode: "builder", keystrokes: typed ? 4 : 0 }),
          loot: {},
          stars: 0,
          extra: { [BUILDER_ISLAND_EXTRA]: mine },
        });
        await flush();
        const after = shared.current();
        // Two islands can't be merged: theirs stays, with its own bag plus what was found since.
        expect(after.island).toEqual(theirs.island);
        const want = totals(theirs);
        addTo(want, shared.otherLoot);
        expect(totals(after)).toEqual(want);
        expectNeverLess(theirs, after, { building: true });
      }),
      { seed: 9111, numRuns: 40 },
    );
  });
});
