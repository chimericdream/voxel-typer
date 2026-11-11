/**
 * Proves the purity zones (docs/impl/contracts.md §0, PLAN.md §6.3) can't silently break.
 *
 * Each fixture in tests/fixtures/purity/cases/ holds one violation. For every case the test builds a
 * throwaway tree laid out like the repo, copies the fixture into every pure location and into some
 * impure ones, then runs the real `.oxlintrc.json` (minus its ignore list and type-aware mode) and
 * tools/check-boundaries.ts over it. The banned thing must error in every pure location and must not
 * trip a purity rule anywhere else.
 *
 * The pure locations come from the one pure-zone list (the `.oxlintrc.json` override that
 * check-boundaries reads), so a newly listed pure file is covered without editing this test.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkBoundaries,
  checkSource,
  pureZoneGlobs,
  type Violation,
} from "../../tools/check-boundaries";

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
const UNDEFINED_GLOBAL: Expect = { tool: "oxlint", rule: "eslint(no-undef)" };
const TYPE_SIDE_EFFECT: Expect = {
  tool: "oxlint",
  rule: "typescript(no-import-type-side-effects)",
};
const IMPURE_IMPORT: Expect = { tool: "boundaries", rule: "impure-import" };
const PACKAGE_IMPORT: Expect = { tool: "boundaries", rule: "package-import" };
const GLOBAL_OBJECT: Expect = { tool: "boundaries", rule: "global-object-access" };

/** fixture name → what must fire inside a pure zone (null = nothing may fire). */
const CASES: Record<string, Expect> = {
  // Packages: named by Oxlint (even `import type`); the allow-list rejects them too.
  "import-three": RESTRICTED_IMPORTS,
  "import-three-type": RESTRICTED_IMPORTS,
  "import-three-dynamic": RESTRICTED_IMPORTS,
  "reexport-three": RESTRICTED_IMPORTS,
  "import-preact": RESTRICTED_IMPORTS,
  "import-preact-hooks": RESTRICTED_IMPORTS,
  "import-preact-signals": RESTRICTED_IMPORTS,
  "import-idb": RESTRICTED_IMPORTS,
  "import-three-addons": RESTRICTED_IMPORTS,
  "import-preact-deep": RESTRICTED_IMPORTS,
  "import-preact-signals-deep": RESTRICTED_IMPORTS,
  "import-package": PACKAGE_IMPORT,
  "import-package-type": PACKAGE_IMPORT,
  "import-node-builtin": PACKAGE_IMPORT,
  // Internal modules: the check-boundaries allow-list, by resolved path.
  "import-alias-ui": IMPURE_IMPORT,
  "import-alias-audio": IMPURE_IMPORT,
  "import-alias-app": IMPURE_IMPORT,
  "import-alias-render": IMPURE_IMPORT,
  "import-alias-ui-deep": IMPURE_IMPORT,
  "import-alias-render-deep": IMPURE_IMPORT,
  "import-relative-ui": IMPURE_IMPORT,
  "import-alias-dotdot": IMPURE_IMPORT,
  "import-transitive-alias-store": IMPURE_IMPORT,
  "import-transitive-alias-modes": IMPURE_IMPORT,
  "import-transitive-relative": IMPURE_IMPORT,
  "import-transitive-relative-dotdot": IMPURE_IMPORT,
  "import-transitive-alias-dotdot": IMPURE_IMPORT,
  "import-mixed-inline-type": IMPURE_IMPORT,
  "export-star-impure": IMPURE_IMPORT,
  "import-dynamic-impure": IMPURE_IMPORT,
  "import-dynamic-computed": IMPURE_IMPORT,
  "import-inline-type-side-effect": TYPE_SIDE_EFFECT,
  // Globals.
  "global-window": RESTRICTED_GLOBALS,
  "global-document": RESTRICTED_GLOBALS,
  "global-navigator": RESTRICTED_GLOBALS,
  "global-location": RESTRICTED_GLOBALS,
  "global-localstorage": RESTRICTED_GLOBALS,
  "global-sessionstorage": RESTRICTED_GLOBALS,
  "global-indexeddb": RESTRICTED_GLOBALS,
  "global-fetch": RESTRICTED_GLOBALS,
  "global-xmlhttprequest": RESTRICTED_GLOBALS,
  "global-websocket": RESTRICTED_GLOBALS,
  "global-crypto-getrandomvalues": RESTRICTED_GLOBALS,
  "global-crypto-randomuuid": RESTRICTED_GLOBALS,
  "global-settimeout": RESTRICTED_GLOBALS,
  "global-setinterval": RESTRICTED_GLOBALS,
  "global-requestanimationframe": RESTRICTED_GLOBALS,
  "global-unlisted-browser": UNDEFINED_GLOBAL,
  "globalthis-document": GLOBAL_OBJECT,
  "globalthis-fetch": GLOBAL_OBJECT,
  "self-navigator": GLOBAL_OBJECT,
  // Clock, randomness, locale-dependent formatting.
  "date-now": RESTRICTED_PROPS,
  "date-now-destructured": RESTRICTED_PROPS,
  "math-random": RESTRICTED_PROPS,
  "math-random-computed": RESTRICTED_PROPS,
  "performance-now": RESTRICTED_PROPS,
  "intl-datetimeformat": RESTRICTED_PROPS,
  "intl-datetimeformat-destructured": RESTRICTED_PROPS,
  "globalthis-performance-now": GLOBAL_OBJECT,
  "globalthis-intl-datetimeformat": GLOBAL_OBJECT,
  "new-date": { tool: "boundaries", rule: "wall-clock" },
  // Pure → pure, and `import type` / `export type` from impure modules.
  "allowed-pure-imports": null,
};

