/**
 * Persistence API (docs/impl/contracts.md §15). Data never leaves the device.
 *
 * Stubs only; M1-09 implements them.
 */
import type { AgeBand } from "@/types/core";
import type { Profile } from "./schema";

/** Where profiles live. At most 8 profiles. */
export interface SaveStore {
  listProfiles(): Promise<
    { id: string; name: string; ageBand: AgeBand; avatar: Profile["avatar"] }[]
  >;
  /** Runs migrations. On corruption it returns the last good snapshot. */
  load(id: string): Promise<Profile | null>;
  /** Keeps the previous version as `<id>:prev`. */
  save(p: Profile): Promise<void>;
  remove(id: string): Promise<void>;
  /** JSON: `{ app: 'voxel-typer', version, profiles: Profile[] }`. */
  exportAll(): Promise<Blob>;
  /** Validates the file. At most 5 MB. Bad input is reported in `errors`, never thrown. */
  importAll(file: Blob): Promise<{ imported: number; skipped: number; errors: string[] }>;
}

/** A store backed by IndexedDB. */
export function createIdbStore(dbName?: string): SaveStore {
  void dbName;
  throw new Error("not implemented: createIdbStore");
}

/** An in-memory store, for tests and `?nosave`. */
export function createMemoryStore(): SaveStore {
  throw new Error("not implemented: createMemoryStore");
}
