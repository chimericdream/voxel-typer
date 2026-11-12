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
  biomeKeys,
  blocklistHits,
  formatProblem,
  loadBlocklist,
  inflections,
  isContraction,
  normalizedWords,
  parseBlocklist,
  ngramWords,
  registryIds,
  repetitionProblems,
  validateWordlists,
} from "../../../tools/validate-wordlists";

const REPO = resolve(import.meta.dirname, "../../..");
const LISTS = resolve(REPO, "src/content/wordlists");
const SENTENCES = resolve(REPO, "src/content/sentences");
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
    const files: string[] = [...readdirSync(LISTS), ...readdirSync(SENTENCES)];
    const onDisk = files
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
      // an apostrophe inside a term is still joined; real contractions, times and room numbers
      // on lines 11-13 pass (M1-FIX-1)
      `${bad("disguised.txt")}:10: "Do not ki'll the bee." is on the blocklist ("kill", violence)`,
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
    expect(r.stderr).toContain("32 problem(s)");
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

const fx = (name: string) => `tests/fixtures/wordlists/${name}`;
const fxBiome = (name: string) => fx(`biome-keys/${name}`);
const keyString = (b: Parameters<typeof biomeKeys>[0]) => [...biomeKeys(b)].join("");
const sentenceAt = (text: string, line: number) => ({ text, file: "s.txt", line });

describe("biome key sets, sentence lengths and repetition (M5-05)", () => {
  it("adds each biome's keys in curriculum order, leaving Sparkstone's out of Sky Citadel", () => {
    expect(keyString("meadow")).toBe("asdfjkl;gh");
    expect(keyString("shore")).toBe("asdfjkl;gheirutyowqpcnvmbxz");
    expect(keyString("frosty")).toBe(keyString("shore"));
    expect(biomeKeys("frosty").has("A")).toBe(false);
    expect(biomeKeys("mines").has("Q")).toBe(true);
    expect(biomeKeys("mines").has("7")).toBe(false);
    expect(biomeKeys("marsh").has("7")).toBe(true);
    expect(biomeKeys("marsh").has("'")).toBe(false);
    for (const c of `.,?!'"/`) expect(biomeKeys("caverns").has(c), c).toBe(true);
    for (const c of "-_():@#=+*") {
      expect(biomeKeys("sparkstone").has(c), c).toBe(true);
      expect(biomeKeys("citadel").has(c), c).toBe(false);
    }
    expect(keyString("citadel")).toBe(keyString("caverns"));
  });

  it("reports keys a biome hasn't taught yet, Sparkstone symbols elsewhere and long Sprout sentences", () => {
    const { problems } = validateWordlists({ dir: resolve(FIXTURES, "biome-keys") });
    expect(problems.map(formatProblem)).toEqual([
      // the keys tag may not ask for more than the biome has taught
      `${fxBiome("a-birch.txt")}:2: keys tag has "z", not taught by birch yet`,
      `${fxBiome("a-birch.txt")}:4: "rice" uses "c", not in the keys tag`,
      `${fxBiome("a-birch.txt")}:4: "rice" uses "c", not taught by birch yet`,
      // the apostrophe arrives in Crystal Caverns
      `${fxBiome("b-frosty.txt")}:4: "it's cold" uses "'", not taught by frosty yet`,
      // c-sparkstone.txt passes: its symbols are Sparkstone's own
      `${fxBiome("d-citadel.txt")}:3: "big_gear" uses "_", not allowed in kind=phrases`,
      `${fxBiome("d-citadel.txt")}:3: "big_gear" uses "_", not taught by citadel yet`,
      // capitals are fine in Deep Mines, digits are not
      `${fxBiome("e-mines.txt")}:4: "Mia has 3 carts" uses "3", not taught by mines yet`,
      `${fxBiome("f-sprout.txt")}:4: "The little crab waved at us from the big pool." is 46 chars; band=sprout sentences are at most 40`,
      // an item line that starts with "#" would be dropped as a comment
      `${fxBiome("g-hash.txt")}:4: "#cogs: 7" is read as a comment, not an item; start comments with "# ", and don't start an item with "#"`,
    ]);
  });

  it("reports a four-word run used more than five times across the sentences", () => {
    const { problems } = validateWordlists({ dir: resolve(FIXTURES, "ngram") });
    const f = fx("ngram/sentences.txt");
    // "the snow is soft" appears exactly five times, which is allowed
    expect(problems.map(formatProblem)).toEqual([
      `${f}:8: the words "the big red cart" appear 6 times across the sentences (at most 5; first at ${f}:3); vary the wording`,
    ]);
  });

  it("counts runs by words, ignoring case and the punctuation at word ends", () => {
    expect(ngramWords(`"Look," said Mia. It's #gems: 3!`)).toEqual([
      "look",
      "said",
      "mia",
      "it's",
      "gems",
      "3",
    ]);
    const same = [1, 2, 3, 4, 5, 6].map((n) =>
      sentenceAt(n % 2 ? "The Big Red Cart!" : "the big red cart", n),
    );
    expect(repetitionProblems(same).map((p) => p.line)).toEqual([6]);
    expect(repetitionProblems(same.slice(0, 5))).toEqual([]);
    // a sentence shorter than the run has no run
    expect(repetitionProblems([sentenceAt("a red cart", 1)])).toEqual([]);
  });

  it("reads a word folder and a sentence folder as one set, with one registry", () => {
    const { problems, pools } = validateWordlists({
      dir: resolve(FIXTURES, "split/lists"),
      sentencesDir: resolve(FIXTURES, "split/sentences"),
    });
    expect(pools).toEqual(["extra", "stories", "words"]);
    expect(problems.map(formatProblem)).toEqual([
      `${fx("split/sentences/extra.txt")}: not listed in pools.ts; append "extra" to POOL_IDS`,
      `${fx("split/sentences/stories.txt")}:3: "lantern" is a duplicate (first at ${fx("split/lists/words.txt")}:2; band=miner)`,
    ]);
    // with only --dir, the sentence folder is not read
    expect(
      validateWordlists({ dir: resolve(FIXTURES, "split/lists") }).problems.map(formatProblem),
    ).toEqual([
      `${fx("split/lists/pools.ts")}:5: "stories" is listed but stories.txt does not exist`,
    ]);
  });

  it("the shipped sentences: about 600, each list tagged with its biome and keys", () => {
    const sentencePools = wordPools.filter((p) => p.tags.includes("kind=sentences"));
    const count = sentencePools.reduce((n, p) => n + p.items.length, 0);
    expect(count).toBeGreaterThanOrEqual(580);
    for (const p of sentencePools) {
      expect(
        p.tags.some((t) => t.startsWith("keys=")),
        p.id,
      ).toBe(true);
      expect(
        p.tags.some((t) => t.startsWith("biome=")),
        p.id,
      ).toBe(true);
    }
  });
});

