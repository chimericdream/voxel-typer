/**
 * Nickname check (task M2-11): the generated hash file is current, the runtime matcher agrees with
 * M1-10's validator, and nicknames are refused or kept as they should be. No blocked word is
 * written in this file: every one comes from the blocklist itself.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NICKNAME_MAX,
  blockedText,
  checkNickname,
  tidyNickname,
} from "../../../src/content/nickname";
import { cyrb53, hashText } from "../../../src/content/nickname/hash";
import { FILTER_FILE, filterSource } from "../../../tools/gen-nickname-filter";
import {
  DEFAULT_DIR,
  blocklistHits,
  inflections,
  loadBlocklist,
} from "../../../tools/validate-wordlists";

const blocklist = loadBlocklist();
const hits = (s: string): boolean => blocklistHits(s, blocklist).length > 0;

/** Every word in the shipped word lists (none is blocked; the validator guarantees it). */
function shippedWords(): string[] {
  const out = new Set<string>();
  for (const f of readdirSync(DEFAULT_DIR)) {
    if (!f.endsWith(".txt") || f === "blocklist.txt") continue;
    for (const line of readFileSync(resolve(DEFAULT_DIR, f), "utf8").split(/\r?\n/)) {
      const s = line.trim();
      if (s !== "" && !s.startsWith("#")) out.add(s);
    }
  }
  return [...out];
}

/** Look-alike spellings of a term, the way kids disguise words. */
function disguises(term: string): string[] {
  return [
    term.replace(/o/g, "0"),
    term.replace(/e/g, "3"),
    term.replace(/a/g, "4"),
    term.replace(/i/g, "1"),
    term.replace(/s/g, "$"),
    term.split("").join("-"),
    term.toUpperCase(),
  ].filter((d) => d !== term);
}

const HARMLESS = [
  "Pip",
  "Juniper",
  "Wren",
  "Rook",
  "Captain Quill",
  "Sam",
  "Maya",
  "Leo",
  "Zoe",
  "Ava",
  "Noah",
  "Liam",
  "Mia",
  "Ella",
  "Max",
  "Ruby",
  "Finn",
  "Ivy",
  "Kai",
  "Rosa",
  "Omar",
  "Priya",
  "Mei",
  "Kofi",
  "Aiyana",
  "Sky Dragon",
  "Mossy Rock",
  "Pixel Fox",
  "Block Star 7",
  "Lil Owl",
  "Tiger-Lily",
  "Jo's Rocket",
];

describe("generated filter data", () => {
  it("is up to date with the blocklist (npm run tool -- gen-nickname-filter)", () => {
    expect(blocklist.problems).toEqual([]);
    expect(readFileSync(FILTER_FILE, "utf8")).toBe(filterSource(blocklist));
  });

  it("holds no term as text, only hashes", () => {
    const text = readFileSync(FILTER_FILE, "utf8");
    const body = text.slice(text.indexOf("*/") + 2);
    const tokens = new Set(body.match(/[a-z0-9]+/g) ?? []);
    for (const t of blocklist.terms) {
      for (const w of t.term.split(" ")) {
        // A short term could match a hash by chance only if it were one; hashes are 8+ chars.
        if (w.length >= 3) expect(tokens.has(w), t.term).toBe(false);
      }
    }
    expect(text).not.toContain("SAFETY FILTER");
  });

  it("hashes are stable 53-bit numbers", () => {
    expect(cyrb53("")).toBe(cyrb53(""));
    expect(cyrb53("abc")).not.toBe(cyrb53("abd"));
    expect(Number.isSafeInteger(cyrb53("a long nickname"))).toBe(true);
    expect(hashText("abc")).toMatch(/^[0-9a-z]+$/);
  });
});

describe("blockedText agrees with M1-10's blocklistHits", () => {
  it("on every term, its inflections and its disguises", () => {
    for (const t of blocklist.terms) {
      for (const s of [t.term, ...inflections(t.term), ...disguises(t.term)]) {
        expect(blockedText(s), s).toBe(hits(s));
      }
    }
  });

  it("on every allowed word and every shipped word-list entry", () => {
    for (const s of [...blocklist.allow, ...shippedWords()]) {
      expect(blockedText(s), s).toBe(hits(s));
    }
  });

  it("on terms inside sentences", () => {
    for (const t of blocklist.terms.slice(0, 200)) {
      const s = `my ${t.term} is here`;
      expect(blockedText(s), s).toBe(hits(s));
    }
  });
});

describe("checkNickname", () => {
  it("keeps ordinary nicknames, tidied", () => {
    for (const name of HARMLESS) expect(checkNickname(name), name).toEqual({ ok: true, name });
    expect(checkNickname("  Pip   Fox ")).toEqual({ ok: true, name: "Pip Fox" });
    expect(tidyNickname(" a \t b ")).toBe("a b");
  });

  it("needs 1 to 16 characters", () => {
    expect(checkNickname("")).toEqual({ ok: false, reason: "empty" });
    expect(checkNickname("    ")).toEqual({ ok: false, reason: "empty" });
    expect(checkNickname("a")).toEqual({ ok: true, name: "a" });
    expect(checkNickname("a".repeat(NICKNAME_MAX)).ok).toBe(true);
    expect(checkNickname("a".repeat(NICKNAME_MAX + 1))).toEqual({ ok: false, reason: "tooLong" });
  });

  it("refuses chars outside letters, digits, space, ' and -", () => {
    for (const name of ["Pip!", "<b>", "Zoë", "😀", "a_b", "x@y"]) {
      expect(checkNickname(name), name).toEqual({ ok: false, reason: "notAllowed" });
    }
  });

  it("refuses every blocked term that fits, plainly, inflected, disguised, spaced or joined", () => {
    let checked = 0;
    for (const t of blocklist.terms) {
      const forms = [
        t.term,
        t.term.toUpperCase(),
        `${t.term.charAt(0).toUpperCase()}${t.term.slice(1)}`,
        ...inflections(t.term).filter((f) => !blocklist.allow.has(f)),
        ...disguises(t.term).filter((d) => !d.includes("$")),
        t.term.split("").join(" "),
        t.term.replace(/ /g, ""),
        `Big ${t.term}`,
      ];
      for (const f of forms) {
        if (Array.from(f).length > NICKNAME_MAX) continue;
        checked++;
        expect(checkNickname(f), f).toEqual({ ok: false, reason: "notAllowed" });
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it("the trademark terms of README §4.5 are refused", () => {
    const ip = blocklist.terms.filter((t) => t.category === "ip");
    expect(ip.length).toBeGreaterThan(4);
    for (const t of ip) {
      if (t.term.length <= NICKNAME_MAX) expect(checkNickname(t.term).ok, t.term).toBe(false);
    }
  });
});
