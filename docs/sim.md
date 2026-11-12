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

## Night Defense wave director (`tools/sim-defense.ts`, M4-05)

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
30-word Mine-style session; its net WPM is the baseline the director starts from, as the game's
baseline would be. Words come from the shipped word lists with all 26 letters allowed (a learner
past Frosty Peaks). The mobs are stand-ins for M4-03's roster: the card's ids, with guessed flavor
tags and speed classes. The run takes about 7 s, or 9 s with the sweep.

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
inside 4–40 s, and fast mobs walk 1.25× faster, slow ones 0.8×. Each wave lasts about 20/25/30 s
by band (3 s longer per wave up to the fourth), so a fast learner gets more mobs, never a longer
wave. A night starts at `d = 0.8` (0.7 for a new profile).

After each wave:

1. `step = k × (accuracy − 0.90)`. `accuracy` is a words-weighted average in which each wave counts
   half as much as the next. A wave under 2 s of activity doesn't count for accuracy.
2. If more than 10 % of the wave's mobs reached the base, `step ≤ −1.5 × (share − 0.10)`.
3. **Search, then fine.** Until the first wave at or under 90 % (or with more than 10 % at the
   base), `k = 2.5` and steps stay within ±15 %. After that, `k = 1` and steps stay within
   −8 % / +5 %.
4. **Relief.** A wave under 75 %, or with more than 30 % of its mobs at the base, makes the next
   one 15 % easier.
5. `d ← clamp(d × (1 + step), 0.3, 2.0)`. In calm mode: a pace of 0.75×, at most `d = 1.2`, at
   most +8 % a wave, and at most 10 mobs.

How it got there (each change checked against the full table):

- **A plain proportional step** (`k = 3`, ±15 %, an exponential average) left fast typists at 98 %:
  `d` only scaled the typing part of each mob's time, not the reaction allowance. So `d` became a
  time scale on everything.
- **Then the plant sweep showed a cliff.** Accuracy is flat until about `d = 0.8`, then falls about
  10 points per 0.1 of `d`. Two changes followed:
  - With `k = 2.5` the loop gain on that slope was about 2.7, which is unstable for this kind of
    step, so the controller swung between too easy and swamped.
  - Speed and spawn rate scaled the same way, so above `d = 1` the extra pressure came from more
    words a minute. That overloads the learner: every slip costs time, which brings more pressure
    and more slips. Speed now rises faster than the spawn rate.
- **Fine mode** came next, because a fast typist's in-band window is only about ±0.03 of `d` wide.
- **Things that didn't help:**
  - a median-of-3 estimate;
  - asymmetric smoothing, which biased the estimate down so slow typists drifted to lower `d`;
  - lower targets (0.88, 0.89), which traded the in-band share for nothing;
  - other relief thresholds.

### Result