describe("blocklist", () => {
  const blocklist = loadBlocklist();
  const hit = (item: string) => blocklistHits(item, blocklist).map((t) => t.term);
  /** The term on a blocklist line; fails loudly if the line moved. */
  const at = (line: number, category: string): string => {
    const t = blocklist.terms.find((x) => x.line === line);
    expect(t?.category, `blocklist line ${line}`).toBe(category);
    return t?.term ?? "";
  };
  const lines = (s: string) => blocklistHits(s, blocklist).map((t) => t.line);

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

  it("leaves contractions and plain numbers alone in the look-alike pass (M1-FIX-1)", () => {
    // tokens with no letter are numbers, times or scores, never words
    for (const s of [
      "Room 455 is up.",
      "It is 4:55 now.",
      "Score: 5155!",
      "We met in 1455, then 3:45.",
      "It costs 55 gems.",
    ]) {
      expect(hit(s), s).toEqual([]);
    }
    expect(normalizedWords("Room 455 at 4:55 k1ll")).toEqual([
      ["room", "at", "kill"],
      ["room", "at", "klll"],
    ]);
    // common contractions are split at the apostrophe, not joined into another word
    for (const s of [
      "He'll be here soon.",
      "She'll, we'll, I'll and they'll go.",
      "He'd say it's fine, and we're sure you've won.",
      "Let's go! I'm ready, but I can't, won't, don't or shouldn't run.",
      "There's a cat. What's that? Who'd know?",
    ]) {
      expect(hit(s), s).toEqual([]);
    }
    expect(isContraction("he'll")).toBe(true);
    expect(isContraction("can't")).toBe(true);
    // a contraction shape with a stem that isn't a pronoun or auxiliary is still joined
    expect(isContraction("ki'll")).toBe(false);
    expect(hit("ki'll")).toEqual(["kill"]);
    expect(hit("he'l.l")).toEqual(["hell"]);
    // tokens that mix letters with digits or symbols are still read as disguises
    expect(hit("a55")).toEqual(["ass"]);
    expect(hit("@$$")).toEqual(["ass"]);
    expect(hit("5h1t")).toEqual(["shit"]);
  });

  describe("allow section scope (M1-FIX-1)", () => {
    // harmless stand-in terms, so the rules are easy to read
    const list = parseBlocklist(
      [
        "# section: food strict",
        "plum",
        "# section: food",
        "pea",
        "# section: allow",
        "peas", // an inflection of "pea": allowed
        "plums", // contains a strict term: rejected
        "apple", // not a form of any term: rejected
        "pea", // the term itself: rejected
      ].join("\n"),
      "b.txt",
    );
    const hits = (s: string) => blocklistHits(s, list).map((t) => t.term);

    it("accepts only inflections of a term, never strict forms or other words", () => {
      expect(list.problems.map(formatProblem)).toEqual([
        'b.txt:9: "pea" is already listed on line 4',
        `b.txt:7: allowed word "plums" contains the strict term on line 2; allow can't cancel strict hits`,
        'b.txt:8: allowed word "apple" is not an inflection of any term, so allowing it does nothing; remove it',
      ]);
      expect([...list.allow]).toEqual(["peas"]);
    });

    it("cancels only the derived hit of an allowed word, plain or disguised", () => {
      expect(hits("peas")).toEqual([]);
      expect(hits("pe4s")).toEqual([]);
      expect(hits("pea")).toEqual(["pea"]);
      expect(hits("peaed")).toEqual(["pea"]);
      // a strict hit is never cancelled, even in a word that is also allowed
      expect(hits("plums")).toEqual(["plum"]);
      expect(hits("plumber")).toEqual(["plum"]);
      // the matcher holds that line too, even for an allow set the parser didn't check
      const forced = { ...list, allow: new Set(["plums", "pea", "peas"]) };
      expect(blocklistHits("plums", forced).map((t) => t.term)).toEqual(["plum"]);
      expect(blocklistHits("pl.ums", forced).map((t) => t.term)).toEqual(["plum"]);
      expect(blocklistHits("pea", forced).map((t) => t.term)).toEqual(["pea"]);
    });

    it("in the real blocklist holds only inflections, and no allowed word hides a strict term", () => {
      for (const word of blocklist.allow) {
        expect(
          blocklist.terms.filter((t) => t.strict && word.includes(t.term)),
          word,
        ).toEqual([]);
        expect(
          blocklist.terms.some((t) => inflections(t.term).includes(word)),
          word,
        ).toBe(true);
        expect(hit(word), word).toEqual([]);
      }
      // the plural of an allowed word is allowed too (re-review §2)
      expect(hit("lusters")).toEqual([]);
    });
  });

  it("rejects the terms the M1-10 re-review found missing (cited by blocklist line)", () => {
    // §6 sexual (666-681), chat acronyms (684-689), extremism (693-700): each is rejected,
    // alone and in a sentence
    const added: [number, string][] = [
      ...[666, 667, 668, 669, 670, 671, 673, 674, 675, 676, 677, 678, 679, 680, 681].map(
        (n): [number, string] => [n, "sexual"],
      ),
      ...[684, 685, 686, 687, 688, 689, 690, 691].map((n): [number, string] => [n, "profanity"]),
      ...[693, 694, 695, 696, 698, 699, 700].map((n): [number, string] => [n, "extremism"]),
      ...[703, 704, 705, 706, 708, 709].map((n): [number, string] => [n, "violence"]),
      ...[711, 712, 713, 714, 716].map((n): [number, string] => [n, "drugs"]),
    ];
    for (const [n, category] of added) {
      const term = at(n, category);
      expect(lines(term), `line ${n}`).toContain(n);
      expect(lines(`Look at the ${term} now!`), `line ${n} in a sentence`).toContain(n);
    }

    // forms the inflection rules didn't produce before, built from older lines
    const derived: [string, number][] = [
      [`${at(190, "sexual")}y`, 190], // -ey with the e kept (§1)
      [`${at(189, "sexual")}ually`, 666], // the adverb of line 189 (§6)
      [`${at(132, "profanity")}ties`, 675], // the diminutive plural of line 132 (§6)
      [`${at(186, "sexual").slice(0, 4)}y`, 676], // the clipped form of line 186 + -y (§6)
      [`${at(512, "sexual").slice(0, 4)}s`, 674], // the clipped form of line 512 (§6)
      [`${at(576, "violence").slice(0, 2)}${at(576, "violence").slice(3)}`, 708], // past of 576
      [`${at(126, "profanity")}head`, 690], // compounds of whole-word terms (§1)
      [`${at(120, "profanity")}hat`, 691],
      [`${at(226, "violence")}shot`, 703],
      [`${at(226, "violence")}fire`, 704],
      [`${at(226, "violence")}point`, 705],
      [`${at(581, "violence")}ist`, 706],
      [`${at(651, "drugs")}head`, 711],
      [`${at(416, "drugs")}head`, 713],
      [`${at(426, "drugs")}ard`, 714],
      [at(552, "extremism").replace(" ", ""), 693], // run-together spellings (§6)
      [at(553, "extremism").replace(" ", ""), 695],
    ];
    for (const [word, n] of derived) expect(lines(word), `line ${n}`).toContain(n);
    // the past of line 260 is listed by hand at line 709, as irregular forms must be
    expect(inflections(at(260, "violence"))).not.toContain(at(709, "violence"));
  });

  it("lists inflections by spelling rule", () => {
    expect(inflections("stab")).toEqual(
      expect.arrayContaining(["stabs", "stabbed", "stabbing", "stabber", "stabman"]),
    );
    expect(inflections("bake")).toEqual(
      expect.arrayContaining(["baked", "baker", "baking", "baky", "bakey"]),
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
