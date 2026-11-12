/**
 * The curriculum validator and doc generator (task M3-01): the shipped lessons pass, each rule
 * fails on a fixture, `allowedKeysFor` follows contracts §6, and `docs/curriculum.md` is current.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOC_PATH,
  renderCurriculumDoc,
  sampleText,
  table,
} from "../../../tools/gen-curriculum-doc";
import {
  loadLessons,
  loadPools,
  RULES,
  validateCurriculum,
  type CurriculumInput,
  type Rule,
} from "../../../tools/validate-curriculum";
import { lessons as shipped } from "../../../src/content/lessons";
import { lessons as meadowAll } from "../../../src/content/lessons/meadow";
import { allowedKeysFor, type Lesson } from "../../../src/content/lessons/types";
import { wordPools } from "../../../src/content/wordlists/pools";
import type { WordPool } from "../../../src/engine/generator";
import en from "../../../src/i18n/en";
import { allowedKeys } from "../../../src/modes/mine/logic";
import type { BiomeId } from "../../../src/types/core";

const REPO = resolve(import.meta.dirname, "../../..");
const NONE: ReadonlySet<BiomeId> = new Set();
/** Meadow 1–6 (M2-12), the base of the fixtures: an unfinished biome. */
const meadow = meadowAll.filter((l) => l.order <= 6);
const SLICE: ReadonlySet<BiomeId> = new Set(["meadow"]);

const input = (
  lessons: readonly Lesson[],
  extra: Partial<CurriculumInput> = {},
): CurriculumInput => ({
  lessons,
  pools: wordPools,
  messages: en,
  ...extra,
});

/** A fixture built on Meadow 1–6, checked as a biome still in progress unless `extra` says not. */
const partial = (
  lessons: readonly Lesson[],
  extra: Partial<CurriculumInput> = {},
): CurriculumInput => input(lessons, { inProgress: SLICE, ...extra });

const rulesOf = (i: CurriculumInput): Set<Rule> =>
  new Set(validateCurriculum(i).problems.map((p) => p.rule));

/** Meadow with lesson `id` replaced by `change(lesson)`. */
function edit(id: string, change: (l: Lesson) => Lesson): Lesson[] {
  return meadow.map((l) => (l.id === id ? change(l) : l));
}

const pool = (id: string, items: string[]): WordPool => ({ id, band: "all", tags: [], items });

