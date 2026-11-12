/**
 * Word-list validator (PLAN.md §7.1, task M1-10). Checks every `<pool-id>.txt` in
 * `src/content/wordlists/` for child safety and quality. `npm test` runs it
 * (tests/unit/content/wordlists.test.ts) and so does CI's `content` job.
 *
 *   npm run tool -- validate-wordlists                     # the repo's lists; exits 1 on problems
 *   npm run tool -- validate-wordlists --dir DIR           # another folder of lists (tests)
 *   npm run tool -- validate-wordlists --blocklist FILE    # another blocklist
 *   npm run tool -- validate-wordlists --sentences DIR     # another folder of sentence lists
 *
 * By default it reads `src/content/wordlists/` and `src/content/sentences/` together: one set of
 * pools, one duplicate check per band, one registry (`wordlists/pools.ts`). With `--dir` and no
 * `--sentences`, it reads only that folder.
 *
 * It checks, and reports each problem as `file:line: message`:
 *   - structure: tags before items, known tags, `name=value` form (from the loader), a valid pool id
 *   - tags: `band` and `reading` present and known; `kind`, `case`, `keys`, `biome`, `theme` valid;
 *     Sprout and all-band pools use an early reading level
 *   - each item: no non-ASCII char; only the chars its kind, case and `keys` tag allow; no stray
 *     spaces; lowercase unless `case=mixed`; length within the band's bounds
 *   - duplicates within a pool, and across pools with the same `band`
 *   - blocklist hits ({@link blocklistHits}): every term and its common inflections as whole
 *     words, substrings for the "strict" sections, and both again after look-alike digits and
 *     punctuation are undone; the "ip" and "brands" sections are reported as trademark/IP terms
 *   - comment lines: "# " then text, so an item that starts with "#" isn't dropped as a comment by
 *     mistake; no blocklist hit and no non-ASCII char, because comments ship in the bundle
 *     with the list (the raw import can't strip them without a build plugin)
 *   - biome key sets (M5-05): a list tagged `biome=<id>` uses only the keys taught up to that biome
 *     ({@link biomeKeys}), and its `keys` tag asks for nothing more
 *   - sentence repetition (M5-05): no 4-word run appears more than {@link NGRAM_MAX} times across
 *     every `kind=sentences` list, so the sentence set doesn't lean on one template
 *   - registry: when the folder has `pools.ts`, its `POOL_IDS` and the `.txt` files match
 *   - the blocklist itself: valid sections, lowercase terms, no term listed twice
 *
 * The non-ASCII and blocklist checks run even when a file's tags are broken, so an author sees
 * every safety problem at once.
 *
 * The validator and the blocklist are tools only. `src/content/wordlists/pools.ts` loads the lists
 * for the app and leaves `blocklist.txt` out, so neither reaches the browser bundle.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import {
  parsePoolText,
  poolIdOf,
  POOL_BANDS,
  POOL_KINDS,
  type ParsedPoolFile,
  type PoolKind,
} from "../src/content/wordlists/loader";
import { BIOME_ORDER, type BiomeId } from "../src/types/core";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_DIR = join(REPO_ROOT, "src", "content", "wordlists");
/** Sentence lists live in their own folder (M5-05) but share the registry in `pools.ts`. */
export const DEFAULT_SENTENCES_DIR = join(REPO_ROOT, "src", "content", "sentences");
export const BLOCKLIST_NAME = "blocklist.txt";
export const DEFAULT_BLOCKLIST = join(DEFAULT_DIR, BLOCKLIST_NAME);

/** Reading levels (PLAN.md §7.1), easiest first. */
export const READING_LEVELS = ["dolch", "cvc", "grade2", "grade4", "grade6+"] as const;
/** Levels a pool that Sprouts see (`band=sprout` or `band=all`) may use (PLAN.md §2). */
export const EARLY_READING_LEVELS: readonly string[] = ["dolch", "cvc", "grade2"];

