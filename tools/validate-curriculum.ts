/**
 * Curriculum validator (PLAN.md §4.2, §7.2, task M3-01). Checks every lesson in
 * `src/content/lessons/` against the word pools and the English titles. `npm test` runs it
 * (tests/unit/content/curriculum.test.ts) and so does CI's `content` job.
 *
 *   npm run tool -- validate-curriculum     # the repo's lessons; exits 1 on problems
 *
 * Rules (each problem names its rule):
 *   - `unique-id`: no two lessons share an id.
 *   - `id-format`: the id is `<biome>-<order>`, order padded to 2 digits (`meadow-03`).
 *   - `order`: each biome's `order` values are whole numbers 1, 2, …, n with no gap or repeat.
 *   - `new-keys`: each `newKeys` entry is one char, not a space, and no key is introduced twice in
 *     the whole curriculum. A lesson introduces only keys its biome teaches
 *     (`BIOME_NEW_KEYS` in `validate-wordlists.ts`, shared with the word-list check), and a finished
 *     biome introduces all of them.
 *   - `review-keys`: `reviewKeys` are keys introduced before the lesson (allowed, not its own new
 *     keys).
 *   - `allowed-keys`: over {@link SEEDS} seeds and every band, generated text uses only the allowed
 *     keys, and a space only inside `phrases` and `sentences` targets.
 *   - `variety`: those runs give ≥ {@link MIN_DISTINCT} distinct targets per band. A `letters`
 *     target is a single key, so a letters lesson with fewer allowed keys must show every one.
 *   - `real-words`: in `words`, `phrases` and `sentences` lessons, ≥ {@link MIN_REAL_SHARE} of the
 *     generated targets are pool items, not the generator's syllable fallback, for every band.
 *   - `pools`: every pool id a lesson names exists.
 *   - `mastery`: each biome has exactly one `mastery` lesson; it is last, or second-to-last right
 *     before a `boss` lesson. Biomes in {@link IN_PROGRESS_BIOMES} get a warning instead when
 *     they have none.
 *   - `boss`: at most one `boss` lesson per biome, and it is last; the `boss` tag and
 *     `mode: "boss"` go together.
 *   - `space`: each biome has a lesson that practises the space bar: kind `phrases` or
 *     `sentences`, or `mode: "practice"` (flowing text). Mine mode no longer types a space between
 *     blocks (decision 81), so word lessons there give no space practice.
 *   - `title`: `titleKey` names an English string.
 *
 * Generation runs the pure generator the way Mine mode does (`src/modes/mine/logic.ts`): allowed
 * keys from `allowedKeysFor`, weights from `keyWeights` with the lesson's `newKeys` as focus and no
 * stats, the band's pools, length and `EST_WPM`, and `createRng(seed)` for seeds 1–10.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isContentDataFile } from "../src/content/collect";
import { lessonsFromModules } from "../src/content/lessons/load";
import { allowedKeysFor, type Lesson } from "../src/content/lessons/types";
import { poolsFromTexts } from "../src/content/wordlists/loader";
import { keyWeights } from "../src/engine/adaptive";
import { generateTargets, type WordPool } from "../src/engine/generator";
import { createRng } from "../src/engine/rng";
import type { Target } from "../src/engine/types";
import { EST_WPM, lengthPlan, poolsFor, TARGET_LATENCY } from "../src/modes/mine/logic";
import { BIOME_ORDER, type AgeBand, type BiomeId } from "../src/types/core";
import {
  BIOME_NEW_KEYS,
  BLOCKLIST_NAME,
  DEFAULT_DIR,
  DEFAULT_SENTENCES_DIR,
  registryIds,
} from "./validate-wordlists";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LESSONS_DIR = join(REPO_ROOT, "src", "content", "lessons");

export const BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];
export const SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Distinct targets a lesson must give per band over {@link SEEDS}. */
export const MIN_DISTINCT = 20;
/** Share of word-like targets that must be pool items. */
export const MIN_REAL_SHARE = 0.7;
/** Kinds whose targets come from word pools. */
export const WORD_KINDS: ReadonlySet<string> = new Set(["words", "phrases", "sentences"]);
/** Kinds whose targets have spaces inside them. */
const SPACED_KINDS: ReadonlySet<string> = new Set(["phrases", "sentences"]);

/**
 * Biomes still being written, which may lack their `mastery` lesson and some of their keys. M3-03
 * removes `meadow` when it adds Meadow 07–14.
 */
export const IN_PROGRESS_BIOMES: ReadonlySet<BiomeId> = new Set<BiomeId>(["meadow"]);

