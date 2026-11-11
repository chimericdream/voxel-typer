/**
 * `npm run e2e:docker [-- <playwright args>]`
 *
 * Runs the Playwright suite inside the official Linux image that matches the installed
 * @playwright/test version, with CI=1, so screenshot comparisons run exactly as on CI
 * (docs/impl/README.md §3.7). Never use it to make baselines: those come only from the
 * Update snapshots workflow.
 *
 * The repo is bind-mounted at /work. node_modules lives in a named Docker volume (one per
 * checkout), so the container gets Linux native binaries and never touches the host's
 * node_modules. `npm ci` runs only when package-lock.json changed since the last run.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit, platform } from "node:process";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function playwrightVersion(): string {
  const pkg: unknown = JSON.parse(
    readFileSync(join(repo, "node_modules/@playwright/test/package.json"), "utf8"),
  );
  if (
    typeof pkg === "object" &&
    pkg !== null &&
    "version" in pkg &&
    typeof pkg.version === "string"
  ) {
    return pkg.version;
  }
  throw new Error("Can't read the installed @playwright/test version. Run `npm ci` first.");
}

const version = playwrightVersion();
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const volume = `voxel-typer-e2e-nm-${createHash("sha256").update(repo.toLowerCase()).digest("hex").slice(0, 12)}`;
const pwArgs = argv
  .slice(2)
  .map((a) => `'${a.replaceAll("'", `'\\''`)}'`)
  .join(" ");

// On Linux/macOS hosts, hand files written into the bind mount back to the host user.
const chown =
  platform === "win32" || typeof process.getuid !== "function"
    ? ""
    : `; chown -R ${process.getuid()}:${process.getgid?.() ?? 0} dist-test test-results playwright-report blob-report 2>/dev/null || true`;

const script = [
  "set -e",
  'want="$(sha256sum package-lock.json | cut -d" " -f1)"',
  'have="$(cat node_modules/.vt-lock-hash 2>/dev/null || true)"',
  'if [ "$want" != "$have" ]; then npm ci --no-audit --no-fund && echo "$want" > node_modules/.vt-lock-hash; fi',
  `set +e; npx playwright test ${pwArgs}; status=$?${chown}`,
  "exit $status",
].join("\n");

console.log(`e2e:docker → ${image} (node_modules volume ${volume})`);
const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--init",
    "--ipc=host",
    "-e",
    "CI=1",
    "-v",
    `${repo}:/work`,
    "-v",
    `${volume}:/work/node_modules`,
    "-w",
    "/work",
    image,
    "bash",
    "-c",
    script,
  ],
  { stdio: "inherit" },
);
if (result.error) {
  console.error(`Couldn't start docker: ${result.error.message}. Is Docker running?`);
  exit(2);
}
exit(result.status ?? 1);
