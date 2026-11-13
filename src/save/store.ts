/**
 * Persistence API (docs/impl/contracts.md §15). Data never leaves the device.
 *
 * Both stores keep each profile as a JSON string under its id, plus the version before the last
 * save under `<id>:prev`. The rules live once, in {@link createStoreOn}; a {@link Backend} only
 * knows how to read keys and how to do one write atomically.
 *
 * - Write path: validate → compact history → in ONE transaction: count profiles, read current
 *   and prev, refuse if either is from a newer build, copy current to `<id>:prev` (only if
 *   current is itself a good profile, so a corrupt current never overwrites a good prev), write
 *   the new current.
 * - Load path: refuse a record from a newer build (null, no fallback) → parse → migrate →
 *   validate (and the id must match the key) → on any failure try `<id>:prev` the same way → on
 *   failure return null. Each problem goes to `console.warn` and to `onProblem`; nothing is sent
 *   anywhere. `load` and `listProfiles` never reject.
 */
import { openDB } from "idb";
import type { IDBPDatabase } from "idb";
import type { AgeBand } from "@/types/core";
import { compactHistory } from "./compact";
import { newId } from "./id";
import { migrateProfile } from "./migrations";
import type { SaveProblemKind, SaveStoreOptions } from "./problems";
import { NAME_MAX, SCHEMA_VERSION, isProfile, profileProblem } from "./schema";
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
  /**
   * `save`, but only if the stored record is still `expected` (the JSON this tab last wrote or
   * read), checked inside the write's own transaction (M3-FIX-9, two-tab safety). A damaged
   * current record counts as unchanged: the save repairs it. When another tab changed or removed
   * the record it rejects with {@link StaleSaveError} and writes nothing. Resolves with the JSON
   * now stored. Every other rule of `save` holds.
   */
  saveIfUnchanged(p: Profile, expected: string): Promise<string>;
  remove(id: string): Promise<void>;
  /** JSON: `{ app: 'voxel-typer', version, profiles: Profile[] }`. */
  exportAll(): Promise<Blob>;
  /** Validates the file. At most 5 MB. Bad input is reported in `errors`, never thrown. */
  importAll(file: Blob): Promise<{ imported: number; skipped: number; errors: string[] }>;
}

/** Most profiles on one device (siblings sharing a computer, PLAN.md §6.6). */
export const MAX_PROFILES = 8;
/** Largest file `importAll` reads. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
/** The `app` field of an export file. */
export const EXPORT_APP = "voxel-typer";
/** The IndexedDB database and object store names. */
export const DEFAULT_DB_NAME = "voxel-typer";
export const PROFILES_STORE = "profiles";

const PREV = ":prev";
const prevKey = (id: string): string => id + PREV;
const isCurrentKey = (key: string): boolean => !key.endsWith(PREV);

/** Thrown by `save` when the profile would be a 9th. */
export class ProfileLimitError extends Error {
  constructor() {
    super(`there are already ${MAX_PROFILES} profiles`);
    this.name = "ProfileLimitError";
  }
}

/**
 * Thrown by `save` when the stored profile was written by a newer build of the game. Nothing is
 * written: an old tab or a stale cached build must never replace newer progress.
 */
export class NewerSaveError extends Error {
  constructor(
    readonly profileId: string,
    readonly storedVersion: number,
  ) {
    super(
      `profile ${profileId} was saved by a newer version of the game (schema ${storedVersion}); ` +
        `this one is ${SCHEMA_VERSION}`,
    );
    this.name = "NewerSaveError";
  }
}

/**
 * Thrown by `saveIfUnchanged` when the stored record is not the one the caller expected: another
 * tab saved or removed this player. Nothing is written. `current` is the stored profile now and
 * `record` its JSON, or both null when the record is gone.
 */
export class StaleSaveError extends Error {
  constructor(
    readonly profileId: string,
    readonly current: Profile | null,
    readonly record: string | null,
  ) {
    super(
      current === null
        ? `profile ${profileId} was removed elsewhere`
        : `profile ${profileId} was changed elsewhere`,
    );
    this.name = "StaleSaveError";
  }
}

