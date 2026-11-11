/**
 * Word-list loader: turns the text of `src/content/wordlists/<pool-id>.txt` files into `WordPool`
 * objects (docs/impl/contracts.md §5). Pure: it takes text that someone else already read.
 *
 * - The app gets the text from Vite (`import.meta.glob(..., { query: "?raw" })` in `./pools.ts`).
 * - Tools and tests read the files with `node:fs` and call {@link poolFromText} or
 *   {@link poolsFromTexts} themselves.
 *
 * The file format is described for authors in `./README.md`. In short:
 *
 * ```text
 * # tags: band=sprout reading=dolch theme=animals
 * # any other line starting with # is a comment
 * cat
 * dog
 * ```
 *
 * The loader only checks structure (a `band` tag, known tag names, tags before items). The safety
 * and quality checks (blocklist, char sets, lengths, duplicates) live in
 * `tools/validate-wordlists.ts`, which runs in `npm test` and CI and never ships to the browser.
 */
import type { WordPool } from "@/engine/generator";
import type { AgeBand } from "@/types/core";

/** Tag names a `# tags:` line may use. */
export const TAG_NAMES = ["band", "reading", "kind", "case", "keys", "biome", "theme"] as const;
export type TagName = (typeof TAG_NAMES)[number];

/** What the items of a pool are. `letters` and `syllables` are generated, never listed. */
export type PoolKind = "words" | "phrases" | "sentences";
export const POOL_KINDS: readonly PoolKind[] = ["words", "phrases", "sentences"];

export const POOL_BANDS: readonly (AgeBand | "all")[] = ["sprout", "miner", "builder", "all"];

/** One item line of a list file. */
export interface ParsedItem {
  text: string;
  /** 1-based line number in the file. */
  line: number;
}

/** A problem the loader found. The validator reports these with the file name. */
export interface ParseIssue {
  line: number;
  message: string;
}

/** A list file, split into its parts. Nothing is dropped, so the validator sees every item. */
export interface ParsedPoolFile {
  /** Tags as written, in order. A tag given twice keeps its first value (and is an issue). */
  tags: ReadonlyMap<string, string>;
  /** 1-based line of each tag, for messages. */
  tagLines: ReadonlyMap<string, number>;
  items: readonly ParsedItem[];
  /**
   * Comment lines (not tag lines), with the leading `#` removed. They ship in the bundle with the
   * list, so the validator checks them against the blocklist too.
   */
  comments: readonly ParsedItem[];
  issues: readonly ParseIssue[];
}

const TAGS_PREFIX = /^#\s*tags\s*:/i;
const isTagName = (s: string): s is TagName => (TAG_NAMES as readonly string[]).includes(s);

/**
 * Splits a list file into tags, items and structural issues. Never throws.
 *
 * - `\r\n` and `\r` count as line breaks, so a file saved with Windows line endings still works.
 * - A leading byte-order mark (U+FEFF, which some Windows editors add) is ignored.
 * - Blank lines (or lines of only spaces) are skipped.
 * - `# tags: a=b c=d` lines set tags; they must come before the first item.
 * - Any other line starting with `#` is a comment.
 * - Every other line is one item, exactly as written (the validator rejects stray spaces).
 */
