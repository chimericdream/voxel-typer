/**
 * Checks that a production build holds no test hooks (task M2-10, docs/impl/contracts.md §13).
 *
 * `window.__vt` and the fixture-profile loader exist only when `import.meta.env.MODE !==
 * 'production'`. This scans every text file in `dist/` for the hook's name and for the fixture
 * path, and fails if either appears. `npm run build` runs it after `vite build`.
 *
 *   npm run tool -- check-dist-hooks            # scans dist/
 *   npm run tool -- check-dist-hooks --dir DIR  # scans another folder (tests)
 */
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Strings that must never ship. */
export const FORBIDDEN: readonly string[] = ["__vt", "tests/fixtures"];

const TEXT_FILES = "**/*.{js,mjs,css,html,json,map,txt,webmanifest}";

/** `file: needle` for every forbidden string found under `dir`. */
export function findTestHooks(dir: string): string[] {
  const out: string[] = [];
  for (const f of globSync(TEXT_FILES, { cwd: dir }).toSorted()) {
    if (f.endsWith(".map")) continue; // sourcemaps aren't built for production; skip if present
    const text = readFileSync(join(dir, f), "utf8");
    for (const needle of FORBIDDEN) if (text.includes(needle)) out.push(`${f}: ${needle}`);
  }
  return out;
}

function main(): void {
  const i = argv.indexOf("--dir");
  const dirArg = i >= 0 ? argv[i + 1] : undefined;
  const dir = dirArg ? resolve(dirArg) : join(REPO_ROOT, "dist");
  if (!existsSync(dir)) {
    console.error(`check-dist-hooks: no such directory: ${dir} (run vite build first)`);
    exit(2);
  }
  const found = findTestHooks(dir);
  for (const f of found) console.error(`check-dist-hooks: ${f}`);
  if (found.length > 0) {
    console.error(`\ncheck-dist-hooks: the production build contains test hooks.`);
    exit(1);
  }
  console.log("check-dist-hooks: dist/ has no test hooks.");
}

if (resolve(argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