| Row         | Typist | Band    | Baseline |   1 |   2 |   3 |   4 |   5 |   6 |   7 |   8 |   9 |  10 | Range 4+   | Learner mean 4+ | In band | Reached 4+ | d first→last | Converged |
| ----------- | ------ | ------- | -------: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | ---------- | --------------: | ------: | ---------: | ------------ | --------- |
| main        | 10wpm  | sprout  |      8.2 |  89 |  94 |  88 |  89 |  90 |  90 |  90 |  93 |  91 |  94 | 89.4-93.7  |            90.0 |     94% |       1.1% | 0.80→0.78    | yes       |
| main        | 10wpm  | miner   |      8.3 |  92 |  90 |  92 |  88 |  91 |  90 |  91 |  90 |  90 |  91 | 88.0-91.5  |            89.3 |     78% |       1.4% | 0.80→0.77    | yes       |
| main        | 10wpm  | builder |      8.2 |  92 |  90 |  88 |  88 |  90 |  91 |  90 |  91 |  93 |  89 | 88.2-92.7  |            88.9 |     88% |       1.4% | 0.80→0.77    | yes       |
| main        | 25wpm  | sprout  |     22.0 |  92 |  93 |  95 |  91 |  94 |  93 |  94 |  91 |  94 |  95 | 90.8-94.5  |            89.9 |     80% |       4.7% | 0.80→0.95    | yes       |
| main        | 25wpm  | miner   |     22.2 |  94 |  92 |  91 |  93 |  93 |  91 |  93 |  93 |  93 |  94 | 91.5-94.2  |            90.9 |    100% |       3.4% | 0.80→0.85    | yes       |
| main        | 25wpm  | builder |     21.7 |  93 |  92 |  93 |  91 |  90 |  94 |  94 |  93 |  94 |  92 | 90.5-94.5  |            90.6 |     90% |       3.6% | 0.80→0.81    | yes       |
| main        | 50wpm  | sprout  |     46.9 | 100 |  98 |  95 |  95 |  95 |  91 |  92 |  94 |  93 |  94 | 91.2-95.1  |            90.1 |     94% |       7.0% | 0.80→1.23    | no        |
| main        | 50wpm  | miner   |     46.6 |  97 |  96 |  81 |  94 |  96 |  95 |  95 |  94 |  96 |  95 | 93.7-96.1  |            89.5 |     86% |       9.4% | 0.80→0.89    | no        |
| main        | 50wpm  | builder |     46.4 |  97 |  91 |  94 |  96 |  96 |  94 |  95 |  96 |  96 |  95 | 94.2-96.2  |            90.8 |     98% |       7.8% | 0.80→0.84    | no        |
| new profile | 10wpm  | miner   |     none |  94 |  91 |  91 |  87 |  91 |  91 |  91 |  90 |  89 |  91 | 86.8-91.5  |            89.2 |     76% |       1.7% | 0.70→0.68    | yes       |
| new profile | 25wpm  | miner   |     none |  95 |  95 |  95 |  96 |  95 |  94 |  93 |  94 |  94 |  94 | 93.1-96.1  |            93.7 |     78% |       0.6% | 0.70→1.28    | no        |
| new profile | 50wpm  | miner   |     none | 100 | 100 | 100 |  97 | 100 |  97 |  97 |  97 |  97 |  97 | 96.7-100.0 |            97.4 |      2% |       0.0% | 0.70→2.00    | no        |
| calm        | 10wpm  | sprout  |      8.2 |  92 |  93 |  90 |  94 |  94 |  94 |  94 |  94 |  94 |  94 | 93.5-94.4  |            92.7 |     84% |       0.0% | 0.80→0.96    | yes       |
| calm        | 25wpm  | sprout  |     22.0 |  95 |  96 |  96 |  94 |  96 |  96 |  97 |  95 |  95 |  97 | 94.1-97.0  |            95.4 |     38% |       0.0% | 0.80→1.20    | no        |
| calm        | 50wpm  | sprout  |     46.9 | 100 | 100 |  97 |  98 |  97 | 100 |  97 | 100 |  97 |  98 | 97.4-100.0 |            98.2 |      0% |       0.0% | 0.80→1.20    | no        |
| slope 0.2   | 10wpm  | miner   |      8.3 |  94 |  90 |  94 |  89 |  91 |  91 |  92 |  90 |  91 |  91 | 88.9-91.7  |            89.9 |     90% |       1.9% | 0.80→0.83    | yes       |
| slope 0.2   | 25wpm  | miner   |     22.2 |  94 |  93 |  92 |  92 |  92 |  92 |  93 |  93 |  93 |  94 | 91.8-93.8  |            90.6 |     94% |       4.5% | 0.80→0.97    | yes       |
| slope 0.2   | 50wpm  | miner   |     46.6 |  98 |  97 |  95 |  92 |  94 |  93 |  95 |  94 |  93 |  95 | 92.5-95.3  |            90.9 |     98% |       8.5% | 0.80→1.10    | no        |
| slope 0.8   | 10wpm  | miner   |      8.3 |  90 |  88 |  89 |  88 |  90 |  90 |  91 |  90 |  90 |  90 | 87.8-90.9  |            87.9 |     76% |       1.5% | 0.80→0.68    | yes       |
| slope 0.8   | 25wpm  | miner   |     22.2 |  91 |  89 |  91 |  94 |  94 |  93 |  93 |  93 |  94 |  93 | 92.8-94.4  |            90.9 |     90% |       2.9% | 0.80→0.78    | yes       |
| slope 0.8   | 50wpm  | miner   |     46.6 |  96 |  90 |  88 |  95 |  97 |  94 |  96 |  95 |  97 |  95 | 94.2-96.9  |            89.7 |     86% |       8.4% | 0.80→0.79    | no        |