/** What a {@link Backend} write sees, all read inside its transaction. */
export interface WriteView {
  current: unknown;
  prev: unknown;
  keys: string[];
}

/**
 * The storage under a {@link SaveStore}. Values are opaque here (JSON strings when written by
 * this module, anything at all when the data was damaged).
 */
export interface Backend {
  keys(): Promise<string[]>;
  get(key: string): Promise<unknown>;
  /**
   * One atomic write. Reads every key and the current and prev values of `id`, asks `plan` what
   * to write, and writes it in the same transaction. If `plan` throws, nothing is written and the
   * error is rethrown.
   */
  write(id: string, plan: (view: WriteView) => { current: string; prev?: unknown }): Promise<void>;
  /** Deletes `id` and `<id>:prev` together. */
  removeBoth(id: string): Promise<void>;
}

type ImportResult = { imported: number; skipped: number; errors: string[] };

/** An import that stopped before any profile was looked at. */
const fail = (error: string): ImportResult => ({ imported: 0, skipped: 0, errors: [error] });

type Read = { ok: true; profile: Profile } | { ok: false; error: string };

/** parse → migrate → validate. Never throws. */
function readRecord(raw: unknown, id: string): Read {
  if (raw === undefined) return { ok: false, error: "no record" };
  if (typeof raw !== "string") return { ok: false, error: "record is not JSON text" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "record is not valid JSON" };
  }
  const migrated = migrateProfile(parsed);
  if (!migrated.ok) return migrated;
  const value: unknown = migrated.value;
  if (!isProfile(value)) return { ok: false, error: profileProblem(value) ?? "profile: invalid" };
  if (value.id !== id) return { ok: false, error: `profile.id: expected ${id}` };
  return { ok: true, profile: value };
}

/**
 * The schema version of a stored record when it is newer than this build's, else null. Only
 * `schemaVersion` is looked at: a newer build may have changed everything else.
 */
