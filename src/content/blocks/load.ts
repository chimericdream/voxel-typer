/**
 * Block loader for callers that can't use `import.meta.glob` (tools under tsx, Node scripts). Pure.
 *
 * The app imports `blocks` from `./index`. A tool loads the block files itself and passes them in;
 * `../lessons/load.ts` shows how.
 */
import { collectExport, hasStringId } from "../collect";
import type { BlockDef } from "./types";

// Shallow on purpose. The registry invariants test (M2-04) checks blocks in depth.
const isBlockDef = (v: unknown): v is BlockDef => hasStringId(v);

/**
 * Every block of the given modules (`{ [path]: module }`, each exporting `blocks: BlockDef[]`),
 * ordered by file path, then by position in the file. Non-data files are skipped. Throws on a
 * missing `blocks` export or a duplicate block id.
 */
export function blocksFromModules(modules: Readonly<Record<string, unknown>>): BlockDef[] {
  return collectExport(modules, "blocks", isBlockDef);
}
