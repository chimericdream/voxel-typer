/**
 * Meadow Home: the home-row keys `a s d f j k l ;`, then `g h` (docs/impl/README.md §8.4). Lessons
 * 1–6 are M2-12's; 7–14 are M3-03's. Pure data.
 *
 * Keys arrive two at a time, from the index fingers out, and each lesson reviews the pair before.
 * `g h` (the index-finger stretch) come in lesson 7, once the eight resting keys are known. Every
 * lesson rewards accuracy only (no `wpmRelative`, PLAN.md §4.1). Lessons 8 and 12 are reviews, 11
 * is the hide-the-keyboard challenge, 13 the mastery check that unlocks Birch Forest, 14 the boss.
 *
 * Lengths, per band: the chars budget (Sprout 0.6, Miner 1, Builder 1.3 unless `bandScale` says
 * otherwise) / the keys a child types, the mean over 50 seeds. In Mine a word block ends on its
 * last letter, so a words lesson types about 15 % fewer keys than its budget, which counts the
 * space between words (decisions 81 and 90). Phrases overshoot a little: the last one finishes.
 *
 * | Lesson | Kind      | New keys | Sprout  | Miner   | Builder |
 * | ------ | --------- | -------- | ------- | ------- | ------- |
 * | 01     | letters   | f j      | 25 / 25 | 50 / 50 | 60 / 60 |
 * | 02     | letters   | d k      | 30 / 30 | 50 / 50 | 65 / 65 |
 * | 03     | syllables | s l      | 33 / 25 | 55 / 41 | 72 / 53 |
 * | 04     | letters   | a ;      | 36 / 36 | 60 / 60 | 78 / 78 |
 * | 05     | words     |          | 36 / 31 | 60 / 50 | 78 / 64 |
 * | 06     | phrases   |          | 33 / 37 | 55 / 56 | 72 / 72 |
 * | 07     | letters   | g h      | 36 / 36 | 60 / 60 | 78 / 78 |
 * | 08     | syllables | review   | 39 / 29 | 65 / 48 | 85 / 63 |
 * | 09     | words     |          | 39 / 33 | 65 / 54 | 85 / 70 |
 * | 10     | phrases   |          | 39 / 42 | 65 / 66 | 85 / 86 |
 * | 11     | letters   | no peek  | 36 / 36 | 60 / 60 | 78 / 78 |
 * | 12     | words     | review   | 42 / 36 | 70 / 58 | 91 / 75 |
 * | 13     | phrases   | mastery  | 90 s    | 90 s    | 90 s    |
 * | 14     | phrases   | boss     | 42 / 45 | 70 / 70 | 91 / 90 |
 *
 * Titles live in `src/i18n/en/lessons-meadow.ts`.
 */
import type { Lesson } from "./types";

/** Accuracy goal of every lesson here (the card asks for 0.85). */
const ACCURACY = 0.85;
/** The mastery lesson's accuracy goal (M3-03 card). */
const MASTERY_ACCURACY = 0.9;

/** The eight keys of lessons 1–4. */
const HOME_KEYS = ["f", "j", "d", "k", "s", "l", "a", ";"];
/** All ten Meadow keys, from lesson 7 on. */
const MEADOW_KEYS = [...HOME_KEYS, "g", "h"];
/** Every Meadow phrase list: lesson 6's, and the g/h pairs. */
const MEADOW_PHRASES = ["meadow-phrases", "meadow-gh-phrases"];

