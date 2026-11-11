/**
 * Proves the copy lint (tools/check-ui-literals.ts) catches kid-facing literals in src/ui.
 *
 * Each fixture in tests/fixtures/ui-literals/cases/ is a small component. The test copies every
 * fixture into a throwaway tree laid out like the repo, inside `src/ui/` and outside the scanned folders (`src/render/`),
 * runs the real tool as `npm run tool -- check-ui-literals` would, and checks what it reports.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkSource, decodeEntities, type Violation } from "../../tools/check-ui-literals";

const REPO = resolve(import.meta.dirname, "../..");
const CASES_DIR = join(REPO, "tests/fixtures/ui-literals/cases");
const TOOL = join(REPO, "tools/check-ui-literals.ts");

/** fixture name → the rules it must trigger inside src/ui ([] = must be clean). */
const CASES: Record<string, Violation["rule"][]> = {
  "jsx-text": ["jsx-text"],
  "fragment-text": ["jsx-text"],
  translated: [],
  "no-letters": [],
  "string-child": ["jsx-string-child"],
  "template-child": ["jsx-string-child"],
  "conditional-child": ["jsx-string-child"],
  "prop-title": ["text-prop"],
  "prop-aria-label": ["text-prop"],
  "prop-placeholder": ["text-prop"],
  "prop-alt": ["text-prop"],
  "props-translated": [],
  "props-no-letters": [],
};

const IN_UI = "src/ui/screens/{name}.tsx";
const OUTSIDE_UI = "src/render/{name}.tsx";

interface Run {
  status: number | null;
  /** posix path inside the tree → rules reported there. */
  rules: Map<string, string[]>;
  output: string;
}

/** Runs the tool as a child process over `root`, the way `npm run lint` does. */
function runTool(root: string): Run {
  const run = spawnSync(process.execPath, ["--import", "tsx", TOOL, "--root", root], {
    cwd: REPO,
    encoding: "utf8",
  });
  if (run.error) throw run.error;
  const rules = new Map<string, string[]>();
  for (const line of run.stderr.split("\n")) {
    const m = /^(.+?):\d+:\d+: error ui-literals\(([\w-]+)\)/.exec(line);
    if (!m?.[1] || !m[2]) continue;
    rules.set(m[1], [...(rules.get(m[1]) ?? []), m[2]]);
  }
  return { status: run.status, rules, output: run.stdout + run.stderr };
}

function makeTree(cases: readonly string[], locations: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "vt-ui-literals-"));
  roots.push(root);
  for (const name of cases) {
    const source = readFileSync(join(CASES_DIR, `${name}.tsx`), "utf8");
    for (const loc of locations) {
      const file = join(root, loc.replace("{name}", name));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    }
  }
  return root;
}

const roots: string[] = [];
let all: Run;

beforeAll(() => {
  all = runTool(makeTree(Object.keys(CASES), [IN_UI, OUTSIDE_UI]));
}, 60_000);

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe("check-ui-literals", () => {
  it("has a table entry for every fixture file (and a fixture for every entry)", () => {
    const files = readdirSync(CASES_DIR)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => f.slice(0, -4))
      .toSorted();
    expect(files).toEqual(Object.keys(CASES).toSorted());
  });

  it("fails on <p>Hello</p> in src/ui (acceptance)", () => {
    const run = runTool(makeTree(["jsx-text"], [IN_UI]));
    expect(run.status, run.output).toBe(1);
    expect(run.rules.get("src/ui/screens/jsx-text.tsx")).toEqual(["jsx-text"]);
  }, 30_000);

  it("fails on <p>Hello</p> in src/app too (the app shell draws kid-facing UI)", () => {
    const run = runTool(makeTree(["jsx-text", "translated"], ["src/app/{name}.tsx"]));
    expect(run.status, run.output).toBe(1);
    expect(run.rules.get("src/app/jsx-text.tsx")).toEqual(["jsx-text"]);
    expect(run.rules.get("src/app/translated.tsx") ?? []).toEqual([]);
  }, 30_000);

  it("passes on <p>{t('x.y')}</p> in src/ui (acceptance)", () => {
    const run = runTool(makeTree(["translated"], [IN_UI]));
    expect(run.status, run.output).toBe(0);
  }, 30_000);

  it("fails the whole run when any case trips it", () => {
    expect(all.status, all.output).toBe(1);
  });

  describe.each(Object.entries(CASES))("%s", (name, expected) => {
    it("inside src/ui", () => {
      expect(all.rules.get(IN_UI.replace("{name}", name)) ?? []).toEqual(expected);
    });

    it("ignored outside src/ui", () => {
      expect(all.rules.get(OUTSIDE_UI.replace("{name}", name)) ?? []).toEqual([]);
    });
  });
});

const rulesFor = (jsx: string): string[] =>
  checkSource("src/ui/x.tsx", `export const X = () => ${jsx};\n`).map((v) => v.rule);

describe("checkSource", () => {
  it.each([
    ["<p>Hello</p>", ["jsx-text"]],
    ["<p>¡Hola, niño!</p>", ["jsx-text"]],
    ["<p>{t('x.y')}</p>", []],
    ["<p>  </p>", []],
    ["<p>12:30 · 3/10 ★★☆ (100%)</p>", []],
    ["<p>{1}{true && 'ok'}</p>", ["jsx-string-child"]],
    ["<p>{x ?? 'none'}</p>", ["jsx-string-child"]],
    ["<p>{('wrapped')}</p>", ["jsx-string-child"]],
    ["<p>{`${n} / ${m}`}</p>", []],
    ["<p>{/* a comment with words */}</p>", []],
    ['<img alt="" />', []],
    ['<input aria-valuetext="half" />', ["text-prop"]],
    ['<input aria-roledescription="slider" />', ["text-prop"]],
    ['<div className="title big" id="main" role="dialog" />', []],
    ['<div title={cond ? "On" : t("off")} />', ["text-prop"]],
    ["<p>&nbsp;&mdash;&#215;&#x2605;</p>", []],
    ["<p>&eacute;</p>", ["jsx-text"]],
  ] as const)("%s → %j", (jsx, expected) => {
    expect(rulesFor(jsx)).toEqual(expected);
  });

  it("reports the line and column of the literal", () => {
    const found = checkSource(
      "src/ui/x.tsx",
      "export const X = () => (\n  <p>\n    Hi\n  </p>\n);\n",
    );
    expect(found).toMatchObject([{ file: "src/ui/x.tsx", line: 2, rule: "jsx-text" }]);
  });

  it("reports parse errors instead of passing silently", () => {
    expect(checkSource("src/ui/x.tsx", "export const X = () => <p>;").map((v) => v.rule)).toContain(
      "parse-error",
    );
  });
});

describe("decodeEntities", () => {
  it.each([
    ["&nbsp;&amp;&lt;", " &<"],
    ["&#65;&#x42;", "AB"],
    ["&unknown;", "&unknown;"],
  ])("%s → %s", (input, out) => {
    expect(decodeEntities(input)).toBe(out);
  });
});
