/**
 * Word-list validator (PLAN.md §7.1, task M1-10). Checks every `<pool-id>.txt` in
 * `src/content/wordlists/` for child safety and quality. `npm test` runs it
 * (tests/unit/content/wordlists.test.ts) and so does CI's `content` job.
 *
 *   npm run tool -- validate-wordlists                     # the repo's lists; exits 1 on problems
 *   npm run tool -- validate-wordlists --dir DIR           # another folder of lists (tests)
 *   npm run tool -- validate-wordlists --blocklist FILE    # another blocklist
 *
 * It checks, and reports each problem as `file:line: message`:
 *   - structure: tags before items, known tags, `name=value` form (from the loader), a valid pool id
 *   - tags: `band` and `reading` present and known; `kind`, `case`, `keys`, `biome`, `theme` valid;
 *     Sprout and all-band pools use an early reading level
 *   - each item: no non-ASCII char; only the chars its kind, case and `keys` tag allow; no stray
 *     spaces; lowercase unless `case=mixed`; length within the band's bounds
 *   - duplicates within a pool, and across pools with the same `band`
 *   - blocklist hits: whole words for every term, substrings for the "strict" sections; the "ip"
 *     and "brands" sections are reported as trademark/IP terms
 *   - registry: when the folder has `pools.ts`, its `POOL_IDS` and the `.txt` files match
 *   - the blocklist itself: valid sections, lowercase terms, no term listed twice
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
import { BIOME_ORDER } from "../src/types/core";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_DIR = join(REPO_ROOT, "src", "content", "wordlists");
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
export const SENTENCE_MAX = 90;

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = LOWER.toUpperCase();
const DIGITS = "0123456789";
/** Chars each kind may use, before `case` and `keys` narrow them. */
const KIND_CHARS: Readonly<Record<PoolKind, string>> = {
  words: LOWER + UPPER,
  phrases: `${LOWER}${UPPER} '`,
  sentences: `${LOWER}${UPPER}${DIGITS} .,!?'":;-`,
};

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
  /** Problems in the blocklist file itself. */
  problems: readonly Problem[];
}

const SECTION = /^#\s*section\s*:\s*(.*)$/i;
const TERM = /^[a-z]+( [a-z]+)*$/;

