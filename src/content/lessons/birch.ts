/**
 * Birch Forest: the top row, `e i r u t y o w q p`, two keys at a time (M3-03). Pure data.
 *
 * The order is M3-02's card order: the two vowels `e i` first (they unlock the most words), then
 * the rest by how many words they open up, ending with the rare `q` and the pinky reach `p`. Each
 * pair gets a drill and then a words lesson. Lessons 4, 8 and 12 are reviews, 13 is the
 * hide-the-keyboard challenge, 14 the mastery check that unlocks Sandy Shore, 15 the boss. Accuracy
 * only: speed targets begin in Frosty Peaks (PLAN.md §4.1).
 *
 * Drills are single letters, except `r u` (syllables). With 14–20 keys allowed and a focus weight
 * of 3 against 2 (contracts §4), syllables gave a consonant pair only 8–10 % of the keys, and a
 * Sprout session often had none of one; letters give it 14–17 %. Pairs with a vowel do fine as
 * syllables (`r u`: 24 %). Phrases need `o` and `q p` (1 of 86 Birch phrases is typeable before
 * `o w`), so the phrase lesson is the review at 12.
 *
 * Lengths, per band: the chars budget (Sprout 0.6, Miner 1, Builder 1.3 unless `bandScale` says
 * otherwise) / the keys a child types, the mean over 50 seeds. In Mine a word block ends on its
 * last letter, so a words lesson types about 15 % fewer keys than its budget, which counts the
 * space between words (decisions 81 and 90). Phrases overshoot a little: the last one finishes.
 *
 * | Lesson | Kind      | New keys | Sprout  | Miner   | Builder   |
 * | ------ | --------- | -------- | ------- | ------- | --------- |
 * | 01     | letters   | e i      | 36 / 36 | 60 / 60 | 78 / 78   |
 * | 02     | words     |          | 42 / 36 | 70 / 60 | 91 / 79   |
 * | 03     | syllables | r u      | 49 / 37 | 65 / 48 | 85 / 63   |
 * | 04     | letters   | review   | 39 / 39 | 65 / 65 | 85 / 85   |
 * | 05     | words     |          | 42 / 36 | 70 / 60 | 91 / 80   |
 * | 06     | letters   | t y      | 49 / 49 | 65 / 65 | 85 / 85   |
 * | 07     | words     |          | 42 / 36 | 70 / 61 | 91 / 82   |
 * | 08     | words     | review   | 45 / 39 | 75 / 65 | 98 / 87   |
 * | 09     | letters   | o w      | 49 / 49 | 65 / 65 | 85 / 85   |
 * | 10     | words     |          | 45 / 39 | 75 / 67 | 98 / 89   |
 * | 11     | letters   | q p      | 49 / 49 | 65 / 65 | 85 / 85   |
 * | 12     | phrases   | review   | 45 / 50 | 75 / 78 | 98 / 103  |
 * | 13     | words     | no peek  | 42 / 37 | 70 / 62 | 91 / 84   |
 * | 14     | phrases   | mastery  | 90 s    | 90 s    | 90 s      |
 * | 15     | phrases   | boss     | 48 / 52 | 80 / 84 | 104 / 111 |
 *
 * Titles live in `src/i18n/en/lessons-birch.ts`.
 */
import type { Lesson } from "./types";

const ACCURACY = 0.85;
const MASTERY_ACCURACY = 0.9;

const MEADOW_KEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"];
const TOP_KEYS = ["e", "i", "r", "u", "t", "y", "o", "w", "q", "p"];

/** Birch words for every band, plus the `band=all` theme lists for flavor. */
const WORDS = [
  "birch-sprout",
  "birch-miner",
  "birch-builder",
  "theme-animals",
  "theme-blocks",
  "theme-colors",
  "theme-food",
  "theme-nature",
  "theme-tools",
];
/** A review also brings back every Meadow word. */
const REVIEW_WORDS = ["home-row", ...WORDS];
/**
 * Sprouts get 0.75 of a drill, not the default 0.6: with 14–20 keys allowed, a new key is only
 * about 1 in 8 chars, and a short session could miss it.
 */
const SPROUT_DRILL = { sprout: 0.75 };
const PHRASES = ["birch-phrases-sprout", "birch-phrases-miner", "birch-phrases-builder"];

type Spec = Omit<Lesson, "id" | "biome" | "mode" | "targets"> &
  Partial<Pick<Lesson, "mode" | "targets">>;

const lesson = (spec: Spec): Lesson => {
  const nn = String(spec.order).padStart(2, "0");
  return {
    id: `birch-${nn}`,
    biome: "birch",
    mode: "mine",
    targets: { accuracy: ACCURACY },
    ...spec,
  };
};