/** Item length bounds in chars. Words depend on the band; `all` uses the tightest (Sprout). */
export const WORD_LENGTH: Readonly<Record<string, { min: number; max: number }>> = {
  sprout: { min: 1, max: 5 },
  miner: { min: 1, max: 8 },
  builder: { min: 1, max: 14 },
  all: { min: 1, max: 5 },
};
export const PHRASE_MAX = 30;
/** Sentence length bounds in chars, by band: short and concrete for Sprouts. `all` uses Sprout's. */
export const SENTENCE_LENGTH: Readonly<Record<string, number>> = {
  sprout: 40,
  miner: 70,
  builder: 90,
  all: 40,
};
/** The longest sentence any band may have. */
export const SENTENCE_MAX = 90;
/** Words in a run for the repetition rule, and how often one run may appear across all sentences. */
export const NGRAM_SIZE = 4;
export const NGRAM_MAX = 5;

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = LOWER.toUpperCase();
const DIGITS = "0123456789";
/** Chars each kind may use, before `case` and `keys` narrow them. */
const KIND_CHARS: Readonly<Record<PoolKind, string>> = {
  words: LOWER + UPPER,
  phrases: `${LOWER}${UPPER}${DIGITS} '`,
  sentences: `${LOWER}${UPPER}${DIGITS} .,!?'":;-`,
};
/** Sparkstone's symbols. Phrases and sentences may use them only in a `biome=sparkstone` list. */
export const SPARKSTONE_SYMBOLS = "-_():@#/=+*";

/**
 * The keys each biome introduces (docs/impl/tasks-m3.md M3-02, tasks-m5.md M5-05, README §8.4):
 * Mines adds Shift (capitals), Marsh the number row, Crystal Caverns `. , ? ! ' "` and `/`, and
 * Sparkstone its symbols. Frosty and Sky Citadel add none. Space is always allowed.
 */
export const BIOME_NEW_KEYS: Readonly<Record<BiomeId, string>> = {
  meadow: "asdfjkl;gh",
  birch: "eirutyowqp",
  shore: "cnvmbxz",
  frosty: "",
  mines: UPPER,
  marsh: DIGITS,
  caverns: `.,?!'"/`,
  sparkstone: SPARKSTONE_SYMBOLS,
  citadel: "",
};

/**
 * Every key a list for `biome` may use: the new keys of that biome and of each biome before it in
 * `BIOME_ORDER`. Sparkstone is a side branch (README §8.5), so only Sparkstone itself gets its
 * symbols; Sky Citadel, after it in the order, does not.
 */
export function biomeKeys(biome: BiomeId): ReadonlySet<string> {
  const out = new Set<string>();
  for (const b of BIOME_ORDER) {
    if (b !== "sparkstone" || biome === "sparkstone") for (const c of BIOME_NEW_KEYS[b]) out.add(c);
    if (b === biome) break;
  }
  return out;
}

const isBiome = (s: string | undefined): s is BiomeId =>
  s !== undefined && (BIOME_ORDER as readonly string[]).includes(s);

/** Categories reported as trademark/IP terms rather than as blocked words. */
const IP_CATEGORIES: ReadonlySet<string> = new Set(["ip", "brands"]);

export interface Problem {
  /** Posix path relative to the repo root (or absolute when outside it). */
  file: string;
  /** 1-based; 0 when the problem is about the whole file. */
  line: number;
  message: string;
}

export const formatProblem = (p: Problem): string =>
  p.line > 0 ? `${p.file}:${p.line}: ${p.message}` : `${p.file}: ${p.message}`;

const displayPath = (abs: string): string => {
  const rel = relative(REPO_ROOT, abs);
  return (rel.startsWith("..") ? abs : rel).replaceAll("\\", "/");
};

// ---------------------------------------------------------------------------------------------
// Blocklist

export interface BlockTerm {
  term: string;
  category: string;
  strict: boolean;
  line: number;
}

export interface Blocklist {
  terms: readonly BlockTerm[];
  /**
   * The `# section: allow` words: real, harmless words that an inflection of a term happens to
   * spell ("butter" from "butt" + "er"). An allowed word cancels only that derived hit, in plain
   * text and in look-alike spellings. It never cancels an exact or a strict hit, and
   * {@link parseBlocklist} rejects an entry that is not an inflection of some term.
   */
  allow: ReadonlySet<string>;
  /** Problems in the blocklist file itself. */
  problems: readonly Problem[];
}

const SECTION = /^#\s*section\s*:\s*(.*)$/i;
const TERM = /^[a-z]+( [a-z]+)*$/;
/** The section whose lines are allowed words, not terms. */
export const ALLOW_SECTION = "allow";

