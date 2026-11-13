# M4-FIX-3 Night Defense for 5 WPM learners

Status: done

## What changed

- `src/modes/defense/director.ts` (pure, still a pure zone): four changes for slow learners, each
  aimed at a cause I found with a per-wave trace.
  - `travelMs.max` goes from 40 s to 90 s. At 5 WPM a walk of three words' time is 45–80 s, so the
    old cap made a slow Builder's mobs walk about twice as fast as anyone else's, measured against
    their own typing.
  - New `minWaveKeys` (Sprout/Miner/Builder 16/24/30 keys at the middle word length) in
    `waveSize`. A slow Sprout's wave was 3 words of 3 letters, so one slip read as a bad wave.
  - `mobTiming`: the reaction allowance is the band's, or one key at the reference speed if that
    is longer.
  - New `throughputWpm`, plus `WavePlan.charsPerWord` and `WavePlan.referenceWpm`. A new
    profile's first wave with more than 10 % of its mobs at the base sets `d` to
    `0.8 × measured / reference`, once. `dMin` goes from 0.3 to 0.2.
  - The calm slowness signal adds `WaveFeedback.pulledMs` (new, optional) back to `activeMs`.
  - The module comment and the constant docs are updated to match.
- `src/modes/defense/logic.ts`: `WaveTally.pulledMs`, which `waveFeedback` passes on.
- `src/modes/defense/defense.ts`:
  - It adds up each idle pull into `tally.pulledMs`.
  - `syncPlates` caches the HUD message's box (#188 review). It measures the box only for 30
    frames after the banner or Caps Lock state changes, or after `relayout` runs (resize and the
    early font frames), and keeps it the rest of the time. Before, it forced a layout every frame.
- `tools/sim-defense.ts`:
  - `playWave` reports `pulledMs`.
  - New `slowRows()`: 5 WPM in every band, with a baseline, new and calm.
  - New `--slow 1` flag, which prints those rows.
- Tests:
  - `director.test.ts`:
    - The property test now feeds the plan's new fields. Only the new-profile reset may step
      down more than 15 %.
    - The calm test also covers pulled waves.
    - A new block, "slow learners (M4-FIX-3)", tests `throughputWpm`, the reset (and that it
      happens once, and never for a learner with a baseline), the key minimum, the first-key
      time, and the walk.
  - `sim-defense.test.ts`:
    - A new 5 WPM pin.
    - The 10 WPM low pin tightens from 25 % to 22 %.
  - `logic.test.ts` and `defense.test.ts` check `pulledMs`. The mode reports it, and it is
    above 0 on a quick typist's night.
- `tests/e2e/defense.spec.ts`: the Miner night's budget comment names the 3.9 min CI baseline. The
  budget goes from 600 s to 480 s, about twice that, as the review suggested.
- `docs/sim.md`:
  - Refreshed main table and sweep.
  - Updated controller text and pins.
  - A new "Slow learners: 5 WPM (M4-FIX-3)" section: the causes, a step-by-step table, a
    before/after table on 3 seeds × 100 learners, the 5 WPM rows, and the star-gate numbers.

## Acceptance

- [x] **Pin 5 WPM:** at most 30 % of waves under 85 % and no swamped waves for any band, a new
      profile included. `sim-defense.test.ts` › "5 WPM (M4-FIX-3)" runs 9 rows: 3 bands ×
      baseline, new and calm, at 50 learners, seed 1. It pins low ≤ 30 %, swamped ≤ 5 %, crowded
      ≤ 5 %, learner mean ≥ 88 %, swamped in waves 1–3 ≤ 5 % (≤ 36 % for a new profile), and the
      idle cap. "No swamped waves" is read as the main rows' chance floor; see Decisions.
- [x] **10 WPM keeps ≤ 25 % with headroom across 3 seeds of 100 learners:** 15–20 % on every row
      and seed (it was 17–28 %). The reviewer's 30-learner Miner row is now 20.5 % (it was 26.7 %).
      The pin is now 22 %.
