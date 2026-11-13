# M4-FIX-2 Night Defense pacing and leftovers

Status: done

## What changed

- `src/modes/defense/director.ts`: adds `DIRECTOR_CONSTANTS.maxIdleMs` (2,500 ms, the same for
  every band) and two pure helpers. `idlePullMs` says how far to move a wave's spawn clock forward
  once the field is empty. `breakMs` gives the pause between waves. The module comment now defines
  the empty field.
- `src/modes/defense/logic.ts`: adds `fieldEmpty(mobs)`, which is true while no mob is `walking`
  or `waiting`. A mob that is popping or bonking doesn't need typing, so it doesn't count.
  `INTERMISSION_MS` (3 s) stays the announcement's time and is now only the longest possible pause.
- `src/modes/defense/defense.ts`: counts `emptyMs` in night time, across waves and pauses, and
  resets it on each spawn. An empty field pulls the next spawn forward, and the rest of the wave
  with it, so spawn gaps and arrival order stay as planned. The pause between waves ends so the next
  wave's first mob comes `maxIdleMs` after the field emptied (usually about 1 s of pause, not 3 +
  1.2 s).
- **Dusk (second commit, per the orchestrator's answer to Question 1):** the first wave now
  starts with dusk.
  - The dusk banner keeps its 4 s. The first mob sets out 1.2 s in, while the banner still shows,
    and can be typed then. Keys, the lit key and hear-again work during dusk; a key at an empty
    field is still dropped.
  - The sky turns to night when the banner's time is up. The start hint waits for the banner and
    shows then.
  - The field's longest empty stretch at the start of the night was 5.2 s (4 s of dusk, then
    1.2 s). It is now 1.2 s.
- `logic.ts` `clearOfBanner`: the plates' top moves below the HUD message (the dusk banner, any
  banner, the Caps Lock hint) when it reaches into their room, so a banner never covers a word.
  The layout already keeps room for a one-line banner; this covers a taller one (a large text
  scale, a narrow screen). `defense.ts` measures the message's real box each frame.
- `tools/sim-defense.ts`: `playWave` plays spawns and arrivals in time order and uses the same
  helpers, so the sim paces exactly like the game. It records every empty stretch. The report has
  a new column, "Empty max". It also gains `PACING_TYPISTS` (5, 10, 25, 40, 60 WPM) and
  `pacingRows()` (every band × typist, with a baseline, new and calm). These rows are not in the
  main report.
- Tests:
  - `tests/unit/modes/defense/director.test.ts`: the helpers, including a property test that a
    pull never holds a mob back.
  - `logic.test.ts`: `fieldEmpty`, and `clearOfBanner` (examples, plus a property test that laid
    out plates stay below the banner).
  - `defense.test.ts`: the first mob sets out within `maxIdleMs` of dusk with the banner still up,
    and its first letter types then (Sprout, Miner, Builder). The empty-field test now measures
    from the first frame of dusk. The habit-space test presses its "empty field" keys at the start
    of dusk, which is now the only empty moment before the first mob.
  - `defense.test.ts`: the real mode, frame by frame, across six cases. Miner at 150 ms and at
    1.5 s a key, an idle Miner, a calm Sprout at 1 s, Builder at 400 ms, and an idle Builder. The
    test also pins `maxIdleMs` ≤ 3 s, the owner's number. The rig gains an `afterFrame` probe.
  - `tests/unit/sim/sim-defense.test.ts`: the card's sim test, which also checks the night's
    opening stretch (the sim's new `openingMax`: from the start of the night to the first mob).
- `docs/sim.md`: new tables (the "Empty max" column; the sweep is unchanged) and a "Pacing"
  section with before and after numbers.
- e2e:
  - `tests/e2e/defense.spec.ts`: the Miner night's budget goes from 7 to 10 min (see Decisions).
    Every plate check also counts plates under the banner (must be 0), including the first plate,
    which now shows during dusk. The Sprout test checks the first plate is up while the dusk
    banner still shows, and attaches a picture of it (`sprout-dusk-first-visitor`). The
    reduced-motion test runs through the same dusk.
  - `tests/e2e/model-lab.spec.ts`: the line-47 test gets its own 90 s timeout. This was approved
    as a "May touch" for this one change.

## Acceptance

- [x] A sim test: across bands and 5–60 WPM typists, no stretch of empty field is longer than
      `maxIdleMs` + 250 ms, except the dawn ending.
  - `sim-defense.test.ts` › "pacing" covers the 9 main rows at 50 learners × 10 waves, plus 54
    pacing rows (3 bands × 6 typists × baseline/new/calm) at 6 learners × 5 waves.
  - The longest stretch is now 2.5 s on every row. Before, it was 6–26 s, and 86 s at 5 WPM.
  - The mode test in `defense.test.ts` checks the same bound on the real mode at 16 ms frames.
  - Mutation checks: turning off the pull fails both tests (20.2 s in the sim). A 3 s pause fails
    the mode test (3,024 ms).
- [x] The existing director tests pass, with no number retuned. `npm test` passes.
  - Every row of the convergence table is the same as before, digit for digit: accuracy, reached,
    swamped, crowded, low and the `d` path. The plant sweep is the same too. A mob is only brought
    forward while the field is empty, when the typist is under no pressure. Gaps and arrival order
    after it are kept, and the sim's random draws are per key.
  - So the 50 WPM pin still holds (learner mean 93.4–96.4 %, inside 90–97 %), and so does
    10/25 WPM in 85–95 %.
- [x] The slow typists' dips are still 16–23 % of waves under 85 % at 10 WPM, pinned at ≤ 25 %
      (unchanged).
- [x] Crash memory: nothing depended on it. A grep for "crash" in `src/modes/defense`, `tools`,
      the defense tests and the sim test finds nothing. Only the prose in `docs/sim.md` and the
      M4-04 handoff mentions it.
- [x] M4-04 star gate (half the visitors sent home for 2 stars, four fifths for 3): `nightStars`
      is unchanged. The pacing doesn't move the share sent home in any sim row ("Reached 4+" is
      the same), and the gate's mode test passes. An idle child sees the same number of visitors,
      only sooner, and still gets the one star for seeing the night through.