/** Parses blocklist text (format in the header of `src/content/wordlists/blocklist.txt`). */
export function parseBlocklist(text: string, file = BLOCKLIST_NAME): Blocklist {
  const terms: BlockTerm[] = [];
  const allow = new Set<string>();
  /** Allow entries and their lines, checked once every term is known. */
  const allowLines = new Map<string, number>();
  const problems: Problem[] = [];
  const seen = new Map<string, number>();
  let category: string | null = null;
  let strict = false;
  for (const [i, raw] of text
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/)
    .entries()) {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const section = SECTION.exec(trimmed);
    if (section) {
      const words = (section[1] ?? "").trim().split(/\s+/);
      const name = words[0] ?? "";
      const flag = words[1];
      if (
        !/^[a-z][a-z-]*$/.test(name) ||
        words.length > 2 ||
        (flag !== undefined && flag !== "strict") ||
        (name === ALLOW_SECTION && flag !== undefined)
      ) {
        problems.push({
          file,
          line,
          message: `bad section line; use "# section: <category> [strict]" or "# section: allow"`,
        });
        category = null;
        continue;
      }
      category = name;
      strict = flag === "strict";
      continue;
    }
    if (trimmed.startsWith("#")) continue;
    if (category === null) {
      problems.push({ file, line, message: `"${trimmed}" comes before any "# section:" line` });
      continue;
    }
    if (!TERM.test(raw)) {
      problems.push({
        file,
        line,
        message: `"${raw}" must be lowercase a-z words with single spaces`,
      });
      continue;
    }
    const first = seen.get(raw);
    if (first !== undefined) {
      problems.push({ file, line, message: `"${raw}" is already listed on line ${first}` });
      continue;
    }
    seen.set(raw, line);
    if (category === ALLOW_SECTION) allowLines.set(raw, line);
    else terms.push({ term: raw, category, strict, line });
  }
  // An allow entry may only release an inflection of a term, so the section can't become a
  // general bypass list. It can't release a strict hit either (collectHits never skips those).
  const derived = new Set(terms.flatMap((t) => inflections(t.term)));
  for (const [word, line] of allowLines) {
    const strictHit = terms.find((t) => t.strict && word.includes(t.term));
    if (strictHit) {
      problems.push({
        file,
        line,
        message: `allowed word "${word}" contains the strict term on line ${strictHit.line}; allow can't cancel strict hits`,
      });
    } else if (derived.has(word)) {
      allow.add(word);
    } else {
      problems.push({
        file,
        line,
        message: `allowed word "${word}" is not an inflection of any term, so allowing it does nothing; remove it`,
      });
    }
  }
  return { terms, allow, problems };
}

export function loadBlocklist(path = DEFAULT_BLOCKLIST): Blocklist {
  return parseBlocklist(readFileSync(path, "utf8"), displayPath(path));
}

const VOWELS = "aeiou";
const isConsonant = (c: string): boolean => c >= "a" && c <= "z" && !VOWELS.includes(c);
const PLAIN_SUFFIXES = ["ed", "ing", "er", "ers", "y"] as const;

/**
 * Common inflections and derivations of a term (not the term itself). A term with spaces is
 * inflected on its last word ("self harm" → "self harming").
 *
 * - every term: `-s`, `-man`, `-men` (gun → guns, gunman, gunmen)
 * - after s, x, z, ch, sh or o: `-es` (punch → punches)
 * - ending in `ee`: `-d`, `-ing` (agree → agreed, agreeing)
 * - ending in `ie`: `-d`, `-r`, `ie` → `ying` (die → died, dying)
 * - ending in `e`: `-d`, `-r`, `-rs`, `-y`, and the `e` dropped before `-ing` and `-y` (bake →
 *   baked, baker, bakey, baking, baky; gore → gory)
 * - ending in consonant + `y`: `y` → `ies ied ier iers iest`, plus `-ing`, `-er` (bully → bullies)
 * - anything else: `-ed -ing -er -ers -y`, and again with the last consonant doubled when the word
 *   ends consonant-vowel-consonant (stab → stabbed, stabbing; slap → slapped)
 */
export function inflections(term: string): string[] {
  const cut = term.lastIndexOf(" ") + 1;
  const head = term.slice(0, cut);
  const w = term.slice(cut);
  const last = w.at(-1) ?? "";
  const prev = w.at(-2) ?? "";
  const prev2 = w.at(-3) ?? "";
  const out = new Set<string>([`${w}s`, `${w}man`, `${w}men`]);
  if (/(s|x|z|ch|sh|o)$/.test(w)) out.add(`${w}es`);
  if (w.endsWith("ee")) {
    out.add(`${w}d`);
    out.add(`${w}ing`);
  } else if (w.endsWith("ie")) {
    out.add(`${w}d`);
    out.add(`${w}r`);
    out.add(`${w.slice(0, -2)}ying`);
  } else if (w.endsWith("e")) {
    const stem = w.slice(0, -1);
    for (const s of ["d", "r", "rs", "y"]) out.add(w + s);
    for (const s of ["ing", "y"]) out.add(stem + s);
  } else if (last === "y" && isConsonant(prev)) {
    const stem = w.slice(0, -1);
    for (const s of ["ies", "ied", "ier", "iers", "iest"]) out.add(stem + s);
    out.add(`${w}ing`);
    out.add(`${w}er`);
  } else {
    for (const s of PLAIN_SUFFIXES) out.add(w + s);
    const cvc =
      isConsonant(last) &&
      !"wxy".includes(last) &&
      prev !== "" &&
      VOWELS.includes(prev) &&
      (prev2 === "" || isConsonant(prev2));
    if (cvc) for (const s of PLAIN_SUFFIXES) out.add(w + last + s);
  }
  out.delete(w);
  return [...out].map((f) => head + f);
}

