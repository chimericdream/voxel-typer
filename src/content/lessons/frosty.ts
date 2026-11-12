/**
 * Frosty Peaks: the whole alphabet together, in short words and phrases (M3-03). No new keys.
 * Pure data.
 *
 * Speed targets begin here (PLAN.md §4.1: after chapter 3). `wpmRelative` is a multiple of the
 * learner's own baseline (contracts §6) and only gates the 3rd star for Miner and Builder; Sprout has
 * no speed check (decision 80), and mastery needs only 2 stars, so speed never blocks a biome. The
 * target starts at 1.0 (match your usual speed) and rises to 1.15 by the mastery check. The letters
 * review and the hide-the-keyboard challenge set no speed target: single-letter blocks are slower
 * than words, and the challenge is about not looking.
 *
 * Lessons 4 and 8 are reviews, 7 is the challenge, 11 the mastery check that unlocks the Deep
 * Mines, 12 the boss. The lessons draw on different pools (Frosty words, theme words, every
 * biome's words, Frosty or every phrase list) so that no two play alike.
 *
 * Speed: 01–02 ×1.0, 03 and 05 ×1.05, 06 and 08–09 ×1.1, 10–12 ×1.15.
 *
 * Lengths, per band: the chars budget (Sprout 0.6, Miner 1, Builder 1.3 unless `bandScale` says
 * otherwise) / the keys a child types, the mean over 50 seeds. In Mine a word block ends on its
 * last letter, so a words lesson types about 15 % fewer keys than its budget, which counts the
 * space between words (decisions 81 and 90). Phrases overshoot a little: the last one finishes.
 *
 * | Lesson | Kind    | New keys | Sprout  | Miner   | Builder   |
 * | ------ | ------- | -------- | ------- | ------- | --------- |
 * | 01     | words   |          | 48 / 42 | 80 / 72 | 104 / 97  |
 * | 02     | phrases |          | 48 / 53 | 80 / 82 | 104 / 111 |
 * | 03     | words   |          | 51 / 44 | 85 / 75 | 111 / 101 |
 * | 04     | letters | review   | 42 / 42 | 70 / 70 | 91 / 91   |
 * | 05     | phrases |          | 51 / 55 | 85 / 88 | 111 / 118 |
 * | 06     | words   |          | 54 / 46 | 90 / 75 | 117 / 97  |
 * | 07     | words   | no peek  | 48 / 42 | 80 / 72 | 104 / 97  |
 * | 08     | words   | review   | 54 / 46 | 90 / 80 | 117 / 106 |
 * | 09     | phrases |          | 54 / 55 | 90 / 88 | 117 / 115 |
 * | 10     | phrases |          | 57 / 55 | 95 / 90 | 124 / 119 |
 * | 11     | phrases | mastery  | 90 s    | 90 s    | 90 s      |
 * | 12     | phrases | boss     | 57 / 56 | 95 / 93 | 124 / 124 |
 *
 * Titles live in `src/i18n/en/lessons-frosty.ts`.
 */
import type { Lesson } from "./types";

const ACCURACY = 0.85;
const MASTERY_ACCURACY = 0.9;

/** Every letter key, for `reviewKeys`. */
const ALL_KEYS = "asdfghjkl;eirutyowqpmvnbcxz".split("");

/** Frosty words for every band. */
const SNOW = ["frosty-sprout", "frosty-miner", "frosty-builder"];
/** The `band=all` theme lists: animals, blocks, colors, food, nature, tools. */
const THEMES = [
  "theme-animals",
  "theme-blocks",
  "theme-colors",
  "theme-food",
  "theme-nature",
  "theme-tools",
];
const WORDS = [...SNOW, ...THEMES];
/** The review brings back every word of the first four biomes. */
const REVIEW_WORDS = [
  "home-row",
  "birch-sprout",
  "birch-miner",
  "birch-builder",
  "shore-sprout",
  "shore-miner",
  "shore-builder",
  ...WORDS,
];
const PHRASES = ["frosty-phrases-sprout", "frosty-phrases-miner", "frosty-phrases-builder"];
/** Every phrase list of Birch, Shore and Frosty. */
const ALL_PHRASES = [
  "birch-phrases-sprout",
  "birch-phrases-miner",
  "birch-phrases-builder",
  "shore-phrases-sprout",
  "shore-phrases-miner",
  "shore-phrases-builder",
  ...PHRASES,
];

