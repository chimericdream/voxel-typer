/**
 * No failure in result application (task M4-10, PLAN.md §1 pillar 2): for any run of finished
 * sessions — curriculum lessons of every mode, remedial practice, free play and the placement
 * test — with any `ModeResult` at all (any stars, any loot, even malformed counts), nothing the
 * child earned ever goes down. `applyResult` and `applyPlacement` are what the play host folds a
 * result in with; the modes' own invariants (`modes.test.ts`, `builder.test.ts`) feed them real
 * results.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyPlacement, applyResult } from "../../../src/app/progress";
import { lessons } from "../../../src/content/lessons";
import type { Lesson } from "../../../src/content/lessons/types";
import { remedialId } from "../../../src/engine/remedial";
import type { SessionSummary } from "../../../src/engine/stats";
import { PLACEMENT_LESSON } from "../../../src/modes/placement/lesson";
import { PLACEMENT_RUNGS_EXTRA, PLACEMENT_TIER_EXTRA } from "../../../src/modes/placement/lesson";
import type { ModeResult } from "../../../src/modes/types";
import { createMemoryStore } from "../../../src/save/store";
import type { Profile } from "../../../src/save/schema";
import { fixture, summary } from "../app/helpers";
import { expectNeverLess } from "./never-less";

const SEED = 20261113;

const FIXTURES = [
  "fresh-sprout",
  "fresh-builder",
  "meadow-done-miner",
  "veteran-builder",
  "island-builder",
  "pinky-weak-camp",
].map(fixture);

/** Blocks a result may drop, and ids no block has (a stale or hand-made save). */
const BLOCKS = ["dirt", "cobble", "oak-planks", "glass", "clay", "sand", "ore-gem", "made-up"];

/** Counts as a mode might send them, including ones `applyResult` must ignore. */
const countArb = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 1, max: 40 }) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(0, -1, -50, 0.5, 2.5, Number.NaN, Number.POSITIVE_INFINITY),
  },
);

const summaryArb: fc.Arbitrary<SessionSummary> = fc
  .record({
    netWpm: fc.double({ min: 0, max: 140, noNaN: true }),
    accuracy: fc.double({ min: 0, max: 1, noNaN: true }),
    keystrokes: fc.integer({ min: 0, max: 600 }),
  })
  .map((s) => summary({ ...s, grossWpm: s.netWpm }));

const resultArb: fc.Arbitrary<ModeResult> = fc.record({
  summary: summaryArb,
  loot: fc.dictionary(fc.constantFrom(...BLOCKS), countArb, { maxKeys: 5 }),
  stars: fc.constantFrom(0, 1, 2, 3),
  extra: fc.record({
    [PLACEMENT_TIER_EXTRA]: fc.oneof(fc.integer({ min: -2, max: 12 }), fc.constant("junk")),
    [PLACEMENT_RUNGS_EXTRA]: fc.constantFrom(undefined, [], [{ tier: 1 }], "junk"),
  }),
});

type Kind = "lesson" | "remedial" | "free" | "placement";

const stepArb = fc.record({
  kind: fc.constantFrom<Kind>("lesson", "lesson", "lesson", "remedial", "free", "placement"),
  lesson: fc.constantFrom(...lessons),
  result: resultArb,
});

/** The step's lesson: a shipped one, a remedial at its place, none, or the placement test. */
function lessonFor(kind: Kind, anchor: Lesson, sessionIndex: number): Lesson | null {
  if (kind === "free") return null;
  if (kind === "placement") return PLACEMENT_LESSON;
  if (kind === "remedial") return { ...anchor, id: remedialId(["f", "j"], sessionIndex) };
  return anchor;
}

/** Loot as `applyResult` must count it: whole, positive counts only. */
const goodLoot = (loot: Readonly<Record<string, number>>): [string, number][] =>
  Object.entries(loot).filter(([, n]) => Number.isInteger(n) && n > 0);

describe("no failure: result application (M4-10)", () => {
  it("for any run of results, nothing in the profile ever goes down", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FIXTURES),
        fc.array(stepArb, { minLength: 1, maxLength: 12 }),
        (start, steps) => {
          let profile: Profile = start;
          let at = 1_800_000_000_000;
          for (const [i, s] of steps.entries()) {
            at += 60_000;
            const lesson = lessonFor(s.kind, s.lesson, profile.sessionCounter + 1);
            const next =
              s.kind === "placement"
                ? applyPlacement(profile, lessons, s.result, at)
                : applyResult(profile, lesson, s.result, at);
            const label = `step ${i} (${s.kind} ${lesson?.id ?? "free"})`;
            expectNeverLess(profile, next, { label });

            // Each result counts once: its loot is added exactly, to the bag and to the finds.
            for (const [block, n] of goodLoot(s.result.loot)) {
              expect(next.inventory[block], label).toBe((profile.inventory[block] ?? 0) + n);
            }
            expect(next.sessionCounter, label).toBe(profile.sessionCounter + 1);
            expect(next.history, label).toHaveLength(profile.history.length + 1);
            // Nothing a session does touches the island or the badges.
            expect(next.island, label).toEqual(profile.island);
            expect(next.achievements, label).toEqual(profile.achievements);

            if (s.kind === "remedial" || s.kind === "free") {
              // Practice is not in the curriculum: no lesson record, no unlock.
              expect(next.progress.lessons, label).toEqual(profile.progress.lessons);
              expect(next.progress.unlockedBiomes, label).toEqual(profile.progress.unlockedBiomes);
              if (lesson !== null) expect(next.progress.lessons[lesson.id], label).toBeUndefined();
            }
            if (s.kind === "lesson" && lesson !== null) {
              const was = profile.progress.lessons[lesson.id];
              const now = next.progress.lessons[lesson.id];
              expect(now?.plays, label).toBe((was?.plays ?? 0) + 1);
              expect(now?.bestStars, label).toBe(Math.max(was?.bestStars ?? 0, s.result.stars));
            }
            profile = next;
          }
          expectNeverLess(start, profile, { label: "start to end" });
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });

  it("a profile still holds everything after the save store's round trip", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...FIXTURES),
        fc.array(stepArb, { minLength: 1, maxLength: 6 }),
        async (start, steps) => {
          const store = createMemoryStore();
          let profile: Profile = start;
          let at = 1_800_000_000_000;
          for (const s of steps) {
            at += 60_000;
            const lesson = lessonFor(s.kind, s.lesson, profile.sessionCounter + 1);
            const next =
              s.kind === "placement"
                ? applyPlacement(profile, lessons, s.result, at)
                : applyResult(profile, lesson, s.result, at);
            await store.save(next);
            const loaded = await store.load(next.id);
            if (loaded === null) throw new Error("the save did not load");
            expectNeverLess(profile, loaded);
            profile = loaded;
          }
        },
      ),
      { seed: SEED + 1, numRuns: 60 },
    );
  });
});