interface Matcher {
  /** Single-word terms. */
  exact: Map<string, BlockTerm>;
  /** Inflections of single-word terms (the first term in the file wins). */
  derived: Map<string, BlockTerm>;
  /** Terms with spaces, and their inflections. */
  phrases: { form: string; term: BlockTerm; derived: boolean }[];
  strict: BlockTerm[];
  allow: ReadonlySet<string>;
}

const matchers = new WeakMap<Blocklist, Matcher>();

function matcherFor(blocklist: Blocklist): Matcher {
  const cached = matchers.get(blocklist);
  if (cached) return cached;
  const m: Matcher = {
    exact: new Map(),
    derived: new Map(),
    phrases: [],
    strict: blocklist.terms.filter((t) => t.strict),
    allow: blocklist.allow,
  };
  for (const t of blocklist.terms) {
    if (t.term.includes(" ")) {
      m.phrases.push({ form: t.term, term: t, derived: false });
      for (const form of inflections(t.term)) m.phrases.push({ form, term: t, derived: true });
    } else if (!m.exact.has(t.term)) {
      m.exact.set(t.term, t);
    }
  }
  for (const t of blocklist.terms) {
    if (t.term.includes(" ")) continue;
    for (const form of inflections(t.term)) {
      if (!m.exact.has(form) && !m.derived.has(form)) m.derived.set(form, t);
    }
  }
  matchers.set(blocklist, m);
  return m;
}

/** Lowercase a-z words of `item`; every other char separates words ("it's" → it, s). */
export const wordsOf = (item: string): string[] =>
  item
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w !== "");

/** Look-alike chars mapped to letters inside a word. `1` is tried as both `i` and `l`. */
const LOOKALIKES: Readonly<Record<string, string>> = {
  "0": "o",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "l",
};

/** Stems that take `'ll 'd 're 've 'm 's` in a contraction ("he'll", "we're", "let's"). */
const PRONOUN_STEMS: ReadonlySet<string> = new Set(
  "i you he she it we they there that who what where when why how this here let".split(" "),
);
/** Stems that take `n't`, without the `n` ("ca" for "can't", "wo" for "won't"). */
const NOT_STEMS: ReadonlySet<string> = new Set(
  "ca wo do does did is are was were has have had could would should must need ai sha".split(" "),
);

/**
 * True for a common English contraction: a pronoun (or "there", "that", "let" …) + `'ll 'd 're
 * 've 'm 's`, or an auxiliary + `n't`. Joining one would spell another word ("he'll"), so the
 * look-alike pass splits it at the apostrophe instead, as the plain pass does. Only these fixed
 * stems count, so an apostrophe put inside a term to disguise it is still joined.
 */
export function isContraction(token: string): boolean {
  const m = /^([a-z]+)'(ll|d|re|ve|m|s|t)$/.exec(token);
  const stem = m?.[1];
  if (stem === undefined) return false;
  if (m?.[2] === "t") return stem.endsWith("n") && NOT_STEMS.has(stem.slice(0, -1));
  return PRONOUN_STEMS.has(stem);
}

/**
 * The words of `item` with disguises undone: split on spaces only, punctuation trimmed from the
 * ends of each token, look-alikes inside it mapped to letters (`sh1t`, `k1ll`, `a$$`), and any
 * other punctuation inside it removed (`k.i.l.l`, `sh-it`). Two variants: `1` read as `i`, and
 * as `l`.
 *
 * Only tokens that mix letters with digits or symbols are rewritten:
 * - A token with no letter and no `@ $ |` is a number, a time or a score ("455", "4:55", "10!").
 *   It is dropped, so it never reads as a word.
 * - A plain contraction ({@link isContraction}) is split at the apostrophe, not joined.
 */
