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