export function newerVersionOf(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const v: unknown = Reflect.get(parsed, "schemaVersion");
  return typeof v === "number" && Number.isInteger(v) && v > SCHEMA_VERSION ? v : null;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Builds the save rules on top of any backend. Exported for tests and other backends. */
export function createStoreOn(backend: Backend, options: SaveStoreOptions = {}): SaveStore {
  function problem(profileId: string | null, kind: SaveProblemKind, message: string): void {
    console.warn(`[save] ${profileId === null ? "" : `profile ${profileId}: `}${message}`);
    try {
      options.onProblem?.({ profileId, kind, message });
    } catch {
      // A broken UI callback must not break saving.
    }
  }

  async function currentIds(): Promise<string[]> {
    return (await backend.keys()).filter(isCurrentKey);
  }

  /** The load rules. Rejects only when the backend itself fails. */
  async function loadStrict(id: string): Promise<Profile | null> {
    if (id.includes(":")) return null;
    const curRaw = await backend.get(id);
    const curNewer = newerVersionOf(curRaw);
    if (curNewer !== null) {
      // Not "corrupt": falling back to the older prev would show (and later save) old progress.
      problem(id, "newerVersion", `saved by a newer version of the game (schema ${curNewer})`);
      return null;
    }
    const cur = readRecord(curRaw, id);
    if (cur.ok) return cur.profile;
    const prevRaw = await backend.get(prevKey(id));
    const prevNewer = newerVersionOf(prevRaw);
    if (prevNewer !== null) {
      problem(
        id,
        "newerVersion",
        `previous snapshot is from a newer version (schema ${prevNewer})`,
      );
      return null;
    }
    const prev = readRecord(prevRaw, id);
    if (prev.ok) {
      problem(
        id,
        "restoredPrev",
        `current record unusable (${cur.error}); loaded the previous one`,
      );
      return prev.profile;
    }
    if (cur.error === "no record" && prev.error === "no record") return null;
    problem(id, "unreadable", `current record: ${cur.error}; previous snapshot: ${prev.error}`);
    return null;
  }

  async function load(id: string): Promise<Profile | null> {
    try {
      return await loadStrict(id);
    } catch (e) {
      problem(id, "storageError", `could not read: ${errorText(e)}`);
      return null;
    }
  }

  /** `save`, and with `expected` the compare-and-swap of `saveIfUnchanged`. */
  async function put(p: Profile, expected?: string): Promise<string> {
    // Validate first, so a malformed profile fails with the validator's reason.
    const problemText = profileProblem(p);
    if (problemText !== null) throw new Error(`not saved: ${problemText}`);
    if (p.id.includes(":")) throw new Error("not saved: profile.id may not contain ':'");
    const next = compactHistory(p);
    const json = JSON.stringify(next);
    try {
      await backend.write(next.id, ({ current, prev, keys }) => {
        const newer = newerVersionOf(current) ?? newerVersionOf(prev);
        if (newer !== null) throw new NewerSaveError(next.id, newer);
        const read = readRecord(current, next.id);
        if (expected !== undefined && current !== expected) {
          // Gone: removed elsewhere, never written back. Readable and different: another tab's
          // save. A damaged record is nobody's save, so this one repairs it.
          if (current === undefined) throw new StaleSaveError(next.id, null, null);
          if (read.ok && typeof current === "string") {
            throw new StaleSaveError(next.id, read.profile, current);
          }
        }
        const ids = keys.filter(isCurrentKey);
        if (!ids.includes(next.id) && ids.length >= MAX_PROFILES) throw new ProfileLimitError();
        // Keep a good prev rather than replace it with a damaged current.
        return read.ok ? { current: json, prev: current } : { current: json };
      });
    } catch (e) {
      if (e instanceof NewerSaveError) {
        problem(next.id, "newerVersion", `not saved: ${e.message}`);
      } else if (!(e instanceof ProfileLimitError) && !(e instanceof StaleSaveError)) {
        problem(next.id, "storageError", `not saved: ${errorText(e)}`);
      }
      throw e;
    }
    return json;
  }

  async function save(p: Profile): Promise<void> {
    await put(p);
  }

  async function loadAll(loader: (id: string) => Promise<Profile | null>): Promise<Profile[]> {
    const out: Profile[] = [];
    for (const id of await currentIds()) {
      const p = await loader(id);
      if (p !== null) out.push(p);
    }
    return out.toSorted((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  }

  async function importAll(file: Blob): Promise<ImportResult> {
    const errors: string[] = [];
    try {
      const read = await readExportFile(file);
      if (!read.ok) return fail(FILE_PROBLEM_TEXT[read.problem]);

      // Every stored id counts, even one whose records are damaged or newer: `save` counts the
      // same way. Any stored id, readable or not, makes an imported profile with that id take a
      // fresh one, so an import never writes over a stored record.
      const stored = await currentIds();
      const ids = new Set(stored);
      const names = new Set((await loadAll(loadStrict)).map((p) => p.name));
      let count = stored.length;
      let imported = 0;
      let skipped = 0;
      for (const entry of read.entries) {
        const label = `Profile ${entry.index + 1}`;
        if (!entry.ok) {
          skipped++;
          errors.push(`${label}: ${entry.detail}`);
          continue;
        }
        if (count >= MAX_PROFILES) {
          skipped++;
          errors.push(
            `${label} (${entry.profile.name}): there are already ${MAX_PROFILES} profiles.`,
          );
          continue;
        }
        let profile: Profile = entry.profile;
        if (ids.has(profile.id) || profile.id.includes(":")) {
          profile = { ...profile, id: freshId(ids), name: suffixedName(profile.name, names) };
        }
        try {
          await save(profile);
        } catch (e) {
          skipped++;
          errors.push(`${label} (${profile.name}): ${errorText(e)}`);
          continue;
        }
        ids.add(profile.id);
        names.add(profile.name);
        count++;
        imported++;
      }
      return { imported, skipped, errors };
    } catch (e) {
      errors.push(`The file could not be read: ${errorText(e)}`);
      return { imported: 0, skipped: 0, errors };
    }
  }

  return {
    async listProfiles() {
      try {
        // `load` reports each damaged profile as `unreadable`, so a grown-up can remove it.
        return (await loadAll(load)).map((p) => ({
          id: p.id,
          name: p.name,
          ageBand: p.ageBand,
          avatar: p.avatar,
        }));
      } catch (e) {
        problem(null, "storageError", `could not list profiles: ${errorText(e)}`);
        return [];
      }
    },
    load,
    save,
    saveIfUnchanged: (p, expected) => put(p, expected),
    async remove(id) {
      if (id.includes(":")) return;
      await backend.removeBoth(id);
    },
    async exportAll() {
      // Strict: a storage failure rejects rather than export a file with a profile missing.
      const profiles = await loadAll(loadStrict);
      const body = { app: EXPORT_APP, version: SCHEMA_VERSION, profiles };
      return new Blob([JSON.stringify(body)], { type: "application/json" });
    },
    importAll,
  };
}

/** Why a whole export file was refused (task M3-12: the UI turns these codes into `t()` copy). */
export type ExportFileProblem =
  | "tooBig"
  | "notJson"
  | "notSave"
  | "wrongApp"
  | "noVersion"
  | "newerFile"
  | "noList"
  | "unreadable";

/** One profile of an export file: usable, or why not (`detail` is English, for logs). */
export type ExportFileEntry =
  | { index: number; ok: true; profile: Profile }
  | { index: number; ok: false; reason: "newer" | "invalid"; detail: string };

export type ExportFileRead =
  | { ok: true; entries: ExportFileEntry[] }
  | { ok: false; problem: ExportFileProblem };

/** `importAll`'s English text for each whole-file problem (unchanged since M1-09). */
const FILE_PROBLEM_TEXT: Record<ExportFileProblem, string> = {
  tooBig: "The file is bigger than 5 MB.",
  notJson: "The file is not a Voxel Typer save file (not JSON).",
  notSave: "The file is not a Voxel Typer save file.",
  wrongApp: "The file is not a Voxel Typer save file (wrong app).",
  noVersion: "The save file has no version number.",
  newerFile: "The save file comes from a newer version of Voxel Typer.",
  noList: "The save file has no profile list.",
  unreadable: "The file could not be read.",
};

/**
 * Reads an export file without writing anything (task M3-12; `importAll` uses it too). A file
 * over {@link MAX_IMPORT_BYTES} is never read. Each profile is migrated and validated on its own.
 * Never rejects.
 */
export async function readExportFile(file: Blob): Promise<ExportFileRead> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, problem: "tooBig" };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, problem: "unreadable" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problem: "notJson" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, problem: "notSave" };
  }
  if (Reflect.get(parsed, "app") !== EXPORT_APP) return { ok: false, problem: "wrongApp" };
  const version: unknown = Reflect.get(parsed, "version");
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, problem: "noVersion" };
  }
  if (version > SCHEMA_VERSION) return { ok: false, problem: "newerFile" };
  const list: unknown = Reflect.get(parsed, "profiles");
  if (!Array.isArray(list)) return { ok: false, problem: "noList" };
  const entries: ExportFileEntry[] = list.map((raw: unknown, index): ExportFileEntry => {
    const migrated = migrateProfile(raw);
    if (!migrated.ok) {
      const newer = newerVersionOf(JSON.stringify(raw ?? null)) !== null;
      return { index, ok: false, reason: newer ? "newer" : "invalid", detail: migrated.error };
    }
    const value: unknown = migrated.value;
    if (!isProfile(value)) {
      return { index, ok: false, reason: "invalid", detail: profileProblem(value) ?? "invalid" };
    }
    return { index, ok: true, profile: value };
  });
  return { ok: true, entries };
}