export const RULES = [
  "unique-id",
  "id-format",
  "order",
  "new-keys",
  "review-keys",
  "allowed-keys",
  "variety",
  "real-words",
  "pools",
  "mastery",
  "boss",
  "space",
  "title",
] as const;
export type Rule = (typeof RULES)[number];

export interface CurriculumProblem {
  rule: Rule;
  /** The lesson id, or the biome id for a rule about a whole biome. */
  where: string;
  message: string;
}

export const formatCurriculumProblem = (p: CurriculumProblem): string =>
  `${p.where}: [${p.rule}] ${p.message}`;

export interface CurriculumInput {
  lessons: readonly Lesson[];
  /** Every shipped pool (all bands); the validator filters them per lesson and band. */
  pools: readonly WordPool[];
  /** The English message tables (`src/i18n/en`'s default export). */
  messages: unknown;
  /** Default {@link IN_PROGRESS_BIOMES}. */
  inProgress?: ReadonlySet<BiomeId>;
}

/** What one lesson gives for one band over {@link SEEDS}. */
export interface BandStats {
  band: AgeBand;
  /** Distinct target texts over all seeds. */
  distinct: number;
  /** Targets over all seeds. */
  targets: number;
  /** Of those, pool items (word-like kinds only; 0 otherwise). */
  poolTargets: number;
  /** Distinct pool items typeable with the allowed keys (word-like kinds only). */
  typeableItems: number;
}

export interface LessonStats {
  id: string;
  allowed: string[];
  bands: BandStats[];
}

export interface CurriculumResult {
  problems: CurriculumProblem[];
  warnings: CurriculumProblem[];
  /** Per generated lesson (lessons with a unique id). */
  stats: LessonStats[];
}

/** Curriculum position: biome order first, then order in the biome. */
const rank = (l: Lesson): number => BIOME_ORDER.indexOf(l.biome) * 1000 + l.order;

/** `lessons` in curriculum order (stable for equal ranks). */
export const curriculumOrder = (lessons: readonly Lesson[]): Lesson[] =>
  lessons.toSorted((a, b) => rank(a) - rank(b));

/** The English text of a dotted key such as `lessonsMeadow.meadow01`, or null. */
export function messageOf(messages: unknown, key: string): string | null {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, part)) return null;
    node = Reflect.get(node, part);
  }
  return typeof node === "string" ? node : null;
}

/** The targets one lesson generates for one band and seed, the way Mine mode asks for them. */
export function generateFor(
  lessons: readonly Lesson[],
  lesson: Lesson,
  band: AgeBand,
  seed: number,
  pools: readonly WordPool[],
): Target[] {
  const allowed = allowedKeysFor(lessons, lesson.id);
  const size = lengthPlan(lesson, band, { calm: false, estWpm: EST_WPM[band] });
  return generateTargets(
    {
      kind: lesson.kind,
      allowed,
      weights: keyWeights({
        allowed,
        focus: lesson.newKeys,
        stats: {},
        sessionIndex: 0,
        targetLatencyMs: TARGET_LATENCY[band],
      }),
      pools: poolsFor(lesson, band, pools),
      length: size.length,
      capitalize: "none",
    },
    createRng(seed),
  );
}

const show = (keys: Iterable<string>): string => [...keys].map((k) => `'${k}'`).join(" ");

