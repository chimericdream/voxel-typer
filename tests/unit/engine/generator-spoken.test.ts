/**
 * Letter groups that sound safe when read aloud (task M3-FIX-6). Read-aloud says each target as a
 * word, so `fak` must never be generated. Covers the "sounds like" check
 * (`src/content/wordlists/spoken-blocklist.ts`), the syllable generator that uses it, and every
 * fixed item read-aloud can speak.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isContentDataFile } from "../../../src/content/collect";
import { lessonsFromModules } from "../../../src/content/lessons/load";
import { allowedKeysFor } from "../../../src/content/lessons/types";
import type { Lesson } from "../../../src/content/lessons/types";
import { parsePoolText } from "../../../src/content/wordlists/loader";
import {
  SPOKEN_SAFE_WORDS,
  SPOKEN_STEMS,
  soundsUnsafe,
  spokenForm,
} from "../../../src/content/wordlists/spoken-blocklist";
import { GENERATOR_CONSTANTS, generateTargets } from "../../../src/engine/generator";
import { createRng } from "../../../src/engine/rng";

const SEED = 20261112;
const REPO = resolve(import.meta.dirname, "../../..");

/** Spellings that sound like a swear word, slur, or body or toilet word. All must be rejected. */
const UNSAFE = [
  // f-word: vowel swaps, c/k/ck/q, ph, doubles, trailing e, short forms, capitals, punctuation.
  "fak",
  "fek",
  "fok",
  "fuk",
  "fuc",
  "fuck",
  "fukk",
  "fuuk",
  "fook",
  "fuq",
  "faq",
  "feq",
  "phuk",
  "phuck",
  "fuke",
  "fk",
  "fck",
  "ffk",
  "sfk",
  "jfk",
  "f;k",
  "FAK",
  "Fuk",
  // s-word
  "shit",
  "shyt",
  "shiit",
  "shite",
  "sht",
  // dick, dyke
  "dik",
  "dic",
  "diq",
  "dick",
  "dyk",
  "dyke",
  "dike",
  "dk",
  "jdk",
  "dkf",
  "d;k",
  // others
  "kok",
  "cok",
  "coq",
  "cock",
  "kunt",
  "cunt",
  "bitch",
  "bich",
  "piss",
  "pis",
  "crap",
  "krap",
  "cum",
  "kum",
  "qum",
  "sex",
  "seks",
  "wank",
  "jizz",
  "jiz",
  "fart",
  "turd",
  "slut",
  "fag",
  "twat",
  "porn",
  "penis",
];

/** Near-misses that must stay allowed, or the home-row drills starve. */
const SAFE = [
  "fa",
  "ka",
  "as",
  "sad",
  "lad",
  "ask",
  "has",
  "fan",
  "kit",
  "dish",
  "fad",
  "fads",
  "ads",
  "add",
  "all",
  "salad",
  "glass",
  "class",
  "kid",
  "kids",
  "kick",
  "fish",
  "fit",
  "fig",
  "fix",
  "fox",
  "face",
  "cake",
  "cook",
  "cookie",
  "sheet",
  "seeks",
  "duck",
  "deck",
  "dock",
  "desk",
  "folk",
  "fork",
  "shot",
  "shut",
  "sock",
  "jazz",
  "flag",
  "fog",
  "fun",
  "cub",
  "cut",
  "pass",
  "dash",
  "kf",
  "kd",
  "df",
  "dj",
  "sk",
  "lk",
  "jk",
  "fl",
  "sdf",
  "jkl",
  "a;",
  "spreadsheet",
  "saturday",
  "coconut",
  "focus",
];