export const lessons: Lesson[] = [
  {
    // A 6-year-old's first lesson: only the two keys with bumps, and short, so it always ends well.
    id: "meadow-01",
    biome: "meadow",
    order: 1,
    titleKey: "lessonsMeadow.meadow01",
    newKeys: ["f", "j"],
    reviewKeys: [],
    kind: "letters",
    length: { chars: 50 },
    mode: "mine",
    targets: { accuracy: ACCURACY },
    bandScale: { sprout: 0.5, builder: 1.2 },
    tags: ["intro"],
  },
  {
    id: "meadow-02",
    biome: "meadow",
    order: 2,
    titleKey: "lessonsMeadow.meadow02",
    newKeys: ["d", "k"],
    reviewKeys: ["f", "j"],
    kind: "letters",
    length: { chars: 50 },
    mode: "mine",
    targets: { accuracy: ACCURACY },
  },
  {
    // No vowel yet, so the syllables are short key groups such as `fds` and `lk`.
    id: "meadow-03",
    biome: "meadow",
    order: 3,
    titleKey: "lessonsMeadow.meadow03",
    newKeys: ["s", "l"],
    reviewKeys: ["d", "k"],
    kind: "syllables",
    length: { chars: 55 },
    mode: "mine",
    targets: { accuracy: ACCURACY },
  },
  {
    // Letters, not syllables: with `a` as the only vowel, syllables fill up with `a` and the comfort
    // cap leaves `;` about 5% of the chars (a Sprout session had none 37 times in 200 seeds).
    id: "meadow-04",
    biome: "meadow",
    order: 4,
    titleKey: "lessonsMeadow.meadow04",
    newKeys: ["a", ";"],
    reviewKeys: ["s", "l"],
    kind: "letters",
    length: { chars: 60 },
    mode: "mine",
    targets: { accuracy: ACCURACY },
  },
  {
    id: "meadow-05",
    biome: "meadow",
    order: 5,
    titleKey: "lessonsMeadow.meadow05",
    newKeys: [],
    reviewKeys: HOME_KEYS,
    kind: "words",
    pools: ["home-row"],
    length: { chars: 60 },
    mode: "mine",
    targets: { accuracy: ACCURACY },
  },
  {
    // Longer targets: two or three home-row words in a row. A short review of every key so far.
    id: "meadow-06",
    biome: "meadow",
    order: 6,
    titleKey: "lessonsMeadow.meadow06",
    newKeys: [],
    reviewKeys: HOME_KEYS,
    kind: "phrases",
    pools: ["meadow-phrases"],
    length: { chars: 55 },
    mode: "mine",
    targets: { accuracy: ACCURACY },
  },
  {
    // Letters over all ten keys: `g h` get the focus weight, and `j ;` (no real word has `;`, few
    // have `j`) get their first practice since lesson 4.
    id: "meadow-07",
    biome: "meadow",
    order: 7,
    titleKey: "lessonsMeadow.meadow07",
    newKeys: ["g", "h"],
    reviewKeys: ["f", "j"],
    kind: "letters",
    length: { chars: 60 },
    mode: "mine",
    targets: { accuracy: ACCURACY },
  },
  {
    // Review (every 4th lesson). Syllables over all ten keys, so `g h` turn up next to the others.
    id: "meadow-08",
    biome: "meadow",
    order: 8,
    titleKey: "lessonsMeadow.meadow08",
    newKeys: [],
    reviewKeys: MEADOW_KEYS,
    kind: "syllables",
    length: { chars: 65 },
    mode: "mine",
    targets: { accuracy: ACCURACY },
  },
  {
    // `home-row` doubles: 43 words with `g h`, against 21 without.
    id: "meadow-09",
    biome: "meadow",
    order: 9,
    titleKey: "lessonsMeadow.meadow09",
    newKeys: [],
    reviewKeys: ["g", "h"],
    kind: "words",
    pools: ["home-row"],
    length: { chars: 65 },
    mode: "mine",
    targets: { accuracy: ACCURACY },
  },
  {
    // Space practice with the g/h pairs (M3-02) and lesson 6's pairs.
    id: "meadow-10",
    biome: "meadow",
    order: 10,
    titleKey: "lessonsMeadow.meadow10",
    newKeys: [],
    reviewKeys: MEADOW_KEYS,
    kind: "phrases",
    pools: MEADOW_PHRASES,
    length: { chars: 65 },
    mode: "mine",
    targets: { accuracy: ACCURACY },
  },
  {
    // The hide-the-keyboard challenge. Single letters: the home row is where "don't look down"
    // starts, and every key a child meets here has a resting finger or the index stretch.
    id: "meadow-11",
    biome: "meadow",
    order: 11,
    titleKey: "lessonsMeadow.meadow11",
    newKeys: [],
    reviewKeys: MEADOW_KEYS,
    kind: "letters",
    length: { chars: 60 },
    mode: "mine",
    targets: { accuracy: ACCURACY },
    tags: ["challenge-hide-keyboard"],
  },
  {
    // Review (every 4th lesson): every home-row word, ahead of the mastery check.
    id: "meadow-12",
    biome: "meadow",
    order: 12,
    titleKey: "lessonsMeadow.meadow12",
    newKeys: [],
    reviewKeys: MEADOW_KEYS,
    kind: "words",
    pools: ["home-row"],
    length: { chars: 70 },
    mode: "mine",
    targets: { accuracy: ACCURACY },
  },
  {
    // Mastery: 90 s for every band, words and phrases mixed. ≥ 2 stars unlocks Birch Forest.
    id: "meadow-13",
    biome: "meadow",
    order: 13,
    titleKey: "lessonsMeadow.meadow13",
    newKeys: [],
    reviewKeys: MEADOW_KEYS,
    kind: "phrases",
    pools: ["home-row", ...MEADOW_PHRASES],
    length: { seconds: 90 },
    mode: "mine",
    targets: { accuracy: MASTERY_ACCURACY },
    bandScale: { sprout: 1, miner: 1, builder: 1 },
    tags: ["mastery"],
  },
  {
    // The Cobble Colossus (README §8.2). Runs as Mine until the boss mode lands (M5).
    id: "meadow-14",
    biome: "meadow",
    order: 14,
    titleKey: "lessonsMeadow.meadow14",
    newKeys: [],
    reviewKeys: MEADOW_KEYS,
    kind: "phrases",
    pools: MEADOW_PHRASES,
    length: { chars: 70 },
    mode: "boss",
    targets: { accuracy: ACCURACY },
    tags: ["boss"],
  },
];