export function normalizedWords(item: string): string[][] {
  const tokens = item
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9@$|]+|[^a-z0-9@$|]+$/g, ""))
    .filter((t) => /[a-z@$|]/.test(t));
  return (["i", "l"] as const).map((one) =>
    tokens
      .flatMap((t) =>
        isContraction(t)
          ? t.split("'")
          : [t.replace(/[^a-z]/g, (c) => (c === "1" ? one : (LOOKALIKES[c] ?? "")))],
      )
      .filter((w) => w !== ""),
  );
}

function collectHits(words: readonly string[], m: Matcher, found: Set<BlockTerm>): void {
  for (const w of words) {
    const exact = m.exact.get(w);
    if (exact) found.add(exact);
    for (const t of m.strict) if (w.includes(t.term)) found.add(t);
    // An allowed word cancels only its derived hit, never an exact or a strict one.
    if (m.allow.has(w)) continue;
    const derived = m.derived.get(w);
    if (derived) found.add(derived);
  }
  if (m.phrases.length === 0) return;
  const spaced = ` ${words.join(" ")} `;
  for (const p of m.phrases) {
    if (!spaced.includes(` ${p.form} `)) continue;
    if (p.derived && m.allow.has(p.form)) continue;
    found.add(p.term);
  }
}

/**
 * The blocklist terms `item` hits, in blocklist order.
 *
 * - Every term matches as a whole word, and so do its {@link inflections} ("shoot" blocks
 *   "shooting"). A term with spaces matches those words in a row.
 * - Strict terms also match inside any single word, but never across a space.
 * - The checks run on the plain words and again on the {@link normalizedWords}, with look-alike
 *   digits and punctuation undone.
 * - A word in the `allow` section is never a derived hit. It is still an exact or strict hit.
 */
export function blocklistHits(item: string, blocklist: Blocklist): BlockTerm[] {
  const m = matcherFor(blocklist);
  const found = new Set<BlockTerm>();
  collectHits(wordsOf(item), m, found);
  for (const words of normalizedWords(item)) collectHits(words, m, found);
  return blocklist.terms.filter((t) => found.has(t));
}

// ---------------------------------------------------------------------------------------------
// Lists

export interface ValidateOptions {
  /** Folder of `<pool-id>.txt` files (default: `src/content/wordlists`). */
  dir?: string;
  /**
   * A second folder of lists, read with `dir` as one set (default: `src/content/sentences` when
   * `dir` is not given, else none). The registry is still `dir`'s `pools.ts`.
   */
  sentencesDir?: string;
  /** Blocklist file (default: the repo's `src/content/wordlists/blocklist.txt`). */
  blocklist?: string;
}

export interface ValidateResult {
  problems: Problem[];
  /** Pool ids checked, sorted. */
  pools: string[];
  /** Items checked, over all pools. */
  items: number;
}

const POOL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEBAB = POOL_ID;

/** `list.includes(v)` for a list of string literals, without a cast. */
const isOneOf = (list: readonly string[], v: string): boolean => list.includes(v);