/** Rules about one biome's lesson list (already in order). */
function checkBiome(
  biome: BiomeId,
  list: readonly Lesson[],
  inProgress: boolean,
  out: CurriculumResult,
): void {
  const add = (rule: Rule, message: string): void => {
    out.problems.push({ rule, where: biome, message });
  };

  // order: 1..n, whole numbers, no repeats
  const orders = list.map((l) => l.order);
  const expected = list.map((_, i) => i + 1);
  if (orders.some((o, i) => o !== expected[i])) {
    add("order", `orders are ${orders.join(", ")}; expected 1 to ${list.length} with no gap`);
  }

  // mastery and boss
  const last = list.length - 1;
  const bosses = list.flatMap((l, i) => (l.tags?.includes("boss") === true ? [i] : []));
  const masteries = list.flatMap((l, i) => (l.tags?.includes("mastery") === true ? [i] : []));
  if (bosses.length > 1) add("boss", `${bosses.length} boss lessons; at most 1`);
  for (const i of bosses) {
    if (i !== last) add("boss", `${list[i]?.id} is a boss lesson but not the last lesson`);
  }
  for (const l of list) {
    const tagged = l.tags?.includes("boss") === true;
    if (tagged !== (l.mode === "boss")) {
      out.problems.push({
        rule: "boss",
        where: l.id,
        message: tagged
          ? `tagged boss but mode is "${l.mode}"; use mode "boss"`
          : `mode "boss" needs the boss tag`,
      });
    }
  }
  const bossLast = bosses.includes(last);
  if (masteries.length === 0) {
    const message = "no mastery lesson";
    if (inProgress) out.warnings.push({ rule: "mastery", where: biome, message });
    else add("mastery", message);
  } else if (masteries.length > 1) {
    add("mastery", `${masteries.length} mastery lessons; exactly 1`);
  } else {
    const at = masteries[0] ?? -1;
    const ok = at === last || (bossLast && at === last - 1);
    if (!ok) {
      add(
        "mastery",
        `${list[at]?.id} is the mastery lesson; it must be last, or right before the boss lesson`,
      );
    }
  }

  // every key the biome teaches gets introduced
  if (!inProgress) {
    const introduced = new Set(list.flatMap((l) => l.newKeys));
    const missing = Array.from(BIOME_NEW_KEYS[biome]).filter((k) => !introduced.has(k));
    if (missing.length > 0) add("new-keys", `never introduces ${show(missing)}`);
  }

  // space practice
  if (!list.some((l) => SPACED_KINDS.has(l.kind) || l.mode === "practice")) {
    add(
      "space",
      "no lesson practises the space bar; add a phrases or sentences lesson, or a practice-mode one",
    );
  }
}

/** Generation rules for one lesson. */
function checkGenerated(
  lessons: readonly Lesson[],
  lesson: Lesson,
  pools: readonly WordPool[],
  out: CurriculumResult,
): void {
  const add = (rule: Rule, message: string): void => {
    out.problems.push({ rule, where: lesson.id, message });
  };
  const allowedList = allowedKeysFor(lessons, lesson.id);
  const allowed = new Set(allowedList);
  const spaced = SPACED_KINDS.has(lesson.kind);
  const wordLike = WORD_KINDS.has(lesson.kind);
  const stats: LessonStats = { id: lesson.id, allowed: allowedList, bands: [] };

  for (const band of BANDS) {
    const bandPools = poolsFor(lesson, band, pools);
    const items = new Set(bandPools.flatMap((p) => p.items));
    const typeable = new Set(
      [...items].filter((i) => Array.from(i).every((c) => allowed.has(c) || c === " ")),
    );
    const texts: string[] = [];
    let empty = 0;
    for (const seed of SEEDS) {
      const run = generateFor(lessons, lesson, band, seed, pools);
      if (run.length === 0) empty++;
      for (const t of run) texts.push(t.text);
    }
    if (empty > 0) add("variety", `${band}: ${empty} of ${SEEDS.length} seeds give no targets`);

    const bad = new Set<string>();
    for (const text of texts) {
      for (const c of text) if (c === " " ? !spaced : !allowed.has(c)) bad.add(c);
    }
    if (bad.size > 0) {
      const named = [...bad].map((c) => (c === " " ? "space" : `'${c}'`)).join(" ");
      add("allowed-keys", `${band}: generates ${named}, outside the allowed keys`);
    }

    const distinct = new Set(texts).size;
    const need = lesson.kind === "letters" ? Math.min(MIN_DISTINCT, allowed.size) : MIN_DISTINCT;
    if (distinct < need) {
      add(
        "variety",
        `${band}: ${distinct} distinct targets over ${SEEDS.length} seeds; need ${need}`,
      );
    }

    const poolTargets = wordLike ? texts.filter((t) => items.has(t)).length : 0;
    if (wordLike) {
      const share = texts.length === 0 ? 0 : poolTargets / texts.length;
      if (share < MIN_REAL_SHARE) {
        add(
          "real-words",
          `${band}: ${Math.round(share * 100)}% of targets are pool items (need ` +
            `${Math.round(MIN_REAL_SHARE * 100)}%); ${typeable.size} typeable item(s) in ` +
            `${bandPools.length} pool(s)`,
        );
      }
    }
    stats.bands.push({
      band,
      distinct,
      targets: texts.length,
      poolTargets,
      typeableItems: wordLike ? typeable.size : 0,
    });
  }
  out.stats.push(stats);
}

