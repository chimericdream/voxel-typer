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
 * With a `band` the accuracy bars depend on the age band (decision 80, contracts §6). `target` is
 * `lesson.targets.accuracy`:
 *
 * | Band    | 2nd star: accuracy ≥     | 3rd star: accuracy ≥ | 3rd star speed check |
 * | ------- | ------------------------ | -------------------- | -------------------- |
 * | sprout  | max(0.85, target − 0.05) | 0.90                 | none                 |
 * | miner   | max(0.88, target − 0.02) | 0.93                 | as above             |
 * | builder | max(0.90, target)        | 0.95                 | as above             |
 *
 * No band means the rules above, which are Builder's.
 *
 * Speed only ever counts relative to the learner's own baseline.
 */
import type { Lesson } from "@/content/lessons/types";
import type { AgeBand, GameModeId } from "@/types/core";
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
 * Slack on the accuracy checks, so `target − 0.05` (0.9 − 0.05 is 0.8500000000000001) never puts
 * the bar above the accuracy it names.
 */
const ACCURACY_EPSILON = 1e-9;

/** The star bars of one age band (contracts §6). */
export interface BandStarRule {
  /** The second star's floor, whatever the lesson's target. */
  secondFloor: number;
  /** How far below the lesson's accuracy target the second star's bar may sit. */
  secondSlack: number;
  /** The third star's accuracy floor. */
  third: number;
  /** Whether the third star also needs the speed goal. */
  speedCheck: boolean;
}

/** The star bars per age band (decision 80). Builder's are the rules with no band. */
export const BAND_STAR_RULES: Readonly<Record<AgeBand, BandStarRule>> = {
  sprout: { secondFloor: 0.85, secondSlack: 0.05, third: 0.9, speedCheck: false },
  miner: { secondFloor: 0.88, secondSlack: 0.02, third: 0.93, speedCheck: true },
  builder: {
    secondFloor: SECOND_STAR_ACCURACY,
    secondSlack: 0,
    third: THIRD_STAR_ACCURACY,
    speedCheck: true,
  },
};

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
  /** The learner's age band. Missing: Builder's bars, the rules from before bands. */
  band?: AgeBand;
}

/** The star rating of one play of a lesson, by the rules above. */
export function computeStars(input: StarInput): StarCount {
  const { completed, accuracy, netWpm, targets, baseline, band } = input;
  if (!completed) return 0;
  const rule = BAND_STAR_RULES[band ?? "builder"];
  const secondBar = Math.max(rule.secondFloor, targets.accuracy - rule.secondSlack);
  const second = accuracy >= secondBar - ACCURACY_EPSILON;
  const fastEnough =
    !rule.speedCheck ||
    targets.wpmRelative === undefined ||
    baseline === null ||
    netWpm >= baseline * targets.wpmRelative - SPEED_EPSILON;
  const third = accuracy >= rule.third - ACCURACY_EPSILON && fastEnough;
  if (second && third) return 3;
  if (second || third) return 2;
  return 1;
}
