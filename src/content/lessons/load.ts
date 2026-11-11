/**
 * Lesson loader for callers that can't use `import.meta.glob` (tools under tsx, Node scripts). Pure.
 *
 * The app imports `lessons` from `./index`. A tool loads the lesson files itself and passes them in:
 *
 * ```ts
 * const dir = "src/content/lessons";
 * const modules: Record<string, unknown> = {};
 * for (const name of readdirSync(dir).filter(isContentDataFile)) {
 *   modules[`./${name}`] = await import(pathToFileURL(join(dir, name)).href);
 * }
 * const lessons = lessonsFromModules(modules);
 * ```
 */
import { collectExport, hasStringId } from "../collect";
import type { Lesson } from "./types";

// Shallow on purpose. The curriculum validator (M3-01) checks lessons in depth.
const isLesson = (v: unknown): v is Lesson => hasStringId(v);

/**
 * Every lesson of the given modules (`{ [path]: module }`, each exporting `lessons: Lesson[]`),
 * ordered by file path, then by position in the file. Non-data files are skipped. Throws on a
 * missing `lessons` export or a duplicate lesson id.
 */
export function lessonsFromModules(modules: Readonly<Record<string, unknown>>): Lesson[] {
  return collectExport(modules, "lessons", isLesson);
}
