/**
 * Star rating of a finished lesson (docs/impl/contracts.md §6). Pure.
 *
 * ```
 * stars = 1  if the lesson completed
 *       + 1  if accuracy ≥ max(0.90, lesson.targets.accuracy)
 *       + 1  if accuracy ≥ 0.95 AND (no wpmRelative OR netWpm ≥ baseline × wpmRelative)
 * baseline = median netWpm of the profile's last 10 summaries in mine/practice/minecart modes;
 *            if fewer than 3, wpmRelative is ignored
 * ```
 *
 * Speed only ever counts relative to the learner's own baseline.
 */
import type { Lesson } from "@/content/lessons/types";
import type { GameModeId } from "@/types/core";
import { median } from "./stats";
import type { SessionSummary } from "./stats";

/** A lesson's star rating. 0 only when the lesson was not completed. */
export type StarCount = 0 | 1 | 2 | 3;

/** The modes whose summaries make up the speed baseline. */
export const BASELINE_MODES: readonly GameModeId[] = ["mine", "practice", "minecart"];
/** How many of the newest matching summaries the baseline looks at. */
export const BASELINE_WINDOW = 10;
/** With fewer matching summaries than this there is no baseline. */
export const BASELINE_MIN_SUMMARIES = 3;
/** Accuracy floor of the second star. */
export const SECOND_STAR_ACCURACY = 0.9;
/** Accuracy floor of the third star. */
export const THIRD_STAR_ACCURACY = 0.95;
/**
 * Slack on the speed check, in WPM, so float noise in `baseline × wpmRelative` (20 × 1.1 is
 * 22.000000000000004) never costs a star.
 */
const SPEED_EPSILON = 1e-9;

/**
 * The learner's baseline net WPM: the median `netWpm` of the newest 10 summaries in `mine`,
 * `practice` or `minecart`, or `null` when there are fewer than 3 such summaries. `history` is
 * oldest first, newest last (as in `Profile.history`).
 */
export function baselineNetWpm(
  history: readonly Pick<SessionSummary, "mode" | "netWpm">[],
): number | null {
  const recent = history
    .filter((summary) => BASELINE_MODES.includes(summary.mode))
    .slice(-BASELINE_WINDOW)
    .map((summary) => summary.netWpm);
  return recent.length < BASELINE_MIN_SUMMARIES ? null : median(recent);
}

/** What {@link computeStars} needs to rate one play of a lesson. */
export interface StarInput {
  /** Whether the lesson was completed. No stars without it. */
  completed: boolean;
  /** The play's accuracy, 0–1 (`SessionSummary.accuracy`). */
  accuracy: number;
  /** The play's net WPM (`SessionSummary.netWpm`). */
  netWpm: number;
  /** The lesson's goals. */
  targets: Lesson["targets"];
  /** From {@link baselineNetWpm}, over the history before this play. `null`: no baseline yet. */
  baseline: number | null;
}

/** The star rating of one play of a lesson, by the rules above. */
export function computeStars(input: StarInput): StarCount {
  const { completed, accuracy, netWpm, targets, baseline } = input;
  if (!completed) return 0;
  const second = accuracy >= Math.max(SECOND_STAR_ACCURACY, targets.accuracy);
  const fastEnough =
    targets.wpmRelative === undefined ||
    baseline === null ||
    netWpm >= baseline * targets.wpmRelative - SPEED_EPSILON;
  const third = accuracy >= THIRD_STAR_ACCURACY && fastEnough;
  if (second && third) return 3;
  if (second || third) return 2;
  return 1;
}
