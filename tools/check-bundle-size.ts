/**
 * Bundle budgets from docs/impl/contracts.md §14.
 *
 *   npm run size                       # checks dist/ (needs `npm run build` first)
 *   npm run size -- --dir dist-test    # another build folder
 *   npm run size -- --markdown out.md  # also write the table as Markdown (for CI comments)
 *
 * When GITHUB_STEP_SUMMARY is set, the Markdown table is appended to the job summary.
 * Exits 1 when any budget is exceeded, 2 when the build is missing.
 */
import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { argv, env, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const KB = 1024;
export const BUDGETS = {
  initialJsGzip: 450 * KB,
  lazyChunkGzip: 250 * KB,
  totalDistGzip: 3 * KB * KB,
} as const;

export interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}
export type Manifest = Record<string, ManifestChunk>;

export interface SizeRow {
  label: string;
  gzip: number;
  budget: number;
  ok: boolean;
}

const gz = (buf: Buffer): number => gzipSync(buf, { level: 9 }).length;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const isJs = (file: string): boolean => /\.m?js$/.test(file);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** Parses Vite's `.vite/manifest.json`, keeping only the fields this tool reads. */
export function parseManifest(json: string): Manifest {
  const raw: unknown = JSON.parse(json);
  if (!isRecord(raw)) throw new Error("Vite manifest is not an object");
  const out: Manifest = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value["file"] !== "string") {
      throw new Error(`Vite manifest entry "${key}" has no "file"`);
    }
    const chunk: ManifestChunk = { file: value["file"] };
    if (value["isEntry"] === true) chunk.isEntry = true;
    if (value["isDynamicEntry"] === true) chunk.isDynamicEntry = true;
    if (isStringArray(value["imports"])) chunk.imports = value["imports"];
    if (isStringArray(value["dynamicImports"])) chunk.dynamicImports = value["dynamicImports"];
    out[key] = chunk;
  }
  return out;
}

/** Keys of every chunk reachable from `startKeys` through static `imports`. */
export function staticClosure(manifest: Manifest, startKeys: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...startKeys];
  for (let key = stack.pop(); key !== undefined; key = stack.pop()) {
    if (seen.has(key)) continue;
    seen.add(key);
    for (const dep of manifest[key]?.imports ?? []) stack.push(dep);
  }
  return seen;
}

export function measure(distDir: string): SizeRow[] {
  const manifestPath = join(distDir, ".vite", "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `No ${relative(".", manifestPath)}. Run \`npm run build\` first (build.manifest must be on).`,
    );
  }
  const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
  const sizeOf = (file: string): number => gz(readFileSync(join(distDir, file)));

  const entryKeys = Object.keys(manifest).filter((k) => manifest[k]?.isEntry);
  const initial = staticClosure(manifest, entryKeys);
  const initialFiles = [
    ...new Set(
      [...initial].map((k) => manifest[k]?.file).filter((f): f is string => !!f && isJs(f)),
    ),
  ];
  const initialGzip = initialFiles.reduce((sum, f) => sum + sizeOf(f), 0);

  const rows: SizeRow[] = [
    {
      label: `Initial JS (${initialFiles.length} chunk${initialFiles.length === 1 ? "" : "s"})`,
      gzip: initialGzip,
      budget: BUDGETS.initialJsGzip,
      ok: initialGzip <= BUDGETS.initialJsGzip,
    },
  ];

  const lazyFiles = new Set<string>();
  for (const [key, chunk] of Object.entries(manifest)) {
    if (!initial.has(key) && isJs(chunk.file)) lazyFiles.add(chunk.file);
  }
  for (const file of [...lazyFiles].toSorted()) {
    const size = sizeOf(file);
    rows.push({
      label: `Lazy: ${file}`,
      gzip: size,
      budget: BUDGETS.lazyChunkGzip,
      ok: size <= BUDGETS.lazyChunkGzip,
    });
  }

  const total = walk(distDir)
    .filter((p) => !p.endsWith(".map") && !relative(distDir, p).startsWith(".vite"))
    .reduce((sum, p) => sum + gz(readFileSync(p)), 0);
  rows.push({
    label: "Total dist/",
    gzip: total,
    budget: BUDGETS.totalDistGzip,
    ok: total <= BUDGETS.totalDistGzip,
  });
  return rows;
}

const fmt = (bytes: number): string => `${(bytes / KB).toFixed(1)} KB`;

export function toText(rows: readonly SizeRow[]): string {
  const header = ["Budget", "gzip", "limit", ""];
  const body = rows.map((r) => [r.label, fmt(r.gzip), fmt(r.budget), r.ok ? "ok" : "OVER"]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => (b[i] ?? "").length)));
  const line = (cells: string[]): string =>
    cells
      .map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0)))
      .join("  ");
  return [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...body.map(line)].join("\n");
}

export function toMarkdown(rows: readonly SizeRow[]): string {
  const lines = ["| Budget | gzip | limit | |", "|---|---:|---:|---|"];
  for (const r of rows)
    lines.push(`| ${r.label} | ${fmt(r.gzip)} | ${fmt(r.budget)} | ${r.ok ? "✅" : "❌ over"} |`);
  return `### Bundle size\n\n${lines.join("\n")}\n`;
}

function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(): void {
  const distDir = resolve(argValue("--dir") ?? "dist");
  let rows: SizeRow[];
  try {
    rows = measure(distDir);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    exit(2);
  }
  console.log(toText(rows));
  const md = toMarkdown(rows);
  const mdOut = argValue("--markdown");
  if (mdOut) writeFileSync(mdOut, md);
  if (env["GITHUB_STEP_SUMMARY"]) appendFileSync(env["GITHUB_STEP_SUMMARY"], md);

  const over = rows.filter((r) => !r.ok);
  if (over.length > 0) {
    console.error(`\n${over.length} budget(s) exceeded (docs/impl/contracts.md §14).`);
    exit(1);
  }
  console.log("\nAll bundle budgets met.");
}

if (resolve(argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
