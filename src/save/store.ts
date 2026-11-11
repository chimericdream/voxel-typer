/**
 * Persistence API (docs/impl/contracts.md §15). Data never leaves the device.
 *
 * Both stores keep each profile as a JSON string under its id, plus the version before the last
 * save under `<id>:prev`. The rules live once, in {@link createStoreOn}; a {@link Backend} only
 * knows how to read keys and how to do one write atomically.
 *
 * - Write path: compact history → validate → in ONE transaction: count profiles, read current,
 *   copy current to `<id>:prev` (only if current is itself a good profile, so a corrupt current
 *   never overwrites a good prev), write the new current.
 * - Load path: parse → migrate → validate (and the id must match the key) → on any failure try
 *   `<id>:prev` the same way → on failure return null. Each failure is reported with
 *   `console.warn`; nothing is sent anywhere.
 */
import { openDB } from "idb";
import type { IDBPDatabase } from "idb";
import type { AgeBand } from "@/types/core";
import { compactHistory } from "./compact";
import { newId } from "./id";
import { migrateProfile } from "./migrations";
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
 * The storage under a {@link SaveStore}. Values are opaque here (JSON strings when written by
 * this module, anything at all when the data was damaged).
 */
export interface Backend {
  keys(): Promise<string[]>;
  get(key: string): Promise<unknown>;
  /**
   * One atomic write. Reads every key and the current value of `id`, asks `plan` what to write,
   * and writes it in the same transaction. If `plan` throws, nothing is written and the error is
   * rethrown.
   */
  write(
    id: string,
    plan: (current: unknown, keys: string[]) => { current: string; prev?: unknown },
  ): Promise<void>;
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

function report(message: string): void {
  console.warn(`[save] ${message}`);
}

/** Builds the save rules on top of any backend. Exported for tests and other backends. */
export function createStoreOn(backend: Backend): SaveStore {
  async function currentIds(): Promise<string[]> {
    return (await backend.keys()).filter(isCurrentKey);
  }

  async function load(id: string): Promise<Profile | null> {
    if (id.includes(":")) return null;
    const cur = readRecord(await backend.get(id), id);
    if (cur.ok) return cur.profile;
    const prev = readRecord(await backend.get(prevKey(id)), id);
    if (cur.error !== "no record" || prev.ok) {
      report(`profile ${id}: current record unusable (${cur.error})`);
    }
    if (prev.ok) {
      report(`profile ${id}: loaded the previous snapshot instead`);
      return prev.profile;
    }
    if (cur.error !== "no record" || prev.error !== "no record") {
      report(`profile ${id}: previous snapshot unusable too (${prev.error})`);
    }
    return null;
  }

  async function save(p: Profile): Promise<void> {
    const next = compactHistory(p);
    const problem = profileProblem(next);
    if (problem !== null) throw new Error(`not saved: ${problem}`);
    if (next.id.includes(":")) throw new Error("not saved: profile.id may not contain ':'");
    const json = JSON.stringify(next);
    await backend.write(next.id, (current, keys) => {
      const ids = keys.filter(isCurrentKey);
      if (!ids.includes(next.id) && ids.length >= MAX_PROFILES) throw new ProfileLimitError();
      // Keep a good prev rather than replace it with a damaged current.
      return readRecord(current, next.id).ok ? { current: json, prev: current } : { current: json };
    });
  }

  async function loadAll(): Promise<Profile[]> {
    const out: Profile[] = [];
    for (const id of await currentIds()) {
      const p = await load(id);
      if (p !== null) out.push(p);
    }
    return out.toSorted((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  }

  async function importAll(file: Blob): Promise<ImportResult> {
    const errors: string[] = [];
    try {
      if (file.size > MAX_IMPORT_BYTES) return fail("The file is bigger than 5 MB.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        return fail("The file is not a Voxel Typer save file (not JSON).");
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return fail("The file is not a Voxel Typer save file.");
      }
      if (Reflect.get(parsed, "app") !== EXPORT_APP) {
        return fail("The file is not a Voxel Typer save file (wrong app).");
      }
      const version: unknown = Reflect.get(parsed, "version");
      if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
        return fail("The save file has no version number.");
      }
      if (version > SCHEMA_VERSION) {
        return fail("The save file comes from a newer version of Voxel Typer.");
      }
      const list: unknown = Reflect.get(parsed, "profiles");
      if (!Array.isArray(list)) return fail("The save file has no profile list.");

      // Every stored id counts, even one whose records are damaged: `save` counts the same way.
      const stored = await currentIds();
      const ids = new Set(stored);
      const names = new Set((await loadAll()).map((p) => p.name));
      let count = stored.length;
      let imported = 0;
      let skipped = 0;
      for (const [i, raw] of list.entries()) {
        const label = `Profile ${i + 1}`;
        const migrated = migrateProfile(raw);
        if (!migrated.ok) {
          skipped++;
          errors.push(`${label}: ${migrated.error}`);
          continue;
        }
        const value: unknown = migrated.value;
        if (!isProfile(value)) {
          skipped++;
          errors.push(`${label}: ${profileProblem(value) ?? "invalid"}`);
          continue;
        }
        if (count >= MAX_PROFILES) {
          skipped++;
          errors.push(`${label} (${value.name}): there are already ${MAX_PROFILES} profiles.`);
          continue;
        }
        let profile: Profile = value;
        if (ids.has(profile.id) || profile.id.includes(":")) {
          profile = { ...profile, id: freshId(ids), name: suffixedName(profile.name, names) };
        }
        try {
          await save(profile);
        } catch (e) {
          skipped++;
          errors.push(`${label} (${profile.name}): ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        ids.add(profile.id);
        names.add(profile.name);
        count++;
        imported++;
      }
      return { imported, skipped, errors };
    } catch (e) {
      errors.push(`The file could not be read: ${e instanceof Error ? e.message : String(e)}`);
      return { imported: 0, skipped: 0, errors };
    }
  }

  return {
    async listProfiles() {
      return (await loadAll()).map((p) => ({
        id: p.id,
        name: p.name,
        ageBand: p.ageBand,
        avatar: p.avatar,
      }));
    },
    load,
    save,
    async remove(id) {
      if (id.includes(":")) return;
      await backend.removeBoth(id);
    },
    async exportAll() {
      const body = { app: EXPORT_APP, version: SCHEMA_VERSION, profiles: await loadAll() };
      return new Blob([JSON.stringify(body)], { type: "application/json" });
    },
    importAll,
  };
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

/** A store backed by IndexedDB. */
export function createIdbStore(dbName: string = DEFAULT_DB_NAME): SaveStore {
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

  return createStoreOn({
    async keys() {
      const all = await (await db()).getAllKeys(PROFILES_STORE);
      return all.filter((k): k is string => typeof k === "string");
    },
    async get(key) {
      const v: unknown = await (await db()).get(PROFILES_STORE, key);
      return v;
    },
    async write(id, plan) {
      const tx = (await db()).transaction(PROFILES_STORE, "readwrite");
      const done = tx.done;
      try {
        const keys = (await tx.store.getAllKeys()).filter(
          (k): k is string => typeof k === "string",
        );
        const current: unknown = await tx.store.get(id);
        const out = plan(current, keys);
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
    },
    async removeBoth(id) {
      const tx = (await db()).transaction(PROFILES_STORE, "readwrite");
      await Promise.all([tx.store.delete(id), tx.store.delete(prevKey(id)), tx.done]);
    },
  });
}

/** An in-memory store, for tests and `?nosave`. */
export function createMemoryStore(): SaveStore {
  return createStoreOn(createMemoryBackend());
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
        const out = plan(map.get(id), [...map.keys()]);
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