export const lessons: Lesson[] = [
  // The first reach off the home row: plain letters, so the child finds `e` and `i` before
  // anything else.
  lesson({
    order: 1,
    titleKey: "lessonsBirch.birch01",
    newKeys: ["e", "i"],
    reviewKeys: [],
    kind: "letters",
    length: { chars: 60 },
  }),
  lesson({
    order: 2,
    titleKey: "lessonsBirch.birch02",
    newKeys: [],
    reviewKeys: ["e", "i"],
    kind: "words",
    pools: WORDS,
    length: { chars: 70 },
  }),
  lesson({
    order: 3,
    titleKey: "lessonsBirch.birch03",
    newKeys: ["r", "u"],
    reviewKeys: ["e", "i"],
    kind: "syllables",
    length: { chars: 65 },
    bandScale: SPROUT_DRILL,
  }),
  // Review: single letters over every key so far, so `j ;` and the home row get a turn.
  lesson({
    order: 4,
    titleKey: "lessonsBirch.birch04",
    newKeys: [],
    reviewKeys: [...MEADOW_KEYS, "e", "i", "r", "u"],
    kind: "letters",
    length: { chars: 65 },
  }),
  lesson({
    order: 5,
    titleKey: "lessonsBirch.birch05",
    newKeys: [],
    reviewKeys: ["r", "u"],
    kind: "words",
    pools: WORDS,
    length: { chars: 70 },
  }),
  lesson({
    order: 6,
    titleKey: "lessonsBirch.birch06",
    newKeys: ["t", "y"],
    reviewKeys: ["r", "u"],
    kind: "letters",
    length: { chars: 65 },
    bandScale: SPROUT_DRILL,
  }),
  lesson({
    order: 7,
    titleKey: "lessonsBirch.birch07",
    newKeys: [],
    reviewKeys: ["t", "y"],
    kind: "words",
    pools: WORDS,
    length: { chars: 70 },
  }),
  // Review: every word so far, Meadow's included.
  lesson({
    order: 8,
    titleKey: "lessonsBirch.birch08",
    newKeys: [],
    reviewKeys: TOP_KEYS.slice(0, 6),
    kind: "words",
    pools: REVIEW_WORDS,
    length: { chars: 75 },
  }),
  lesson({
    order: 9,
    titleKey: "lessonsBirch.birch09",
    newKeys: ["o", "w"],
    reviewKeys: ["t", "y"],
    kind: "letters",
    length: { chars: 65 },
    bandScale: SPROUT_DRILL,
  }),
  lesson({
    order: 10,
    titleKey: "lessonsBirch.birch10",
    newKeys: [],
    reviewKeys: ["o", "w"],
    kind: "words",
    pools: WORDS,
    length: { chars: 75 },
  }),
  lesson({
    order: 11,
    titleKey: "lessonsBirch.birch11",
    newKeys: ["q", "p"],
    reviewKeys: ["o", "w"],
    kind: "letters",
    length: { chars: 65 },
    bandScale: SPROUT_DRILL,
  }),
  // Review and space practice: the whole top row, in short forest phrases.
  lesson({
    order: 12,
    titleKey: "lessonsBirch.birch12",
    newKeys: [],
    reviewKeys: TOP_KEYS,
    kind: "phrases",
    pools: PHRASES,
    length: { chars: 75 },
  }),
  lesson({
    order: 13,
    titleKey: "lessonsBirch.birch13",
    newKeys: [],
    reviewKeys: TOP_KEYS,
    kind: "words",
    pools: REVIEW_WORDS,
    length: { chars: 70 },
    tags: ["challenge-hide-keyboard"],
  }),
  // Mastery: 90 s for every band, words and phrases mixed. ≥ 2 stars unlocks Sandy Shore.
  lesson({
    order: 14,
    titleKey: "lessonsBirch.birch14",
    newKeys: [],
    reviewKeys: TOP_KEYS,
    kind: "phrases",
    pools: [...WORDS, ...PHRASES],
    length: { seconds: 90 },
    targets: { accuracy: MASTERY_ACCURACY },
    bandScale: { sprout: 1, miner: 1, builder: 1 },
    tags: ["mastery"],
  }),
  // The Bramble Stag (README §8.2). Runs as Mine until the boss mode lands (M5).
  lesson({
    order: 15,
    titleKey: "lessonsBirch.birch15",
    newKeys: [],
    reviewKeys: TOP_KEYS,
    kind: "phrases",
    pools: PHRASES,
    length: { chars: 80 },
    mode: "boss",
    tags: ["boss"],
  }),
];
