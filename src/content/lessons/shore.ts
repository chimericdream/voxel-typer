/**
 * Sandy Shore: the bottom row, `m v n b c x z` (M3-03). Pure data.
 *
 * Mirror pairs from the index fingers out, as in the Meadow: `m v` (straight down from `j f`),
 * then `n b` (the inside stretch), then `c x`, and last `z`, the pinky reach. `, . /` wait for
 * Crystal Caverns (README §8.4). Each step gets a letters drill (syllables would bury a consonant
 * pair among 22–27 keys; see `birch.ts`) and a words lesson. Lessons 4, 8 and 12 are reviews, 11
 * is the hide-the-keyboard challenge, 13 the mastery check that unlocks Frosty Peaks, 14 the boss.
 * Accuracy only: speed targets begin in Frosty Peaks (PLAN.md §4.1).
 *
 * `z` is alone: it is the last bottom-row letter, and only 13 Sprout words have one. The words
 * lesson after it uses the whole row.
 *
 * Lengths, per band: the chars budget (Sprout 0.6, Miner 1, Builder 1.3 unless `bandScale` says
 * otherwise) / the keys a child types, the mean over 50 seeds. In Mine a word block ends on its
 * last letter, so a words lesson types about 15 % fewer keys than its budget, which counts the
 * space between words (decisions 81 and 90). Phrases overshoot a little: the last one finishes.
 *
 * | Lesson | Kind    | New keys | Sprout  | Miner   | Builder   |
 * | ------ | ------- | -------- | ------- | ------- | --------- |
 * | 01     | letters | m v      | 49 / 49 | 65 / 65 | 85 / 85   |
 * | 02     | words   |          | 45 / 39 | 75 / 65 | 98 / 87   |
 * | 03     | letters | n b      | 53 / 53 | 70 / 70 | 91 / 91   |
 * | 04     | words   | review   | 48 / 41 | 80 / 70 | 104 / 95  |
 * | 05     | words   |          | 45 / 39 | 75 / 67 | 98 / 89   |
 * | 06     | letters | c x      | 53 / 53 | 70 / 70 | 91 / 91   |
 * | 07     | words   |          | 45 / 39 | 75 / 66 | 98 / 91   |
 * | 08     | phrases | review   | 48 / 53 | 80 / 84 | 104 / 109 |
 * | 09     | letters | z        | 49 / 49 | 65 / 65 | 85 / 85   |
 * | 10     | words   |          | 48 / 41 | 80 / 71 | 104 / 96  |
 * | 11     | words   | no peek  | 45 / 39 | 75 / 67 | 98 / 89   |
 * | 12     | phrases | review   | 42 / 46 | 70 / 74 | 91 / 102  |
 * | 13     | phrases | mastery  | 90 s    | 90 s    | 90 s      |
 * | 14     | phrases | boss     | 51 / 56 | 85 / 89 | 111 / 116 |
 *
 * Titles live in `src/i18n/en/lessons-shore.ts`.
 */
import type { Lesson } from "./types";

const ACCURACY = 0.85;
const MASTERY_ACCURACY = 0.9;

const BOTTOM_KEYS = ["m", "v", "n", "b", "c", "x", "z"];

/** Shore words for every band, plus the `band=all` theme lists for flavor. */
const WORDS = [
  "shore-sprout",
  "shore-miner",
  "shore-builder",
  "theme-animals",
  "theme-blocks",
  "theme-colors",
  "theme-food",
  "theme-nature",
  "theme-tools",
];
/** A review also brings back every Birch and Meadow word. */
const REVIEW_WORDS = ["home-row", "birch-sprout", "birch-miner", "birch-builder", ...WORDS];
/**
 * Sprouts get 0.75 of a drill, not the default 0.6: with 22–27 keys allowed, a new key is only
 * about 1 in 15 chars, and a short session could miss it.
 */
const SPROUT_DRILL = { sprout: 0.75 };
const PHRASES = ["shore-phrases-sprout", "shore-phrases-miner", "shore-phrases-builder"];
const REVIEW_PHRASES = [
  "birch-phrases-sprout",
  "birch-phrases-miner",
  "birch-phrases-builder",
  ...PHRASES,
];

type Spec = Omit<Lesson, "id" | "biome" | "mode" | "targets"> &
  Partial<Pick<Lesson, "mode" | "targets">>;

const lesson = (spec: Spec): Lesson => ({
  id: `shore-${String(spec.order).padStart(2, "0")}`,
  biome: "shore",
  mode: "mine",
  targets: { accuracy: ACCURACY },
  ...spec,
});

