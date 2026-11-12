/**
 * Checks that the Node pin in `mise.toml` (local machines) matches `.nvmrc` (CI's
 * actions/setup-node), so every computer and every CI job runs the same Node and bundled npm.
 * `npm run lint` runs it.
 *
 *   npm run tool -- check-tool-versions
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The `node = "x.y.z"` value under `[tools]` in a mise.toml, or undefined. */
export function miseNodeVersion(toml: string): string | undefined {
  const tools = /^\[tools\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml)?.[1] ?? "";
  return /^\s*node\s*=\s*"([^"]+)"/m.exec(tools)?.[1];
}

/** Problems found, empty when the pins agree and are exact versions. */
export function checkPins(miseToml: string, nvmrc: string): string[] {
  const mise = miseNodeVersion(miseToml);
  const nvm = nvmrc.trim().replace(/^v/, "");
  const exact = /^\d+\.\d+\.\d+$/;
  const out: string[] = [];
  if (mise === undefined) out.push('mise.toml: no `node = "…"` under [tools]');
  else if (!exact.test(mise)) out.push(`mise.toml: node "${mise}" is not an exact x.y.z version`);
  if (!exact.test(nvm)) out.push(`.nvmrc: "${nvm}" is not an exact x.y.z version`);
  if (mise !== undefined && mise !== nvm) {
    out.push(`mise.toml pins node ${mise} but .nvmrc says ${nvm}; make them match`);
  }
  return out;
}

function main(): void {
  const problems = checkPins(
    readFileSync(join(REPO_ROOT, "mise.toml"), "utf8"),
    readFileSync(join(REPO_ROOT, ".nvmrc"), "utf8"),
  );
  for (const p of problems) console.error(`check-tool-versions: ${p}`);
  if (problems.length > 0) exit(1);
}

if (resolve(argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
