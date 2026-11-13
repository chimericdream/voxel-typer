/**
 * No failure in Mine and Night Defense, through the real play host (task M4-10, PLAN.md §1
 * pillar 2). Each run is a real mode on a fake scene (`three` is null, so it runs headless), fed
 * any key stream: the right key, any other key, Space, Backspace, capitals and keys no lesson
 * uses, at any speed. The host folds the result in and saves it into a real (memory) save store.
 * What the store holds afterwards never has less of anything than the profile had before.
 *
 * A remedial (M3-06) goes the same way and writes no lesson record.
 */
import * as fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { createSilentAudio } from "../../../src/app/audio";
import { createBreakReminder } from "../../../src/app/break-reminder";
import type { Clock } from "../../../src/app/clock";
import { createHudStore } from "../../../src/app/hud";
import { createPlayHost } from "../../../src/app/play-host";
import { lessons } from "../../../src/content/lessons";
import type { Lesson } from "../../../src/content/lessons/types";
import { remedialId } from "../../../src/engine/remedial";
import { mode as defense } from "../../../src/modes/defense";
import { forgetNights } from "../../../src/modes/defense/defense";
import { mode as mine } from "../../../src/modes/mine";
import type { ModeModule, ModeResult } from "../../../src/modes/types";
import type { Profile } from "../../../src/save/schema";
import { createMemoryStore } from "../../../src/save/store";
import type { BiomeId } from "../../../src/types/core";
import { fakeScene, fixture, flush } from "../app/helpers";
import { expectNeverLess } from "./never-less";

const T0 = 1_800_000_000_000;
const FRAME = 16;

const lessonById = (id: string): Lesson => {
  const l = lessons.find((x) => x.id === id);
  if (!l) throw new Error(`no lesson ${id}`);
  return l;
};

const KEYS = [..."abcdefghijklmnopqrstuvwxyz;".split(""), " ", "Backspace", "Enter", "~", "A", "F"];

/** A child's keys: mostly the one asked for, sometimes anything, at any pace. */
const streamArb = fc.array(
  fc.record({
    right: fc.boolean(),
    key: fc.constantFrom(...KEYS),
    gap: fc.integer({ min: 20, max: 2500 }),
  }),
  { minLength: 0, maxLength: 100 },
);

/** A profile with something to lose: blocks, a best score on `lesson`, a later biome. */
function withSomethingToLose(profile: Profile, lesson: Lesson): Profile {
  const birch: BiomeId = "birch";
  return {
    ...profile,
    inventory: { ...profile.inventory, dirt: 12, "oak-log": 3 },
    progress: {
      ...profile.progress,
      unlockedBiomes: [...new Set([...profile.progress.unlockedBiomes, birch])],
      lessons: {
        ...profile.progress.lessons,
        [lesson.id]: {
          bestStars: 3,
          bestNetWpm: 31,
          bestAccuracy: 0.99,
          plays: 4,
          lastPlayed: 5,
        },
      },
    },
  };
}

interface Played {
  result: ModeResult | undefined;
  stored: Profile | null;
  saves: number;
}

/**
 * One session of `module` in the play host: `stream`, then the rest played out with the right
 * keys (a calm night waits for its words; a timed remedial runs out on its own).
 */
async function play(
  module: ModeModule,
  lesson: Lesson,
  profile: Profile,
  stream: readonly { right: boolean; key: string; gap: number }[],
  seed: number,
): Promise<Played> {
  const store = createMemoryStore();
  await store.save(profile);
  const scene = fakeScene();
  const hud = createHudStore();
  let now = 10_000;
  let current = profile;
  let saves = 0;
  const finished: ModeResult[] = [];
  const clock: Clock = { now: () => now, epoch: () => T0 + now };
  const host = createPlayHost({
    acquireScene: () => Promise.resolve(scene),
    resolveMode: () => module,
    hud,
    audio: createSilentAudio(),
    clock,
    nextSeed: () => seed,
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
    onFinished: (r) => finished.push(r),
  });
  const run = (ms: number): void => {
    for (let left = ms; left > 0; left -= FRAME) {
      now += FRAME;
      scene.tick(FRAME, now);
    }
  };
  const type = (key: string, gap: number): void => {
    run(gap);
    host.input({ key, t: now, shift: false });
  };
  await host.start({ lesson, profile });
  await flush();
  expect(host.status()).toBe("running");
  for (const k of stream) {
    if (host.status() !== "running") break;
    type(k.right ? (hud.get().nextKey ?? k.key) : k.key, k.gap);
  }
  // The rest of the session, typed right. No session runs longer than a night's cap and more.
  const end = now + 15 * 60_000;
  const playing = (): boolean => host.status() === "running" && now < end;
  while (playing()) {
    const next = hud.get().nextKey;
    if (next === null) run(160);
    else type(next, 150);
  }
  run(2000);
  await flush();
  return { result: finished[0], stored: await store.load(profile.id), saves };
}