Plant sweep (miner band, fixed d, 50 learners, waves 3-4): mean accuracy % / reached %

| Typist |  d 0.5 |  d 0.6 |  d 0.7 |  d 0.8 |  d 0.9 |   d 1.0 |   d 1.1 |   d 1.2 |   d 1.3 |   d 1.4 |   d 1.5 |   d 1.6 |
| ------ | -----: | -----: | -----: | -----: | -----: | ------: | ------: | ------: | ------: | ------: | ------: | ------: |
| 10wpm  | 93 / 0 | 93 / 0 | 92 / 0 | 91 / 1 | 88 / 2 | 82 / 10 | 73 / 25 | 67 / 37 | 60 / 50 | 55 / 59 | 49 / 70 | 45 / 77 |
| 25wpm  | 95 / 0 | 95 / 0 | 94 / 0 | 93 / 0 | 89 / 3 | 77 / 21 | 69 / 35 | 63 / 47 | 56 / 60 | 52 / 68 | 47 / 76 | 44 / 81 |
| 50wpm  | 98 / 0 | 98 / 0 | 97 / 0 | 97 / 0 | 93 / 3 | 82 / 19 | 75 / 32 | 68 / 44 | 65 / 52 | 61 / 59 | 59 / 63 | 58 / 65 |

- **10 and 25 WPM converge in every band.** The median accuracy is in 85–95 % at wave 4 and every
  later wave (88.0–94.5 %), and at most 4.7 % of mobs reach the base.
- **50 WPM is 1 point over at the top.** Each learner's own mean from wave 4 on is in band: the
  median of those means is 89.5–90.8 %, and 86–98 % of the learners are in band. But the per-wave
  median peaks at 95.1 % (Sprout), 96.1 % (Miner) and 96.2 % (Builder), because a fast typist's
  waves are "fine or swamped". The sweep shows why: at fixed `d` the fast typist goes from 97 % at
  `d = 0.8` to 82 % at `d = 1.0`. A typical wave just under that edge scores 95–97 %, and an
  occasional one over it scores 70–80 %. So the average sits at 90 % while the median wave sits
  higher. At most 9.4 % of mobs reach the base, inside the 20 % limit.
- **New profiles start slow on purpose.** A 10 WPM new player converges. A 25 or 50 WPM one is
  still climbing at wave 10 (`d` reaches 1.28 and 2.00), because the default reference is
  10 WPM and steps are at most +15 % a wave. Defense lessons come after Mine lessons and the
  placement test, so in practice a baseline exists.
- **Calm mode never lets a mob reach the base** and keeps `d ≤ 1.2`. That ceiling leaves 25 and
  50 WPM Sprouts above 95 %: calm mode trades challenge for calm.
- **The model's slope barely matters.** With half or double the slope, 10 and 25 WPM still
  converge, and 50 WPM behaves as in the main rows.

`tests/unit/sim/sim-defense.test.ts` pins these results:

- 10 and 25 WPM converge in every band;
- 50 WPM: the learner mean is in band, at least 80 % of learners are in band, and every per-wave
  median from wave 4 on is within 85–96.5 %;
- reached base ≤ 20 % on the main rows;
- calm mode: no mob reaches the base, and `d ≤ 1.2`;
- the report is the same for the same seed.

**What the model can't show.** In M1-07's typist the slip rate depends on the key and on pressure,
never on the word. Real children also slip more on longer and harder words. That is a second lever
the director could use for fast learners (longer words as `d` rises) once real play data exists.
