/**
 * i18n key check (docs/impl/contracts.md §11): finds keys the code asks for that have no English
 * text (missing), and English text nothing asks for (unused).
 *
 * It parses every `src/**` `.ts`/`.tsx` file outside `src/i18n/` with oxc-parser and collects:
 *   - `t("ns.key")` calls (also `t('…')` and `` t(`…`) `` without `${}`): the key is used, and
 *     missing if `src/i18n/en/` has no text for it.
 *   - `` t(`ns.biome.${id}`) `` calls: every key starting with the static prefix (`ns.biome.`) counts
 *     as used. Such a key can't be checked for missing.
 *   - any other string literal equal to a defined key, such as `titleKey: "meadow.title"` in content
 *     data: the key is used. Literals that aren't keys are ignored.
 *
 * The English tables come from `<root>/src/i18n/en/index.ts` (its default export). Nested objects
 * give dotted keys: `{ menu: { biome: { meadow: "…" } } }` → `menu.biome.meadow`.
 *
 *   npm run tool -- i18n-keys            # checks the repo; exits 1 on missing or unused keys
 *   npm run tool -- i18n-keys --root DIR # checks another tree laid out like the repo (tests)
 */
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseSync, Visitor, type Span } from "oxc-parser";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Files scanned for key uses, relative to the root. */
export const SOURCE_GLOB = "src/**/*.{ts,tsx}";
/** The string tables themselves are definitions, not uses. */
export const EXCLUDE_GLOB = "src/i18n/**";
/** The English tables' aggregator, relative to the root. */
export const EN_INDEX = "src/i18n/en/index.ts";

/**
 * Keys written before the screen that shows them exists, with the work that will use them. They
 * may be unused without failing the check. A pending key that becomes used (or is deleted) fails the
 * check until its entry here is removed, so this list only shrinks.
 */
export const PENDING_KEYS: Readonly<Record<string, string>> = {
  "common.appName": "title screen and menus (M2)",
  "common.notAffiliated": "the required footer, PLAN.md §1 (M2)",
};

/** Where a key is asked for. */
export interface KeyUse {
  key: string; // the key, or the static prefix for a dynamic `t()` call
  file: string; // posix path relative to root
  line: number;
  column: number;
}

export interface SourceScan {
  /** Static `t()` calls. */
  calls: KeyUse[];
  /** Static prefixes of `t()` calls whose key has `${…}` in it. */
  prefixes: KeyUse[];
  /** Every other string literal (and expression-free template) in the file. */
  literals: Set<string>;
}

export interface KeyReport {
  /** `t()` calls whose key has no English text. */
  missing: KeyUse[];
  /** English keys nothing uses, sorted, not counting pending keys. */
  unused: string[];
  /** Pending keys that are still unused, as allowed. */
  pending: string[];
  /** Pending keys that are used now or no longer defined: remove them from the pending list. */
  stalePending: string[];
  /** Every defined key, sorted. */
  defined: string[];
}

const toPosix = (p: string): string => p.replaceAll("\\", "/");

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

/** Collects the key uses in one source file. Throws on a parse error. */
export function scanSource(file: string, source: string): SourceScan {
  const lang = file.endsWith(".tsx") ? "tsx" : "ts";
  const parsed = parseSync(file, source, { lang, sourceType: "module" });
  const first = parsed.errors[0];
  if (first) throw new Error(`${file}: parse error: ${first.message}`);

  const scan: SourceScan = { calls: [], prefixes: [], literals: new Set() };
  const use = (key: string, node: Span): KeyUse => ({
    key,
    file,
    ...lineCol(source, node.start),
  });

  const visitor = new Visitor({
    CallExpression(call) {
      if (call.callee.type !== "Identifier" || call.callee.name !== "t") return;
      const arg = call.arguments[0];
      if (!arg) return;
      if (arg.type === "Literal" && typeof arg.value === "string") {
        scan.calls.push(use(arg.value, arg));
      } else if (arg.type === "TemplateLiteral") {
        const head = arg.quasis[0]?.value.cooked ?? "";
        if (arg.expressions.length === 0) scan.calls.push(use(head, arg));
        else if (head !== "") scan.prefixes.push(use(head, arg));
      }
    },
    Literal(lit) {
      if (typeof lit.value === "string") scan.literals.add(lit.value);
    },
    TemplateLiteral(tpl) {
      const only = tpl.quasis[0];
      if (tpl.expressions.length === 0 && only?.value.cooked != null) {
        scan.literals.add(only.value.cooked);
      }
    },
  });
  visitor.visit(parsed.program);
  return scan;
}