- [x] Dawn ending: not measured, and still empty on purpose (`DAWN_MS` unchanged).
- [x] Dusk (orchestrator): the first mob is on the field and typeable 1.2 s after the night starts,
      with the banner still up. `defense.test.ts` › "sends the first visitor while the dusk banner
      is still up" checks this. The banner never covers a plate: `clearOfBanner` (unit and property
      tests) and the e2e `overBanner` checks. Reduced motion changes nothing here; the e2e
      reduced-motion night goes through the same dusk.
- [x] The `defense` night-budget e2e and the `model-lab` line-47 timeout (see Decisions).
- [x] `npm run verify` passes.

## Decisions

- **"Empty" is "no mob on the field still needs typing".** A popping or bonking mob doesn't count,
  because it is no longer a lockOn target. This is the card's "no mob visible and walking, and no
  word left to type". A calm mob at the waiting line does count (it still needs typing).
- **The rest of the wave moves with its next mob.** Pulling only the one mob forward would bunch it
  up with the next one and break M4-05's arrival spacing, the cause of the old pile-ups.
- **The night starts at dusk.** The count starts on the first frame of dusk, which is also when
  the first wave starts. The dawn isn't counted.
- **Dusk keeps its 4 s** as the time the banner and the dusk sky stay up, not as a wait. The night
  sky comes when it ends.
- **"About to empty"** is covered by the bound itself: the next mob comes at most `maxIdleMs` after
  the field empties, whether it was planned sooner or later. Pulling earlier, while the last word is
  still being typed, would put pressure on the child, so this doesn't do it.
- **Night-budget e2e: a sane budget, not determinism.** The test plays a real night on game time,
  and game time follows CI's slow software-rendered frames. On main it took 6.1, 6.4, 6.6 and
  7.2 min against a 7 min timeout. The pacing fix shortens the night itself by about a third (the
  unit rig's Miner night at 300 ms a key: 124 s → 82 s of game time; at 600 ms: 128 s → 106 s).
  The budget goes to 10 min on top of that. Making it deterministic would need a game-speed debug
  param, which is a contract change (§13).
- **model-lab line 47:** `test.setTimeout(90_000)`. It took 23.8–27.7 s on CI against 30 s, and it
  grows with every model.

## New dependencies

- None.

## Notes for downstream tasks

- **5 WPM learners (follow-up card).** The pacing doesn't change them, measured both ways (50
  learners, 10 waves, seed 1):
  - learner mean 82–87 % from wave 4 on, and 73 % for a new Builder profile;
  - 37–52 % of their waves under 85 %, and 65 % for a new Builder;
  - 11–20 % of waves swamped, and 46 % for a new Builder (23 % of mobs at the base).

  Calm mode does better: means 86–90 %, 23–34 % of waves under 85 %. The rows are
  `pacingRows()` in `tools/sim-defense.ts`, for typist `5wpm`. The profile is M1-07's `slow` one
  at 5 WPM, a guess.

- **The night now starts at dusk.** `phase()` is `dusk` for the first 4 s of typing. A test that
  waits for `night` before the first mob (M4-10) will find it already on the field.

- `idlePullMs` and `breakMs` are exported from the director. M5 bosses' `minions` phase can reuse
  them with the same `maxIdleMs`.
- The wave announcement banner still stays up for `INTERMISSION_MS` (3 s). The pause is now
  shorter, so the banner is still showing as the wave's first mob sets out.
- `tools/sim-defense.ts`'s `playWave` takes an optional `WavePacing` (`emptyBeforeMs`, `idle`).
  `playNight` takes an optional `idle` array.

## Contract change request / Questions

No contract change. Both questions from the first commit are answered: dusk is done in this PR,
and the 5 WPM learners get a follow-up card (numbers above).

Closes #182
