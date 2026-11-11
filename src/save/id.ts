/**
 * Profile ids (docs/impl/contracts.md §15, secure-context note).
 *
 * The app may be served over plain HTTP on a LAN by mistake, and `crypto.randomUUID` only exists in
 * secure contexts. So ids come from here, never from `crypto.randomUUID()` directly.
 *
 * Stub; M1-09 implements it.
 */

/**
 * A new v4 UUID. Uses `crypto.randomUUID` when present; otherwise builds one from
 * `crypto.getRandomValues`, which is available everywhere.
 */
export function newId(): string {
  throw new Error("not implemented: newId");
}
