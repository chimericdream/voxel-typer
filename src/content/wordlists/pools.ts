/**
 * Word pools shipped with the game (docs/impl/contracts.md §0 and §5).
 *
 * To add a list: put `<pool-id>.txt` in this folder and append ONE line with its id to `POOL_IDS`.
 * Append only; don't reorder or edit other lines. `./README.md` explains the file format.
 *
 * Vite only: `import.meta.glob` does not exist under tsx. Tools read the `.txt` files with
 * `node:fs` and use `./loader` (see `tools/validate-wordlists.ts`). The glob skips
 * `blocklist.txt`, so the safety blocklist never reaches the browser bundle.
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
] as const;

export type PoolId = (typeof POOL_IDS)[number];

/** Every shipped pool, in `POOL_IDS` order. */
export const wordPools: readonly WordPool[] = poolsFromTexts(
  import.meta.glob<string>(["./*.txt", "!./blocklist.txt"], {
    eager: true,
    query: "?raw",
    import: "default",
  }),
  POOL_IDS,
);