export function parsePoolText(text: string): ParsedPoolFile {
  const tags = new Map<string, string>();
  const tagLines = new Map<string, number>();
  const items: ParsedItem[] = [];
  const comments: ParsedItem[] = [];
  const issues: ParseIssue[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  for (const [i, raw] of lines.entries()) {
    const line = i + 1;
    if (raw.trim() === "") continue;
    if (raw.startsWith("#")) {
      if (!TAGS_PREFIX.test(raw)) {
        comments.push({ text: raw.slice(1), line });
        continue;
      }
      if (items.length > 0) {
        issues.push({ line, message: "tag lines must come before the first item" });
      }
      for (const pair of raw.replace(TAGS_PREFIX, "").trim().split(/\s+/)) {
        if (pair === "") continue;
        const eq = pair.indexOf("=");
        const name = eq > 0 ? pair.slice(0, eq) : "";
        const value = eq > 0 ? pair.slice(eq + 1) : "";
        if (name === "" || value === "") {
          issues.push({ line, message: `tag "${pair}" must look like name=value` });
        } else if (!isTagName(name)) {
          issues.push({
            line,
            message: `unknown tag "${name}" (known tags: ${TAG_NAMES.join(", ")})`,
          });
        } else if (tags.has(name)) {
          issues.push({ line, message: `tag "${name}" is set twice` });
        } else {
          tags.set(name, value);
          tagLines.set(name, line);
        }
      }
      continue;
    }
    items.push({ text: raw, line });
  }
  return { tags, tagLines, items, comments, issues };
}

const isBand = (s: string | undefined): s is AgeBand | "all" =>
  s !== undefined && (POOL_BANDS as readonly string[]).includes(s);

/**
 * The `WordPool` of one list file.
 *
 * `band` comes from the `band` tag. `tags` holds every other tag as `name=value`, with the defaults
 * filled in, in this order: `kind`, `case`, `reading`, then the rest as written. So a pool always
 * has `kind=words|phrases|sentences` and `case=lower|mixed` in its tags, and a lesson's biome pools
 * are the ones with `biome=<id>`.
 *
 * Throws when the file has structural issues or no valid `band` tag. The message names `id`.
 */
export function poolFromText(id: string, text: string): WordPool {
  const parsed = parsePoolText(text);
  const first = parsed.issues[0];
  if (first !== undefined) {
    throw new Error(`wordlists: ${id}.txt:${first.line}: ${first.message}`);
  }
  const band = parsed.tags.get("band");
  if (!isBand(band)) {
    throw new Error(`wordlists: ${id}.txt needs a "band" tag (${POOL_BANDS.join(", ")})`);
  }
  return {
    id,
    band,
    tags: normalizedTags(parsed.tags),
    items: parsed.items.map((item) => item.text),
  };
}

/** `name=value` tags of a pool, defaults filled in, `band` left out (see {@link poolFromText}). */
export function normalizedTags(tags: ReadonlyMap<string, string>): string[] {
  const out = [`kind=${tags.get("kind") ?? "words"}`, `case=${tags.get("case") ?? "lower"}`];
  const reading = tags.get("reading");
  if (reading !== undefined) out.push(`reading=${reading}`);
  const placed = new Set(["band", "kind", "case", "reading"]);
  for (const [name, value] of tags) {
    if (!placed.has(name)) out.push(`${name}=${value}`);
  }
  return out;
}

/** The pool id of a list file path or glob key: `./home-row.txt` → `home-row`. Null if not `.txt`. */
export function poolIdOf(path: string): string | null {
  const base = path.replaceAll("\\", "/").split("/").pop() ?? "";
  return base.endsWith(".txt") ? base.slice(0, -".txt".length) : null;
}

/**
 * The pools named in `ids`, in that order, from `texts` (`{ [path]: file text }`, e.g. Vite's glob
 * result). Throws when a registered id has no file, or a `.txt` file in `texts` is not registered,
 * so a list can't ship by accident or go missing quietly.
 */
export function poolsFromTexts(
  texts: Readonly<Record<string, string>>,
  ids: readonly string[],
): WordPool[] {
  const byId = new Map<string, string>();
  for (const [path, text] of Object.entries(texts)) {
    const id = poolIdOf(path);
    if (id !== null) byId.set(id, text);
  }
  const registered = new Set(ids);
  const unregistered = [...byId.keys()].filter((id) => !registered.has(id)).toSorted();
  if (unregistered.length > 0) {
    throw new Error(
      `wordlists: ${unregistered.map((id) => `${id}.txt`).join(", ")} not listed in pools.ts`,
    );
  }
  return ids.map((id) => {
    const text = byId.get(id);
    if (text === undefined)
      throw new Error(`wordlists: pools.ts lists "${id}" but ${id}.txt is missing`);
    return poolFromText(id, text);
  });
}
