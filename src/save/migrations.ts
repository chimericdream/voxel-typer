/**
 * Save migrations (docs/impl/contracts.md §15). Pure. Orchestrator-owned after M1-09.
 */

/**
 * One migration per schema version bump: `migrations[n]` turns a version-`n` profile into a
 * version-`n + 1` profile. Each one has a fixture test in `tests/fixtures/saves/v<N>.json`.
 *
 * Empty until the schema first changes.
 */
export const migrations: Record<number, (old: unknown) => unknown> = {};
