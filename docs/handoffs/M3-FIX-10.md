# M3-FIX-10 Placement small items

Status: done

The leftovers from the M3-FIX-3 review (PR #168, items N-a to N-d) and the placement follow-up from
the M3-FIX-7 review (PR #187, N2):

- A child who knows only the home row no longer starts past Birch Forest. The new **row floor**
  checks the top row on its own (and the bottom row on the way past the Shore).
- The gate docs now say what the code does.
- The 60-key floor's value is pinned by a literal test.
- Quitting the test and picking yourself again in the same visit no longer brings the test back
  straight away.
- The stale "at or below" comments are fixed.

## What changed

- `src/engine/placement.ts`:
  - New `PLACEMENT_ROW_FLOOR` (0.88), `firstTryShare(summary, keys)` and `rowFloorKeys(tier)`.
  - `estimatePlacement` has one new rule. A start past Birch needs at least 88 % of top-row places
    hit on the first try, over the whole test. A start past the Shore needs the same over the top
    and bottom rows together.
  - The JSDoc of `estimatePlacement`, `PLACEMENT_GATES` and `RungScore` now says which blocks
    really judge each gate (N-a).
- `src/engine/placement-driver.ts`, `src/modes/placement/lesson.ts`: the "at or below that rung"
  comments now say "from the start of the test until the next rung opened" (N-d).
- `src/app/types.ts`, `src/app/shell.ts` (outside "Owns", 8 lines): new
  `AppApi.placementOffered()`, a set of profile ids that lives for one page load.
- `src/ui/screens/Placement.tsx`: the intro adds the active profile's id to that set when it
  shows.
- `src/ui/screens/Profiles.tsx` (outside "Owns", as in M3-FIX-3): "Who is playing?" makes the
  repeat offer only for an id that isn't in the set (N-c).
- `tools/sim-placement.ts`: the `HOME_ROW_ONLY` comment says what holds that child back now.
- `docs/handoffs/M3-FIX-3.md`: the N2 rule now says which blocks really judge each gate (N-a).
- Tests:
  - `tests/unit/engine/placement.test.ts`:
    - literal 45- and 60-key rungs around the floor (N-b);
    - the row floor: its keys, its value, top row only, bottom row too, no record, and an
      unfinished place.
  - `tests/unit/sim/placement.test.ts`: "never past Birch" for home-row-only learners, over seeds
    1–10 × 3 bands × 40 learners. It replaces the "at most 1 in 40" check.
  - `tests/unit/ui/screens/screens.test.tsx`: a test that quits, then picks the same player in
    the same visit and goes to the map. A new visit still gets the offer.

## The items

### Home-row-only learners past Birch (M3-FIX-7 review N2)

**The rule.** To start past a biome, you must know the row it teaches. Past Birch, the top row;
past the Shore, the top and bottom rows together. "Know" means at least 88 % of the places that
asked for one of those keys were hit on the first try, over the whole test. 88 % is Birch's own
accuracy bar. Places are `attempts − errors`: with the `stay` policy each place ends on one right
press, and a second wrong press at the same place isn't counted.

**Why this rule and not the card's per-key floor on the ladder.** I tried three versions, each
over 10 seeds × 40 learners × 3 bands:

| Variant                                                                                  |            Home-row-only past Birch | What else it did                                                                 |
| ---------------------------------------------------------------------------------------- | ----------------------------------: | -------------------------------------------------------------------------------- |
| main                                                                                     |                            6 / 1200 |                                                                                  |
| Per key in the estimate (each key ≤ 20 % slips, 1 forgiven)                              |                                   0 | 3 % of fast Builders went to the Meadow, avg Shore fell from 99 % to 65 %        |
| Per key on the ladder (a cover key passes at ≤ 20 % slips on the rung, min 1 or 2 tries) | 10 / 1200 (min 1), 4 / 1200 (min 2) | **more** leaks, and weak-pinky Meadow went from 1 % to 12–16 %                   |
| Whole row in the estimate, home row too, 0.85                                            |                                   0 | avg and weak-pinky typists 1–3 % to the Meadow (pinky keys `a ;`)                |
| **Top row, then top + bottom, 0.88 (shipped)**                                           |                               **0** | fast typists unchanged; about 1 % of avg and weak-pinky typists go Shore → Birch |

- **Per key is too noisy.** A single key gets only 5–10 tries in a test. For a fast typist, 2
  slips on `d` out of 7 is common enough that one of 27 keys trips the floor in 3–5 % of runs. A
  row gets 25–140 places.
- **On the ladder it backfires.** It keeps the child on the top rung longer, so the few who get
  through are judged on lucky blocks. It also holds weak-pinky children on the home rung.
- **The home row has no floor.** Everyone starts at the Meadow anyway. In the sim, a home-row floor
  only moved average and weak-pinky typists back there, and stopped no home-row-only child.
- **The bottom row is pooled with the top row.** On its own, about 20 places let 0.9 % of fast
  Builders drop from the Marsh to the Shore. Pooled, none did.
- **The threshold.** 0.85 still let 1 in 3600 through (seed 30, top row 0.863). The home-row-only
  tail reaches 0.897, but the ones above 0.88 all failed the speed or accuracy gate. Under 0.88:
  1.5 % of average typists, 1.8 % of weak-pinky typists, 0 fast typists. Those children start at
  Birch instead of the Shore: one biome early, which is safe.

**Before → after**, seeds 1–30 × 40 learners (1200 per row). These are the sim's usual typists.
Rows where nothing changed are marked "same".

| Band    | Typist    | Meadow |         Birch |         Shore |        Frosty |        Mines |         Marsh |
| ------- | --------- | -----: | ------------: | ------------: | ------------: | -----------: | ------------: |
| sprout  | slow      |  100 % |               |               |               |              |               |
| sprout  | avg       |  0.1 % |   0.5 → 2.0 % | 99.4 → 97.9 % |               |              |               |
| sprout  | fast      |        |               |         0.1 % | 99.9 % (same) |              |               |
| sprout  | pinkyweak |  0.8 % | 23.8 → 24.6 % | 75.4 → 74.6 % |               |              |               |
| sprout  | homeonly  | 95.1 % |   4.6 → 4.9 % | **0.3 → 0 %** |               |              |               |
| miner   | slow      |  100 % |               |               |               |              |               |
| miner   | avg       |  0.1 % |   0.7 → 1.8 % | 99.3 → 98.1 % |               |              |               |
| miner   | fast      |        |               |               |               | 100 % (same) |               |
| miner   | pinkyweak |  0.7 % | 23.7 → 24.0 % | 75.7 → 75.3 % |               |              |               |
| miner   | homeonly  | 96.4 % |   3.2 → 3.6 % | **0.4 → 0 %** |               |              |               |
| builder | slow      |  100 % |               |               |               |              |               |
| builder | avg       |  0.1 % |   0.7 → 1.7 % | 99.3 → 98.3 % |               |              |               |
| builder | fast      |        |               |               |               |        2.0 % | 98.0 % (same) |
| builder | pinkyweak |  0.4 % | 24.8 → 24.9 % | 74.8 → 74.7 % |               |              |               |
| builder | homeonly  | 96.4 % |   3.3 → 3.6 % | **0.3 → 0 %** |               |              |               |

Home-row-only learners past Birch: **12 / 3600 → 0 / 3600** (seeds 1–10 alone: 6 → 0).

The standard report, `npm run tool -- sim-placement --runs 200 --seed 1`, after the change:

| Band    | Typist    | Net WPM | Accuracy | Blocks | Meadow | Birch | Shore | Frosty | Mines | Marsh | Lower on whole test | Rungs reached (home/top/bottom/words/capitals/numbers) |
| ------- | --------- | ------: | -------: | -----: | -----: | ----: | ----: | -----: | ----: | ----: | ------------------: | ------------------------------------------------------ |
| sprout  | slow      |     8.1 |   92.2 % |     42 |  100 % |       |       |        |       |       |                     | 0/0/4/196/0/0                                          |
| sprout  | avg       |    19.3 |   95.3 % |     58 |    1 % |   2 % |  98 % |        |       |       |                 1 % | 0/0/0/200/0/0                                          |
| sprout  | fast      |    42.0 |   98.1 % |     94 |        |       |       |  100 % |       |       |                     | 0/0/0/200/0/0                                          |
| sprout  | pinkyweak |    17.5 |   94.9 % |     56 |    1 % |  24 % |  76 % |        |       |       |                 1 % | 0/0/0/200/0/0                                          |
| sprout  | homeonly  |    14.7 |   78.4 % |     81 |   99 % |   2 % |       |        |       |       |                 1 % | 0/9/38/153/0/0                                         |
| miner   | slow      |     8.3 |   92.5 % |     41 |  100 % |       |       |        |       |       |                     | 0/1/5/194/0/0                                          |
| miner   | avg       |    18.7 |   94.8 % |     53 |    1 % |   1 % |  99 % |        |       |       |                     | 0/0/0/31/169/0                                         |
| miner   | fast      |    38.8 |   98.0 % |     81 |        |       |       |        | 100 % |       |                     | 0/0/0/0/200/0                                          |
| miner   | pinkyweak |    16.9 |   94.5 % |     51 |    1 % |  31 % |  69 % |        |       |       |                25 % | 0/0/0/39/161/0                                         |
| miner   | homeonly  |    14.7 |   78.1 % |   78.5 |   97 % |   4 % |       |        |       |       |                 4 % | 0/6/32/162/0/0                                         |
| builder | slow      |     8.3 |   92.2 % |     41 |  100 % |       |       |        |       |       |                     | 0/0/5/195/0/0                                          |
| builder | avg       |    18.8 |   94.7 % |     52 |    1 % |   2 % |  98 % |        |       |       |                     | 0/0/0/47/125/28                                        |
| builder | fast      |    29.3 |   97.3 % |    135 |        |       |       |        |   1 % |  99 % |               100 % | 0/0/0/0/0/200                                          |
| builder | pinkyweak |    17.2 |   94.2 % |     51 |        |  20 % |  80 % |        |       |       |                24 % | 0/0/0/53/139/8                                         |
| builder | homeonly  |    14.7 |   78.0 % |     76 |   96 % |   4 % |       |        |       |       |                 4 % | 0/1/36/163/0/0                                         |

Compared with the same report on main, the starts differ only here:

- avg: Sprout 1 → 2 % Birch, Miner 0 → 1 %, Builder 1 → 2 %.
- weak-pinky: Sprout 23 → 24 % Birch, Builder Shore 81 → 80 %.
- Builder homeonly: 1 % → 0 at the Shore.

The ladder, the rungs reached, the WPM, the accuracy and the coverage table are byte-identical,
because the floor only reads the summary at the end.

**Real Builders.** Fast Builders place exactly where they did: Marsh 98.0 %, Mines 2.0 % over 1200,
and none moved. Fast Miners stay at the Deep Mines (100 %) and fast Sprouts at Frosty (99.9 %).
Their top-row first-try share is never under 0.91 in 3600 runs.

The sim's home-row-only child types unknown keys at average speed. A real child hunts for them, so
they would also fail the speed gates more often. The M3-GATE playtest is still the real check.

### N-a: the docs and the code now agree

I made the docs match the code. The review judged the behaviour fine, and the row floor builds on
it. In practice the three letter rungs come to about 35 keys, under the 60-key floor. So the Birch,
Shore, Frosty and Deep Mines gates are all judged on everything up to the end of the words rung, or
on the whole test if the test never left it (every Sprout). Only the Marsh gate is judged on its own
blocks, up to the end of the capitals. Fixed in the `estimatePlacement`, `PLACEMENT_GATES` and
`RungScore` docs and in `docs/handoffs/M3-FIX-3.md`. Decision 92 says nothing about the gate
window. The orchestrator line is under Decisions.

### N-b: the floor test pins the value

The card says "import the real constant, not keep its own copy". The test already imported
`PLACEMENT_MIN_GATE_KEYS`; the review's point (N-b on #168) was that reading it back pins nothing.
Two literal rungs now sit next to it: 45 keys at 82 % must fall through to the whole test (Birch),
and 60 keys at 83 % must count (Meadow). I checked that setting the constant to 30 fails the test.

### N-c: no second offer in the same visit

- The shell keeps `placementOffered`, a set that lives for one page load.
- The placement intro adds the player when it shows: the first offer after New player, or the
  repeat offer.
- "Who is playing?" makes the repeat offer only to a player not in the set. So after Pause → Quit
  → Players → pick, the child goes to the map.
- The start isn't settled, so the next visit (a reload, or opening the game again) still offers
  the test once more, as M3-FIX-3 N4 meant.
- I checked that the new screens test fails without the check.

### N-d: stale comments

`placement-driver.ts` (`rungScores`), `modes/placement/lesson.ts` (`PLACEMENT_RUNGS_EXTRA`) and
`placement.ts` (`RungScore`) said "at or below that rung". They now say "from the start of the test
until the next rung opened".

## Acceptance

- [x] Each item fixed, or listed with a reason. All five are fixed, as described above.
- [x] No home-row-only learner is placed past Birch in 10 seeds × 40 learners.
      `tests/unit/sim/placement.test.ts`, "never starts a child who knows only the home row past
      Birch, over 10 seeds", checks all three bands. On main's estimate it fails with 6 learners at the
      Shore; I checked by removing the floor line. Over seeds 1–30 it is 0 of 3600 (12 on main).
- [x] Real Builders still place where they did: see the tables above.
- `npm run verify` passed before the push: 4395 tests; initial JS 61.8 KB.
- No local e2e: the push was at 8–9 pm, inside the owner's no-e2e hours. CI runs it.

## Decisions

- **Row floor for placement (M3-FIX-10).** A start past Birch needs ≥ 88 % of top-row places hit
  on the first try over the whole test, and a start past the Shore needs the same over the top and
  bottom rows together. There is no home-row floor and no per-key floor; the reasons are above.
- **Decision 92 add-on for the orchestrator:** "The Birch–Deep Mines gates are judged in practice
  on everything up to the end of the words rung (the letter rungs are under the 60-key floor), and
  the Marsh gate up to the end of the capitals (M3-FIX-10)."
- **"Same visit" means one page load.** The set lives in the shell, not in the save, so a reload
  still gets the one repeat offer.

## New dependencies

- None.

## Notes for downstream tasks

- **M3-11 (Parent Dashboard)** and anything else that explains placement: "skipped Birch" now
  also means "typed the top row right on the first try at least 88 % of the time".
- **More biomes:** nothing to do. The rule applies as soon as `playableStart` can place a child
  past the Meadow.
- `AppApi.placementOffered()` is new app API (not a frozen contract). Only the shell implements
  `AppApi`, so no fakes needed updating.

## Contract change request / Questions

- No contract change.
- **For the pedagogy reviewer:** is 88 % first-try on the row (Birch's own bar) right? It moves
  about 1 % of average typists from the Shore to Birch. At 0.85 that is 0.1 %, but 1 in 3600
  home-row-only learners got through.

Closes #180
