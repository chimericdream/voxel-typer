/**
 * Proves the purity zones (docs/impl/contracts.md §0, PLAN.md §6.3) can't silently break.
 *
 * Each fixture in tests/fixtures/purity/cases/ holds one violation. For every case the test builds a
 * throwaway tree laid out like the repo, copies the fixture into every pure location and into some
 * impure ones, then runs the real `.oxlintrc.json` (minus its ignore list and type-aware mode) and
 * tools/check-boundaries.ts over it. The banned thing must error in every pure location and must not
 * trip a purity rule anywhere else.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkBoundaries, checkSource, type Violation } from "../../tools/check-boundaries";

const REPO = resolve(import.meta.dirname, "../..");
const CASES_DIR = join(REPO, "tests/fixtures/purity/cases");
const OXLINT_BIN = join(REPO, "node_modules/oxlint/bin/oxlint");

type Expect =
  | { tool: "oxlint"; rule: string }
  | { tool: "boundaries"; rule: Violation["rule"] }
  | null;

const RESTRICTED_IMPORTS: Expect = { tool: "oxlint", rule: "eslint(no-restricted-imports)" };
const RESTRICTED_GLOBALS: Expect = { tool: "oxlint", rule: "eslint(no-restricted-globals)" };
const RESTRICTED_PROPS: Expect = { tool: "oxlint", rule: "eslint(no-restricted-properties)" };

/** fixture name → what must fire inside a pure zone (null = nothing may fire). */
const CASES: Record<string, Expect> = {
  "import-three": RESTRICTED_IMPORTS,
  "import-three-type": RESTRICTED_IMPORTS,
  "import-three-dynamic": RESTRICTED_IMPORTS,
  "reexport-three": RESTRICTED_IMPORTS,
  "import-preact": RESTRICTED_IMPORTS,
  "import-preact-hooks": RESTRICTED_IMPORTS,
  "import-preact-signals": RESTRICTED_IMPORTS,
  "import-idb": RESTRICTED_IMPORTS,
  "import-alias-ui": RESTRICTED_IMPORTS,
  "import-alias-audio": RESTRICTED_IMPORTS,
  "import-alias-app": RESTRICTED_IMPORTS,
  "import-alias-render": RESTRICTED_IMPORTS,
  "import-relative-ui": { tool: "boundaries", rule: "relative-import" },
  "global-window": RESTRICTED_GLOBALS,
  "global-document": RESTRICTED_GLOBALS,
  "global-navigator": RESTRICTED_GLOBALS,
  "global-localstorage": RESTRICTED_GLOBALS,
  "global-indexeddb": RESTRICTED_GLOBALS,
  "globalthis-document": { tool: "boundaries", rule: "global-object-access" },
  "self-navigator": { tool: "boundaries", rule: "global-object-access" },
  "date-now": RESTRICTED_PROPS,
  "date-now-destructured": RESTRICTED_PROPS,
  "math-random": RESTRICTED_PROPS,
  "math-random-computed": RESTRICTED_PROPS,
  "performance-now": RESTRICTED_PROPS,
  "globalthis-performance-now": { tool: "boundaries", rule: "global-object-access" },
  "new-date": { tool: "boundaries", rule: "wall-clock" },
  "allowed-pure-imports": null,
};

/** Where a case file lands in the throwaway tree. `{name}` → the case name. */
const PURE_LOCATIONS = [
  "src/engine/{name}.ts",
  "src/content/{name}.ts",
  "src/render/mesher/{name}.ts",
  "src/render/atlas/recipes.ts",
  "src/save/schema.ts",
  "src/save/migrations.ts",
];
const IMPURE_LOCATIONS = [
  "src/ui/{name}.ts",
  "src/app/{name}.ts",
  "src/render/scene/{name}.ts",
  "src/render/atlas/build.ts",
  "src/save/store.ts",
  "src/main.ts",
];

const PURITY_RULES = new Set([
  "eslint(no-restricted-imports)",
  "eslint(no-restricted-globals)",
  "eslint(no-restricted-properties)",
]);

