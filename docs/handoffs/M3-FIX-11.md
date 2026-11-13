# M3-FIX-11 Progression fixes from the sim study

Status: partial (items 1, 3 and 4 done; item 2 is done in code, but one of its acceptance
numbers holds only at a lower `err0`, see Questions; item 5 left for the owner)

Items 1–4 of the card. Item 5 (Sprout's second star at 80 %) waits on the owner and is not
touched. All numbers come from `npm run tool -- sim-progression --study --runs 40 --seed 1` and
`--sweep --runs 40 --seed 1`, and `docs/sim.md` has the full tables.

## What changed

- **Camp cache bug (item 1), `src/app/recommend.ts` and `src/engine/remedial.ts`.**
  - `remedialId(keys, session, scope)` hashes a scope too. `dueRemedial` passes
    `<profile id>:<anchor id>:<layout id>`.
  - So siblings on one device with the same weak keys at the same session count each get their
    own camp. The bug gave a younger child the older child's camp, which used keys the younger
    child hadn't been taught. A child who reaches a new lesson also gets a new camp.
  - The id still starts with `remedial-`, so `isRemedialId`, the rate limit and `applyResult`
    are unchanged.
- **Failed mastery check (item 2), `nextCurriculumLesson`.**
  - Nothing fresh is left, and the current biome's mastery lesson is played, not tested out, and
    under 2★? Then the next lesson is the mastery check, unless the last curriculum session _was_
    the check. In that case it is one fewest-stars replay from the same biome (never the check
    twice in a row).
  - Camps in between don't count as the replay.
  - The No Peeking! skip rule and the tested-out rule are unchanged, and both are tested.
  - The map's next cue still follows `nextCurriculumLesson`, so the camp stays a side stop
    (M3-06 B1).
  - `RecommendOptions.masteryRetry: "fewest"` keeps the old rule for the study's comparison. The
    game passes no options.
- **Remedial trigger (item 3), `src/engine/remedial.ts`.**
  - `RemedialRules { minWeight, minAttempts, relative, every, speed }`, with shipped defaults in
    `REMEDIAL_RULES`. `suggestRemedial` takes `rules`, `remedialAllowed` takes `every`, and
    `recommendNext`/`dueRemedial` take `RecommendOptions.remedial`. All of it stays pure.
  - A key is weak at weight ≥ 4 **and** ≥ `REMEDIAL_RELATIVE` (1.5) × the median weight of the
    allowed keys, with ≥ 30 attempts. `REMEDIAL_EVERY` is now 4 (was 3).
  - `speed: false` computes the trigger's weights with no latency term. It was tried for Sprouts
    and not shipped (see Decisions).
- **One session builder (item 4), `src/modes/mine/logic.ts`.**
  - `planLesson` (targets, time limit, session rules), `sessionRules`, `lessonStars` and
    `focusKeys` moved out of `mine.ts`.
  - `mine.ts` and `tools/sim-progression.ts` both call them, so the sim's copy of `plan()`, its
    star scoring and its `focusKeys` copy are gone.
  - Mine's own behaviour is unchanged: same rng forks, same rules, and free play still plays 30
    letters.
- **Sim (item 4), `tools/sim-progression.ts`.**
  - New flags: `--policy game|alternate|fewest|mastery-first`, `--err-scale`, `--lat-scale`,
    `--relative`, `--every`, `--sprout-speed on|off` and `--sweep`.
  - `--study` now prints three configurations (game, before M3-FIX-11, camps passed by) and a
    sensitivity table: game and before at `err0` × 0.5, 0.7 and 1.0.
- **Docs, `docs/sim.md`.** The Progression study is rerun and refreshed.
  - Flags, the shared `planLesson`, the new results, the sweep, and findings given as ranges.
  - "Camps help little" is now "what camps do can't be measured here (no forgetting)".
  - A stuck run is described as standing in for the risk of quitting, not as real behaviour.
- **Tests:**
  - `tests/unit/engine/remedial.test.ts`:
    - the two-profile test, which fails on the old code (checked by removing the scope);
    - the new-anchor test and scoped ids;
    - the relative trigger, the injectable rules and the speed switch;
    - the every-4 rate limit;
    - the mastery alternation, the tie, the old rule, and the skip and tested-out rules.
  - `tests/unit/modes/mine/mine.test.ts`: Mine plays exactly the blocks `planLesson` makes.
  - `tests/unit/sim/progression.test.ts`:
    - the Phase 3 pin (the median of five average Miners finishes biomes 1–4 in 40–90 sessions);
    - `--policy alternate` equals the game and `fewest` differs;
    - the new flags.
  - `tests/unit/ui/map.test.tsx`: the offer slots are now 0, 4, 8, ….

## Acceptance

- [x] **1. Camp cache bug fixed, with a two-profile test** that fails on the old code:
      `remedial.test.ts` › "camps on a shared device".
- [~] **2. Alternating mastery retry.** Done in code and tested. The numbers for slow Sprouts,
  before → now:

  | `err0` × | Learners with a stuck run (≤ 20 %?) | Median longest 1★ run (no worse?) |
  | -------- | ----------------------------------- | --------------------------------- |
  | 0.5      | 20 % → 0 % (yes)                    | 2 → 2 (yes)                       |
  | 0.7      | 68 % → 8 % (yes)                    | 5 → 5 (yes)                       |
  | 1.0      | 95 % → **65 %** (no)                | 10 → **12** (no)                  |

  At × 1.0 a slow Sprout fails the 85 % mastery bar 2–3 times running, and with one replay
  between attempts that already makes a 5-session run. The longest 1★ run grows because they
  now move on sooner (fewer replays and camps between new lessons), and 79 % of their first
  plays are 1★. Both are the Sprout second-star bar (item 5), not the replay rule. See
  Questions.

- [x] **3. Remedial trigger.** It is injectable and swept over × 1.25 / 1.5 / 2, every 3 / 4,
      and Sprouts without speed. Final: × 1.5, every 4, speed on.
  - Slow learners' camp share: 4–8 % (≤ 20 %), was 23–32 %.
  - Slow Sprouts finish Meadow in 13–15 sessions (≤ 20), was 17–18.
- [x] **4. Sim.**
  - `--policy alternate`, `--err-scale` and `--lat-scale` are in.
  - Mine and the tool share `planLesson`, and the star scoring (`lessonStars`) too.
  - The CI pin passes: the average Miner finishes in 56–62 sessions over `err0` × 0.5–1.0, and
    the test runs five learners at × 1.0.
  - Findings are given as ranges with the sensitivity table, "help little" is reworded, the
    study is rerun and `docs/sim.md` is refreshed.
- [x] No-failure rule: `applyResult` is unchanged, and remedials still write no lesson record
      ("playing a remedial never counts as a lesson"). Nothing lowers stars, unlocks, inventory
      or `found`.
- [x] No new kid-facing copy. Pure zones stay pure (`npm run lint`: check-boundaries clean).
- [x] `npm run verify` passes locally; see CI.
- E2E: not run locally (before midnight, owner rule). No fixture changes:
  - every profile in `tests/fixtures/profiles/` gets no camp under the old or the new rule;
  - each fixture's next lesson is the same under the old and the new mastery rule.

  So no screenshot baselines should move.

## Decisions

- **Camp rule × 1.5, every 4, speed in the trigger for every band.**
  - × 1.25 leaves slow learners at 19–27 %.
  - × 2 turns camps off almost entirely (0–4 %), so a child with one really weak key would
    never be offered practice.
  - Leaving speed out for Sprouts gave slow Sprouts about the same share (8–11 % against 5 %),
    cut average Sprouts to 2–3 %, and didn't lower stuck runs.
- **The replay between mastery attempts is the fewest-stars lesson of the current biome**, not
  counting the check. Ties go to the earliest lesson, as before. Only curriculum sessions count
  for "the last session was the check", so a camp in between doesn't use up the replay.
- **A tested-out mastery lesson is never retried this way.** It isn't a score (decision 92).
- **The scope is profile + anchor + layout**, as the review asked. The anchor makes a new camp
  after every new lesson, and the layout covers a layout change between sessions.
- **`RecommendOptions` exists only for the study.** The game never passes it. This is additive:
  the existing two-argument calls are unchanged.

## New dependencies

- None.

## Notes for downstream tasks

- `planLesson` and `lessonStars` in `src/modes/mine/logic.ts` are now the one place a Mine
  lesson is built and scored. Change them there, and the sim follows.
- A remedial id now depends on the profile, the anchor and the layout. A test that builds a
  remedial id by hand must pass the same scope.
- The study takes about 5 minutes, and the sweep about 4.

## Contract change request / Questions

- **Item 2 at `err0` × 1.0 (for the orchestrator and the learning review).** The card's two
  numbers (≤ 20 % stuck, longest 1★ run no worse) hold at × 0.7 and × 0.5, not at × 1.0.
  - The M3-13 review argued × 1.0 is pessimistic for a guided 6-year-old.
  - The rule is the one the card specifies. I didn't add more rules to hit the number at × 1.0,
    because what is left there comes from the 85 % second-star bar (item 5).
  - Please confirm that the × 0.7 result is enough, or say which other change you want. I
    didn't run a throwaway 80 % check this time; M3-13's showed it lowers the slow-Sprout 1★
    share and runs.
- No contract change. `docs/impl/contracts.md` doesn't define the remedial or recommend APIs.

Closes #200
