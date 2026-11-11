/**
 * Save problems the UI can tell a family about (docs/impl/contracts.md §15, `onProblem`).
 *
 * Nothing here leaves the device: the store calls the app's callback, and logs with
 * `console.warn` as well.
 */

/**
 * - `restoredPrev`: the current record was damaged, so `load` returned the snapshot before it
 *   ("We brought back your last save").
 * - `unreadable`: neither record of a profile can be read. The profile still takes one of the 8
 *   slots until it is removed.
 * - `newerVersion`: a newer build of the game wrote this profile. This build won't show it or
 *   save over it.
 * - `storageError`: the browser's storage itself failed (storage disabled, quota, a closed
 *   connection).
 */
export type SaveProblemKind = "restoredPrev" | "unreadable" | "newerVersion" | "storageError";

export interface SaveProblem {
  /** The profile it is about, or null when it is not about one profile (e.g. listing failed). */
  profileId: string | null;
  kind: SaveProblemKind;
  /** A short English description for logs; not kid-facing. */
  message: string;
}

/** Options for `createIdbStore` and `createMemoryStore`. */
export interface SaveStoreOptions {
  /** Called once per problem found. Exceptions it throws are caught and ignored. */
  onProblem?: (p: SaveProblem) => void;
}
