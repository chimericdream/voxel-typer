/**
 * Save layer: schema, settings, store, ids and migrations (docs/impl/contracts.md §15).
 *
 * This barrel is NOT pure (the store uses IndexedDB). Pure code imports `@/save/schema` or
 * `@/save/migrations` directly.
 */
export * from "./compact";
export * from "./id";
export * from "./migrations";
export * from "./schema";
export * from "./settings";
export * from "./store";