const sprout = fixture("fresh-sprout");
const miner = fixture("meadow-done-miner");
const builder = fixture("veteran-builder");
const mineLessons = lessons.filter((l) => l.mode === "mine");

beforeEach(() => {
  forgetNights();
});

describe("no failure: Mine through the play host (M4-10)", () => {
  it("for any key stream, band and lesson, the saved profile keeps everything", async () => {
    await fc.assert(
      fc.asyncProperty(
        streamArb,
        fc.constantFrom(sprout, miner, builder),
        fc.constantFrom(...mineLessons),
        fc.integer({ min: 1, max: 9999 }),
        async (stream, start, lesson, seed) => {
          const before = withSomethingToLose(start, lesson);
          const { result, stored, saves } = await play(mine, lesson, before, stream, seed);
          expect(result, "the lesson did not finish").toBeDefined();
          expect(saves).toBe(1);
          if (stored === null) throw new Error("nothing stored");
          expectNeverLess(before, stored, { label: lesson.id });
          expect(stored.progress.lessons[lesson.id]?.plays).toBe(5);
          expect(stored.history).toHaveLength(before.history.length + 1);
          for (const [block, n] of Object.entries(result?.loot ?? {})) {
            expect(Number.isInteger(n) && n > 0).toBe(true);
            expect(stored.inventory[block]).toBe((before.inventory[block] ?? 0) + n);
          }
        },
      ),
      { seed: 4101, numRuns: 30 },
    );
  }, 120_000);

  it("a remedial keeps everything and writes no lesson record, whatever is typed", async () => {
    await fc.assert(
      fc.asyncProperty(
        streamArb,
        fc.constantFrom(sprout, miner, builder),
        fc.constantFrom(...mineLessons),
        async (stream, start, anchor) => {
          const before = withSomethingToLose(start, anchor);
          const id = remedialId(["f", "j"], before.sessionCounter + 1);
          // As `remedialLesson` makes one: at the anchor's place, 60 s long.
          const remedial: Lesson = { ...anchor, id, length: { seconds: 60 } };
          const { result, stored } = await play(mine, remedial, before, stream, 7);
          expect(result, "the remedial did not finish").toBeDefined();
          if (stored === null) throw new Error("nothing stored");
          expectNeverLess(before, stored, { label: id });
          expect(stored.progress.lessons).toEqual(before.progress.lessons);
          expect(stored.progress.lessons[id]).toBeUndefined();
          expect(stored.progress.unlockedBiomes).toEqual(before.progress.unlockedBiomes);
          // It still counts as a session, under its own id (the remedial rate limit reads it).
          expect(stored.history.at(-1)?.lessonId).toBe(id);
        },
      ),
      { seed: 4102, numRuns: 12 },
    );
  }, 120_000);
});

describe("no failure: Night Defense through the play host (M4-10)", () => {
  it("for any key stream, band and night, the saved profile keeps everything", async () => {
    await fc.assert(
      fc.asyncProperty(
        streamArb,
        fc.constantFrom(sprout, miner, builder),
        fc.constantFrom("birch-08", "shore-05", "frosty-06"),
        fc.integer({ min: 1, max: 9999 }),
        async (stream, start, lessonId, seed) => {
          forgetNights();
          const lesson = lessonById(lessonId);
          const before = withSomethingToLose(start, lesson);
          const { result, stored, saves } = await play(defense, lesson, before, stream, seed);
          expect(result, "the night did not reach dawn").toBeDefined();
          expect(saves).toBe(1);
          if (stored === null) throw new Error("nothing stored");
          expectNeverLess(before, stored, { label: lessonId });
          expect(stored.island).toEqual(before.island);
          expect(stored.progress.lessons[lesson.id]?.plays).toBe(5);
          expect(result?.stars).toBeGreaterThanOrEqual(1);
        },
      ),
      { seed: 4103, numRuns: 10 },
    );
  }, 180_000);
});
