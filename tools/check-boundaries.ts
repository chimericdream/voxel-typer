/**
 * Purity-zone checks that Oxlint can't express (docs/impl/contracts.md §0, PLAN.md §6.3).
 *
 * The pure-zone list lives in ONE place: the `files` of the `.oxlintrc.json` override that sets
 * `no-restricted-imports`. This script, Oxlint and tests/unit/purity.test.ts all read it. To make a
 * file pure, add its path (or a folder glob) to that `files` array; nothing else needs editing.
 *
 * Oxlint (that override) turns the browser env off, so unknown browser globals fail `no-undef`, and
 * bans by name: the globals in `no-restricted-globals` (globalThis, window, fetch, crypto, timers ...),
 * the properties in `no-restricted-properties` (Date.now, Math.random, performance.now,
 * Intl.DateTimeFormat), and imports of three / preact / idb (even `import type`).
 *
 * This script adds, using an AST from oxc-parser:
 *   1. The import allow-list. Every import / export-from / dynamic import() / `import x = require()`
 *      / `typeof import()` specifier in a pure file is resolved (`@/` → `src/`, relative paths, `..`).
 *      It passes only if it is
 *        (a) a file in a pure zone,
 *        (b) type-only (`import type`, `export type`, every specifier inline `type`, `typeof import()`)
 *            of any file in the repo, or
 *        (c) a package on PURE_PACKAGES (empty for now).
 *      Anything else fails: impure files (which may pull in three, idb or the DOM transitively),
 *      every other npm package, `node:` builtins, URLs, Vite `?query` imports, computed `import()`.
 *   2. Banned globals reached through a global object (`globalThis.fetch`, `self["navigator"]`,
 *      `globalThis.Intl.DateTimeFormat`). The names come from the same Oxlint override.
 *   3. Wall-clock reads with no arguments: `new Date()` and `Date()` (same thing as Date.now()).
 *
 *   npm run tool -- check-boundaries            # scans the repo
 *   npm run tool -- check-boundaries --root DIR # scans another tree laid out like the repo (tests)
 */
import { globSync, readFileSync, statSync } from "node:fs";
import { dirname, join, matchesGlob, posix, relative, resolve } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { parseSync, Visitor, type Expression, type MemberExpression, type Span } from "oxc-parser";