/** Where a case file lands in the throwaway tree. `{name}` → the case name. */
const PURE_LOCATIONS = pureZoneGlobs().map((g) => {
  if (g.endsWith("/**")) return `${g.slice(0, -3)}/{name}.ts`;
  if (!g.includes("*")) return g;
  throw new Error(`purity.test.ts: teach PURE_LOCATIONS about the zone glob "${g}"`);
});
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
  "eslint(no-undef)",
  "typescript(no-import-type-side-effects)",
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

  it("tests every pure zone", () => {
    expect(PURE_LOCATIONS.length).toBe(pureZoneGlobs().length);
    expect(PURE_LOCATIONS).toContain("src/engine/{name}.ts");
    expect(PURE_LOCATIONS).toContain("src/save/schema.ts");
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

describe("check-boundaries import allow-list", () => {
  it.each([
    // pure → pure, relative and alias
    ["src/engine/session.ts", "./matcher", false],
    ["src/engine/session.ts", "../content/lessons/meadow", false],
    ["src/engine/session.ts", "../render/mesher/voxel-grid", false],
    ["src/content/blocks/types.ts", "../../render/atlas/recipes", false],
    ["src/save/schema.ts", "../render/mesher/voxel-grid.ts", false],
    ["src/save/schema.ts", "./migrations", false],
    ["src/save/migrations.ts", "./schema.js", false],
    ["src/render/mesher/mesh.ts", "../atlas/recipes", false],
    ["src/engine/session.ts", "@/engine/rng", false],
    ["src/engine/session.ts", "@/engine", false],
    ["src/engine/session.ts", "@/content/words/sprout.json", false],
    ["src/engine/session.ts", "@/render/mesher/../mesher/x", false],
    // pure → impure (transitive: these modules may pull in idb, three or the DOM)
    ["src/save/schema.ts", "./store", true],
    ["src/save/schema.ts", "./", true],
    ["src/engine/session.ts", "../save/store", true],
    ["src/engine/session.ts", "../modes/mine", true],
    ["src/engine/session.ts", "../ui/hud/bridge", true],
    ["src/engine/session.ts", "../app/clock", true],
    ["src/engine/session.ts", "../audio", true],
    ["src/engine/session.ts", "../main", true],
    ["src/engine/session.ts", "../../tools/sim", true],
    ["src/engine/session.ts", "../../../outside", true],
    ["src/render/mesher/mesh.ts", "../atlas/build", true],
    ["src/render/mesher/mesh.ts", "..", true],
    ["src/render/atlas/recipes.ts", "./painters", false],
    ["src/engine/session.ts", "@/save/store", true],
    ["src/engine/session.ts", "@/modes/mine", true],
    ["src/engine/session.ts", "@/ui/x", true],
    ["src/engine/session.ts", "@/render", true],
    ["src/engine/session.ts", "@/render/atlas", true],
    ["src/engine/session.ts", "@/engine/../ui/x", true],
    ["src/engine/session.ts", "@/render/mesher/../scene/x", true],
    ["src/engine/session.ts", "@/content/words.txt?raw", true],
  ] as const)("%s importing %s → impure=%s", (file, spec, impure) => {
    const found = checkSource(file, `import { x } from "${spec}";\nexport const y = x;\n`);
    expect(found.map((v) => v.rule)).toEqual(impure ? ["impure-import"] : []);
  });

  it.each([
    ["import type { A } from", []],
    // Allowed here; Oxlint's no-import-type-side-effects then asks for `import type`.
    ["import { type A, type B } from", []],
    ["export type { A } from", []],
    ["export { type A } from", []],
    ["export type * from", []],
    ["import { type A, b } from", ["impure-import"]],
    ["import A from", ["impure-import"]],
    ["import * as A from", ["impure-import"]],
    ["export { A } from", ["impure-import"]],
    ["export * from", ["impure-import"]],
    ["import", ["impure-import"]], // side-effect import
  ] as const)("%s an impure module → %j", (head, rules) => {
    const found = checkSource("src/engine/x.ts", `${head} "@/save/store";\n`);
    expect(found.map((v) => v.rule)).toEqual(rules);
  });

  it("allows `typeof import()` of an impure module and rejects a value import()", () => {
    const src = [
      `export type S = typeof import("@/save/store");`,
      `export const l = () => import("@/save/store");`,
      "",
    ].join("\n");
    expect(checkSource("src/engine/x.ts", src).map((v) => [v.rule, v.line])).toEqual([
      ["impure-import", 2],
    ]);
  });

  it.each(["zod", "zod/mini", "node:fs", "@scope/pkg", "https://example.com/x.js", "#internal"])(
    "rejects package %s, also type-only",
    (spec) => {
      const src = [
        `import { a } from "${spec}";`,
        `import type { B } from "${spec}";`,
        "export const y = a;",
        "",
      ].join("\n");
      expect(checkSource("src/engine/x.ts", src).map((v) => v.rule)).toEqual([
        "package-import",
        "package-import",
      ]);
    },
  );

  it("names the pure file, the specifier and the rule in the message", () => {
    const [v] = checkSource("src/engine/x.ts", `import { s } from "@/save/store";\n`);
    expect(v?.message).toContain("src/engine/x.ts");
    expect(v?.message).toContain('"@/save/store"');
    expect(v?.message).toContain("Pure files may import only other pure-zone files");
  });

  it("resolves on disk when a root is given (src/engine.ts wins over src/engine/index.ts)", () => {
    const root = mkdtempSync(join(tmpdir(), "vt-resolve-"));
    try {
      mkdirSync(join(root, "src/engine"), { recursive: true });
      writeFileSync(join(root, "src/engine/index.ts"), "");
      const src = `import { x } from "@/engine";\nexport const y = x;\n`;
      expect(checkSource("src/content/a.ts", src, { root })).toEqual([]);
      writeFileSync(join(root, "src/engine.ts"), "");
      expect(checkSource("src/content/a.ts", src, { root }).map((v) => v.rule)).toEqual([
        "impure-import",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