export const lessons: Lesson[] = [
  // The first reach below the home row: plain letters.
  lesson({
    order: 1,
    titleKey: "lessonsShore.shore01",
    newKeys: ["m", "v"],
    reviewKeys: [],
    kind: "letters",
    length: { chars: 65 },
    bandScale: SPROUT_DRILL,
  }),
  lesson({
    order: 2,
    titleKey: "lessonsShore.shore02",
    newKeys: [],
    reviewKeys: ["m", "v"],
    kind: "words",
    pools: WORDS,
    length: { chars: 75 },
  }),
  lesson({
    order: 3,
    titleKey: "lessonsShore.shore03",
    newKeys: ["n", "b"],
    reviewKeys: ["m", "v"],
    kind: "letters",
    length: { chars: 70 },
    bandScale: SPROUT_DRILL,
  }),
  // Review: every word so far, Birch's and Meadow's included.
  lesson({
    order: 4,
    titleKey: "lessonsShore.shore04",
    newKeys: [],
    reviewKeys: ["m", "v", "n", "b"],
    kind: "words",
    pools: REVIEW_WORDS,
    length: { chars: 80 },
  }),
  lesson({
    order: 5,
    // A night at the camp (M4-04): the same words, on visitors walking the lanes.
    mode: "defense",
    titleKey: "lessonsShore.shore05",
    newKeys: [],
    reviewKeys: ["n", "b"],
    kind: "words",
    pools: WORDS,
    length: { chars: 75 },
  }),
  lesson({
    order: 6,
    titleKey: "lessonsShore.shore06",
    newKeys: ["c", "x"],
    reviewKeys: ["n", "b"],
    kind: "letters",
    length: { chars: 70 },
    bandScale: SPROUT_DRILL,
  }),
  lesson({
    order: 7,
    titleKey: "lessonsShore.shore07",
    newKeys: [],
    reviewKeys: ["c", "x"],
    kind: "words",
    pools: WORDS,
    length: { chars: 75 },
  }),
  // Review and space practice: short beach phrases.
  lesson({
    order: 8,
    titleKey: "lessonsShore.shore08",
    newKeys: [],
    reviewKeys: ["m", "v", "n", "b", "c", "x"],
    kind: "phrases",
    pools: PHRASES,
    length: { chars: 80 },
  }),
  lesson({
    order: 9,
    titleKey: "lessonsShore.shore09",
    newKeys: ["z"],
    reviewKeys: ["c", "x"],
    kind: "letters",
    length: { chars: 65 },
    bandScale: SPROUT_DRILL,
  }),
  lesson({
    order: 10,
    titleKey: "lessonsShore.shore10",
    newKeys: [],
    reviewKeys: BOTTOM_KEYS,
    kind: "words",
    pools: WORDS,
    length: { chars: 80 },
  }),
  lesson({
    order: 11,
    titleKey: "lessonsShore.shore11",
    newKeys: [],
    reviewKeys: BOTTOM_KEYS,
    kind: "words",
    pools: REVIEW_WORDS,
    length: { chars: 75 },
    tags: ["challenge-hide-keyboard"],
  }),
  // Review and space practice before the mastery check: every Birch and Shore phrase.
  lesson({
    order: 12,
    titleKey: "lessonsShore.shore12",
    newKeys: [],
    reviewKeys: BOTTOM_KEYS,
    kind: "phrases",
    pools: REVIEW_PHRASES,
    length: { chars: 70 },
  }),
  // Mastery: 90 s for every band, words and phrases mixed. ≥ 2 stars unlocks Frosty Peaks.
  lesson({
    order: 13,
    titleKey: "lessonsShore.shore13",
    newKeys: [],
    reviewKeys: BOTTOM_KEYS,
    kind: "phrases",
    pools: [...WORDS, ...PHRASES],
    length: { seconds: 90 },
    targets: { accuracy: MASTERY_ACCURACY },
    bandScale: { sprout: 1, miner: 1, builder: 1 },
    tags: ["mastery"],
  }),
  // The Tidecrab King (README §8.2). Runs as Mine until the boss mode lands (M5).
  lesson({
    order: 14,
    titleKey: "lessonsShore.shore14",
    newKeys: [],
    reviewKeys: BOTTOM_KEYS,
    kind: "phrases",
    pools: PHRASES,
    length: { chars: 85 },
    mode: "boss",
    tags: ["boss"],
  }),
];