- [x] **The 50 WPM pin and the idle cap still pass.** The 50 WPM learner means are 93.2–96.4 %
      (pin 90–97 %; they were 93.4–96.4 %). Every 25 and 50 WPM row is within 0.2 points of
      before. The idle cap is 2.5 s on every main, slow and pacing row, and the mode-level
      frame test passes.
- [x] **Star gate and no failure:** `nightStars` is unchanged, and no code path takes anything
      away. The share of learners who pass the gate went up or held on every row I measured (3-wave
      night, 50 learners). A new 5 WPM Builder reaches 2 stars in 100 % of nights (it was 0 %). See
      `docs/sim.md`.
- [x] **#188 review items:**
  - The banner box is cached (see above).
  - The e2e budget comment names 3.9 min.
  - The calm signal: the pull had made calm waves read about 30 % less slow (median time over
    plan 0.63 → 0.44). With `pulledMs` added back, it reads 0.63 again, the same as with the pull
    off, at 5, 10 and 25 WPM.
- [x] `npm run verify` passes.

### Before / after (3 seeds × 100 learners, waves 4 on; the range over the seeds)

| Typist | Band    | Profile  |       Learner mean 4+ |            Low 4+ |      Swamped 4+ |       Swamped 1-3 |
| ------ | ------- | -------- | --------------------: | ----------------: | --------------: | ----------------: |
| 5wpm   | sprout  | baseline | 87.1–88.7 → 90.0–90.3 | 33–38 % → 18–21 % |  9–12 % → 1–2 % |     7–8 % → 0–1 % |
| 5wpm   | sprout  | new      | 86.9–88.2 → 90.0–90.2 | 34–38 % → 18–23 % |  9–13 % → 3–4 % |    8–11 % → 1–2 % |
| 5wpm   | sprout  | calm     | 90.7–91.6 → 92.2–92.8 |   20–26 % → 8–9 % |     2–4 % → 0 % |       1–4 % → 0 % |
| 5wpm   | miner   | baseline | 86.0–86.8 → 89.8–90.3 | 34–38 % → 17–19 % | 10–11 % → 1–2 % |        12 % → 0 % |
| 5wpm   | miner   | new      | 84.1–85.1 → 91.9–92.1 | 41–44 % → 10–11 % | 15–18 % → 0–1 % | 59–63 % → 29–32 % |
| 5wpm   | builder | baseline | 82.5–83.1 → 90.1–90.5 | 49–52 % → 15–18 % | 19–21 % → 1–2 % |     17–24 % → 0 % |
| 5wpm   | builder | new      | 73.7–74.8 → 91.4–91.7 | 64–67 % → 10–13 % |   43–46 % → 0 % |    97 % → 33–34 % |
| 10wpm  | sprout  | baseline | 89.9–90.5 → 89.9–90.6 | 17–21 % → 17–20 % |   3–5 % → 3–5 % |         2 % → 1 % |
| 10wpm  | sprout  | new      | 91.2–91.9 → 91.7–92.3 |  17–23 % → 9–12 % |   1–2 % → 0–1 % |       1–3 % → 0 % |
| 10wpm  | sprout  | calm     | 92.4–92.7 → 92.4–93.0 |  10–14 % → 8–10 % |       0 % → 0 % |       0–2 % → 0 % |
| 10wpm  | miner   | baseline | 89.9–90.1 → 90.3–90.8 | 20–22 % → 15–18 % |     3 % → 1–2 % |       1 % → 0–1 % |
| 10wpm  | miner   | new      | 89.7–90.2 → 90.3–90.7 | 19–23 % → 17–19 % |   3–4 % → 2–4 % |     1–2 % → 0–2 % |
| 10wpm  | builder | baseline | 89.4–90.1 → 90.4–90.9 | 19–24 % → 15–17 % |   2–3 % → 1–2 % |     1–3 % → 0–1 % |
| 10wpm  | builder | new      | 88.3–89.5 → 90.0–90.8 | 24–28 % → 15–18 % |     5–6 % → 3 % | 15–20 % → 12–17 % |