describe("shipped curriculum", () => {
  const result = validateCurriculum(input(shipped));

  it("has no problems", () => {
    expect(result.problems).toEqual([]);
  });

  it("has no warnings: every shipped biome is finished", () => {
    expect(result.warnings).toEqual([]);
  });

  it("Meadow word and phrase lessons use only pool items, never the syllable fallback", () => {
    for (const s of result.stats.filter((x) => x.id === "meadow-05" || x.id === "meadow-06")) {
      for (const b of s.bands) expect(b.poolTargets, `${s.id} ${b.band}`).toBe(b.targets);
    }
  });

  it("the tool's node:fs loaders give the same lessons and pools as the Vite aggregators", async () => {
    expect(await loadLessons()).toEqual(shipped);
    expect(loadPools().map((p) => [p.id, p.band, p.items])).toEqual(
      wordPools.map((p) => [p.id, p.band, p.items]),
    );
  });

  it("the CLI exits 0", () => {
    const run = spawnSync(process.execPath, ["--import", "tsx", "tools/validate-curriculum.ts"], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("no problems");
  });
});

describe("docs/curriculum.md", () => {
  it("is current (run `npm run tool -- gen-curriculum-doc` after changing lessons)", () => {
    expect(readFileSync(DOC_PATH, "utf8")).toBe(renderCurriculumDoc(input(shipped)));
  });

  it("has a table row for every lesson", () => {
    const doc = renderCurriculumDoc(input(shipped));
    for (const l of shipped) expect(doc).toContain(`| \`${l.id}\` |`);
  });

  it("pads tables like Oxfmt and cuts samples at a target boundary", () => {
    expect(table(["A", "Bb"], [["xyzw", "z"]])).toBe(
      ["| A    | Bb  |", "| ---- | --- |", "| xyzw | z   |"].join("\n"),
    );
    expect(sampleText(["ab", "cd"], " · ")).toBe("ab · cd");
    expect(sampleText(Array.from({ length: 30 }, () => "abc"))).toMatch(/^(abc ){10}…$/);
  });
});

describe("allowedKeysFor", () => {
  it("is every key introduced up to and including the lesson, in order", () => {
    expect(allowedKeysFor(meadow, "meadow-01")).toEqual(["f", "j"]);
    expect(allowedKeysFor(meadow, "meadow-03")).toEqual(["f", "j", "d", "k", "s", "l"]);
    expect(allowedKeysFor(meadow, "meadow-06")).toEqual(["f", "j", "d", "k", "s", "l", "a", ";"]);
  });

  it("matches Mine mode's own rule for every shipped lesson", () => {
    for (const l of shipped) expect(allowedKeysFor(shipped, l.id)).toEqual(allowedKeys(shipped, l));
  });

  it("throws on an unknown lesson", () => {
    expect(() => allowedKeysFor(meadow, "meadow-99")).toThrow(/meadow-99/);
  });

  it("counts Sparkstone keys in Sparkstone, and later only when unlocked", () => {
    const base = meadow[0];
    if (base === undefined) throw new Error("no meadow lessons");
    const at = (biome: BiomeId, newKeys: string[]): Lesson => ({
      ...base,
      id: `${biome}-01`,
      biome,
      newKeys,
    });
    const list = [at("citadel", []), at("sparkstone", ["#"]), at("caverns", ["?"]), base];
    expect(allowedKeysFor(list, "caverns-01")).toEqual(["f", "j", "?"]);
    expect(allowedKeysFor(list, "sparkstone-01")).toEqual(["f", "j", "?", "#"]);
    expect(allowedKeysFor(list, "citadel-01")).toEqual(["f", "j", "?"]);
    expect(allowedKeysFor(list, "citadel-01", { sparkstoneUnlocked: true })).toEqual([
      "f",
      "j",
      "?",
      "#",
    ]);
    expect(allowedKeysFor(list, "caverns-01", { sparkstoneUnlocked: true })).toEqual([
      "f",
      "j",
      "?",
    ]);
  });
});

/** One bad curriculum per rule; each must fail with that rule. */
const FIXTURES: { name: string; rule: Rule; input: CurriculumInput }[] = [
  {
    name: "two lessons share an id",
    rule: "unique-id",
    input: partial([...meadow, ...meadow.slice(1, 2)]),
  },
  {
    name: "id does not match biome and order",
    rule: "id-format",
    input: partial(edit("meadow-03", (l) => ({ ...l, id: "meadow-3" }))),
  },
  {
    name: "a gap in the order",
    rule: "order",
    input: partial(edit("meadow-06", (l) => ({ ...l, id: "meadow-07", order: 7 }))),
  },
  {
    name: "a key introduced twice",
    rule: "new-keys",
    input: partial(edit("meadow-02", (l) => ({ ...l, newKeys: ["d", "f"] }))),
  },
  {
    name: "a key from a later biome",
    rule: "new-keys",
    input: partial(edit("meadow-05", (l) => ({ ...l, newKeys: ["e"] }))),
  },
  {
    name: "a new key that is two chars",
    rule: "new-keys",
    input: partial(edit("meadow-05", (l) => ({ ...l, newKeys: ["gh"] }))),
  },
  {
    name: "a finished biome that never teaches some of its keys",
    rule: "new-keys",
    input: partial(meadow, { inProgress: NONE }),
  },
  {
    name: "reviews a key not yet introduced",
    rule: "review-keys",
    input: partial(edit("meadow-02", (l) => ({ ...l, reviewKeys: ["s"] }))),
  },
  {
    name: "reviews its own new key",
    rule: "review-keys",
    input: partial(edit("meadow-02", (l) => ({ ...l, reviewKeys: ["d"] }))),
  },
  {
    name: "a words lesson drawing on a phrase pool types spaces",
    rule: "allowed-keys",
    input: partial(edit("meadow-05", (l) => ({ ...l, pools: ["meadow-phrases"] }))),
  },
  {
    name: "too few distinct targets",
    rule: "variety",
    input: partial(
      edit("meadow-05", (l) => ({ ...l, pools: ["tiny"] })),
      { pools: [...wordPools, pool("tiny", ["dad", "sad", "lad", "fad", "add"])] },
    ),
  },
  {
    name: "a words lesson whose pool it cannot type falls back to syllables",
    rule: "real-words",
    input: partial(
      edit("meadow-05", (l) => ({ ...l, pools: ["untypeable"] })),
      { pools: [...wordPools, pool("untypeable", ["tree", "bird", "nest", "leaf"])] },
    ),
  },
  {
    name: "names a pool that does not exist",
    rule: "pools",
    input: partial(edit("meadow-05", (l) => ({ ...l, pools: ["no-such-pool"] }))),
  },
  {
    name: "a finished biome with no mastery lesson",
    rule: "mastery",
    input: partial(meadow, { inProgress: NONE }),
  },
  {
    name: "two mastery lessons",
    rule: "mastery",
    input: partial(meadow.map((l) => (l.order >= 5 ? { ...l, tags: ["mastery" as const] } : l))),
  },
  {
    name: "mastery lesson not last",
    rule: "mastery",
    input: partial(edit("meadow-03", (l) => ({ ...l, tags: ["mastery"] }))),
  },
  {
    name: "boss lesson not last",
    rule: "boss",
    input: partial(edit("meadow-03", (l) => ({ ...l, tags: ["boss"], mode: "boss" }))),
  },
  {
    name: "boss tag without boss mode",
    rule: "boss",
    input: partial(edit("meadow-06", (l) => ({ ...l, tags: ["boss"] }))),
  },
  {
    name: "no lesson practises the space bar",
    rule: "space",
    input: partial(edit("meadow-06", (l) => ({ ...l, kind: "words", pools: ["home-row"] }))),
  },
  {
    name: "title key with no English text",
    rule: "title",
    input: partial(
      edit("meadow-04", (l) => Object.assign({}, l, { titleKey: "lessonsMeadow.nope" })),
    ),
  },
];

describe("validator on fixtures", () => {
  for (const f of FIXTURES) {
    it(`[${f.rule}] ${f.name}`, () => {
      expect([...rulesOf(f.input)]).toContain(f.rule);
    });
  }

  it("has a failing fixture for every rule", () => {
    expect(new Set(FIXTURES.map((f) => f.rule))).toEqual(new Set(RULES));
  });

  it("problems name the lesson or biome", () => {
    const [p] = validateCurriculum(
      partial(edit("meadow-02", (l) => ({ ...l, reviewKeys: ["s"] }))),
    ).problems;
    expect(p).toEqual({
      rule: "review-keys",
      where: "meadow-02",
      message: "reviews 's', not introduced before this lesson",
    });
  });
});

/** Meadow 1–6 plus a mastery lesson and a boss lesson, finished. */
function finished(): Lesson[] {
  const words = meadow[4];
  const last = meadow.at(-1);
  if (words === undefined || last === undefined) throw new Error("no meadow lessons");
  return [
    ...meadow.slice(0, 4),
    { ...words, newKeys: ["g", "h"] },
    last,
    { ...last, id: "meadow-07", order: 7, tags: ["mastery"] },
    { ...last, id: "meadow-08", order: 8, tags: ["boss"], mode: "boss" },
  ];
}

describe("validator accepts", () => {
  it("a mastery lesson right before the boss lesson", () => {
    const r = validateCurriculum(partial(finished(), { inProgress: NONE }));
    expect(r.problems).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("a practice-mode words lesson as the biome's space practice", () => {
    const lessons = edit("meadow-06", (l) => ({
      ...l,
      kind: "words",
      pools: ["home-row"],
      mode: "practice",
    }));
    expect(rulesOf(partial(lessons)).has("space")).toBe(false);
  });
});
