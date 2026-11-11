/**
 * `npm run tool -- <name> [...args]` runs `tools/<name>.ts` through tsx.
 * The tool runs as its own process, so it sees itself as the entry module.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = dirname(fileURLToPath(import.meta.url));
const [name, ...args] = process.argv.slice(2);

function listTools(): string {
  return readdirSync(toolsDir)
    .filter((f) => f.endsWith(".ts") && f !== "run.ts")
    .map((f) => `  ${f.slice(0, -3)}`)
    .join("\n");
}

if (!name || !/^[\w-]+$/.test(name)) {
  console.error(`Usage: npm run tool -- <name> [...args]\n\nAvailable tools:\n${listTools()}`);
  process.exit(2);
}

const file = join(toolsDir, `${name}.ts`);
if (!existsSync(file)) {
  console.error(
    `No tool named "${name}" (looked for ${file}).\n\nAvailable tools:\n${listTools()}`,
  );
  process.exit(2);
}

const result = spawnSync(process.execPath, ["--import", "tsx", file, ...args], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
