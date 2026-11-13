# Typist simulator

`tools/sim.ts` plays synthetic learners through a lesson so you can check the difficulty curve and
the adaptive engine without a browser (`PLAN.md` §8 Phase 1, §9.3). It was built and used for
task M1-07.

```sh
npm run tool -- sim --lesson adhoc --typist pinkyweak --runs 50 --seed 1
```

| Flag         | Default     | Meaning                                                          |
| ------------ | ----------- | ---------------------------------------------------------------- |
| `--lesson`   | `adhoc`     | A lesson id from `src/content/lessons/`, or `adhoc` (below)      |
| `--typist`   | `avg`       | `slow`, `avg`, `fast` or `pinkyweak` (`TYPIST_PROFILES`)         |
| `--runs`     | `50`        | Learners. Each one is independent (`rng.fork("run:<n>")`)        |
| `--sessions` | `5`         | Sessions each learner plays in a row                             |
| `--seed`     | `1`         | Root seed. Same arguments give byte-identical output             |
| `--band`     | `miner`     | Sets the target latency (900/500/300 ms) and the lesson defaults |
| `--kind`     | `syllables` | `adhoc` only: the content kind                                   |
| `--chars`    | `150`       | `adhoc` only: chars per session (about 90 s at 20 WPM)           |

**`adhoc`** is Meadow's ten keys (`a s d f g h j k l ;`), no focus keys (a review lesson), the
`stay` policy, `sequential` targeting, mode `practice` and an accuracy goal of 0.9. No lesson
files exist yet, so `adhoc` is the only lesson today. Word pools don't exist yet either, so word
lessons fall back to syllables in the generator.

## What one run does

For each session `s = 1 … N` of a learner:

1. `keyWeights` from the learner's key stats so far (`sessionIndex = s`).
2. `generateTargets` with those weights (`rng.fork("generate:<s>")`).
3. `runTypist` plays the session (`rng.fork("typist:<s>")`) and returns the snapshot and summary.
4. `computeStars` with `baselineNetWpm` of the earlier sessions.
5. `foldSummaryIntoKeyStats` and `foldSummaryIntoBigramStats`, exactly as the game will.
6. `weakKeys(…, 2)` with `sessionIndex = s + 1`: the keys the next session will push.

The report prints, per session: the stars distribution, median accuracy, median net WPM and the
three most common top-2 weak-key pairs. After the last session it prints each key's mean weight,
how often it is in the top-2, and its share of the generated chars. It ends with bigram SRS
numbers (see below).

## The typist model (`tools/sim/typist.ts`)

The typist is pure: no clock, no global randomness, only the `Rng` it is given. It drives a real
`TypingSession`, so every run also yields a snapshot that `replay()` turns back into the same
summary (tested).

- **Speed.** The gap between keys is lognormal: `12000 / wpm · exp(jitter · z)`, `z` standard
  normal (Box–Muller, two `next()` calls), clamped to 20–10 000 ms. `jitter` is the σ of the log
  gap.
- **Errors.** Each aimed key goes wrong with probability
  `errorRate × perKeyErrorMult[key] × 1 / (1 + learnRate · practice / 100)`, capped at 0.9.
  `practice` is the key's earlier attempts. A wrong key is a random QWERTY neighbor of the right
  one (hardcoded map, because M1-11's layout data isn't merged).
- **Corrections.** `backspace`: after a 150–400 ms notice delay, Backspace, then the key again.
  `stay`: the cursor didn't move, so the typist waits the same notice delay and types the right
  key. It doesn't press Backspace, because that does nothing in `sequential` and resets the target
  in `lockOn`. `skip`: no correction.
- **Targets.** It types the active target. Under `lockOn` with nothing locked, it starts the first
  open target. When the targets run out before the session ends, or after 50 000 keys, it ends the
  session itself.

| Profile     | wpm | errorRate | jitter | learnRate | perKeyErrorMult                                |
| ----------- | --- | --------- | ------ | --------- | ---------------------------------------------- |
| `slow`      | 10  | 0.08      | 0.45   | 0.5       | —                                              |
| `avg`       | 22  | 0.05      | 0.35   | 0.3       | —                                              |
| `fast`      | 45  | 0.02      | 0.25   | 0.2       | —                                              |
| `pinkyweak` | 20  | 0.04      | 0.35   | 0.3       | `a` 4, `;` 4; `q z p / '` 3 (other pinky keys) |

## Tuning `ADAPTIVE_CONSTANTS`

**Goal (card M1-07):** a pinky-weak typist's `;` and `a` weights rise to the top-2 within 5
sessions, without starving other keys.