const hex = (c: string): string =>
  `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;

/** What the item checks need to know about a list, from its tags. */
interface ItemSettings {
  band: string;
  kind: PoolKind;
  mixed: boolean;
  keys: ReadonlySet<string> | null;
  /** The list's biome, when its `biome` tag is a known one. */
  biome: BiomeId | null;
}

/** Checks the tags of one file. Returns the settings the item checks need, or null if unusable. */
function checkTags(parsed: ParsedPoolFile, file: string, problems: Problem[]): ItemSettings | null {
  const tag = (name: string): string | undefined => parsed.tags.get(name);
  /** Where a tag is, or where it belongs (the first tag line, else line 1) when it is missing. */
  const firstTagLine = Math.min(...parsed.tagLines.values(), parsed.items[0]?.line ?? 1);
  const at = (name: string): number => parsed.tagLines.get(name) ?? firstTagLine;
  let usable = true;

  const band = tag("band");
  if (band === undefined) {
    problems.push({
      file,
      line: at("band"),
      message: `missing "band" tag (${POOL_BANDS.join(", ")})`,
    });
    usable = false;
  } else if (!isOneOf(POOL_BANDS, band)) {
    problems.push({
      file,
      line: at("band"),
      message: `unknown band "${band}" (${POOL_BANDS.join(", ")})`,
    });
    usable = false;
  }

  const reading = tag("reading");
  if (reading === undefined) {
    problems.push({
      file,
      line: at("reading"),
      message: `missing "reading" tag (${READING_LEVELS.join(", ")})`,
    });
  } else if (!isOneOf(READING_LEVELS, reading)) {
    problems.push({
      file,
      line: at("reading"),
      message: `unknown reading level "${reading}" (${READING_LEVELS.join(", ")})`,
    });
  } else if ((band === "sprout" || band === "all") && !EARLY_READING_LEVELS.includes(reading)) {
    problems.push({
      file,
      line: at("reading"),
      message: `band=${band} lists reach 6-year-olds; use reading=${EARLY_READING_LEVELS.join(", ")}`,
    });
  }

  const kindTag = tag("kind") ?? "words";
  const kind = POOL_KINDS.find((k) => k === kindTag);
  if (kind === undefined) {
    problems.push({
      file,
      line: at("kind"),
      message: `unknown kind "${kindTag}" (${POOL_KINDS.join(", ")})`,
    });
    usable = false;
  }

  const caseTag = tag("case") ?? "lower";
  if (caseTag !== "lower" && caseTag !== "mixed") {
    problems.push({ file, line: at("case"), message: `unknown case "${caseTag}" (lower, mixed)` });
  }

  let keys: Set<string> | null = null;
  const keysTag = tag("keys");
  if (keysTag !== undefined) {
    keys = new Set(keysTag);
    const bad = [...keys].filter((c) => c < "!" || c > "~");
    if (bad.length > 0) {
      problems.push({
        file,
        line: at("keys"),
        message: `keys tag may hold only printable ASCII (found ${bad.map(hex).join(", ")})`,
      });
    }
  }

  const biome = tag("biome");
  if (biome !== undefined && !isOneOf(BIOME_ORDER, biome)) {
    problems.push({
      file,
      line: at("biome"),
      message: `unknown biome "${biome}" (${BIOME_ORDER.join(", ")})`,
    });
  }
  const knownBiome = isBiome(biome) ? biome : null;
  if (knownBiome !== null && keys !== null) {
    const taught = biomeKeys(knownBiome);
    const early = [...keys].filter((c) => !taught.has(c));
    if (early.length > 0) {
      problems.push({
        file,
        line: at("keys"),
        message: `keys tag has ${early.map((c) => `"${c}"`).join(", ")}, not taught by ${knownBiome} yet`,
      });
    }
  }
  const theme = tag("theme");
  if (theme !== undefined && !KEBAB.test(theme)) {
    problems.push({ file, line: at("theme"), message: `theme "${theme}" must be kebab-case` });
  }

  if (!usable || band === undefined || kind === undefined) return null;
  return { band, kind, mixed: caseTag === "mixed", keys, biome: knownBiome };
}

/** The non-ASCII and control chars of `text`, as `U+XXXX`, each once. */
function nonAsciiOf(text: string): string[] {
  // Whole code points (the `u` flag), so an emoji is reported as one char.
  return [...new Set(text.match(/[^ -~]/gu) ?? [])].map(hex);
}

/** How a problem message names a blocklist hit. */
function describeHit(hit: BlockTerm): string {
  return IP_CATEGORIES.has(hit.category)
    ? `is a trademark/IP term ("${hit.term}", ${hit.category})`
    : `is on the blocklist ("${hit.term}", ${hit.category}${hit.strict ? ", strict" : ""})`;
}

/** Checks one ASCII item's chars, spacing, case and length. */
function checkItem(
  text: string,
  line: number,
  file: string,
  opts: ItemSettings,
  problems: Problem[],
): void {
  const push = (message: string): void => {
    problems.push({ file, line, message });
  };
  if (text !== text.trim()) push(`"${text}" starts or ends with a space`);
  if (text.includes("  ")) push(`"${text}" has two spaces in a row`);

  const allowed = new Set(
    KIND_CHARS[opts.kind] +
      (opts.biome === "sparkstone" && opts.kind !== "words" ? SPARKSTONE_SYMBOLS : ""),
  );
  const outside = [...new Set(text)].filter((c) => !allowed.has(c));
  if (outside.length > 0) {
    push(
      `"${text}" uses ${outside.map((c) => `"${c}"`).join(", ")}, not allowed in kind=${opts.kind}`,
    );
  }
  if (!opts.mixed && /[A-Z]/.test(text)) {
    push(`"${text}" has capital letters; write it lowercase or tag the list case=mixed`);
  }
  if (opts.keys !== null) {
    const keys = opts.keys;
    const off = [...new Set(text)].filter((c) => c !== " " && !keys.has(c));
    if (off.length > 0) {
      push(`"${text}" uses ${off.map((c) => `"${c}"`).join(", ")}, not in the keys tag`);
    }
  }
  if (opts.biome !== null) {
    const taught = biomeKeys(opts.biome);
    const early = [...new Set(text)].filter((c) => c !== " " && !taught.has(c));
    if (early.length > 0) {
      push(
        `"${text}" uses ${early.map((c) => `"${c}"`).join(", ")}, not taught by ${opts.biome} yet`,
      );
    }
  }

  const len = text.length;
  if (opts.kind === "words") {
    const b = WORD_LENGTH[opts.band] ?? { min: 1, max: 5 };
    if (len < b.min || len > b.max) {
      push(`"${text}" is ${len} letters; band=${opts.band} words are ${b.min}-${b.max} letters`);
    }
  } else if (opts.kind === "phrases") {
    if (len > PHRASE_MAX) push(`"${text}" is ${len} chars; phrases are at most ${PHRASE_MAX}`);
  } else {
    const max = SENTENCE_LENGTH[opts.band] ?? SENTENCE_MAX;
    if (len > max)
      push(`"${text}" is ${len} chars; band=${opts.band} sentences are at most ${max}`);
  }
}

/** `POOL_IDS` of a `pools.ts` source, with line numbers. Null when it has no `POOL_IDS` array. */
export function registryIds(source: string): { id: string; line: number }[] | null {
  const m = /POOL_IDS\s*=\s*\[([\s\S]*?)\]/.exec(source);
  if (!m || m[1] === undefined) return null;
  const startLine = source.slice(0, m.index + m[0].indexOf("[")).split("\n").length;
  const out: { id: string; line: number }[] = [];
  for (const [i, raw] of m[1].split("\n").entries()) {
    const code = raw.replace(/\/\/.*$/, "");
    for (const s of code.matchAll(/"([^"]*)"|'([^']*)'/g)) {
      out.push({ id: s[1] ?? s[2] ?? "", line: startLine + i });
    }
  }
  return out;
}

/** Validates every `.txt` list in a folder (except the blocklist). Never throws on bad content. */
export function validateWordlists(opts: ValidateOptions = {}): ValidateResult {
  const dir = resolve(opts.dir ?? DEFAULT_DIR);
  const blocklistPath = resolve(opts.blocklist ?? DEFAULT_BLOCKLIST);
  const blocklist = loadBlocklist(blocklistPath);
  const problems: Problem[] = [...blocklist.problems];

  const sentencesDir =
    opts.sentencesDir !== undefined
      ? resolve(opts.sentencesDir)
      : opts.dir === undefined
        ? DEFAULT_SENTENCES_DIR
        : null;
  const listFiles = (d: string): string[] =>
    existsSync(d)
      ? readdirSync(d)
          .filter(
            (f) => f.endsWith(".txt") && resolve(d, f) !== blocklistPath && f !== BLOCKLIST_NAME,
          )
          .toSorted()
          .map((f) => join(d, f))
      : [];
  const files = [...listFiles(dir), ...(sentencesDir !== null ? listFiles(sentencesDir) : [])];
  /** Every sentence item, for the repetition rule. */
  const sentences: { text: string; file: string; line: number }[] = [];
  /** band → item → first place it was seen. */
  const seenByBand = new Map<string, Map<string, { file: string; line: number }>>();
  const pools: string[] = [];
  let items = 0;

  for (const abs of files) {
    const file = displayPath(abs);
    const id = poolIdOf(abs) ?? abs;
    if (pools.includes(id)) {
      problems.push({ file, line: 0, message: `pool id "${id}" is used by two files` });
    }
    pools.push(id);
    if (!POOL_ID.test(id)) {
      problems.push({ file, line: 0, message: `pool id "${id}" must be kebab-case (a-z, 0-9, -)` });
    }
    const parsed = parsePoolText(readFileSync(abs, "utf8"));
    for (const issue of parsed.issues) problems.push({ file, ...issue });
    const settings = checkTags(parsed, file, problems);
    if (parsed.items.length === 0) {
      problems.push({ file, line: 0, message: "the list has no items" });
    }

    // Comments ship in the bundle with the list (the raw import keeps them), so check them too.
    for (const { text, line } of parsed.comments) {
      // "#gems: 3" looks like an item, but the loader reads every "#" line as a comment and drops it.
      if (text !== "" && !text.startsWith(" ")) {
        problems.push({
          file,
          line,
          message: `"#${text}" is read as a comment, not an item; start comments with "# ", and don't start an item with "#"`,
        });
      }
      const bad = nonAsciiOf(text);
      if (bad.length > 0) {
        problems.push({ file, line, message: `comment has non-ASCII chars (${bad.join(", ")})` });
      }
      for (const hit of blocklistHits(text, blocklist)) {
        problems.push({
          file,
          line,
          message: `comment ${describeHit(hit)}; comments ship with the list, so reword it`,
        });
      }
    }

    const seen = settings
      ? (seenByBand.get(settings.band) ?? new Map<string, { file: string; line: number }>())
      : null;
    if (settings && seen) seenByBand.set(settings.band, seen);
    for (const { text, line } of parsed.items) {
      items++;
      // The safety checks run even when the tags are broken, so an author sees every hit at once.
      const bad = nonAsciiOf(text);
      if (bad.length > 0) {
        problems.push({
          file,
          line,
          message: `"${text}" has non-ASCII or control chars (${bad.join(", ")}); type them as plain a-z`,
        });
      } else if (settings) {
        checkItem(text, line, file, settings, problems);
      }
      for (const hit of blocklistHits(text, blocklist)) {
        problems.push({ file, line, message: `"${text}" ${describeHit(hit)}` });
      }
      if (!settings || !seen) continue;
      if (settings.kind === "sentences") sentences.push({ text, file, line });
      const key = text.toLowerCase();
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, { file, line });
      } else {
        const where = first.file === file ? `line ${first.line}` : `${first.file}:${first.line}`;
        problems.push({
          file,
          line,
          message: `"${text}" is a duplicate (first at ${where}; band=${settings.band})`,
        });
      }
    }
  }

  problems.push(...repetitionProblems(sentences));

  const registryPath = join(dir, "pools.ts");
  if (existsSync(registryPath)) {
    const file = displayPath(registryPath);
    const ids = registryIds(readFileSync(registryPath, "utf8"));
    if (ids === null) {
      problems.push({ file, line: 0, message: "no POOL_IDS array found" });
    } else {
      const listed = new Map<string, number>();
      for (const { id, line } of ids) {
        const first = listed.get(id);
        if (first !== undefined) {
          problems.push({
            file,
            line,
            message: `"${id}" is listed twice (first on line ${first})`,
          });
        } else {
          listed.set(id, line);
        }
        if (!pools.includes(id)) {
          problems.push({ file, line, message: `"${id}" is listed but ${id}.txt does not exist` });
        }
      }
      for (const [i, id] of pools.entries()) {
        if (!listed.has(id)) {
          problems.push({
            file: displayPath(files[i] ?? join(dir, `${id}.txt`)),
            line: 0,
            message: `not listed in pools.ts; append "${id}" to POOL_IDS`,
          });
        }
      }
    }
  }

  problems.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { problems, pools: pools.toSorted(), items };
}