interface Hit {
  tool: "oxlint" | "boundaries";
  rule: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

let work: string;
/** "<case>/<posix path inside the tree>" → purity hits there. */
const hits = new Map<string, Hit[]>();

function addHit(key: string, hit: Hit): void {
  const list = hits.get(key) ?? [];
  list.push(hit);
  hits.set(key, list);
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "vt-purity-"));
  const config: unknown = JSON.parse(readFileSync(join(REPO, ".oxlintrc.json"), "utf8"));
  if (!isRecord(config)) throw new Error(".oxlintrc.json is not an object");
  delete config["$schema"];
  delete config["ignorePatterns"];
  delete config["options"]; // type-aware needs a tsconfig; the purity rules are syntactic.

  for (const name of Object.keys(CASES)) {
    const root = join(work, name);
    const source = readFileSync(join(CASES_DIR, `${name}.ts`), "utf8");
    for (const loc of [...PURE_LOCATIONS, ...IMPURE_LOCATIONS]) {
      const file = join(root, loc.replace("{name}", name));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    }
    writeFileSync(join(root, ".oxlintrc.json"), JSON.stringify(config));

    for (const v of checkBoundaries(root, join(REPO, ".oxlintrc.json"))) {
      addHit(`${name}/${v.file}`, { tool: "boundaries", rule: v.rule });
    }
  }

  // One Oxlint run over all case trees; each tree's nested .oxlintrc.json applies to it.
  const run = spawnSync(process.execPath, [OXLINT_BIN, "--format", "json", "."], {
    cwd: work,
    encoding: "utf8",
  });
  if (run.error) throw run.error;
  const report: unknown = JSON.parse(run.stdout);
  if (!isRecord(report) || !Array.isArray(report["diagnostics"])) {
    throw new Error(`Unexpected oxlint output: ${run.stdout.slice(0, 500)}${run.stderr}`);
  }
  for (const d of report["diagnostics"]) {
    if (!isRecord(d) || typeof d["code"] !== "string" || typeof d["filename"] !== "string")
      continue;
    if (!PURITY_RULES.has(d["code"])) continue;
    addHit(d["filename"].replaceAll("\\", "/"), { tool: "oxlint", rule: d["code"] });
  }
}, 60_000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("purity zones", () => {
  it("has a table entry for every fixture file (and a fixture for every entry)", () => {
    const files = readdirSync(CASES_DIR)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.slice(0, -3))
      .toSorted();
    expect(files).toEqual(Object.keys(CASES).toSorted());
  });

  describe.each(Object.entries(CASES))("%s", (name, expected) => {
    it.each(PURE_LOCATIONS)(`inside a pure zone: %s`, (loc) => {
      const found = hits.get(`${name}/${loc.replace("{name}", name)}`) ?? [];
      if (expected === null) {
        expect(found).toEqual([]);
      } else {
        expect(found).toContainEqual(expected);
      }
    });

    it.each(IMPURE_LOCATIONS)(`allowed outside the zones: %s`, (loc) => {
      expect(hits.get(`${name}/${loc.replace("{name}", name)}`) ?? []).toEqual([]);
    });
  });
});

describe("check-boundaries relative-import resolution", () => {
  it.each([
    ["src/engine/session.ts", "./matcher", false],
    ["src/engine/session.ts", "../content/lessons/meadow", false],
    ["src/engine/session.ts", "../render/mesher/voxel-grid", false],
    ["src/content/blocks/types.ts", "../../render/atlas/recipes", false],
    ["src/save/schema.ts", "../render/mesher/voxel-grid.ts", false],
    ["src/render/mesher/mesh.ts", "../atlas/recipes", false],
    ["src/engine/session.ts", "../ui/hud/bridge", true],
    ["src/engine/session.ts", "../app/clock", true],
    ["src/engine/session.ts", "../audio", true],
    ["src/render/mesher/mesh.ts", "../atlas/build", true],
    ["src/render/mesher/mesh.ts", "..", true],
    ["src/render/atlas/recipes.ts", "./painters", true],
  ] as const)("%s importing %s → forbidden=%s", (file, spec, forbidden) => {
    const found = checkSource(file, `import { x } from "${spec}";\nexport const y = x;\n`);
    expect(found.map((v) => v.rule)).toEqual(forbidden ? ["relative-import"] : []);
  });
});