function freshId(taken: ReadonlySet<string>): string {
  for (;;) {
    const id = newId();
    if (!taken.has(id)) return id;
  }
}

/** `"Sam"` → `"Sam (2)"`, or `(3)` … if that is taken. Kept within {@link NAME_MAX} chars. */
export function suffixedName(name: string, taken: ReadonlySet<string>): string {
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const chars = Array.from(name);
    const base = chars
      .slice(0, NAME_MAX - suffix.length)
      .join("")
      .trimEnd();
    const candidate = (base === "" ? (chars[0] ?? "") : base) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/** True for the error IndexedDB throws when a connection was closed under us. */
const isClosedConnection = (e: unknown): boolean =>
  e instanceof Error && e.name === "InvalidStateError";

/** A store backed by IndexedDB. */
export function createIdbStore(
  dbName: string = DEFAULT_DB_NAME,
  options: SaveStoreOptions = {},
): SaveStore {
  let dbp: Promise<IDBPDatabase> | null = null;
  const db = (): Promise<IDBPDatabase> => {
    dbp ??= openDB(dbName, 1, {
      upgrade(d) {
        d.createObjectStore(PROFILES_STORE);
      },
      blocking() {
        // A newer tab wants to upgrade: let it.
        void dbp?.then((d) => d.close());
        dbp = null;
      },
      terminated() {
        dbp = null;
      },
    }).catch((e: unknown) => {
      dbp = null;
      throw e;
    });
    return dbp;
  };

  /**
   * Runs `fn` on the open database. If the connection was closed under it (`blocking` or the
   * browser closed it), it reopens and tries once more. `transaction()` throws before anything is
   * written, so the retry can't write twice.
   */
  async function withDb<T>(fn: (d: IDBPDatabase) => Promise<T>): Promise<T> {
    const first = await db();
    try {
      return await fn(first);
    } catch (e) {
      if (!isClosedConnection(e)) throw e;
      if (dbp !== null && (await dbp) === first) dbp = null;
      return fn(await db());
    }
  }

  return createStoreOn(
    {
      keys: () =>
        withDb(async (d) =>
          (await d.getAllKeys(PROFILES_STORE)).filter((k): k is string => typeof k === "string"),
        ),
      get: (key) =>
        withDb(async (d) => {
          const v: unknown = await d.get(PROFILES_STORE, key);
          return v;
        }),
      write: (id, plan) =>
        withDb(async (d) => {
          const tx = d.transaction(PROFILES_STORE, "readwrite");
          const done = tx.done;
          try {
            const keys = (await tx.store.getAllKeys()).filter(
              (k): k is string => typeof k === "string",
            );
            const current: unknown = await tx.store.get(id);
            const prev: unknown = await tx.store.get(prevKey(id));
            const out = plan({ current, prev, keys });
            if (Object.hasOwn(out, "prev")) await tx.store.put(out.prev, prevKey(id));
            await tx.store.put(out.current, id);
          } catch (e) {
            try {
              tx.abort();
            } catch {
              // Already finished or aborted.
            }
            await done.catch(() => undefined);
            throw e;
          }
          await done;
        }),
      removeBoth: (id) =>
        withDb(async (d) => {
          const tx = d.transaction(PROFILES_STORE, "readwrite");
          await Promise.all([tx.store.delete(id), tx.store.delete(prevKey(id)), tx.done]);
        }),
    },
    options,
  );
}

/** An in-memory store, for tests and `?nosave`. */
export function createMemoryStore(options: SaveStoreOptions = {}): SaveStore {
  return createStoreOn(createMemoryBackend(), options);
}

/** The backend under {@link createMemoryStore}. Exported so tests can damage records. */
export function createMemoryBackend(map: Map<string, unknown> = new Map()): Backend {
  return {
    keys() {
      return Promise.resolve([...map.keys()].toSorted());
    },
    get(key) {
      return Promise.resolve(map.get(key));
    },
    write(id, plan) {
      try {
        // Synchronous, so nothing can run between the read and the writes.
        const out = plan({
          current: map.get(id),
          prev: map.get(prevKey(id)),
          keys: [...map.keys()],
        });
        if (Object.hasOwn(out, "prev")) map.set(prevKey(id), out.prev);
        map.set(id, out.current);
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    removeBoth(id) {
      map.delete(id);
      map.delete(prevKey(id));
      return Promise.resolve();
    },
  };
}