/** Flattens nested string tables into dotted keys. Non-string, non-object leaves are skipped. */
export function definedKeys(tables: unknown, prefix = ""): string[] {
  if (typeof tables !== "object" || tables === null) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(tables)) {
    const key = prefix === "" ? k : `${prefix}.${k}`;
    if (typeof v === "string") out.push(key);
    else out.push(...definedKeys(v, key));
  }
  return out.toSorted();
}

/**
 * Compares the uses in `scans` against the keys defined in `tables`. Keys in `pending` may be
 * unused.
 */
export function compareKeys(
  tables: unknown,
  scans: readonly SourceScan[],
  pending: Readonly<Record<string, string>> = {},
): KeyReport {
  const defined = definedKeys(tables);
  const known = new Set(defined);
  const used = new Set<string>();
  const prefixes: string[] = [];
  const missing: KeyUse[] = [];
  for (const scan of scans) {
    for (const call of scan.calls) {
      used.add(call.key);
      if (!known.has(call.key)) missing.push(call);
    }
    for (const lit of scan.literals) used.add(lit);
    for (const p of scan.prefixes) prefixes.push(p.key);
  }
  const isPending = (k: string): boolean => Object.hasOwn(pending, k);
  const allUnused = defined.filter((k) => !used.has(k) && !prefixes.some((p) => k.startsWith(p)));
  const stillUnused = new Set(allUnused);
  return {
    missing,
    unused: allUnused.filter((k) => !isPending(k)),
    pending: allUnused.filter(isPending),
    stalePending: Object.keys(pending)
      .filter((k) => !stillUnused.has(k))
      .toSorted(),
    defined,
  };
}

/** Scans the source files under `root`. */
export function scanTree(root: string): SourceScan[] {
  const files = globSync(SOURCE_GLOB, { cwd: root, exclude: [EXCLUDE_GLOB] })
    .map(toPosix)
    .toSorted();
  return files.map((f) => scanSource(f, readFileSync(join(root, f), "utf8")));
}

/** Loads `<root>/src/i18n/en/index.ts`'s default export. */
export async function loadTables(root: string): Promise<unknown> {
  const mod: unknown = await import(pathToFileURL(join(root, EN_INDEX)).href);
  if (typeof mod !== "object" || mod === null || !("default" in mod)) {
    throw new Error(`${EN_INDEX} has no default export`);
  }
  return mod.default;
}

/**
 * Checks the tree under `root` against its own English tables. {@link PENDING_KEYS} applies to the
 * repo only; another root (a test fixture) gets no pending keys unless they're passed in.
 */
export async function checkI18nKeys(
  root: string = REPO_ROOT,
  pending: Readonly<Record<string, string>> = resolve(root) === REPO_ROOT ? PENDING_KEYS : {},
): Promise<KeyReport> {
  return compareKeys(await loadTables(root), scanTree(root), pending);
}

async function main(): Promise<void> {
  const i = argv.indexOf("--root");
  const rootArg = i >= 0 ? argv[i + 1] : undefined;
  const root = rootArg ? resolve(rootArg) : REPO_ROOT;
  if (!existsSync(join(root, EN_INDEX))) {
    console.error(`No ${EN_INDEX} under ${root}`);
    exit(2);
  }
  const report = await checkI18nKeys(root);
  for (const m of report.missing) {
    console.error(
      `${m.file}:${m.line}:${m.column}: error i18n-keys(missing): no English text for "${m.key}".`,
    );
  }
  for (const k of report.unused) {
    console.error(`${EN_INDEX}: error i18n-keys(unused): nothing uses "${k}".`);
  }
  for (const k of report.stalePending) {
    console.error(
      `tools/i18n-keys.ts: error i18n-keys(stale-pending): "${k}" is used or gone now; delete it from PENDING_KEYS.`,
    );
  }
  const where = toPosix(relative(process.cwd(), root)) || ".";
  const { missing, unused, stalePending, pending } = report;
  if (missing.length + unused.length + stalePending.length > 0) {
    console.error(
      `\ni18n-keys: ${missing.length} missing, ${unused.length} unused, ${stalePending.length} stale pending (${where}).`,
    );
    exit(1);
  }
  const pendingNote = pending.length > 0 ? ` (${pending.length} pending)` : "";
  console.log(
    `i18n-keys: ${report.defined.length} keys, none missing, none unused${pendingNote} in ${where}`,
  );
}

if (resolve(argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
