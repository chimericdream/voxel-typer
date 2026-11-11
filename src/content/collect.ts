/**
 * Turns already-loaded content modules into one list. Pure: it does no loading itself.
 *
 * Content folders are one-file-per-area (docs/impl/contracts.md §0). Two callers load those files
 * in two ways and hand the modules to the same collector, so they can't disagree:
 *
 * - The app: `import.meta.glob("./*.ts", { eager: true })` in the folder's `index.ts`. Vite only.
 * - Tools and Node scripts (`tools/*.ts` run under tsx, which has no `import.meta.glob`): list the
 *   folder with `node:fs`, `import()` each file, and pass `{ [path]: module }` to the folder's
 *   `load.ts`. They never import the folder's `index.ts`.
 */

/** Files in a content folder that hold no data: the aggregator, the types and the loader. */
const RESERVED_NAMES: ReadonlySet<string> = new Set(["index", "types", "load"]);

/**
 * True when `path` (any path or glob key; only the file name counts) is a content data file: a
 * `.ts` file that is not `index.ts`, `types.ts`, `load.ts`, a `.d.ts` or a test.
 */
export function isContentDataFile(path: string): boolean {
  const base = path.replaceAll("\\", "/").split("/").pop() ?? "";
  if (!base.endsWith(".ts") || base.endsWith(".d.ts") || base.endsWith(".test.ts")) return false;
  return !RESERVED_NAMES.has(base.slice(0, -".ts".length));
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** True for an object with a string `id`. The shallow shape every content item shares. */
export function hasStringId(v: unknown): v is { id: string } {
  return isRecord(v) && typeof v["id"] === "string";
}

/**
 * Collects the array each data module exports as `exportName` into one list.
 *
 * - `modules` maps a path (or glob key) to its loaded module. Entries that are not data files
 *   ({@link isContentDataFile}) are skipped, so a caller may pass every file in the folder.
 * - The result is ordered by path (code-unit order), then by position in the file. That makes it
 *   the same for Vite's glob and for a directory listing on any OS.
 * - Throws when a data file lacks the export, when an item fails `isItem`, or when two items share
 *   an `id`. The message names the files.
 */
export function collectExport<T extends { id: string }>(
  modules: Readonly<Record<string, unknown>>,
  exportName: string,
  isItem: (v: unknown) => v is T,
): T[] {
  const out: T[] = [];
  const seenIn = new Map<string, string>();
  for (const path of Object.keys(modules).filter(isContentDataFile).toSorted()) {
    const mod = modules[path];
    const list = isRecord(mod) ? mod[exportName] : undefined;
    if (!Array.isArray(list)) {
      throw new Error(`content: ${path} must export an array named "${exportName}"`);
    }
    for (const item of list) {
      if (!isItem(item)) {
        throw new Error(`content: ${path} has an invalid entry in "${exportName}"`);
      }
      const first = seenIn.get(item.id);
      if (first !== undefined) {
        throw new Error(`content: duplicate id "${item.id}" in ${first} and ${path}`);
      }
      seenIn.set(item.id, path);
      out.push(item);
    }
  }
  return out;
}