**Result:** `errorWeight` 6 → **10** and `latencyWeight` 1.5 → **1**. Every other value is unchanged.

| Constant               | Old             | New       |
| ---------------------- | --------------- | --------- |
| `priorErrorRate`       | 0.05            | 0.05      |
| `priorAttempts`        | 5               | 5         |
| `maxSmoothingAttempts` | 50              | 50        |
| `baseWeight`           | 1               | 1         |
| `errorWeight`          | 6               | **10**    |
| `latencyWeight`        | 1.5             | **1**     |
| `maxSlowness`          | 2               | 2         |
| `focusMinWeight`       | 3               | 3         |
| `unseenAttempts`       | 5               | 5         |
| `unseenWeight`         | 2               | 2         |
| SRS values (`srs*`)    | as contracts §4 | unchanged |

### Evidence

The grid was run with a throwaway script that called `simulate()` with each variant patched into
`ADAPTIVE_CONSTANTS` (not committed). Settings: `adhoc`, typist `pinkyweak`, 200 runs, 5 sessions,
seed 7. "Pair" is the share of runs where `weakKeys(…, 2)` after that session is exactly `{a, ;}`.
"a / ; in top-2" is the share of runs where that key is in the top-2 after session 5. The least
practiced key's share of chars was 4.4–4.8% (syllables) and 9.3–9.7% (letters) in every row, so no
variant starved a key.

| Variant (changes only)                 | syllables: pair after s1–s5 | a / ; in top-2 | letters: pair after s1–s5 | a / ; in top-2 |
| -------------------------------------- | --------------------------- | -------------- | ------------------------- | -------------- |
| contract values (6 / 1.5)              | 18 20 22 20 21%             | 34 / 72%       | 16 14 9 10 11%            | 42 / 42%       |
| errorWeight 8, latencyWeight 1         | 22 28 31 26 28%             | 45 / 69%       | 23 30 31 25 28%           | 59 / 58%       |
| **errorWeight 10, latencyWeight 1**    | **26 27 35 28 31%**         | **46 / 76%**   | **26 33 34 28 35%**       | **62 / 62%**   |
| errorWeight 12, latencyWeight 1        | 28 28 34 31 34%             | 46 / 78%       | 27 39 36 35 34%           | 64 / 58%       |
| errorWeight 10, latencyWeight 0.75     | 28 33 33 33 31%             | 47 / 73%       | 28 36 40 32 37%           | 69 / 60%       |
| errorWeight 10, lw 1, maxSlowness 1    | 26 28 36 30 31%             | 46 / 77%       | 34 42 43 43 39%           | 67 / 62%       |
| errorWeight 10, lw 1, priorAttempts 10 | 26 27 31 29 35%             | 49 / 74%       | 24 29 32 26 27%           | 60 / 55%       |
| latencyWeight 0.5 (errorWeight 6)      | 11 28 34 30 31%             | —              | 27 36 34 33 31%           | —              |
| latencyWeight 0 (errorWeight 6)        | 1 28 35 36 28%              | —              | 38 50 41 52 47%           | —              |

Why 10 / 1:

- Raising the error weight relative to the latency weight is the only lever that moves the
  ranking. `priorAttempts` and `maxSmoothingAttempts` shrink every key's error the same way once a
  key has a few sessions behind it, so they barely change the order (the `priorAttempts 10` row).
- 10 / 1 is where the gain levels off: 12 / 1 is within noise of it.
- Lower latency weights look better on `letters`, but only because of an artifact (finding 1
  below). Latency is a real signal for a learner whose weak keys are slow, not wrong, so it keeps
  its place: a key three times slower than the target still adds +2, as much as a 20-point error
  rate.

**Control typists** (same settings, before → after): the `{a, ;}` pair shows up in 0–6% of runs
for `avg`, `slow` and `fast`. That is chance level for 10 keys (1 in 45 ≈ 2%). Their weights stay
even across keys (spread ≤ 0.2 for `letters`, ≤ 0.45 for `syllables`, where `a` is the only vowel
and gets the most practice). The change creates no false weak keys.

**The committed tool, after the change** (`npm run tool -- sim --lesson adhoc --typist pinkyweak --runs 50 --seed 1`):