/** Parses blocklist text (format in the header of `src/content/wordlists/blocklist.txt`). */
export function parseBlocklist(text: string, file = BLOCKLIST_NAME): Blocklist {
  const terms: BlockTerm[] = [];
  const problems: Problem[] = [];
  const seen = new Map<string, number>();
  let category: string | null = null;
  let strict = false;
  for (const [i, raw] of text.split(/\r\n|\r|\n/).entries()) {
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
        (flag !== undefined && flag !== "strict")
      ) {
        problems.push({
          file,
          line,
          message: `bad section line; use "# section: <category> [strict]"`,
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
    terms.push({ term: raw, category, strict, line });
  }
  return { terms, problems };
}

export function loadBlocklist(path = DEFAULT_BLOCKLIST): Blocklist {
  return parseBlocklist(readFileSync(path, "utf8"), displayPath(path));
}

/** Lowercase a-z words of `item`; every other char separates words ("it's" → it, s). */
export const wordsOf = (item: string): string[] =>
  item
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w !== "");

/**
 * The blocklist terms `item` hits. Every term matches as whole words (a term with spaces matches
 * those words in a row). Strict terms also match inside any single word, never across a space,
 * so "has hit" does not hit "shit".
 */
export function blocklistHits(item: string, blocklist: Blocklist): BlockTerm[] {
  const words = wordsOf(item);
  const spaced = ` ${words.join(" ")} `;
  return blocklist.terms.filter(
    (t) => spaced.includes(` ${t.term} `) || (t.strict && words.some((w) => w.includes(t.term))),
  );
}

// ---------------------------------------------------------------------------------------------
// Lists

export interface ValidateOptions {
  /** Folder of `<pool-id>.txt` files (default: `src/content/wordlists`). */
  dir?: string;
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

/** Checks the tags of one file. Returns the settings the item checks need, or null if unusable. */
function checkTags(
  parsed: ParsedPoolFile,
  file: string,
  problems: Problem[],
): { band: string; kind: PoolKind; mixed: boolean; keys: ReadonlySet<string> | null } | null {
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
  const theme = tag("theme");
  if (theme !== undefined && !KEBAB.test(theme)) {
    problems.push({ file, line: at("theme"), message: `theme "${theme}" must be kebab-case` });
  }

  if (!usable || band === undefined || kind === undefined) return null;
  return { band, kind, mixed: caseTag === "mixed", keys };
}

/** Checks one item's chars, spacing, case and length. */
function checkItem(
  text: string,
  line: number,
  file: string,
  opts: { band: string; kind: PoolKind; mixed: boolean; keys: ReadonlySet<string> | null },
  problems: Problem[],
): void {
  const push = (message: string): void => {
    problems.push({ file, line, message });
  };
  // Whole code points (the `u` flag), so an emoji is reported as one char.
  const nonAscii = text.match(/[^ -~]/gu) ?? [];
  if (nonAscii.length > 0) {
    push(
      `"${text}" has non-ASCII or control chars (${[...new Set(nonAscii)].map(hex).join(", ")}); ` +
        "type them as plain a-z",
    );
    return;
  }
  if (text !== text.trim()) push(`"${text}" starts or ends with a space`);
  if (text.includes("  ")) push(`"${text}" has two spaces in a row`);

  const allowed = new Set(KIND_CHARS[opts.kind]);
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

  const len = text.length;
  if (opts.kind === "words") {
    const b = WORD_LENGTH[opts.band] ?? { min: 1, max: 5 };
    if (len < b.min || len > b.max) {
      push(`"${text}" is ${len} letters; band=${opts.band} words are ${b.min}-${b.max} letters`);
    }
  } else {
    const max = opts.kind === "phrases" ? PHRASE_MAX : SENTENCE_MAX;
    if (len > max) push(`"${text}" is ${len} chars; ${opts.kind} are at most ${max}`);
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

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".txt") && resolve(dir, f) !== blocklistPath && f !== BLOCKLIST_NAME)
    .toSorted();
  /** band → item → first place it was seen. */
  const seenByBand = new Map<string, Map<string, { file: string; line: number }>>();
  const pools: string[] = [];
  let items = 0;

  for (const name of files) {
    const abs = join(dir, name);
    const file = displayPath(abs);
    const id = poolIdOf(name) ?? name;
    pools.push(id);
    if (!POOL_ID.test(id)) {
      problems.push({ file, line: 0, message: `pool id "${id}" must be kebab-case (a-z, 0-9, -)` });
    }
    const parsed = parsePoolText(readFileSync(abs, "utf8"));
    for (const issue of parsed.issues) problems.push({ file, ...issue });
    const settings = checkTags(parsed, file, problems);
    if (parsed.items.length === 0)
      problems.push({ file, line: 0, message: "the list has no items" });
    if (settings === null) continue;

    const seen = seenByBand.get(settings.band) ?? new Map<string, { file: string; line: number }>();
    seenByBand.set(settings.band, seen);
    for (const { text, line } of parsed.items) {
      items++;
      checkItem(text, line, file, settings, problems);
      for (const hit of blocklistHits(text, blocklist)) {
        const what = IP_CATEGORIES.has(hit.category)
          ? `is a trademark/IP term ("${hit.term}", ${hit.category})`
          : `is on the blocklist ("${hit.term}", ${hit.category}${hit.strict ? ", strict" : ""})`;
        problems.push({ file, line, message: `"${text}" ${what}` });
      }
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
      for (const id of pools) {
        if (!listed.has(id)) {
          problems.push({
            file: displayPath(join(dir, `${id}.txt`)),
            line: 0,
            message: `not listed in pools.ts; append "${id}" to POOL_IDS`,
          });
        }
      }
    }
  }

  problems.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { problems, pools, items };
}

function main(): void {
  const args = argv.slice(2);
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dir = opt("--dir");
  const blocklist = opt("--blocklist");
  const result = validateWordlists({
    ...(dir !== undefined && { dir }),
    ...(blocklist !== undefined && { blocklist }),
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