export interface Violation {
  file: string; // posix path relative to root
  line: number;
  column: number;
  rule: "impure-import" | "package-import" | "global-object-access" | "wall-clock" | "parse-error";
  message: string;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(REPO_ROOT, ".oxlintrc.json");

/**
 * npm packages pure code may import (by name; subpaths of a listed package are allowed too).
 * Keep it empty unless a package is provably pure: no DOM, no clock, no randomness, no I/O.
 */
export const PURE_PACKAGES: readonly string[] = [];

/** Objects that expose the globals: `globalThis.document`, `self.navigator` ... */
const GLOBAL_OBJECTS = new Set(["globalThis", "self", "window", "global", "frames"]);

/** Extensions tried, in TypeScript "bundler" order, when a specifier has none. */
const EXTS = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const JS_TO_TS: Record<string, readonly string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

export interface PureConfig {
  /** Pure-zone globs, posix, relative to the repo root. */
  globs: readonly string[];
  /** Global names pure code may not touch, also through `globalThis.x`. */
  globals: ReadonlySet<string>;
  /** object → banned properties (`Date` → `now`), also through `globalThis.Date.now`. */
  properties: ReadonlyMap<string, ReadonlySet<string>>;
}

const toPosix = (p: string): string => p.replaceAll("\\", "/");

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The rule's option objects, skipping the severity: `["error", {...}, {...}]` → the objects. */
const ruleOptions = (rule: unknown): Record<string, unknown>[] =>
  Array.isArray(rule) ? rule.filter(isRecord) : [];

/** Reads the pure-zone override (the one that sets `no-restricted-imports`) of `.oxlintrc.json`. */
export function loadPureConfig(configPath = CONFIG_PATH): PureConfig {
  const config: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  const overrides =
    isRecord(config) && Array.isArray(config["overrides"]) ? config["overrides"] : [];
  for (const o of overrides) {
    if (!isRecord(o) || !isRecord(o["rules"]) || !("no-restricted-imports" in o["rules"])) continue;
    const files = o["files"];
    if (!Array.isArray(files) || files.length === 0 || !files.every((g) => typeof g === "string")) {
      continue;
    }
    const rules = o["rules"];
    const globals = new Set<string>();
    for (const opt of ruleOptions(rules["no-restricted-globals"])) {
      if (typeof opt["name"] === "string") globals.add(opt["name"]);
    }
    const properties = new Map<string, Set<string>>();
    for (const opt of ruleOptions(rules["no-restricted-properties"])) {
      const obj = opt["object"];
      const prop = opt["property"];
      if (typeof obj !== "string" || typeof prop !== "string") continue;
      const set = properties.get(obj) ?? new Set<string>();
      set.add(prop);
      properties.set(obj, set);
    }
    return { globs: files, globals, properties };
  }
  throw new Error(`No pure-zone override (no-restricted-imports) in ${configPath}`);
}

/** Pure-zone globs: the `files` of the `.oxlintrc.json` override that sets `no-restricted-imports`. */
export function pureZoneGlobs(configPath = CONFIG_PATH): readonly string[] {
  return loadPureConfig(configPath).globs;
}

export function isInZone(relPath: string, globs: readonly string[]): boolean {
  const p = toPosix(relPath);
  return globs.some((g) => matchesGlob(p, g));
}

/** Files a module path may resolve to, in resolution order. */
function candidates(target: string): string[] {
  const ext = posix.extname(target);
  const swapped = (JS_TO_TS[ext] ?? []).map((e) => target.slice(0, -ext.length) + e);
  return [
    ...swapped,
    target,
    ...EXTS.map((e) => target + e),
    ...EXTS.map((e) => `${target}/index${e}`),
  ];
}

const isFile = (p: string): boolean => statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;

/**
 * True when `target` (posix, relative to the root, already normalized) is a pure-zone file.
 * With a `root`, the first candidate that exists on disk decides, the way the bundler resolves it.
 * If nothing exists (a fixture, or a file not written yet), any pure candidate is enough; an
 * unresolved import fails typecheck anyway.
 */
export function isPureTarget(target: string, globs: readonly string[], root?: string): boolean {
  if (target === ".." || target.startsWith("../") || posix.isAbsolute(target)) return false;
  const list = candidates(target);
  if (root !== undefined) {
    const hit = list.find((c) => isFile(join(root, c)));
    if (hit !== undefined) return isInZone(hit, globs);
  }
  return list.some((c) => isInZone(c, globs));
}

/** Where an internal specifier points, relative to the root; null for a bare/package specifier. */
export function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return posix.normalize(`src/${spec.slice(2)}`);
  if (spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../")) {
    return posix.normalize(posix.join(posix.dirname(toPosix(fromFile)), spec));
  }
  return null;
}

const packageAllowed = (spec: string): boolean =>
  PURE_PACKAGES.some((p) => spec === p || spec.startsWith(`${p}/`));

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

const RULE_TEXT =
  "Pure files may import only other pure-zone files, `import type` from anywhere, " +
  "and packages on PURE_PACKAGES in tools/check-boundaries.ts (PLAN.md §6.3).";

export interface CheckOptions {
  /** Tree the file lives in; enables on-disk resolution of imports. */
  root?: string;
  config?: PureConfig;
}

