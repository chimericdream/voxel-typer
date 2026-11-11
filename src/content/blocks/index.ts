/**
 * Block aggregator (docs/impl/contracts.md §0). Add a group as `./<group>.ts` (`terrain.ts`,
 * `ores.ts`, `wood.ts`, …) exporting `blocks: BlockDef[]`; never edit this file.
 *
 * Vite only: `import.meta.glob` does not exist under tsx. Tools use `blocksFromModules` from
 * `./load` (see that file).
 */
import { blocksFromModules } from "./load";
import type { BlockDef } from "./types";

/** Every block, ordered by file path, then by position in the file. */
export const blocks: readonly BlockDef[] = blocksFromModules(
  import.meta.glob(["./*.ts", "!./index.ts"], { eager: true }),
);

export * from "./load";
export * from "./types";
