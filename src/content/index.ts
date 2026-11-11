/**
 * Game content: lessons, blocks, layouts, loot tables. All of it is pure data and pure functions.
 *
 * Vite only, because the lesson and block aggregators use `import.meta.glob`. Tools import the
 * `load.ts` of the folder they need (see `./collect`).
 */
export * from "./blocks";
export * from "./collect";
export * from "./layouts";
export * from "./lessons";
export * from "./loot/types";