/** Checks the whole curriculum. Pure: everything comes in through `input`. */
export function validateCurriculum(input: CurriculumInput): CurriculumResult {
  const { pools, messages } = input;
  const inProgress = input.inProgress ?? IN_PROGRESS_BIOMES;
  const lessons = curriculumOrder(input.lessons);
  const out: CurriculumResult = { problems: [], warnings: [], stats: [] };
  const add = (rule: Rule, where: string, message: string): void => {
    out.problems.push({ rule, where, message });
  };

  // unique ids
  const count = new Map<string, number>();
  for (const l of lessons) count.set(l.id, (count.get(l.id) ?? 0) + 1);
  for (const [id, n] of count) if (n > 1) add("unique-id", id, `${n} lessons share this id`);

  const poolIds = new Set(pools.map((p) => p.id));
  const introducedBy = new Map<string, string>();

  for (const l of lessons) {
    const want = `${l.biome}-${String(l.order).padStart(2, "0")}`;
    if (l.id !== want) add("id-format", l.id, `id should be "${want}" (biome and order)`);

    for (const k of l.newKeys) {
      if (Array.from(k).length !== 1 || k === " ") {
        add("new-keys", l.id, `new key "${k}" must be one char and not a space`);
        continue;
      }
      const first = introducedBy.get(k);
      if (first !== undefined) add("new-keys", l.id, `'${k}' was already introduced in ${first}`);
      else introducedBy.set(k, l.id);
      if (!BIOME_NEW_KEYS[l.biome].includes(k)) {
        add("new-keys", l.id, `'${k}' is not a key ${l.biome} teaches`);
      }
    }

    if ((count.get(l.id) ?? 0) === 1) {
      const earlier = new Set(allowedKeysFor(lessons, l.id));
      for (const k of l.newKeys) earlier.delete(k);
      const stray = l.reviewKeys.filter((k) => !earlier.has(k));
      if (stray.length > 0) {
        add("review-keys", l.id, `reviews ${show(stray)}, not introduced before this lesson`);
      }
    }

    for (const id of l.pools ?? []) {
      if (!poolIds.has(id)) add("pools", l.id, `names pool "${id}", which does not exist`);
    }

    if (messageOf(messages, l.titleKey) === null) {
      add("title", l.id, `title key "${l.titleKey}" has no English text`);
    }
  }

  for (const biome of BIOME_ORDER) {
    const list = lessons.filter((l) => l.biome === biome);
    if (list.length > 0) checkBiome(biome, list, inProgress.has(biome), out);
  }

  for (const l of lessons) {
    if ((count.get(l.id) ?? 0) === 1) checkGenerated(lessons, l, pools, out);
  }
  return out;
}

/** The shipped lessons, loaded with `node:fs` (tsx has no `import.meta.glob`). */
export async function loadLessons(dir = LESSONS_DIR): Promise<Lesson[]> {
  const modules: Record<string, unknown> = {};
  for (const name of readdirSync(dir).filter(isContentDataFile)) {
    modules[`./${name}`] = await import(pathToFileURL(join(dir, name)).href);
  }
  return lessonsFromModules(modules);
}

/** The shipped pools: every registered `.txt` in the word-list and sentence folders. */
export function loadPools(dir = DEFAULT_DIR, sentencesDir = DEFAULT_SENTENCES_DIR): WordPool[] {
  const ids = registryIds(readFileSync(join(dir, "pools.ts"), "utf8"));
  if (ids === null) throw new Error("pools.ts has no POOL_IDS array");
  const texts: Record<string, string> = {};
  for (const folder of [dir, sentencesDir]) {
    for (const name of readdirSync(folder)) {
      if (name.endsWith(".txt") && name !== BLOCKLIST_NAME) {
        texts[`./${name}`] = readFileSync(join(folder, name), "utf8");
      }
    }
  }
  return poolsFromTexts(
    texts,
    ids.map((r) => r.id),
  );
}

/** The English message tables. */
export async function loadMessages(): Promise<unknown> {
  const mod: unknown = await import(
    pathToFileURL(join(REPO_ROOT, "src", "i18n", "en", "index.ts")).href
  );
  return typeof mod === "object" && mod !== null && "default" in mod ? mod.default : null;
}

/** Everything {@link validateCurriculum} needs, from the repo. */
export async function loadCurriculum(): Promise<CurriculumInput> {
  return { lessons: await loadLessons(), pools: loadPools(), messages: await loadMessages() };
}

async function main(): Promise<void> {
  const input = await loadCurriculum();
  const result = validateCurriculum(input);
  for (const w of result.warnings) console.log(`warning: ${formatCurriculumProblem(w)}`);
  for (const p of result.problems) console.error(formatCurriculumProblem(p));
  const n = input.lessons.length;
  if (result.problems.length > 0) {
    console.error(`${result.problems.length} problem(s) in ${n} lesson(s)`);
    exit(1);
  }
  console.log(`${n} lesson(s), no problems`);
}

if (resolve(argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