```
Per session
session | stars 0/1/2/3        | median acc | median net WPM | top-2 weak keys after (runs)
--------|----------------------|------------|----------------|--------------------------------
1       | 0% / 46% / 44% / 10% | 90.0%      | 16.3           | [; a] 28%, [a h] 12%, [a s] 12%
2       | 0% / 16% / 64% / 20% | 93.0%      | 16.9           | [; a] 28%, [; d] 8%, [; k] 6%
3       | 0% / 2% / 60% / 38%  | 94.3%      | 17.4           | [; a] 28%, [; f] 14%, [; j] 12%
4       | 0% / 2% / 66% / 32%  | 93.8%      | 17.5           | [; a] 26%, [; g] 8%, [; s] 8%
5       | 0% / 2% / 62% / 36%  | 94.4%      | 17.6           | [; a] 30%, [; f] 10%, [; h] 8%

Adaptive weights after session 5 (mean over runs)
key | weight | in top-2 | share of chars in session 5
----|--------|----------|----------------------------
a   | 2.111  | 40%      | 39.3%
s   | 1.713  | 12%      | 6.9%
d   | 1.633  | 8%       | 6.5%
f   | 1.680  | 14%      | 7.3%
g   | 1.635  | 4%       | 7.2%
h   | 1.655  | 16%      | 7.9%
j   | 1.742  | 10%      | 6.7%
k   | 1.707  | 16%      | 6.4%
l   | 1.676  | 10%      | 6.4%
;   | 2.523  | 70%      | 5.4%
```

With `--kind letters` the same command gives `a` 2.853 and `;` 2.822 against 1.89–2.08 for the
rest, and `{a, ;}` is the most common pair after every session (28–36% of runs).

So, within 5 sessions, `;` and `a` are the top-2 by mean weight, and they are the most common
top-2 pair from session 1 on, for both content kinds, and they are in the top-2 more
often than any other key. `tests/unit/sim/sim.test.ts` › "pinky-weak tuning" pins these three
facts and the no-starving floor (every key > 4% of chars). No key starves: the comfort cap keeps
at least half of the chars on the comfortable keys, so the weak keys only get a modest share of
extra practice.

**What tuning can't fix.** In a single run the top-2 is still `{a, ;}` only about a third of the
time. The limit is the data, not the constants. A 150-char session gives each key 7–15 attempts,
so a 4% key often shows 2 errors and a 16% key often shows 1. On top of that, `recentErrRate`
forgets fast: the fold applies α = 0.1 per attempt, so a key with 15 attempts keeps only
0.9¹⁵ ≈ 20% of its history. See the proposals below.

## Findings

1. **Latency in `letters` lessons comes only from corrections.** A key's latency is measured from
   the previous key _in the same target_, and `letters` targets are one char long. So the only
   latencies a key gets in a letters drill are the retypes after a mistake, which include the
   notice delay. One mistake gives a key a slow median (about 850 ms against a 500 ms target),
   and the median stays slow because nothing else fills the ring. In letters drills, "slow" is
   really "made a mistake once". Sprout's early lessons are letters drills, so this matters.
   Options are under Questions in the handoff note (`docs/handoffs/M1-07.md`).
2. **In home-row syllables, `a` gets about 40% of the chars** because it is the only vowel, and
   `;` gets the least of any key (about 5%) even when it has the highest weight. The comfort cap
   leaves room for only half the chars on non-comfortable keys, and the vowel slots already spend
   that room on `a`. So a weak consonant gets little extra practice in syllable lessons. That is a
   generator and curriculum question (M1-06, M3-01), not an adaptive constant.
3. **Bigram SRS needs a minimum-attempts threshold.** In `syllables` sessions, 74–78% of the
   bigrams practiced in a session had fewer than 5 attempts, and 88–94% of those had their SRS
   interval grow, because one or two clean attempts score 100% accuracy (the "Bigram SRS" table
   the tool prints). Proposal for `stats.ts` (`foldKeyAggs`): reschedule SRS only when the session
   had at least `ADAPTIVE_CONSTANTS.unseenAttempts` (5) attempts on the key or bigram; below that,
   keep the old `srs`. Keys mostly pass that bar (7–60 attempts a session here), so in practice it
   only changes bigrams. `stats.ts` is not part of this task, so this is a proposal only.

## Night Defense wave director (`tools/sim-defense.ts`, M4-05, retuned in M4-04, paced in M4-FIX-2)

```sh
npm run tool -- sim-defense --runs 50 --waves 10 --seed 1 --sweep 1
```

| Flag      | Default | Meaning                                                       |
| --------- | ------- | ------------------------------------------------------------- |
| `--runs`  | `50`    | Learners per row. Each is independent (`rng.fork(…:run:<n>)`) |
| `--waves` | `10`    | Waves per night (at least 4)                                  |
| `--seed`  | `1`     | Root seed. Same arguments give byte-identical output          |
| `--sweep` | `0`     | `1` also prints the plant sweep (below)                       |

