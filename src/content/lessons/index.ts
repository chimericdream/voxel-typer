/**
 * Lesson aggregator (docs/impl/contracts.md §0). Add a biome's lessons as `./<biome>.ts` exporting
 * `lessons: Lesson[]`; never edit this file.
 *
 * Vite only: `import.meta.glob` does not exist under tsx. Tools use `lessonsFromModules` from
 * `./load` (see that file).
 */
import { lessonsFromModules } from "./load";
import type { Lesson } from "./types";

/** Every shipped lesson, ordered by file path, then by position in the file. */
export const lessons: readonly Lesson[] = lessonsFromModules(
  import.meta.glob(["./*.ts", "!./index.ts"], { eager: true }),
);

export * from "./load";
export * from "./types";
