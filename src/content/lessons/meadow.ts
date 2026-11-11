/**
 * Meadow Home, lessons 1–6: the home-row keys `a s d f j k l ;` (docs/impl/tasks-m2.md M2-12,
 * docs/impl/README.md §8.4). `g` and `h` come in Meadow's later lessons. Pure data.
 *
 * Keys arrive two at a time, from the index fingers out, and each lesson reviews the pair before.
 * Every lesson rewards accuracy only (no `wpmRelative`, PLAN.md §4.1). Lengths, by the band scale:
 *
 * | Lesson | Kind      | Sprout | Miner | Builder |
 * | ------ | --------- | ------ | ----- | ------- |
 * | 01     | letters   | 25     | 50    | 60      |
 * | 02     | letters   | 30     | 50    | 65      |
 * | 03     | syllables | 33     | 55    | 72      |
 * | 04     | letters   | 36     | 60    | 78      |
 * | 05     | words     | 36     | 60    | 78      |
 * | 06     | phrases   | 33     | 55    | 72      |
 *
 * Titles live in `src/i18n/en/lessons-meadow.ts`.
 */
import type { Lesson } from "./types";

/** Accuracy goal of every lesson here (the card asks for 0.85). */
const ACCURACY = 0.85;

/** The eight keys of lessons 1–4. */
const HOME_KEYS = ["f", "j", "d", "k", "s", "l", "a", ";"];

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
];