/** The lowercase words of a sentence for the repetition rule; punctuation at word ends is dropped. */
export const ngramWords = (sentence: string): string[] =>
  sentence
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((w) => w !== "");

/**
 * One problem for each {@link NGRAM_SIZE}-word run that appears more than {@link NGRAM_MAX} times
 * over all `sentences`, reported where it appears for the (NGRAM_MAX + 1)th time.
 */
export function repetitionProblems(
  sentences: readonly { text: string; file: string; line: number }[],
): Problem[] {
  const runs = new Map<string, { file: string; line: number }[]>();
  for (const s of sentences) {
    const words = ngramWords(s.text);
    for (let i = 0; i + NGRAM_SIZE <= words.length; i++) {
      const run = words.slice(i, i + NGRAM_SIZE).join(" ");
      const at = runs.get(run) ?? [];
      at.push({ file: s.file, line: s.line });
      runs.set(run, at);
    }
  }
  const out: Problem[] = [];
  for (const [run, at] of runs) {
    const over = at[NGRAM_MAX];
    const first = at[0];
    if (over === undefined || first === undefined) continue;
    out.push({
      file: over.file,
      line: over.line,
      message: `the words "${run}" appear ${at.length} times across the sentences (at most ${NGRAM_MAX}; first at ${first.file}:${first.line}); vary the wording`,
    });
  }
  return out;
}

function main(): void {
  const args = argv.slice(2);
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dir = opt("--dir");
  const blocklist = opt("--blocklist");
  const sentencesDir = opt("--sentences");
  const result = validateWordlists({
    ...(dir !== undefined && { dir }),
    ...(blocklist !== undefined && { blocklist }),
    ...(sentencesDir !== undefined && { sentencesDir }),
  });
  for (const p of result.problems) console.error(formatProblem(p));
  if (result.problems.length > 0) {
    console.error(`\nvalidate-wordlists: ${result.problems.length} problem(s).`);
    exit(1);
  }
  console.log(
    `validate-wordlists: ${result.pools.length} list(s), ${result.items} item(s), no problems.`,
  );
}

if (resolve(argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