describe("soundsUnsafe", () => {
  it("has the table sizes the card asks for", () => {
    expect(new Set(UNSAFE).size).toBeGreaterThanOrEqual(40);
    expect(new Set(SAFE).size).toBeGreaterThanOrEqual(40);
  });

  it.each(UNSAFE)("rejects %s", (text) => {
    expect(soundsUnsafe(text)).toBe(true);
  });

  it.each(SAFE)("allows %s", (text) => {
    expect(soundsUnsafe(text)).toBe(false);
  });

  it("checks each word of a phrase", () => {
    expect(soundsUnsafe("a sad lad")).toBe(false);
    expect(soundsUnsafe("a fak lad")).toBe(true);
  });

  it("normalises as documented", () => {
    expect(spokenForm("Phuck")).toBe("fuk");
    expect(spokenForm("cocoa")).toBe("kokoa");
    expect(spokenForm("face")).toBe("fase");
    expect(spokenForm("cook")).toBe("kuk");
    expect(spokenForm("sheet")).toBe("sheet");
    expect(spokenForm("shyt")).toBe("shit");
    expect(spokenForm("bitch")).toBe("bich");
    expect(spokenForm("f;k")).toBe("fk");
  });

  it("keeps stems normalised, and safe words longer than any random group", () => {
    for (const stem of SPOKEN_STEMS) expect(spokenForm(stem)).toBe(stem);
    for (const word of SPOKEN_SAFE_WORDS) {
      expect(word).toMatch(/^[a-z]+$/);
      expect(word.length).toBeGreaterThan(GENERATOR_CONSTANTS.syllableMax);
      // Each entry is needed: without the allow-list it would be rejected.
      expect(SPOKEN_STEMS.some((s) => spokenForm(word).includes(s))).toBe(true);
    }
  });
});

async function loadLessons(): Promise<Lesson[]> {
  const dir = join(REPO, "src/content/lessons");
  const modules: Record<string, unknown> = {};
  for (const name of readdirSync(dir).filter(isContentDataFile)) {
    const loaded: unknown = await import(/* @vite-ignore */ pathToFileURL(join(dir, name)).href);
    modules[`./${name}`] = loaded;
  }
  return lessonsFromModules(modules);
}

describe("syllable generator", () => {
  it("never makes a group that sounds unsafe, for every lesson's allowed keys", async () => {
    const lessons = await loadLessons();
    const keySets = new Map<string, string[]>();
    for (const l of lessons) {
      for (const sparkstoneUnlocked of [false, true]) {
        const keys = allowedKeysFor(lessons, l.id, { sparkstoneUnlocked });
        keySets.set(keys.join(""), keys);
      }
    }
    expect(keySets.size).toBeGreaterThan(5);
    const GROUPS_PER_RUN = 1000;
    const RUNS = 10; // 10 × 1000 = 10,000 groups per key set.
    for (const keys of keySets.values()) {
      fc.assert(
        fc.property(
          fc.integer(),
          fc.dictionary(fc.constantFrom(...keys), fc.double({ min: 0.1, max: 10, noNaN: true })),
          (seed, weights) => {
            const out = generateTargets(
              {
                kind: "syllables",
                allowed: keys,
                weights,
                pools: [],
                length: { targets: GROUPS_PER_RUN },
              },
              createRng(seed),
            );
            expect(out).toHaveLength(GROUPS_PER_RUN);
            const bad = out.map((t) => t.text).filter(soundsUnsafe);
            expect(bad).toEqual([]);
          },
        ),
        { seed: SEED, numRuns: RUNS },
      );
    }
  }, 60_000);

  it("still makes the home-row groups the drills need", () => {
    const out = generateTargets(
      {
        kind: "syllables",
        allowed: Array.from("fjdksla;"),
        weights: {},
        pools: [],
        length: { targets: 5000 },
      },
      createRng(SEED),
    ).map((t) => t.text);
    // (`ask` is a VCC group, a pattern the generator never makes.)
    for (const g of ["fa", "ka", "as", "sad", "lad", "kas"]) expect(out).toContain(g);
  });
});

describe("fixed content", () => {
  it("every word-list, phrase and sentence item sounds safe", () => {
    const failures: string[] = [];
    for (const folder of ["src/content/wordlists", "src/content/sentences"]) {
      const dir = join(REPO, folder);
      const files = readdirSync(dir).filter((f) => f.endsWith(".txt") && f !== "blocklist.txt");
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        for (const item of parsePoolText(readFileSync(join(dir, file), "utf8")).items) {
          if (soundsUnsafe(item.text)) failures.push(`${folder}/${file}:${item.line} ${item.text}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
