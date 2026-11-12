/**
 * Word pools shipped with the game (docs/impl/contracts.md §0 and §5).
 *
 * To add a list: put `<pool-id>.txt` in this folder and append ONE line with its id to `POOL_IDS`.
 * Append only; don't reorder or edit other lines. `./README.md` explains the file format.
 *
 * Vite only: `import.meta.glob` does not exist under tsx. Tools read the `.txt` files with
 * `node:fs` and use `./loader` (see `tools/validate-wordlists.ts`). The glob skips
 * `blocklist.txt`, so the safety blocklist never reaches the browser bundle. Sentence lists live in
 * `../sentences/` (M5-05) and are registered here like any other pool.
 */
import type { WordPool } from "@/engine/generator";
import { poolsFromTexts } from "./loader";

/**
 * Every shipped pool id, one per line, append only. Each has a `<id>.txt` in this folder.
 * The ignore comment keeps the formatter from joining the lines, which would make parallel
 * additions conflict.
 */
// oxfmt-ignore
export const POOL_IDS = [
  "sight-dolch",
  "home-row",
  "meadow-phrases",
  "birch-sprout",
  "birch-miner",
  "birch-builder",
  "birch-phrases-miner",
  "birch-phrases-builder",
  "shore-sprout",
  "shore-miner",
  "shore-builder",
  "shore-phrases-miner",
  "shore-phrases-builder",
  "frosty-sprout",
  "frosty-miner",
  "frosty-builder",
  "frosty-phrases-miner",
  "frosty-phrases-builder",
  "meadow-gh-phrases",
  "theme-blocks",
  "theme-animals",
  "theme-colors",
  "theme-food",
  "theme-tools",
  "theme-nature",
  "mines-sprout",
  "mines-miner",
  "mines-builder",
  "mines-phrases-sprout",
  "mines-phrases-miner",
  "mines-phrases-builder",
  "marsh-sprout",
  "marsh-miner",
  "marsh-builder",
  "marsh-drills",
  "marsh-phrases-sprout",
  "marsh-phrases-miner",
  "marsh-phrases-builder",
  "caverns-sprout",
  "caverns-miner",
  "caverns-builder",
  "caverns-phrases-sprout",
  "caverns-phrases-miner",
  "caverns-phrases-builder",
  "sparkstone-sprout",
  "sparkstone-miner",
  "sparkstone-builder",
  "sparkstone-code-sprout",
  "sparkstone-code-miner",
  "sparkstone-code-builder",
  "citadel-sprout",
  "citadel-miner",
  "citadel-builder",
  "citadel-phrases-miner",
  "citadel-phrases-builder",
  "frosty-sentences-miner",
  "frosty-sentences-builder",
  "mines-sentences-sprout",
  "mines-sentences-miner",
  "mines-sentences-builder",
  "marsh-sentences-sprout",
  "marsh-sentences-miner",
  "marsh-sentences-builder",
  "caverns-sentences-sprout",
  "caverns-sentences-miner",
  "caverns-sentences-builder",
  "sparkstone-sentences-sprout",
  "sparkstone-sentences-miner",
  "sparkstone-sentences-builder",
  "citadel-sentences-sprout",
  "citadel-sentences-miner",
  "citadel-sentences-builder",
  "birch-phrases-sprout",
  "shore-phrases-sprout",
  "frosty-phrases-sprout",
] as const;

export type PoolId = (typeof POOL_IDS)[number];

/** Every shipped pool, in `POOL_IDS` order. */
export const wordPools: readonly WordPool[] = poolsFromTexts(
  import.meta.glob<string>(["./*.txt", "../sentences/*.txt", "!./blocklist.txt"], {
    eager: true,
    query: "?raw",
    import: "default",
  }),
  POOL_IDS,
);