The tool plays nights of Defense through the real director (`src/modes/defense/director.ts`) and
the real typing engine in `lockOn` targeting with the `stay` policy. The typists are M1-07's
`slow`, `avg` and `fast` profiles set to exactly 10, 25 and 50 WPM. Each learner first types a
30-word Mine-style session; its net WPM and its accuracy are the baselines the director starts
from, as the game's would be. Words come from the shipped word lists with all 26 letters allowed (a
learner past Frosty Peaks). The mobs are the real roster (`MOBS`, M4-03), all eight. The Cave
Bat's flavor words are capitalised, so with lowercase keys it carries the lesson's words. The run
takes about 6 s, or 8 s with the sweep.

### The defense typist (an assumption)

M1-07's typist errs at a fixed rate whatever the pace, so on its own nothing the director does
could move its accuracy. Children make more slips when they rush, so the sim adds a pressure model
on top:

- **Pressure** is the most urgent "work left ÷ time left" over the mobs on the field. For each mob,
  in the order they will reach the base, it is the time to type its word and every word before it
  (at the typist's median gap, plus 500 ms and one gap to read each new word), divided by the time
  until it arrives. Above 1 the typist can't save every mob.
- **Slips.** Each key's slip chance is M1-07's chance plus `min(0.2, 0.4 × max(0, pressure − 0.1))`.
  Rushing also shortens the gap by up to 15 %.
- **Triage.** With nothing locked, the typist starts the first-arriving mob it can still finish in
  time, or else the one arriving last.
- **Calm mode.** Mobs stop at the waiting line (85 % of the lane) and never reach the base, and the
  typist feels half the pressure.

The numbers are a guess, not a measurement. `p0` was first 0.5, but with mobs walking three spawn
gaps that only pushed on a typist already swamped, so it became 0.1. The extra slips are capped at
20 points, because a swamped child lets mobs through rather than typing at 10 % accuracy. The
`slope 0.2` and `slope 0.8` rows rerun the Miner rows with half and double the slope, to check the
controller does not depend on the exact model.

### The controller

`d ∈ [0.3, 2.0]` scales time against the learner's reference speed (the baseline, or 5/10/15 WPM
for a new Sprout/Miner/Builder). At `d = 1` a mob spawns every "reaction + word at the reference
speed" (reaction 1400/900/650 ms by band) and walks its lane in three of those. Below `d = 1` the
spawn gap is `base / d`; above it, `base / d^0.3`. Travel time is always `3 × base / d^1.5`, kept
inside 4–40 s, and fast mobs walk 1.25× faster, slow ones 0.8×. **Mobs reach the base in spawn
order, a spawn gap apart:** a mob that would catch up with the one before it sets out a little
later. Each wave lasts about 20/25/30 s by band (3 s longer per wave up to the fourth), so a fast
learner gets more mobs, never a longer wave. A night starts at `d = 0.8` (0.7 for a new profile),
or where the player's last night in the same sitting ended.

After each wave:

1. `step = k × (accuracy − target)`. `accuracy` is a words-weighted average in which each wave
   counts half as much as the next. A wave under 2 s of activity doesn't count for accuracy.
   **The target is the learner's own:** 3 points under their median accuracy in Mine, practice and
   Minecart (the same sessions as the WPM baseline), kept inside 85–93 %, and 90 % for a new
   profile.
2. If more than 10 % of the wave's mobs reached the base, `step ≤ −1.5 × (share − 0.10)`.
3. **Search, then fine.** A new profile searches: until the first wave at or under the target (or
   with more than 10 % at the base), `k = 2.5` and steps stay within ±15 %. After that, and **from
   the first wave for a learner with a baseline or a resumed night**, `k = 1` and steps stay within
   −8 % / +5 %. While the average is under 85 %, a step down may still be the full 15 %.
4. **Relief.** A wave under 75 %, or with more than 30 % of its mobs at the base, makes the next
   one 15 % easier.
5. `d ← clamp(d × (1 + step), 0.3, 2.0)`. In calm mode: a pace of 0.75×, at most
   `d = 1.2`, at most +8 % a wave, and at most 10 mobs. Calm mobs never reach the base, so calm
   mode reads time instead: a wave that took more than 1.5× its planned span holds the pace, and
   one that took more than 2.25× eases it by 8 %.

How it got there (each change checked against the full table):

- **A plain proportional step** (`k = 3`, ±15 %, an exponential average) left fast typists at 98 %:
  `d` only scaled the typing part of each mob's time, not the reaction allowance. So `d` became a
  time scale on everything.
