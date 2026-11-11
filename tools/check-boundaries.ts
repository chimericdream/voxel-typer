/**
 * Purity-zone checks that Oxlint can't express (docs/impl/contracts.md §0, PLAN.md §6.3).
 *
 * Oxlint (`.oxlintrc.json`, the pure-zone override) already bans, by import string or bare name:
 *   - imports of three / preact / @preact/* / idb / @/ui / @/audio / @/app / @/render (minus the pure parts),
 *     including `import type`, re-exports and dynamic `import()`;
 *   - the globals window, document, navigator, localStorage, indexedDB;
 *   - Date.now, Math.random, performance.now (incl. destructuring and `Math["random"]`).
 *
 * This script covers the gaps, using an AST from oxc-parser:
 *   1. RELATIVE imports that resolve into a forbidden folder (`../ui/x` from src/engine/), which
 *      Oxlint can't see because it matches the import string, not the resolved path.
 *   2. Banned globals reached through a global object: `globalThis.document`, `self.navigator`,
 *      `window["localStorage"]`, `globalThis.performance.now()`, `globalThis.Math.random()`.
 *   3. Wall-clock reads with no arguments: `new Date()` and `Date()` (same thing as Date.now()).
 *
 * The zone globs are read from `.oxlintrc.json`, so there is one list to edit.
 *
 *   npm run tool -- check-boundaries            # scans the repo
 *   npm run tool -- check-boundaries --root DIR # scans another tree laid out like the repo (tests)
 */
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative, resolve } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { parseSync, Visitor, type Expression, type MemberExpression, type Span } from "oxc-parser";

export interface Violation {
  file: string; // posix path relative to root
  line: number;
  column: number;
  rule: "relative-import" | "global-object-access" | "wall-clock" | "parse-error";
  message: string;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Folders a pure file may not reach, and the pure exceptions inside them. */
const FORBIDDEN_DIRS = ["src/ui", "src/audio", "src/app", "src/render"] as const;
const ALLOWED_INSIDE_FORBIDDEN = ["src/render/mesher"] as const;
const ALLOWED_FILES = ["src/render/atlas/recipes"] as const;

const BANNED_GLOBALS = new Set(["window", "document", "navigator", "localStorage", "indexedDB"]);
const BANNED_PROPERTIES: Record<string, ReadonlySet<string>> = {
  Date: new Set(["now"]),
  Math: new Set(["random"]),
  performance: new Set(["now"]),
};
const GLOBAL_OBJECTS = new Set(["globalThis", "self", "window", "global", "frames"]);

const toPosix = (p: string): string => p.replaceAll("\\", "/");

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Pure-zone globs: the `files` of the `.oxlintrc.json` override that sets `no-restricted-imports`. */
export function pureZoneGlobs(configPath = join(REPO_ROOT, ".oxlintrc.json")): string[] {
  const config: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  const overrides =
    isRecord(config) && Array.isArray(config["overrides"]) ? config["overrides"] : [];
  for (const o of overrides) {
    if (!isRecord(o) || !isRecord(o["rules"]) || !("no-restricted-imports" in o["rules"])) continue;
    const files = o["files"];
    if (Array.isArray(files) && files.length > 0 && files.every((g) => typeof g === "string")) {
      return files;
    }
  }
  throw new Error(`No pure-zone override (no-restricted-imports) in ${configPath}`);
}

export function isInZone(relPath: string, globs: readonly string[]): boolean {
  const p = toPosix(relPath);
  return globs.some((g) => matchesGlob(p, g));
}

/** True when a pure file may not import `targetRel` (posix, relative to root, extension optional). */
export function isForbiddenTarget(targetRel: string): boolean {
  const noExt = toPosix(targetRel)
    .replace(/\.(d\.)?[cm]?[jt]sx?$/, "")
    .replace(/\/index$/, "");
  const under = (dir: string): boolean => noExt === dir || noExt.startsWith(`${dir}/`);
  if (ALLOWED_FILES.some((f) => noExt === f)) return false;
  if (ALLOWED_INSIDE_FORBIDDEN.some(under)) return false;
  return FORBIDDEN_DIRS.some(under);
}

function lineCol(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: offset - last };
}

/** The property name of `a.b` or `a["b"]`, or null for anything dynamic. */
function propName(m: MemberExpression): string | null {
  if (m.type !== "MemberExpression") return null;
  if (!m.computed) return m.property.type === "Identifier" ? m.property.name : null;
  const p = m.property;
  return p.type === "Literal" && typeof p.value === "string" ? p.value : null;
}

