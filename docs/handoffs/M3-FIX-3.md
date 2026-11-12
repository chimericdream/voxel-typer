# M3-FIX-3 Placement test follow-ups (before Birch lessons ship)

Status: done

The follow-ups from the M3-05 review (PR #154, review 5870060807):

- Each rung of the ladder now shows all its new keys before it can open the next rung (N1).
- Each biome's gate is judged on the blocks that earned its rung, not on the whole test (N2).
- The test is offered once more after a quit or a reload (N4).
- A test now proves that stats from real lessons win (N5).
- The small items N6–N9 are fixed.

These keep their M3-05 values: 90 s in every mode, the Sprout cap at Frosty, the Miner cap at the Deep
Mines, and no numbers shown to the child.

Today only the Meadow has lessons, so `playableStart` still starts every child at the Meadow. These
rules take effect when Birch lessons ship.

## What changed

- `src/engine/placement.ts`:
  - The ladder tracks `pending`, the keys the rung still has to cover (`coverKeys`).
  - `ladderRecord(l, clean, text)` counts only blocks that use one of the rung's new keys
    (`testsNewKey`). It opens the next rung on 8 clean of the last 10 such blocks, and only once
    `pending` is empty.
  - New `RungScore` and `rungRates`.
  - `PlacementProgression.rungs?` is new. `estimatePlacement` judges each gate on the score of the
    blocks typed before the biome's rung opened, with at least `PLACEMENT_MIN_GATE_KEYS` (60)
    keystrokes.
  - The `PLACEMENT_MIN_ACTIVE_MS` doc now says "unpaused elapsed time".
- `src/engine/placement-driver.ts`:
  - `tierTargets(…, first)` puts the keys still to cover first, in a shuffled order. Each batch
    starts with the rung's `pending` keys.
  - `next(errors, t)` takes the break time. The new `rungScores(startT)` returns a cumulative
    score for each rung the test left.
- `src/modes/placement/`:
  - `placement.ts` passes the block time to the driver. It tracks pauses, so a rung's time leaves
    them out, as `activeMs` does. It hands back `extra.placementRungs`. The driver's
    `sessionIndex` is now `sessionCounter + 1`, the same as the estimate's (review N8).
  - `lesson.ts` adds `PLACEMENT_RUNGS_EXTRA`.
- `src/app/progress.ts`:
  - `placementRungsOf(result)` uses a type guard and drops malformed entries.
  - `placementEstimateOf` passes the rung scores on.
  - New `shouldOfferPlacement(profile)` and `settleAtMeadow(profile, at)` (N4).
- `src/ui/screens/Placement.tsx`: uses `isTestedOut` (N6). Skip now settles the start at the
  Meadow (N4).
- `src/ui/screens/Profiles.tsx` (outside "Owns", 8 lines): picking a player that
  `shouldOfferPlacement` matches settles the start at the Meadow and opens the placement screen
  instead of the map. Read-only profiles are never asked again.
- `src/i18n/en/placement.ts`: "That is fine!" is now "It is OK to miss some!" (review copy
  suggestion).
- `tools/sim-placement.ts`:
  - `HARD_KEYS`: digits are 2× slower with 2× the slips; Shifted capitals are 1.6× slower with
    1.5× the slips.
  - A `homeonly` typist: an average child who knows only the home row.
  - A "Lower on whole test" column: how many learners the M3-05 rule would have started earlier.
  - A rung-coverage table.
  - `simulatePlacement` now returns `{ rows, coverage }`.
- `docs/handoffs/M3-05.md`: the "30 s of active typing" wording is corrected (N8).
- Tests:
  - `tests/unit/engine/placement.test.ts`: coverage, new-key counting, the property test
    (fast-check seed 4305), the cover-first batch, rung scores, per-rung gates and the 60-key floor.
  - `tests/unit/app/placement.test.ts`: N5, rung parsing, per-rung gates through
    `placementEstimateOf`, the N4 helpers.
  - `tests/unit/modes/placement/placement.test.ts`: the 10 home keys come first, and rung time
    leaves a pause out.
  - `tests/unit/modes/mine/mine.test.ts`: the Sprout countdown default, with calm mode off (N7).
  - `tests/unit/sim/placement.test.ts`: N1 and N2 checks; the same-report test gets a 60 s timeout
    (decision 96).
  - `tests/unit/ui/screens/placement.test.tsx` and `screens.test.tsx`: Skip settles the start; the
    once-more offer.

## The items

### N1: rungs cover their new keys

- A letter rung (home, top, bottom) can open the next rung only after each of its new keys has
  broken cleanly at least once.
- Each batch of blocks starts with the keys still to cover, shuffled. A slipped key comes back at
  the start of the next batch.
- Only blocks that use one of the rung's new keys count toward 8 of the last 10. Old-key blocks
  change nothing, clean or not.
- Every block on the words rung counts, because that rung adds no keys. Every capitals block
  already has a capital.
- I tried the review's third option, a 70 % share of new keys in the random blocks. The
  generator's comfort rule keeps about half of the random letters on the easier keys, so 70 % can't
  hold. Coverage plus counting only new-key blocks already does the job, so I dropped that option
  and left the generator's rule alone.

| Rung   | First 8 blocks with a new key (M3-05 → now) | New keys shown before the next rung opens |
| ------ | ------------------------------------------: | ----------------------------------------: |
| top    |                                41 % → 100 % |                  2.9 of 10 → all 10 of 10 |
| bottom |                                 28 % → 88 % |                     1.9 of 7 → all 7 of 7 |

**What this does to where children start.**

- A child now sees every key of a rung before the test moves on. The home rung takes at least 10
  blocks instead of 8; the top rung at least 10; the bottom rung about 8.
- A child who doesn't know a key either breaks it cleanly or never opens the next rung.
- The `homeonly` typist slips on about 1 in 3 top- and bottom-row keys. It starts at the Meadow in
  96–99 % of runs, and at Birch or the Meadow in at least 99 %.
- To be plain about it, 8 of the last 10 is still a sliding window over 90 s, so even this child
  opens the top rung in most runs. What keeps them at the Meadow is the per-rung gate (N2), whose
  accuracy now includes their top-row slips.
- A careful hunt-and-peck child makes few slips. The ladder still can't catch that child, but the
  WPM gate on those same blocks can.
- The M3-GATE child playtest is still the real check.

### N2: each gate is judged on the blocks that earned its rung

I picked a variant of the review's "at or below the rung", and here is why.

- **The rule.** A biome's gate is judged on the blocks typed before that biome's rung opened. Those
  are the keys the biome treats as known, not the ones it teaches.
  - Birch is judged on the home row, Shore on home and top, and so on.
  - The Marsh teaches digits, so the Marsh gate is judged on everything up to the end of the
    capitals.
  - When those blocks are fewer than 60 keystrokes, the blocks of the next rungs join in, up to the
    whole test.
- **Why "before", not "at or below".** "At or below" judges the Marsh gate on the digits the Marsh
  is there to teach.
  - With slower digits, a 45 WPM Builder could then never reach the Marsh. In the sim, that rule
    started 99 % of fast Builders in the Deep Mines.
  - That gates a biome on the very skill it teaches.
- **Why the 60-key floor.**
  - The home rung alone is about 12 keys. Two slips there is 83 %, under Birch's 88 % bar.
  - With no floor, 2–6 % of average typists dropped to the Meadow by bad luck, and up to 13 % of
    slow typists were moved up by good luck.
  - With the floor, that noise is gone (see the table).
- A result with no rung scores (none exist today, but this guards against one) is judged on the
  whole test, as M3-05 did.

**What this does to where children start** (with the new slow digits and Shift):

- Fast Builders start at the Marsh 99 % of the time. The M3-05 rule would have started all of them
  lower, because about 60 s of slow digits pulled the whole-test WPM down to 29.
- Fast Miners stay at the Deep Mines (the cap).
- The `pinkyweak` typist is the one that changes most:
  - 24–26 % of Miners and Builders start one biome later than the whole-test rule would put them,
    and 1 % of Sprouts.
  - Their weak pinkies and slower capitals late in the test no longer lower the gates for the
    early rows, which they typed well.
  - They still start at Birch or Shore.
- Slow and average typists barely change (1 % or less), and they are no longer exposed to
  small-sample noise.

### N4: the test is offered once more

- `shouldOfferPlacement(profile)` holds when `progress.placement` is unset and `sessionCounter` is
  0, meaning the player has neither settled a start nor played anything.
- Where the offer comes from:
  - The first offer is still the one straight after making the player.
  - The repeat comes when the player is picked on the "Who is playing?" screen. That is the next
    visit after a reload, or after Pause → Quit.
  - Quit itself goes to the map as before: the child just chose to stop, so asking again right away
    would nag.
- Why it is asked only once more:
  - The repeat offer saves `placement: { doneAt, startBiome: "meadow" }` as it shows (`settleAtMeadow`).
  - Skip saves the same.
  - A test finished afterwards replaces it, through `applyPlacement`.
  - So the test is offered at most twice in all.
  - A read-only profile can't keep that mark, so it is never asked again.
- After any real lesson, it is never asked again.

### N5: stats from real lessons win

A new test gives the profile a `keyStats.f` with 300 attempts. The test's baseline has 10 attempts
on `f`, and after `applyPlacement` the profile still has the 300. Swapping the spread order now
fails this test; I checked by mutating the code.

### N6–N9

- **N6:** `Placement.tsx` calls `isTestedOut`. Neither `src/` nor the M3-05 tests have another
  `plays === 0`; the only one left is inside `isTestedOut` itself.
- **N7:** two Mine tests use a 60 s `meadow-01` with calm mode off:
  - a Sprout never sees a countdown;
  - a Builder sees one, and doesn't in calm mode.

  Forcing the countdown on (`opts ? opts.timer : true`) now fails a test; I checked.

- **N8:**
  - The 30 s floor is unpaused elapsed time (`activeMs`). I fixed the docs, not the code: every
    test runs 90 s, so the floor only guards against a cut-short result. The driver's
    `sessionIndex` now matches the estimate's.
  - The new per-rung WPM is elapsed time too, with pauses left out. It runs from the start of the
    test until the block that opened the next rung.
- **N9 (copy):**
  - "That is fine!" is now "It is OK to miss some!".
  - Reading the intro aloud to Sprouts is the review's follow-up suggestion, not done here.
  - Contracts §7 already says "builder, placement".

## Sim results

`npm run tool -- sim-placement --runs 200 --seed 1`. These are M1-07's typists, with digits 2×
slower and 2× the slips, and Shifted capitals 1.6× slower and 1.5× the slips. `homeonly` is the
average typist with 6× the slips on every top- and bottom-row letter.

| Band    | Typist    | Net WPM | Accuracy | Blocks | Meadow | Birch | Shore | Frosty | Mines | Marsh | Lower on whole test | Rungs reached (home/top/bottom/words/capitals/numbers) |
| ------- | --------- | ------: | -------: | -----: | -----: | ----: | ----: | -----: | ----: | ----: | ------------------: | ------------------------------------------------------ |
| sprout  | slow      |     8.1 |   92.2 % |     42 |  100 % |       |       |        |       |       |                     | 0/0/4/196/0/0                                          |
| sprout  | avg       |    19.3 |   95.3 % |     58 |    1 % |   1 % |  99 % |        |       |       |                 1 % | 0/0/0/200/0/0                                          |
| sprout  | fast      |    42.0 |   98.1 % |     94 |        |       |       |  100 % |       |       |                     | 0/0/0/200/0/0                                          |
| sprout  | pinkyweak |    17.5 |   94.9 % |     56 |    1 % |  25 % |  75 % |        |       |       |                 1 % | 0/0/0/200/0/0                                          |
| sprout  | homeonly  |    14.7 |   78.3 % |     81 |   99 % |   2 % |       |        |       |       |                 1 % | 0/9/38/153/0/0                                         |
| miner   | slow      |     8.3 |   92.5 % |     41 |  100 % |       |       |        |       |       |                     | 0/1/5/194/0/0                                          |
| miner   | avg       |    18.7 |   94.8 % |     53 |    1 % |       | 100 % |        |       |       |                 1 % | 0/0/0/32/168/0                                         |
| miner   | fast      |    38.8 |   98.0 % |     81 |        |       |       |        | 100 % |       |                     | 0/0/0/0/200/0                                          |
| miner   | pinkyweak |    16.9 |   94.6 % |     51 |    1 % |  31 % |  69 % |        |       |       |                26 % | 0/0/0/40/160/0                                         |
| miner   | homeonly  |    14.7 |   78.0 % |   78.5 |   97 % |   4 % |       |        |       |       |                 4 % | 0/6/32/162/0/0                                         |
| builder | slow      |     8.3 |   92.2 % |     41 |  100 % |       |       |        |       |       |                     | 0/0/5/195/0/0                                          |
| builder | avg       |    18.8 |   94.7 % |     52 |    1 % |   1 % |  99 % |        |       |       |                 1 % | 0/0/0/47/125/28                                        |
| builder | fast      |    29.3 |   97.3 % |  135.5 |        |       |       |        |   2 % |  99 % |               100 % | 0/0/0/0/0/200                                          |
| builder | pinkyweak |    17.2 |   94.3 % |     51 |        |  20 % |  81 % |        |       |       |                24 % | 0/0/0/51/141/8                                         |
| builder | homeonly  |    14.7 |   78.0 % |     76 |   96 % |   4 % |   1 % |        |       |       |                 4 % | 0/1/36/163/0/0                                         |

A row can add up to 101 % because of rounding. Net WPM and accuracy are over the whole test. "Lower
on whole test" means the M3-05 rule (every gate on the whole test) would have started that share of
learners in an earlier biome.

- Card acceptance still holds. Slow typists go to the Meadow (100 %), average ones to Birch or
  Shore (99–100 %), and fast Builders to Frosty or later (100 %). No Sprout goes past Frosty, and
  no Miner past the Deep Mines.
- Compared with M3-05 (whose sim had no slow digits):
  - Fast Builders stay at the Marsh (99 % against 100 %), even with slow digits.
  - Average typists start at the Shore as before (99–100 %), and the noise check keeps them off the
    Meadow.
- Both are checked with 40 learners a row in `tests/unit/sim/placement.test.ts`:
  - the slow-digits Marsh case and the whole-test comparison;
  - `homeonly` at the Meadow or Birch;
  - every new key shown before a letter rung opens.

## Acceptance

- [x] Sim results documented again, with slower digits and Shift for the sim typists: the table
      above. Proof: `tests/unit/sim/placement.test.ts`.
- [ ] Pedagogy review passes: for the reviewer. Each item's effect on where children start is
      written above.
- [x] Each item, with a test that fails on the old code:
  - **N1:** `tests/unit/engine/placement.test.ts`, "opens a rung only once each of its new keys
    broke cleanly" and "counts only blocks that use one of the rung's new keys", plus the property
    test.
  - **N2:** "judges each gate on the blocks that earned its rung" (engine and app), and "scores each
    rung it left, with paused time taken out" (mode).
  - **N4:** "offering the test again" (app), "offers a new player's placement test once more, then
    never again" (screens), and "Skip … settles the start".
  - **N5, N7:** each checked by mutating the code, as described above.
- `npm run verify` passed before the push: 3173 tests; initial JS 52.6 KB, within its budget.
- Local e2e (decision 79: 2am, one worker, port 4397): 87 of 87 passed. Screenshots were not
  compared locally; CI does that.

## Decisions

- **Gates use the blocks before the rung opened, with at least 60 keystrokes.** This is not the
  review's "at or below": that would gate a biome on the skill it teaches, and the Marsh would
  become out of reach. The reasons are under N2.
- **Coverage plus new-key counting, with no 70 % weighting.** The generator's comfort rule (half
  the random letters on easier keys) stays, as it is everywhere else.