- **Then the plant sweep showed a cliff.** Accuracy was flat until about `d = 0.8`, then fell about
  10 points per 0.1 of `d`. Two changes followed:
  - With `k = 2.5` the loop gain on that slope was about 2.7, which is unstable for this kind of
    step, so the controller swung between too easy and swamped.
  - Speed and spawn rate scaled the same way, so above `d = 1` the extra pressure came from more
    words a minute. That overloads the learner: every slip costs time, which brings more pressure
    and more slips. Speed now rises faster than the spawn rate.
- **Fine mode** came next, because a fast typist's in-band window was only about ±0.03 of `d` wide.
- **Things that didn't help:**
  - a median-of-3 estimate;
  - asymmetric smoothing, which biased the estimate down so slow typists drifted to lower `d`;
  - lower targets (0.88, 0.89), which traded the in-band share for nothing;
  - other relief thresholds.

**M4-04: the swamped waves (review 5871182504).** M4-05's table met its medians, but its review
counted single waves: at 50 WPM about one wave in four from wave 4 on was swamped (median accuracy
71–77 %), and in 13–21 % of waves more than a fifth of the mobs reached the base. A per-wave trace
showed three causes, and each got its own fix. "Swamped" below is the director's own relief mark:
a wave under 75 % accuracy, or with more than 30 % of its mobs at the base.

| Step (50 learners, seed 1, waves 4+)                    | 10 WPM swamped | 25 WPM swamped | 50 WPM swamped | 50 WPM over 20 % at base |
| ------------------------------------------------------- | -------------: | -------------: | -------------: | -----------------------: |
| M4-05 as merged                                         |          5–8 % |         8–11 % |        10–14 % |                  11–20 % |
| + target 3 points under the learner's own, at most 93 % |          7–9 % |          4–6 % |          5–8 % |                   5–10 % |
| + fine mode from wave 1 with a baseline                 |          5–6 % |          2–5 % |          1–8 % |                    1–9 % |
| + arrivals a spawn gap apart (final)                    |          3–4 % |            1 % |          0–3 % |                    0–5 % |

- **The target.** A 90 % mean on a fast, accurate typist is "mostly 97 %, sometimes 70 %". A flat
  93 % would have fixed that and pushed a child who types at 90 % with no hurry down to the
  slowest pace for ever, so the target follows the learner: 3 points under their own accuracy.
- **The start.** Because `d` is relative to the learner's own speed, everyone's edge is near
  `d = 0.85–0.95`, and the start at 0.8 is already close. Searching up from there in +15 % steps
  jumped over the edge in two waves, and most real nights are only three waves long. With a
  baseline the night now starts in fine mode. Swamped waves among waves 1–3 fell from up to 14 %
  to 0–3 %.
- **Pile-ups.** At a fixed `d` the same typist scored 100 % on one wave and 68 % on the next: a
  fast mob that set out later caught up with a slow one, and two words were due at once. Spacing
  arrivals took that variance out, and it also softened the cliff (the sweep below now falls about
  4–6 points per 0.1 of `d` past the edge).