export function checkSource(relPath: string, source: string, opts: CheckOptions = {}): Violation[] {
  const file = toPosix(relPath);
  const { globs, globals, properties } = opts.config ?? loadPureConfig();
  const out: Violation[] = [];
  const report = (node: Span, rule: Violation["rule"], message: string): void => {
    out.push({ file, ...lineCol(source, node.start), rule, message });
  };

  const parsed = parseSync(file, source);
  for (const err of parsed.errors) {
    out.push({ file, line: 1, column: 1, rule: "parse-error", message: err.message });
  }

  const checkSpecifier = (node: Expression, typeOnly: boolean): void => {
    if (node.type !== "Literal" || typeof node.value !== "string") {
      report(
        node,
        "impure-import",
        `Pure zone: ${file} has an import() with a computed specifier, which can't be checked. ${RULE_TEXT}`,
      );
      return;
    }
    const spec = node.value;
    const target = resolveSpecifier(file, spec);
    if (target === null) {
      if (packageAllowed(spec)) return;
      report(
        node,
        "package-import",
        `Pure zone: ${file} imports package "${spec}", which is not on PURE_PACKAGES. ${RULE_TEXT}`,
      );
      return;
    }
    if (spec.includes("?")) {
      report(
        node,
        "impure-import",
        `Pure zone: ${file} imports "${spec}"; Vite ?query imports are not pure. ${RULE_TEXT}`,
      );
      return;
    }
    if (typeOnly && !target.startsWith("../") && target !== "..") return;
    if (isPureTarget(target, globs, opts.root)) return;
    report(
      node,
      "impure-import",
      `Pure zone: ${file} imports "${spec}" (→ ${target}), which is not in a pure zone. ${RULE_TEXT}`,
    );
  };

  const visitor = new Visitor({
    ImportDeclaration(n) {
      const inlineTypes =
        n.specifiers.length > 0 &&
        n.specifiers.every((s) => s.type === "ImportSpecifier" && s.importKind === "type");
      checkSpecifier(n.source, n.importKind === "type" || inlineTypes);
    },
    ExportNamedDeclaration(n) {
      if (n.source === null) return;
      const inlineTypes =
        n.specifiers.length > 0 && n.specifiers.every((s) => s.exportKind === "type");
      checkSpecifier(n.source, n.exportKind === "type" || inlineTypes);
    },
    ExportAllDeclaration: (n) => checkSpecifier(n.source, n.exportKind === "type"),
    ImportExpression: (n) => checkSpecifier(n.source, false),
    TSImportType: (n) => checkSpecifier(n.source, true),
    TSImportEqualsDeclaration(n) {
      if (n.moduleReference.type !== "TSExternalModuleReference") return;
      checkSpecifier(n.moduleReference.expression, n.importKind === "type");
    },
    MemberExpression(m) {
      const name = propName(m);
      if (name === null) return;
      // globalThis.document, self["navigator"], window.fetch ...
      if (isGlobalObject(m.object) && globals.has(name)) {
        report(
          m,
          "global-object-access",
          `Pure zone: no DOM, network, storage or timer globals (${name}). Pass what you need in as a parameter.`,
        );
        return;
      }
      // globalThis.performance.now, self.Math.random, globalThis.Intl.DateTimeFormat ...
      const inner = m.object;
      if (inner.type !== "MemberExpression") return;
      const innerName = propName(inner);
      if (innerName && isGlobalObject(inner.object) && properties.get(innerName)?.has(name)) {
        report(
          m,
          "global-object-access",
          `Pure zone: ${innerName}.${name} is banned; take time, randomness or formatting as a parameter.`,
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
export function checkBoundaries(root: string = REPO_ROOT, configPath = CONFIG_PATH): Violation[] {
  const config = loadPureConfig(configPath);
  const files = globSync("src/**/*.{ts,tsx,mts,cts,js,jsx,mjs}", { cwd: root })
    .map(toPosix)
    .filter((f) => isInZone(f, config.globs))
    .toSorted();
  return files.flatMap((f) =>
    checkSource(f, readFileSync(join(root, f), "utf8"), { root, config }),
  );
}

function main(): void {
  const i = argv.indexOf("--root");
  const rootArg = i >= 0 ? argv[i + 1] : undefined;
  const root = rootArg ? resolve(rootArg) : REPO_ROOT;
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
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