type Spec = Omit<Lesson, "id" | "biome" | "mode" | "targets" | "newKeys" | "reviewKeys"> &
  Partial<Pick<Lesson, "mode">> & { accuracy?: number; speed?: number };

const lesson = ({ accuracy = ACCURACY, speed, ...spec }: Spec): Lesson => ({
  id: `frosty-${String(spec.order).padStart(2, "0")}`,
  biome: "frosty",
  newKeys: [],
  reviewKeys: ALL_KEYS,
  mode: "mine",
  targets: speed === undefined ? { accuracy } : { accuracy, wpmRelative: speed },
  ...spec,
});

export const lessons: Lesson[] = [
  lesson({
    order: 1,
    titleKey: "lessonsFrosty.frosty01",
    kind: "words",
    pools: SNOW,
    length: { chars: 80 },
    speed: 1,
  }),
  lesson({
    order: 2,
    titleKey: "lessonsFrosty.frosty02",
    kind: "phrases",
    pools: PHRASES,
    length: { chars: 80 },
    speed: 1,
  }),
  lesson({
    order: 3,
    titleKey: "lessonsFrosty.frosty03",
    kind: "words",
    pools: WORDS,
    length: { chars: 85 },
    speed: 1.05,
  }),
  // Review: single letters over every key, so the rare ones (`q z x j ;`) get a turn.
  lesson({
    order: 4,
    titleKey: "lessonsFrosty.frosty04",
    kind: "letters",
    length: { chars: 70 },
  }),
  lesson({
    order: 5,
    titleKey: "lessonsFrosty.frosty05",
    kind: "phrases",
    pools: ALL_PHRASES,
    length: { chars: 85 },
    speed: 1.05,
  }),
  lesson({
    order: 6,
    titleKey: "lessonsFrosty.frosty06",
    kind: "words",
    pools: THEMES,
    length: { chars: 90 },
    speed: 1.1,
  }),
  lesson({
    order: 7,
    titleKey: "lessonsFrosty.frosty07",
    kind: "words",
    pools: SNOW,
    length: { chars: 80 },
    tags: ["challenge-hide-keyboard"],
  }),
  // Review: every word of the first four biomes.
  lesson({
    order: 8,
    titleKey: "lessonsFrosty.frosty08",
    kind: "words",
    pools: REVIEW_WORDS,
    length: { chars: 90 },
    speed: 1.1,
  }),
  lesson({
    order: 9,
    titleKey: "lessonsFrosty.frosty09",
    kind: "phrases",
    pools: [...SNOW, ...PHRASES],
    length: { chars: 90 },
    speed: 1.1,
  }),
  lesson({
    order: 10,
    titleKey: "lessonsFrosty.frosty10",
    kind: "phrases",
    pools: [...REVIEW_WORDS, ...ALL_PHRASES],
    length: { chars: 95 },
    speed: 1.15,
  }),
  // Mastery: 90 s for every band, words and phrases mixed. ≥ 2 stars unlocks the Deep Mines.
  lesson({
    order: 11,
    titleKey: "lessonsFrosty.frosty11",
    kind: "phrases",
    pools: [...WORDS, ...PHRASES],
    length: { seconds: 90 },
    accuracy: MASTERY_ACCURACY,
    speed: 1.15,
    bandScale: { sprout: 1, miner: 1, builder: 1 },
    tags: ["mastery"],
  }),
  // The Frost Wyrm (README §8.2). Runs as Mine until the boss mode lands (M5).
  lesson({
    order: 12,
    titleKey: "lessonsFrosty.frosty12",
    kind: "phrases",
    pools: [...WORDS, ...ALL_PHRASES],
    length: { chars: 95 },
    speed: 1.15,
    mode: "boss",
    tags: ["boss"],
  }),
];
