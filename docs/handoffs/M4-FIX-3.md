# M4-FIX-3 Night Defense for 5 WPM learners

Status: done (reworked after the feel review of #197)

## What changed

- `src/modes/defense/director.ts` (pure, still a pure zone):
  - **Slow learners (first commit).** Four changes, each aimed at a cause found with a per-wave
    trace.
    - `travelMs.max` goes from 40 s to 90 s. At 5 WPM a walk of three words' time is 45–80 s, so
      the old cap made a slow Builder's mobs walk about twice as fast as anyone else's, measured
      against their own typing.
    - New `minWaveKeys` (Sprout/Miner/Builder 16/24/30 keys at the middle word length) in
      `waveSize`. A slow Sprout's wave was 3 words of 3 letters, so one slip read as a bad wave.
    - `mobTiming`: the reaction allowance is the band's, or one key at the reference speed if
      that is longer.
    - New `throughputWpm`, plus `WavePlan.charsPerWord` and `WavePlan.referenceWpm`. `dMin` goes
      from 0.3 to 0.2.
  - **New profiles (rework, the reviewer's proposal as the orchestrator decided):**
    - A new profile starts cautious: `startDifficulty` gives
      `min(0.7, newProfileStartWpm 3.5 / default reference)`. That is Sprout 0.70 (unchanged),
      Miner 0.35 and Builder 0.23. `startDifficulty` now takes `band`.
    - After a first wave that went well (at most 10 % at the base, accuracy at the target or
      above), `d` jumps once to `max(d, min(0.7, newProfileJump 1.0 × measured / reference))`.
      `WavePlan.index` (new) says which wave it was.
    - The downward reset stays as the safety net.
    - **Reset comment:** the code fires on the first search-mode wave the child can't keep up
      with, whichever wave that is, and only once, because that wave also ends the search. The
      comments said "first wave"; I fixed them (module comment, the code, `docs/sim.md`).
  - New `Director.referenceWpm`.
  - The calm slowness signal adds `WaveFeedback.pulledMs` (new, optional) back to `activeMs`.
- `src/modes/defense/logic.ts`:
  - `WaveTally.pulledMs`.
  - New `NIGHT_CAP_MS` (Sprout 4 min, Miner and Builder 5 min) and `nightOver`.
  - New `walkRate`: 1 for a lane walked in 20 s or less, slower for slower mobs, never under
    0.4.
- `src/modes/defense/defense.ts`:
  - Adds up each idle pull into `tally.pulledMs`.
  - Caches the HUD message's box for `clearOfBanner` (#188 review).
  - Counts `nightMs` over dusk and night. After a wave, dawn comes when `nightOver` says so.
  - Remembers a night as a pace, `{ pace: d × referenceWpm }`, and resumes at
    `pace / referenceWpm(band, baseline)`.
- `src/modes/defense/view.ts`: the walk clip plays at `walkRate(mob.speed)` (on spawn, on going
  back to walking, and after a hit).
- `tools/sim-defense.ts`:
  - `playWave` reports `pulledMs`.
  - New `slowRows()` and `newProfileRows()` (every band at 5, 10, 25 and 50 WPM, new).
  - `--slow 1` prints both.
- Tests:
  - `director.test.ts`:
    - The start covers every band. The property test covers the jump and the reset.
    - The reset test now resets after wave 1.
    - New: "jumps a new profile up once after a cautious first wave that went well".
    - The slow-learner block from the first commit stays.
  - `sim-defense.test.ts`:
    - The 5 WPM pin now asks for swamped 1–3 ≤ 5 % for every row, new profile included (it was
      ≤ 36 % for new profiles), plus a wave-1 median of at least 85 %.
    - New: "new profiles", 12 rows.
    - The 10 WPM low pin is 22 %.
  - `defense.test.ts`:
    - A night cap test (a 5-wave calm Miner night at 4 s a key ends after the wave on when 5 min
      passed, and the stars still count).
    - A resume test (a new Builder's second night after gaining a 4 WPM baseline resumes at the
      same pace).
    - Both fail with their fix taken out.
    - `pulledMs` is checked.
  - `logic.test.ts`: `nightOver`, `walkRate` and `pulledMs`.
- `tests/e2e/defense.spec.ts`: the Miner night's budget comment names the 3.9 min CI baseline
  (#188 review). The budget is 480 s; that night took 2.7 min on #197's CI.
- `docs/sim.md`:
  - Refreshed tables.
  - The "Slow learners" section.
  - A new "After the feel review" section: new profiles, the `dMin` headroom, night length and
    the cap, walking, and the resumed night.

## Acceptance

- [x] **Pin 5 WPM:** at most 30 % of waves under 85 % and no swamped waves for any band, a new
      profile included. `sim-defense.test.ts` › "5 WPM", 9 rows: low ≤ 30 %, swamped 4+ ≤ 5 %,
      **swamped 1–3 ≤ 5 % on every row** and wave-1 median ≥ 85 %. Today: low 8–24 %, swamped
      0–4 %, swamped 1–3 0–2 %, wave 1 at 90–96 %.
- [x] **Rework pin:** at most 5 % swamped in waves 1–3 for every row, new profile included, and a
      wave-1 median of at least 85 % for 5 WPM learners in every band.
  - The main rows already pin it.
  - The 5 WPM rows pin it (above).
  - `sim-defense.test.ts` › "new profiles" adds every band at 5, 10, 25 and 50 WPM, the new
    10 WPM Builder included. It also checks that 25 and 50 WPM still climb.
- [x] **10 WPM keeps ≤ 25 % with headroom across 3 seeds of 100 learners:** 15–20 % with a
      baseline and 9–19 % new (pin 22 %).
- [x] **50 WPM pin, idle cap, star gate:**
  - The 50 WPM learner means are 93.2–96.4 % (pin 90–97 %).
  - Empty max is 2.5 s on every row.
  - Gate shares in the sim: 100 % for 2 and 3 stars on every row I measured. That is 5, 10 and
    25 WPM, every band, with and without a baseline, 3- and 5-wave nights, capped.
- [x] **New 10 WPM Miner:** it settles at `d` 0.61–0.64 with a learner mean of 91.7–91.9 %. The
      reviewer saw 92–93 % with the 0.8 jump; 1.0 gets a little closer to the edge.
- [x] **Night cap:** Sprout 4 min, Miner and Builder 5 min. The current wave finishes, then dawn.
      `defense.test.ts` › "ends a long night at dawn" covers it, and the star gate holds (above).
- [x] **Walk animation:** the clip plays at `walkRate` (0.4–1×). Reduced motion is unchanged: the
      animator holds the pose whatever the rate.
- [x] **Second night:** remembered as a pace. `defense.test.ts` › "resumes a second night at the
      same pace" covers it.
- [x] **Reset comment** fixed (see above).
- [x] **#188 review items** (first commit): the banner box cache (the reviewer found no stale
      case that matters), the e2e budget comment, and the calm signal.
- [x] `npm run verify` passes.

### New profiles: before and after (3 seeds × 100 learners, the range over the seeds)

"Main" is before M4-FIX-3, "head" is #197 before this rework. Rows with a baseline didn't change in
the rework: they match #197's head digit for digit.

| New profile   | Wave 1 median, after | Swamped 1-3, main → head → after | Low 4+, main → head → after | Final `d`, main → head → after    |
| ------------- | -------------------: | -------------------------------- | --------------------------- | --------------------------------- |
| 5wpm sprout   |                 92 % | 8–11 % → 1–2 % → 1–2 %           | 34–38 % → 18–23 % → 18–23 % | 0.54–0.62 → 0.72–0.74 → 0.72–0.74 |
| 5wpm miner    |              91–93 % | 59–63 % → 29–32 % → 0–1 %        | 41–44 % → 10–11 % → 14–15 % | 0.31–0.33 → 0.23 → 0.41           |
| 5wpm builder  |              90–93 % | 97 % → 33–34 % → 0–1 %           | 64–67 % → 10–13 % → 13–16 % | 0.30 → 0.22 → 0.27–0.28           |
| 10wpm sprout  |                 92 % | 1–3 % → 0 % → 0 %                | 17–23 % → 9–12 % → 9–12 %   | 0.84–0.86 → 0.87–0.91 → 0.87–0.91 |
| 10wpm miner   |                 93 % | 1–2 % → 0–2 % → 0 %              | 19–23 % → 17–19 % → 10–12 % | 0.72–0.73 → 0.73–0.75 → 0.62–0.64 |
| 10wpm builder |              92–93 % | 15–20 % → 12–17 % → 0 %          | 24–28 % → 15–18 % → 9–10 %  | 0.51–0.53 → 0.54–0.56 → 0.45–0.48 |

- **Wave 1:** at #197's head the wave-1 median was 58–64 % for a new 5 WPM Miner and 36–40 % for
  a new Builder (the reviewer's numbers).
- **25 and 50 WPM new profiles** end where they did, or within a few percent:
  - 25 WPM ends at 1.08–1.34 by band. A new Miner was at 1.30–1.37 and is now 1.26–1.28.
  - 50 WPM ends at 2.00.
  - Their wave-1 medians are 95–100 %.

### The first commit's tables (rows with a baseline, unchanged by the rework)

| Typist | Band    | Profile  |       Learner mean 4+ |            Low 4+ |      Swamped 4+ |   Swamped 1-3 |
| ------ | ------- | -------- | --------------------: | ----------------: | --------------: | ------------: |
| 5wpm   | sprout  | baseline | 87.1–88.7 → 90.0–90.3 | 33–38 % → 18–21 % |  9–12 % → 1–2 % | 7–8 % → 0–1 % |
| 5wpm   | sprout  | calm     | 90.7–91.6 → 92.2–92.8 |   20–26 % → 8–9 % |     2–4 % → 0 % |   1–4 % → 0 % |
| 5wpm   | miner   | baseline | 86.0–86.8 → 89.8–90.3 | 34–38 % → 17–19 % | 10–11 % → 1–2 % |    12 % → 0 % |
| 5wpm   | builder | baseline | 82.5–83.1 → 90.1–90.5 | 49–52 % → 15–18 % | 19–21 % → 1–2 % | 17–24 % → 0 % |
| 10wpm  | sprout  | baseline | 89.9–90.5 → 89.9–90.6 | 17–21 % → 17–20 % |   3–5 % → 3–5 % |     2 % → 1 % |
| 10wpm  | sprout  | calm     | 92.4–92.7 → 92.4–93.0 |  10–14 % → 8–10 % |       0 % → 0 % |   0–2 % → 0 % |
| 10wpm  | miner   | baseline | 89.9–90.1 → 90.3–90.8 | 20–22 % → 15–18 % |     3 % → 1–2 % |   1 % → 0–1 % |
| 10wpm  | builder | baseline | 89.4–90.1 → 90.4–90.9 | 19–24 % → 15–17 % |   2–3 % → 1–2 % | 1–3 % → 0–1 % |

### Night length (sim, median of 40 learners with a baseline, active time plus pauses)

Main → #197 head → now (with the cap):

| Typist, band  | 3-wave night      | 5-wave night                |
| ------------- | ----------------- | --------------------------- |
| 5 WPM Sprout  | 125 → 268 → 268 s | 221 → 454 → 268 s (3 waves) |
| 5 WPM Miner   | 161 → 327 → 327 s | 272 → 555 → 327 s (3 waves) |
| 10 WPM Sprout | 105 → 156 → 156 s | 190 → 260 → 260 s           |
| 10 WPM Miner  | 123 → 185 → 185 s | 215 → 312 → 312 s           |

A 10 WPM night is about 45–50 % longer than on main too, not only a 5 WPM one: that comes from the
key minimum and the first-key time. The cap bounds the 5-wave nights. The shipped nights are
3 waves, and those still play every wave.

## Decisions

- **The new-profile start is the reviewer's proposal** (orchestrator decision). The one
  difference is the jump factor: 1.0, not 0.8. The throughput is a floor on the child's speed, so
  1.0 still can't overshoot. With 1.0 a new 10 WPM Miner settles at 0.61 (91 %), not 0.53 (92 %),
  and no row has more swamped waves.
- **"No swamped waves" means the chance floor, ≤ 5 %, for every row and every part of the
  night.** Waves 1–3 of a new profile are now held to the same bound. The reviewer accepted the
  reading for waves 4 on.
- **The reset fires on the first wave the child can't keep up with, not only wave 1.** I fixed
  the comment, not the code. That wave also ends the search, so it happens once. With the
  cautious start it mostly matters for a new learner the jump over-estimated.
- **The night cap counts game time over dusk and night.** Pauses don't count, and day and dawn
  aren't night. It only ends the night between waves, so a wave in progress always finishes.
  `nightProgress` needs no change: the summary is taken at dawn, and the bar then shows 1.
- **Walk rate:** the clip is "authored" for a lane walked in 20 s (`WALK_REF_MS`). That is about
  the walk of a 25 WPM learner near their edge (11–20 s). It's a guess, and an item for the feel
  review.
- **The remembered night is a pace.** I converted it rather than forgot it, so a returning child
  still starts near their edge.
- **`dMin` 0.2 is close for one case.** A new 5 WPM Builder now starts at 0.23 and ends at
  0.27–0.28, so the floor doesn't bind for them. It binds for a new Builder slower than about
  3.75 WPM net, whose reset would ask for less: their pace stops at 3 WPM. With a baseline, `d`
  is relative and the floor is 0.2 of the child's own speed.
- **From the first commit:** the travel cap, the key minimum, the first-key time, the calm signal
  (`pulledMs` is added back to `activeMs`), the banner cache (30 frames after a change) and the
  480 s e2e budget.

## New dependencies

- None.

## Notes for downstream tasks

- `WaveFeedback.pulledMs`, `WavePlan.index` and `Director.referenceWpm` are new. Anything else
  that drives a director (M5 bosses' `minions` phase) should pass the plan's `index` and report
  `pulledMs`.
- A remembered night is now `{ pace }` in `defense.ts`'s in-memory map; `forgetNights()` still
  clears it.
- `NIGHT_CAP_MS` and `nightOver` live in `logic.ts`. A boss night (M5) may want its own cap.
- **Feel review:**
  - The walk rate at 0.4–1×.
  - A 60–90 s walk for a 5 WPM learner.
  - Slow learners' nights are longer: about 4.5 min for a 5 WPM Sprout on a 3-wave night.
  - A new Miner's or Builder's first wave is slow on purpose (3.5 WPM). A fast child gets one
    easy wave, then the jump.
- The banner cache and the walk rate in `view.ts` have no unit test (no DOM or three.js in the
  rig). The e2e `overBanner` checks cover the cache.

## Contract change request / Questions

- No contract change. `WaveFeedback`, `WavePlan`, `Director` and `WaveTally` aren't in
  `contracts.md`.
- Files beyond the card's Owns list: `defense.ts`, `logic.ts`, `view.ts`, their tests, and
  `tests/e2e/defense.spec.ts`. The review items and the orchestrator's rework list need them.

Closes #191
