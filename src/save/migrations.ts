/**
 * Save migrations (docs/impl/contracts.md §15). Pure. Orchestrator-owned after M1-09.
 */
import { SCHEMA_VERSION } from "./schema";

/**
 * One migration per schema version bump: `migrations[n]` turns a version-`n` profile into a
 * version-`n + 1` profile. Each one has a fixture test in `tests/fixtures/saves/v<N>.json`.
 *
 * Empty until the schema first changes.
 */
export const migrations: Record<number, (old: unknown) => unknown> = {};

/** What {@link migrateProfile} returns: the migrated (not yet validated) value, or why it failed. */
export type MigrateResult = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Brings a parsed profile of any older version up to {@link SCHEMA_VERSION} by running
 * `steps[v]`, `steps[v + 1]` … in order. It does not validate the result: run `profileProblem`
 * on it afterwards. A profile from a newer build, or with no version, fails; a missing step fails.
 * A step that throws fails too, so bad data never escapes as an exception.
 *
 * `steps` and `target` are parameters for tests; the app uses the defaults.
 */
export function migrateProfile(
  raw: unknown,
  steps: Record<number, (old: unknown) => unknown> = migrations,
  target: number = SCHEMA_VERSION,
): MigrateResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "profile: expected an object" };
  }
  const version: unknown = Reflect.get(raw, "schemaVersion");
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: "profile.schemaVersion: missing or not a version number" };
  }
  if (version > target) {
    return {
      ok: false,
      error: `profile.schemaVersion: ${version} is newer than this game (${target})`,
    };
  }
  let value: unknown = raw;
  for (let v = version; v < target; v++) {
    const step = steps[v];
    if (step === undefined) return { ok: false, error: `no migration from version ${v}` };
    try {
      value = step(value);
    } catch (e) {
      return { ok: false, error: `migration from version ${v} failed: ${String(e)}` };
    }
  }
  return { ok: true, value };
}
