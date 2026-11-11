/**
 * Word-list pipeline (task M1-10): the loader, the shipped pools, and the validator
 * (tools/validate-wordlists.ts) on the real lists and on seeded bad fixtures.
 *
 * The "shipped lists" block is how `npm test` runs the validator over every list.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parsePoolText,
  poolFromText,
  poolIdOf,
  poolsFromTexts,
} from "../../../src/content/wordlists/loader";
import { POOL_IDS, wordPools } from "../../../src/content/wordlists/pools";
import {
  blocklistHits,
  formatProblem,
  loadBlocklist,
  inflections,
  parseBlocklist,
  registryIds,
  validateWordlists,
} from "../../../tools/validate-wordlists";

const REPO = resolve(import.meta.dirname, "../../..");
const LISTS = resolve(REPO, "src/content/wordlists");
const FIXTURES = resolve(REPO, "tests/fixtures/wordlists");
/** The Meadow (home-row) key set. */
const MEADOW_KEYS = new Set("asdfghjkl;");

const runTool = (...args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", "tools/validate-wordlists.ts", ...args], {
    cwd: REPO,
    encoding: "utf8",
  });

describe("shipped lists", () => {
  it("pass the validator", () => {
    const result = validateWordlists();
    expect(result.problems.map(formatProblem)).toEqual([]);
    expect(result.pools).toEqual([...POOL_IDS].toSorted());
  });

  it("pass the validator as a CLI (what CI's content job runs)", () => {
    const r = runTool();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no problems/);
  });

  it("are all registered in pools.ts, and pools.ts loads exactly those (no blocklist)", () => {
    const onDisk = readdirSync(LISTS)
      .filter((f) => f.endsWith(".txt") && f !== "blocklist.txt")
      .map((f) => poolIdOf(f) ?? f)
      .toSorted();
    expect([...POOL_IDS].toSorted()).toEqual(onDisk);
    expect(wordPools.map((p) => p.id)).toEqual([...POOL_IDS]);
    expect(wordPools.some((p) => p.id === "blocklist")).toBe(false);
  });

  it("home-row has at least 40 items, all typeable with the Meadow keys", () => {
    const pool = wordPools.find((p) => p.id === "home-row");
    expect(pool?.items.length).toBeGreaterThanOrEqual(40);
    for (const item of pool?.items ?? []) {
      expect(
        [...item].filter((c) => !MEADOW_KEYS.has(c)),
        item,
      ).toEqual([]);
    }
    expect(pool?.band).toBe("all");
    expect(pool?.tags).toContain("biome=meadow");
  });

  it("sight-dolch is a lowercase Sprout word list", () => {
    const pool = wordPools.find((p) => p.id === "sight-dolch");
    expect(pool?.band).toBe("sprout");
    expect(pool?.tags).toEqual(["kind=words", "case=lower", "reading=dolch"]);
    expect(pool?.items.length).toBeGreaterThan(200);
    expect(pool?.items.every((w) => /^[a-z]{1,5}$/.test(w))).toBe(true);
  });
});

const bad = (name: string) => `tests/fixtures/wordlists/bad/${name}`;

