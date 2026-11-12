/**
 * Placement test mode (task M3-05, PLAN.md §3.2.8): a 90-second Mine run whose blocks climb a
 * ladder of key sets (home row → top → bottom → words → capitals → numbers). A set opens when 8
 * of the last 10 blocks broke without a slip.
 *
 * This is a reskin of Mine, not a copy: Mine's `create` takes {@link MineOptions} hooks, so the
 * stage, the loot, the wrong-key cues, the "keys wait for the world" rule (decision 83), the habit
 * space between blocks (decision 90) and "a block breaks on its last char" (decision 81) are all
 * Mine's own. This file only picks the blocks (`createPlacementDriver`, pure) and builds the
 * result. The estimate itself is made when the result is applied (`applyPlacement`).
 */
import { wordPools } from "@/content/wordlists/pools";
import { PLACEMENT_CALM_BLOCKS, PLACEMENT_MS } from "@/engine/placement";
import { createPlacementDriver } from "@/engine/placement-driver";
import { PLACEMENT_TIER_EXTRA } from "./lesson";
import type { Ms } from "@/types/core";
import { create as createMine } from "../mine/mine";
import type { MineInstance } from "../mine/mine";
import { TARGET_LATENCY } from "../mine/logic";
import type { ModeContext, ModeResult } from "../types";

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function create(ctx: ModeContext): MineInstance {
  const calm = ctx.settings.calmMode;
  const driver = createPlacementDriver(
    {
      band: ctx.band,
      pools: wordPools,
      stats: ctx.profile.keyStats,
      sessionIndex: ctx.profile.sessionCounter,
      targetLatencyMs: TARGET_LATENCY[ctx.band],
    },
    ctx.rng.fork("placement"),
  );
  const limitMs: Ms | null = calm ? null : PLACEMENT_MS;

  return createMine(ctx, {
    mode: "placement",
    plan: {
      targets: [driver.first()],
      // Timed: the session ends at 90 s. Calm mode has no timer, so the test ends after a set
      // number of blocks instead.
      end: limitMs === null ? { kind: "manual" } : { kind: "time", ms: limitMs },
      limitMs,
    },
    onBlock({ errors }) {
      const next = driver.next(errors);
      if (limitMs === null && driver.blocks() >= PLACEMENT_CALM_BLOCKS) return "end";
      return [next];
    },
    progress(done, leftMs) {
      if (leftMs === null || limitMs === null) return clamp01(done / PLACEMENT_CALM_BLOCKS);
      return clamp01(1 - leftMs / limitMs);
    },
    // No countdown: the bar fills instead, so nobody races a clock on their first day.
    timer: false,
    result(summary, loot): ModeResult {
      return {
        summary,
        loot,
        stars: 0,
        extra: { [PLACEMENT_TIER_EXTRA]: driver.tierReached() },
      };
    },
  });
}