const isGlobalObject = (n: Expression): boolean =>
  n.type === "Identifier" && GLOBAL_OBJECTS.has(n.name);

const isBareDateCall = (callee: Expression, args: readonly unknown[]): boolean =>
  callee.type === "Identifier" && callee.name === "Date" && args.length === 0;

export function checkSource(relPath: string, source: string): Violation[] {
  const file = toPosix(relPath);
  const out: Violation[] = [];
  const report = (node: Span, rule: Violation["rule"], message: string): void => {
    out.push({ file, ...lineCol(source, node.start), rule, message });
  };

  const parsed = parseSync(file, source);
  for (const err of parsed.errors) {
    out.push({ file, line: 1, column: 1, rule: "parse-error", message: err.message });
  }

  const checkSpecifier = (node: Expression | null): void => {
    if (node?.type !== "Literal" || typeof node.value !== "string") return;
    const spec = node.value;
    if (!spec.startsWith(".")) return;
    const target = toPosix(join(dirname(file), spec));
    if (isForbiddenTarget(target)) {
      report(
        node,
        "relative-import",
        `Pure zone: "${spec}" resolves to ${target}, which pure code may not import.`,
      );
    }
  };

  const visitor = new Visitor({
    ImportDeclaration: (n) => checkSpecifier(n.source),
    ExportNamedDeclaration: (n) => checkSpecifier(n.source),
    ExportAllDeclaration: (n) => checkSpecifier(n.source),
    ImportExpression: (n) => checkSpecifier(n.source),
    TSImportType: (n) => checkSpecifier(n.source),
    MemberExpression(m) {
      const name = propName(m);
      if (name === null) return;
      // globalThis.document, self["navigator"], window.localStorage ...
      if (isGlobalObject(m.object) && BANNED_GLOBALS.has(name)) {
        report(
          m,
          "global-object-access",
          `Pure zone: no DOM/storage globals (${name}). Pass what you need in as a parameter.`,
        );
        return;
      }
      // globalThis.performance.now, self.Math.random, globalThis.Date.now ...
      const inner = m.object;
      if (inner.type !== "MemberExpression") return;
      const innerName = propName(inner);
      if (innerName && isGlobalObject(inner.object) && BANNED_PROPERTIES[innerName]?.has(name)) {
        report(
          m,
          "global-object-access",
          `Pure zone: ${innerName}.${name} is banned; take time/randomness as a parameter.`,
        );
      }
    },
    NewExpression(n) {
      if (isBareDateCall(n.callee, n.arguments)) {
        report(
          n,
          "wall-clock",
          "Pure zone: `new Date()` reads the clock; take time as a parameter.",
        );
      }
    },
    CallExpression(n) {
      if (isBareDateCall(n.callee, n.arguments)) {
        report(n, "wall-clock", "Pure zone: `Date()` reads the clock; take time as a parameter.");
      }
    },
  });
  visitor.visit(parsed.program);
  return out;
}

/** Scans every pure-zone source file under `root`. */
export function checkBoundaries(
  root: string = REPO_ROOT,
  configPath = join(REPO_ROOT, ".oxlintrc.json"),
): Violation[] {
  const globs = pureZoneGlobs(configPath);
  const files = globSync("src/**/*.{ts,tsx,mts,cts,js,jsx,mjs}", { cwd: root })
    .map(toPosix)
    .filter((f) => isInZone(f, globs))
    .toSorted();
  return files.flatMap((f) => checkSource(f, readFileSync(join(root, f), "utf8")));
}

function main(): void {
  const i = argv.indexOf("--root");
  const rootArg = i >= 0 ? argv[i + 1] : undefined;
  const root = rootArg ? resolve(rootArg) : REPO_ROOT;
  if (!existsSync(root)) {
    console.error(`No such directory: ${root}`);
    exit(2);
  }
  const violations = checkBoundaries(root);
  for (const v of violations) {
    console.error(`${v.file}:${v.line}:${v.column}: error boundaries(${v.rule}): ${v.message}`);
  }
  if (violations.length > 0) {
    console.error(`\ncheck-boundaries: ${violations.length} violation(s) in pure zones.`);
    exit(1);
  }
  console.log(`check-boundaries: pure zones clean (${relative(process.cwd(), root) || "."}).`);
}

if (resolve(argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