describe("validator on seeded bad fixtures", () => {
  it("reports each seeded problem with file:line", () => {
    const { problems } = validateWordlists({ dir: resolve(FIXTURES, "bad") });
    expect(problems.map(formatProblem)).toEqual([
      // a blocklisted word, a strict substring hit, an IP term; "stable" and "something" pass
      `${bad("blocked.txt")}:5: "shot" is on the blocklist ("shot", violence)`,
      `${bad("blocked.txt")}:6: "shitty" is on the blocklist ("shit", profanity, strict)`,
      `${bad("blocked.txt")}:7: "creeper" is a trademark/IP term ("creeper", ip)`,
      // comments ship with the list, so they are checked too
      `${bad("comment.txt")}:1: comment is on the blocklist ("shot", violence); comments ship with the list, so reword it`,
      // digits and punctuation used to disguise letters; the digit-only sentences pass
      `${bad("disguised.txt")}:3: "Oh sh1t, the cave is dark." is on the blocklist ("shit", profanity, strict)`,
      `${bad("disguised.txt")}:4: "What the fu-ck is that?" is on the blocklist ("fuck", profanity, strict)`,
      `${bad("disguised.txt")}:5: "Do not k.i.l.l the bee." is on the blocklist ("kill", violence)`,
      `${bad("disguised.txt")}:6: "The Ki11er Bee is here." is on the blocklist ("killer", violence)`,
      // duplicates within a file and across files of the same band
      `${bad("duplicate.txt")}:5: "rock" is a duplicate (first at line 3; band=builder)`,
      `${bad("duplicate.txt")}:6: "glass" is a duplicate (first at ${bad("blocked.txt")}:4; band=builder)`,
      `${bad("format.txt")}:4: "Glad dad" has capital letters; write it lowercase or tag the list case=mixed`,
      `${bad("format.txt")}:4: "Glad dad" uses "G", not in the keys tag`,
      `${bad("format.txt")}:5: "sad  dad" has two spaces in a row`,
      `${bad("format.txt")}:6: "flag " starts or ends with a space`,
      `${bad("format.txt")}:7: "glad cat" uses "c", "t", not in the keys tag`,
      `${bad("format.txt")}:8: tag lines must come before the first item`,
      // inflected and derived forms of whole-word terms (child-safety review B1); "butter",
      // "brass", "striped", "warm" and "stables" pass
      `${bad("inflected.txt")}:3: "shooting" is on the blocklist ("shoot", violence)`,
      `${bad("inflected.txt")}:4: "hurts" is on the blocklist ("hurt", violence)`,
      `${bad("inflected.txt")}:5: "stabbing" is on the blocklist ("stab", violence)`,
      `${bad("inflected.txt")}:6: "bombing" is on the blocklist ("bomb", violence)`,
      `${bad("inflected.txt")}:7: "drowned" is on the blocklist ("drown", violence)`,
      `${bad("inflected.txt")}:8: "gunman" is on the blocklist ("gun", violence)`,
      `${bad("inflected.txt")}:9: "jackass" is on the blocklist ("jackass", profanity)`,
      `${bad("inflected.txt")}:10: "slapped" is on the blocklist ("slap", violence)`,
      `${bad("inflected.txt")}:11: "bleeding" is on the blocklist ("bleed", violence)`,
      `${bad("inflected.txt")}:12: "gored" is on the blocklist ("gore", violence)`,
      `${bad("inflected.txt")}:13: "armies" is on the blocklist ("army", violence)`,
      `${bad("inflected.txt")}:14: "punches" is on the blocklist ("punch", violence)`,
      // a missing reading tag
      `${bad("no-reading.txt")}:2: missing "reading" tag (dolch, cvc, grade2, grade4, grade6+)`,
      // a non-ASCII char
      `${bad("non-ascii.txt")}:4: "café" has non-ASCII or control chars (U+00E9); type them as plain a-z`,
      // a too-long Sprout word
      `${bad("too-long.txt")}:4: "elephant" is 8 letters; band=sprout words are 1-5 letters`,
    ]);
  });

  it("exits 1 as a CLI and prints the problems", () => {
    const r = runTool("--dir", "tests/fixtures/wordlists/bad");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${bad("too-long.txt")}:4: "elephant"`);
    expect(r.stderr).toContain("31 problem(s)");
  });

  it("checks pools.ts against the files", () => {
    const { problems } = validateWordlists({ dir: resolve(FIXTURES, "registry") });
    const reg = "tests/fixtures/wordlists/registry";
    expect(problems.map(formatProblem)).toEqual([
      `${reg}/extra.txt: not listed in pools.ts; append "extra" to POOL_IDS`,
      `${reg}/pools.ts:5: "missing" is listed but missing.txt does not exist`,
      `${reg}/pools.ts:6: "listed" is listed twice (first on line 4)`,
    ]);
  });

  it("rejects bad tags", () => {
    expect(
      validateWordlists({ dir: resolve(FIXTURES, "tags") }).problems.map((p) => p.message),
    ).toEqual([
      "band=sprout lists reach 6-year-olds; use reading=dolch, cvc, grade2",
      'unknown biome "moon" (meadow, birch, shore, frosty, mines, marsh, caverns, sparkstone, citadel)',
      'unknown tag "colour" (known tags: band, reading, kind, case, keys, biome, theme)',
      'missing "band" tag (sprout, miner, builder, all)',
      // the safety checks still run on a list whose tags are broken
      '"shot" is on the blocklist ("shot", violence)',
      'unknown kind "poems" (words, phrases, sentences)',
      "the list has no items",
    ]);
  });
});

describe("blocklist", () => {
  const blocklist = loadBlocklist();
  const hit = (item: string) => blocklistHits(item, blocklist).map((t) => t.term);

  it("is well formed", () => {
    expect(blocklist.problems).toEqual([]);
    // the high-severity categories from the child-safety review (B2) are all present
    for (const category of [
      "predation",
      "sexual",
      "self-harm",
      "extremism",
      "violence",
      "gambling",
    ]) {
      expect(
        blocklist.terms.filter((t) => t.category === category).length,
        category,
      ).toBeGreaterThan(3);
    }
    // an allowed word is never also a term
    for (const word of blocklist.allow)
      expect(
        blocklist.terms.some((t) => t.term === word),
        word,
      ).toBe(false);
    expect(blocklist.terms.length).toBeGreaterThan(300);
    for (const term of ["creeper", "enderman", "redstone", "nether", "steve"]) {
      expect(blocklist.terms.find((t) => t.term === term)?.category, term).toBe("ip");
    }
  });

  it("matches whole words, and strict terms inside words", () => {
    expect(hit("ass")).toEqual(["ass"]);
    expect(hit("the big shot")).toEqual(["shot"]);
    expect(hit("shitty")).toEqual(["shit"]);
    expect(hit("A Creeper!")).toEqual(["creeper"]);
    // strict terms never match across a space
    expect(hit("he has hit it")).toEqual(["hit"]);
  });

  it("matches inflections and derivations of whole-word terms", () => {
    // the child-safety review's examples (B1)
    for (const [word, term] of [
      ["shooting", "shoot"],
      ["hurts", "hurt"],
      ["stabbing", "stab"],
      ["bombing", "bomb"],
      ["drowned", "drown"],
      ["gunman", "gun"],
      ["gunmen", "gun"],
      ["jackass", "jackass"],
      // more: -es, -er/-ers, doubling, e-dropping, y → ies/ied, -y, phrases
      ["punches", "punch"],
      ["shooters", "shoot"],
      ["slapped", "slap"],
      ["whipping", "whip"],
      ["choking", "choke"],
      ["strangled", "strangle"],
      ["armies", "army"],
      ["bloodier", "bloody"],
      ["gory", "gory"],
      ["kidnapping", "kidnap"],
      ["executing", "execute"],
    ] as const) {
      expect(hit(word), word).toEqual([term]);
    }
    expect(hit("she is self harming")).toEqual(["harm", "self harm"]);
  });

  it("undoes look-alike spellings before matching", () => {
    expect(hit("sh1t")).toEqual(["shit"]);
    expect(hit("a$$")).toEqual(["ass"]);
    expect(hit("k1ll3r")).toEqual(["killer"]);
    expect(hit("s.h.o.t")).toEqual(["shot"]);
    expect(hit("sh!t")).toEqual(["shit"]);
    expect(hit("Fu-ck!")).toEqual(["fuck"]);
    // ordinary digits and end punctuation stay harmless
    expect(hit("I have 3 cats, 10 dogs and 100 bees!")).toEqual([]);
    expect(hit("Room 7 is a well-made, warm room.")).toEqual([]);
  });

  it("lists inflections by spelling rule", () => {
    expect(inflections("stab")).toEqual(
      expect.arrayContaining(["stabs", "stabbed", "stabbing", "stabber", "stabman"]),
    );
    expect(inflections("bake")).toEqual(
      expect.arrayContaining(["baked", "baker", "baking", "baky"]),
    );
    expect(inflections("die")).toEqual(expect.arrayContaining(["died", "dying"]));
    expect(inflections("bully")).toEqual(expect.arrayContaining(["bullies", "bullied"]));
    expect(inflections("punch")).toContain("punches");
    expect(inflections("pee")).not.toContain("peer");
    expect(inflections("self harm")).toContain("self harming");
  });

  it("does not block harmless look-alikes", () => {
    const harmless = [
      "glass",
      "class",
      "grass",
      "assess",
      "stable",
      "establish",
      "something",
      "method",
      "scrap",
      "trifle",
      "marvelous",
      "demonstrate",
      "bulletin",
      "grape",
      "allegory",
      "choreography",
      "hello",
      "shell",
      "warm",
      "dice",
      "raccoon",
      "spice",
      "heroine",
      "peacock",
      "hoarse",
      "window",
      "windows",
      "pickaxe",
      "bone",
      "smoke",
      "pot",
      // real words an inflection or look-alike reading of a term would spell (the allow section)
      "brass",
      "butter",
      "assessed",
      "striped",
      "blazer",
      "hanger",
      "spicy",
      "wary",
      "jagged",
      "shaggy",
      "baby",
      // strict terms moved to whole-word because they hide in these
      "saltwater",
      "debugger",
      // common words with blocked-looking endings
      "ginger",
      "summer",
      "hammer",
      "button",
      "bottle",
      "kitten",
      "winter",
      "bigger",
      "better",
      "skilled",
      "warmer",
      "shelling",
      "robin",
      "parson",
    ];
    for (const word of harmless) expect(blocklistHits(word, blocklist), word).toEqual([]);
  });

  it("reports its own format problems", () => {
    const parsed = parseBlocklist(
      ["early", "# section: ip strict", "ok", "ok", "Bad", "# section: two words here"].join("\n"),
      "b.txt",
    );
    expect(parsed.problems.map(formatProblem)).toEqual([
      'b.txt:1: "early" comes before any "# section:" line',
      'b.txt:4: "ok" is already listed on line 3',
      'b.txt:5: "Bad" must be lowercase a-z words with single spaces',
      'b.txt:6: bad section line; use "# section: <category> [strict]" or "# section: allow"',
    ]);
  });
});

describe("loader", () => {
  it("parses tags, comments, blank lines and CRLF", () => {
    const parsed = parsePoolText(
      "# hi\r\n# tags: band=miner reading=grade2\r\n\r\nrock\r\n# x\r\nore\r\n",
    );
    expect(Object.fromEntries(parsed.tags)).toEqual({ band: "miner", reading: "grade2" });
    expect(parsed.items).toEqual([
      { text: "rock", line: 4 },
      { text: "ore", line: 6 },
    ]);
    expect(parsed.issues).toEqual([]);
  });

  it("ignores a byte-order mark and keeps comments for the validator", () => {
    const parsed = parsePoolText(
      String.fromCodePoint(0xfeff) + "# tags: band=all reading=cvc\n# a note\ncat\n",
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.tags.get("band")).toBe("all");
    expect(parsed.items).toEqual([{ text: "cat", line: 3 }]);
    expect(parsed.comments).toEqual([{ text: " a note", line: 2 }]);
  });

  it("builds a WordPool with normalized tags", () => {
    const pool = poolFromText(
      "ores",
      "# tags: theme=mining band=builder reading=grade4 case=mixed\nCopper ore\n",
    );
    expect(pool).toEqual({
      id: "ores",
      band: "builder",
      tags: ["kind=words", "case=mixed", "reading=grade4", "theme=mining"],
      items: ["Copper ore"],
    });
  });

  it("throws on structural problems", () => {
    expect(() => poolFromText("x", "rock\n")).toThrow(/x\.txt needs a "band" tag/);
    expect(() => poolFromText("x", "# tags: band=moon\nrock\n")).toThrow(/band/);
    expect(() => poolFromText("x", "# tags: colour=red band=all\nrock\n")).toThrow(
      /x\.txt:1: unknown tag "colour"/,
    );
  });

  it("matches files to the registry", () => {
    const text = "# tags: band=all reading=cvc\ncat\n";
    expect(
      poolsFromTexts({ "./b.txt": text, "./a.txt": text }, ["b", "a"]).map((p) => p.id),
    ).toEqual(["b", "a"]);
    expect(() => poolsFromTexts({ "./a.txt": text, "./z.txt": text }, ["a"])).toThrow(
      /z\.txt not listed in pools\.ts/,
    );
    expect(() => poolsFromTexts({ "./a.txt": text }, ["a", "b"])).toThrow(
      /"b" but b\.txt is missing/,
    );
  });

  it("reads the registry ids from pools.ts source", () => {
    const source = readFileSync(resolve(LISTS, "pools.ts"), "utf8");
    expect(registryIds(source)?.map((r) => r.id)).toEqual([...POOL_IDS]);
  });
});