Calm rows for Miner and Builder at 5 WPM (calm is optional outside Sprout): 6–7 % low, 0 % swamped.
`docs/sim.md` has the step-by-step table, which shows what each change moved.

## Decisions

- **"No swamped waves" means the chance floor, ≤ 5 %, not 0 %.** About 3 % of a slow typist's
  waves fall under 75 % by chance at any pace (M4-04's measurement at fixed `d = 0.5`). A literal
  zero would need near-empty waves. The 5 WPM rows are at 0–4 %.
- **A new profile's first wave may still swamp a 5 WPM Miner or Builder.** That wave is played at
  the band's slow default (10 or 15 WPM × 0.7). Its median accuracy is 59 % for a new Miner and
  42 % for a new Builder. The director learns from it and resets after that one wave, so
  "swamped 1–3" is about one wave in three for those rows, pinned at ≤ 36 %. Starting every new
  profile slower would bore a fast new learner for the whole night (a new 50 WPM Miner already
  needs all 10 waves to climb). The real fix is a baseline: Defense comes after Mine lessons and
  placement, so in practice one exists.
- **The reset only applies in search mode** (new profile, not resumed). With a baseline the
  reference was measured. At 50 WPM, a swamped wave's throughput underestimates speed, and the
  reset would knock the 50 WPM pin over.
- **The key minimum makes a slow learner's waves longer, not busier.** A fresh Sprout's night in the
  mode's rig (1 s a key) went from 3 to 6 mobs a wave, and from 58 s to 118 s. That is about the
  chars per wave `nightWaves` counts on (`WAVE_CHARS` 16/27/36). The Miner e2e night is unchanged
  (85 s in the rig).
- **The first key takes at least one key's time** (not a band constant). It doesn't move 25 WPM and
  up. At 10 WPM it gives about 0.5 s more a word, which is where the pin's headroom comes from.
- **The calm signal adds the pulled time back to `activeMs`.** It doesn't subtract it from the
  plan. Adding it back gives exactly the pre-pull ratio, so `calmSlow` / `calmVerySlow` keep
  their meaning. Subtracting it would have changed the ratio's scale.
- **The banner box is re-measured for 30 frames after a change, then cached.** The HUD renders a
  frame late and the toast pops in over `--t-med` (200 ms). The early `relayout` frames (2, 10, 30
  and 90, and any resize) also re-measure, in case a font loaded late.
- **e2e budget: 480 s,** about twice the 3.9 min CI run, as the review suggested. This PR doesn't
  change that night's waves.

## New dependencies

- None.

## Notes for downstream tasks

- `WaveFeedback.pulledMs` (optional) is new. Anything else that feeds a director (M5 bosses'
  `minions` phase, if it reuses `idlePullMs`) should report it. Without it, calm slowness reads
  low.
- `throughputWpm(feedback, plan)` is exported. The playtest's `defense:waveEnd` bus event now
  also carries `pulledMs`.
- `DIRECTOR_CONSTANTS.dMin` is 0.2. `lastDifficulty` can now remember a `d` under 0.3 for a new
  profile, and the next night resumes there.
- **Feel review:**
  - A 5 WPM mob may take 60–90 s to walk its lane. That is slow, but the field is never empty
    (the idle cap holds).
  - Slow Sprouts get twice the words a night.
  - A brand-new Builder's first wave is still hard, but only that one.
- The banner cache isn't covered by a unit test (the rig has no DOM). The e2e `overBanner` checks
  still guard the behaviour.

## Contract change request / Questions

- No contract change. `WaveFeedback`, `WavePlan` and `WaveTally` aren't in `contracts.md`.
- Files beyond the card's Owns list: `defense.ts` (the review's banner cache, and reporting
  `pulledMs`), `logic.ts` (`WaveTally.pulledMs`), their tests, and `tests/e2e/defense.spec.ts`
  (the review's budget comment). All are needed for the card's "from the #188 review" items.

Closes #191