- **Crash memory, tried and removed.** A swamped wave left a ceiling at 90 % of the `d` that
  caused it, rising 1 % a wave. It made no measurable difference in the sim (the M4-05 review's
  probe and the M4-04 review's mutation both found the same): with it off, one learner mean moved
  by 0.1 point. Relief and the small fine-mode steps already do its job, so it came out.
- **Tried and dropped:** a bigger "plenty of room" step up for a wave far above the target. It
  got fast typists to their edge sooner, but a slow typist's 4–5 mob wave is often far above the
  target by luck, and their swamped share rose from 4 % to 7 %.

The 10 WPM rows can't go much lower: a slow typist's wave is only 4–5 mobs and about 20 keys, so
about 3 % of their waves fall under 75 % by chance at any pace (measured at fixed `d = 0.5`).

### Result

| Row         | Typist | Band    | Baseline |   1 |   2 |   3 |   4 |   5 |   6 |   7 |   8 |   9 |  10 | Range 4+   | Learner mean 4+ | In band | Reached 4+ | Swamped 4+ | Crowded 4+ | Low 4+ | Swamped 1-3 | Empty max | d first→last | Converged |
| ----------- | ------ | ------- | -------: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | ---------- | --------------: | ------: | ---------: | ---------: | ---------: | -----: | ----------: | --------: | ------------ | --------- |
| main        | 10wpm  | sprout  |      8.2 |  89 |  94 |  90 |  91 |  91 |  91 |  90 |  91 |  92 |  92 | 90.5-91.7  |            90.4 |     96% |       0.5% |         4% |         1% |    16% |          3% |       2.5 | 0.80→0.84    | yes       |
| main        | 10wpm  | miner   |      8.3 |  93 |  90 |  94 |  89 |  93 |  91 |  91 |  91 |  90 |  91 | 89.1-92.6  |            89.7 |     96% |       0.5% |         4% |         1% |    23% |          1% |       2.5 | 0.80→0.83    | yes       |
| main        | 10wpm  | builder |      8.2 |  91 |  90 |  89 |  89 |  91 |  91 |  91 |  91 |  91 |  90 | 88.6-91.4  |            89.3 |     98% |       0.7% |         3% |         1% |    21% |          2% |       2.5 | 0.80→0.80    | yes       |
| main        | 25wpm  | sprout  |     22.0 |  92 |  93 |  97 |  94 |  95 |  95 |  94 |  93 |  94 |  95 | 92.7-95.1  |            93.8 |     86% |       0.2% |         1% |         0% |     3% |          0% |       2.5 | 0.80→0.91    | no        |
| main        | 25wpm  | miner   |     22.2 |  93 |  94 |  94 |  95 |  93 |  93 |  94 |  93 |  93 |  94 | 92.9-95.1  |            93.4 |     90% |       0.3% |         1% |         0% |     6% |          0% |       2.5 | 0.80→0.86    | no        |
| main        | 25wpm  | builder |     21.7 |  94 |  94 |  95 |  94 |  92 |  93 |  93 |  93 |  93 |  94 | 91.7-93.7  |            92.2 |     96% |       0.2% |         1% |         0% |     8% |          0% |       2.5 | 0.80→0.89    | yes       |
| main        | 50wpm  | sprout  |     46.9 | 100 |  97 |  98 |  98 |  98 |  96 |  98 |  97 |  96 |  96 | 95.6-98.0  |            96.4 |     14% |       0.1% |         0% |         0% |     1% |          0% |       2.5 | 0.80→1.10    | no        |
| main        | 50wpm  | miner   |     46.6 |  98 |  97 |  96 |  97 |  97 |  95 |  96 |  95 |  95 |  96 | 94.8-97.3  |            94.9 |     52% |       1.3% |         2% |         3% |     4% |          0% |       2.5 | 0.80→1.03    | no        |
| main        | 50wpm  | builder |     46.4 |  97 |  97 |  97 |  96 |  96 |  95 |  95 |  95 |  94 |  95 | 93.8-96.4  |            93.4 |     88% |       2.6% |         3% |         5% |    10% |          0% |       2.5 | 0.80→0.91    | no        |
| new profile | 10wpm  | miner   |     none |  93 |  90 |  92 |  88 |  92 |  92 |  91 |  92 |  90 |  92 | 88.2-92.2  |            89.2 |     86% |       0.8% |         5% |         1% |    23% |          2% |       2.5 | 0.70→0.73    | yes       |
| new profile | 25wpm  | miner   |     none |  95 |  96 |  95 |  96 |  94 |  94 |  94 |  94 |  95 |  94 | 94.0-96.3  |            94.1 |     80% |       0.4% |         0% |         0% |     5% |          0% |       2.5 | 0.70→1.31    | no        |
| new profile | 50wpm  | miner   |     none | 100 |  98 | 100 |  97 | 100 |  97 |  97 |  97 |  97 |  96 | 95.5-100.0 |            97.3 |      2% |       0.0% |         0% |         0% |     1% |          0% |       2.5 | 0.70→2.00    | no        |
| calm        | 10wpm  | sprout  |      8.2 |  92 |  92 |  89 |  94 |  94 |  93 |  94 |  94 |  94 |  95 | 93.3-94.9  |            92.5 |     84% |       0.0% |         0% |         0% |    10% |          1% |       2.5 | 0.80→0.99    | yes       |
| calm        | 25wpm  | sprout  |     22.0 |  95 |  95 |  96 |  96 |  96 |  96 |  97 |  96 |  97 |  97 | 96.1-96.8  |            95.6 |     36% |       0.0% |         0% |         0% |     0% |          0% |       2.5 | 0.80→1.05    | no        |
| calm        | 50wpm  | sprout  |     46.9 | 100 | 100 |  97 |  99 |  98 | 100 |  99 | 100 |  98 | 100 | 97.5-100.0 |            98.2 |      0% |       0.0% |         0% |         0% |     0% |          0% |       2.5 | 0.80→1.19    | no        |
| slope 0.2   | 10wpm  | miner   |      8.3 |  94 |  91 |  94 |  92 |  93 |  92 |  92 |  92 |  89 |  91 | 89.4-92.8  |            90.9 |     94% |       0.1% |         1% |         0% |    17% |          0% |       2.5 | 0.80→0.89    | yes       |
| slope 0.2   | 25wpm  | miner   |     22.2 |  94 |  94 |  94 |  96 |  94 |  94 |  95 |  94 |  94 |  95 | 93.6-95.6  |            94.0 |     76% |       0.2% |         0% |         0% |     2% |          0% |       2.5 | 0.80→0.92    | no        |
| slope 0.2   | 50wpm  | miner   |     46.6 |  98 |  98 |  97 |  97 |  98 |  97 |  96 |  96 |  96 |  97 | 95.6-97.6  |            96.3 |     12% |       0.4% |         0% |         0% |     1% |          0% |       2.5 | 0.80→1.12    | no        |
| slope 0.8   | 10wpm  | miner   |      8.3 |  91 |  89 |  91 |  87 |  90 |  89 |  89 |  90 |  89 |  91 | 87.1-91.1  |            88.2 |     76% |       1.3% |         8% |         2% |    29% |          5% |       2.5 | 0.80→0.71    | yes       |
| slope 0.8   | 25wpm  | miner   |     22.2 |  91 |  92 |  93 |  94 |  93 |  91 |  93 |  94 |  93 |  93 | 90.9-93.6  |            92.4 |     98% |       0.7% |         2% |         1% |     7% |          3% |       2.5 | 0.80→0.75    | yes       |
| slope 0.8   | 50wpm  | miner   |     46.6 |  96 |  96 |  95 |  96 |  95 |  94 |  96 |  95 |  96 |  95 | 94.0-96.2  |            92.3 |     80% |       3.5% |         7% |         7% |    12% |          3% |       2.5 | 0.80→0.83    | no        |

| Typist |  d 0.5 |  d 0.6 |  d 0.7 |  d 0.8 |  d 0.9 |  d 1.0 |  d 1.1 |   d 1.2 |   d 1.3 |   d 1.4 |   d 1.5 |   d 1.6 |
| ------ | -----: | -----: | -----: | -----: | -----: | -----: | -----: | ------: | ------: | ------: | ------: | ------: |
| 10wpm  | 93 / 0 | 92 / 0 | 92 / 0 | 92 / 0 | 90 / 0 | 86 / 3 | 82 / 9 | 76 / 19 | 68 / 33 | 64 / 44 | 58 / 56 | 54 / 62 |
| 25wpm  | 95 / 0 | 94 / 0 | 94 / 0 | 94 / 0 | 92 / 0 | 90 / 1 | 84 / 9 | 77 / 23 | 71 / 36 | 64 / 49 | 59 / 61 | 52 / 71 |
| 50wpm  | 98 / 0 | 98 / 0 | 98 / 0 | 97 / 0 | 96 / 0 | 94 / 1 | 90 / 6 | 84 / 16 | 77 / 30 | 69 / 44 | 63 / 56 | 59 / 63 |

- **10 WPM converges in every band** by the card's strict reading: the median accuracy is in
  85–95 % at wave 4 and every later wave (88.6–92.6 %).
- **25 WPM sits at 92–95 %.** Its target is 92–93 % (3 points under a Mine accuracy of 95–96 %), so
  two per-wave medians touch 95.1 % and the strict "Converged" column says no for Sprout and
  Miner. Each learner's own mean from wave 4 on is 92.2–93.8 %, and 86–96 % of learners are in
  band.
- **50 WPM errs on the easy side, on purpose.** Learner means are 93.4–96.4 %. A fast typist is
  capped at a 93 % target and climbs at most 5 % a wave from `d = 0.8`, so a Sprout-band 50 WPM
  typist (short words, a long reaction allowance) is still climbing at wave 10. The M4-05
  review judged that a few too-easy waves are safer for a child than one in four with half the
  mobs at the base, and the M4-04 brief asked for that fix. The second night in a sitting starts where the first
  ended, so the climb carries on.
- **Swamped waves: 0–4 % on the main rows** from wave 4 on (the 10 WPM floor is about 3 %), 0–3 %
  in waves 1–3, and at most 5 % of waves have more than a fifth of the mobs at the base. At most
  2.6 % of mobs reach the base.
- **New profiles start slow on purpose.** A 10 WPM new player converges. A 25 or 50 WPM one is
  still climbing at wave 10 (`d` reaches 1.31 and 2.00), because the default reference is
  10 WPM and steps are at most +15 % a wave. Defense lessons come after Mine lessons and the
  placement test, so in practice a baseline exists.
- **Calm mode keeps `d ≤ 1.2`.** That ceiling leaves 25 and 50 WPM Sprouts above 95 %: calm mode
  trades challenge for calm. The sim's calm mobs never reach the base by construction, so "0 %
  reached" in those rows is the model, not a finding. The sim's calm typist is never slow enough
  to trip the slowness signal; `director.test.ts` covers it.
- **The model's slope matters a little more than before.** With double the slope the 10 WPM row has
  8 % swamped waves and the 50 WPM row 7 %: with a harsher trade-off the same pace costs more.
  The medians still hold.

### Pacing: no long empty field (M4-FIX-2)

The owner's playtest (2026-11-12) found mobs came too slowly, even for kids. The field is _empty_
while no mob on it still needs typing (a popping or bonking mob doesn't count). It now stays empty
for at most `maxIdleMs` (2,500 ms, every band). When it empties, the wave's next mob, and the rest
of the wave with it, is brought forward (`idlePullMs`). The pause between two waves ends so the next
wave's first mob comes `maxIdleMs` after the field emptied (`breakMs`). The sim plays the same
rules, in event order, and measures every empty stretch ("Empty max", in seconds; the dawn isn't
counted). The night's first wave starts with dusk, so its first mob sets out 1.2 s into the dusk
announcement, not 1.2 s after it: the sim's first wave starts at the night's start, and the test
checks that opening stretch too.

- **Before:** the longest empty stretch was 5.9–8.3 s at 50 WPM, 12–19 s at 25 WPM, 19–21 s at
  10 WPM, 21–26 s for a new profile and 10–18 s in calm mode. At 5 WPM it reached 86 s. A slow
  learner's low `d` spread mobs out: at `d = 0.3` the spawn gap is over three times their typing
  time.
- **After:** 2.5 s on every row, and on every band at 5, 10, 25, 40 and 60 WPM, with a baseline, as
  a new profile and calm.
- **The convergence table didn't move.** Every accuracy, reached share, swamped and low share and
  `d` path is the same as before, digit for digit, and so is the plant sweep. A mob is only brought
  forward while the field is empty, so the pressure on the typist is zero during the time cut. The
  spawn gaps and arrival order after it stay as planned, and the typist's random draws are per key,
  not per millisecond. The slow typists' dips are still 16–23 % of waves under 85 % (pinned at 25 %).
  What changed is the wall time: a Miner night typed at 300 ms a key went from 124 s to 82 s in the
  mode's own test rig.
- **5 WPM, outside the pins.** These learners struggle as much as before (the numbers are the same
  with and without the pacing): their learner mean is 82–87 % (73 % for a new Builder), 37–52 % of
  their waves are under 85 %, and 11–20 % are swamped (46 % for a new Builder). M1-07's `slow`
  profile at 5 WPM is a guess, and a 5 WPM Builder (11–13) is rare. A follow-up card looks at it;
  it is not a pacing effect.

`tests/unit/sim/sim-defense.test.ts` pins these results:

- 10 and 25 WPM: each learner's mean from wave 4 on is in 85–95 %, at least 80 % of learners are in
  band, and every per-wave median is within 85–96 % (it was 85–95 %; the 25 WPM target moved up).
  10 WPM also converges by the strict reading;
- 50 WPM: the learner mean is within 90–97 % and every per-wave median within 85–98.5 %. This is
  looser than the M4-05 card's literal 85–95 % (the Sprout row's mean is 96.4 %), on purpose;
- **stability, on every main row:** at most 6 % of waves from wave 4 on are swamped, at most 8 %
  have more than a fifth of the mobs at the base, and at most 5 % of waves 1–3 are swamped. At
  10 WPM, at most 25 % of waves from wave 4 on are under 85 % (15–23 % today);
- reached base ≤ 20 % on the main rows;
- calm mode: `d ≤ 1.2`;
- pacing: no stretch of empty field is longer than `maxIdleMs` + 250 ms, on the main rows and on
  every band at 5–60 WPM (with a baseline, new and calm; 6 learners and 5 waves a row), and the
  night's opening (dusk to its first mob) is at most `maxIdleMs`;
- the report is the same for the same seed.

**What the model can't show.** In M1-07's typist the slip rate depends on the key and on pressure,
never on the word. Real children also slip more on longer and harder words. That is a second lever
the director could use for fast learners (longer words as `d` rises) once real play data exists.
The first real numbers will come from the owner's playtest: the mode sends each wave's feedback
and the new difficulty on the bus as `defense:waveEnd`.