- **The repeat offer comes on "Who is playing?", not on Quit.** It settles the start as it shows,
  so the test is asked at most twice and never nags.
- **`progress.placement` now means "the start is settled"**, by a test, by Skip or by the repeat
  offer. Skip writing it was the review's suggestion. A Meadow start with no lessons tested out
  looks the same either way.
- **`HARD_KEYS` lives in the sim only.** M1-07's shared typists stay unchanged, so other sims keep
  their results.

## New dependencies

- None.

## Notes for downstream tasks

- **M3-11 (Parent Dashboard):** `progress.placement` is also set by Skip and by the repeat offer
  (always `startBiome: "meadow"`). Don't read it as "took the test"; `history` has a `placement`
  entry only when the test was finished.
- **M3-14:** a fresh fixture profile picked on "Who is playing?" now opens the placement screen
  (once), not the map. Use a profile with `sessionCounter ≥ 1` or a `progress.placement` to go
  straight to the map.
- **More biomes:** nothing to do. The new rules apply as soon as `playableStart` can place a child
  past the Meadow.

## Contract change request / Questions

- No contract change. `PlacementProgression.rungs?` and `extra.placementRungs` are additive and
  task-local.
- Optional docs line for contracts §15 (`progress.placement`): "set by a finished test, by Skip,
  or by the one repeat offer (M3-FIX-3)".
- **For the pedagogy reviewer:**
  1. Is "the blocks before the rung opened, at least 60 keys" the right evidence for a gate?
  2. Are the `HARD_KEYS` factors (2× for digits, 1.6× for capitals) reasonable for children aged
     9–13?
  3. Should the ladder be stricter for slips? It is still 8 of the last 10, sliding.

Closes #161
