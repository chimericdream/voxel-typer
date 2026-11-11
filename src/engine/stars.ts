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
 *
 * The contracts pin these rules but give no function signature. M1-04 adds `computeStars` and
 * `baselineNetWpm` here.
 */
// oxlint-disable-next-line unicorn/require-module-specifiers -- placeholder: nothing to export yet
export {};
