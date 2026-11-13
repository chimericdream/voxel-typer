/**
 * Replay variety (task M3-FIX-7). The owner finished Meadow, pressed "Play again", and got "ha ha"
 * for every item. Every shipped lesson, replayed 3 times with new seeds in every band, must give at
 * least 5 distinct items per session (or every item distinct, when a session has fewer than 5),
 * under no key stats, the stats behind that report, and a spread of made-up learners.
 *
 * The params mirror Mine's `plan()` (`src/modes/mine/mine.ts`): the allowed keys, the lesson's new
 * and review keys as focus, the band's pools and length.
 */
import { describe, expect, it } from "vitest";
import { lessons } from "../../../src/content/lessons";
import { wordPools } from "../../../src/content/wordlists/pools";
import { keyWeights } from "../../../src/engine/adaptive";
import { generateTargets } from "../../../src/engine/generator";
import { createRng } from "../../../src/engine/rng";
import type { Rng } from "../../../src/engine/rng";
import type { KeyStat } from "../../../src/engine/stats";
import { allowedKeys, lengthPlan, poolsFor } from "../../../src/modes/mine/logic";
import type { AgeBand } from "../../../src/types/core";

const BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];
const TARGET_LATENCY: Record<AgeBand, number> = { sprout: 900, miner: 500, builder: 300 };
const EST_WPM: Record<AgeBand, number> = { sprout: 8, miner: 15, builder: 25 };
const KEYS = "abcdefghijklmnopqrstuvwxyz;,./'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?-";
const REPLAYS = 3;
const MIN_DISTINCT = 5;

function stat(err: number, latency: number): KeyStat {
  return {
    attempts: 100,
    errors: Math.round(err * 100),
    recentErrRate: err,
    latencyMedian: latency,
    recentLatencies: [],
    lastSeenSession: 1,
    srs: { intervalSessions: 1, dueSession: 99 },
  };
}

/** A made-up learner: every key seen, with its own error rate and speed. */
function learner(rng: Rng): Record<string, KeyStat> {
  const out: Record<string, KeyStat> = {};
  for (const k of KEYS) out[k] = stat(rng.next() * 0.3, 300 + rng.next() * 1200);
  return out;
}

const learners = createRng(7);
const PROFILES: readonly Record<string, KeyStat>[] = [
  {},
  // The second learner from seed 7 gives Meadow the weights of the report (generator.test.ts).
  ...Array.from({ length: 12 }, () => learner(learners)),
];

describe("replay variety", () => {
  for (const lesson of lessons) {
    it(`${lesson.id}: ${REPLAYS} replays in every band give at least ${MIN_DISTINCT} distinct items`, () => {
      const allowed = allowedKeys(lessons, lesson);
      const keys = new Set(allowed.filter((k) => k !== " ")).size;
      let seed = 1;
      for (const band of BANDS) {
        const pools = poolsFor(lesson, band, wordPools);
        const { length } = lengthPlan(lesson, band, { calm: false, estWpm: EST_WPM[band] });
        PROFILES.forEach((stats, p) => {
          const weights = keyWeights({
            allowed,
            focus: [...lesson.newKeys, ...lesson.reviewKeys],
            stats,
            sessionIndex: 5,
            targetLatencyMs: TARGET_LATENCY[band],
          });
          for (let r = 0; r < REPLAYS; r++) {
            const targets = generateTargets(
              { kind: lesson.kind, allowed, weights, pools, length, capitalize: "none" },
              createRng(seed++).fork("targets"),
            );
            const distinct = new Set(targets.map((t) => t.text)).size;
            const room =
              lesson.kind === "letters" ? Math.min(keys, targets.length) : targets.length;
            expect(distinct, `${band}, profile ${p}, replay ${r}`).toBeGreaterThanOrEqual(
              Math.min(MIN_DISTINCT, room),
            );
          }
        });
      }
    });
  }
});
