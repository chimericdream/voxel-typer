/**
 * The save store (contracts §15, task M1-09). The same suite runs on the IndexedDB store (through
 * fake-indexeddb) and on the memory store. Each harness can read and damage the raw records, so
 * the write path and the corrupt-record fallback are tested on both.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDB } from "idb";
import * as fakeIdb from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_CAP } from "../../../src/save/compact";
import { isProfile, profileProblem } from "../../../src/save/schema";
import type { Profile, StoredSummary } from "../../../src/save/schema";
import {
  MAX_PROFILES,
  PROFILES_STORE,
  ProfileLimitError,
  createIdbStore,
  createMemoryBackend,
  createStoreOn,
} from "../../../src/save/store";
import type { SaveStore } from "../../../src/save/store";

// indexedDB, IDBKeyRange, IDBRequest … as globals, the way a browser has them.
Object.assign(globalThis, fakeIdb);

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/profiles");
function fixture(name: string): Profile {
  const v: unknown = JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), "utf8"));
  if (!isProfile(v)) throw new Error(`${name}: ${profileProblem(v)}`);
  return v;
}
const ALL = [
  "fresh-sprout",
  "fresh-builder",
  "meadow-done-miner",
  "pinky-weak",
  "veteran-builder",
] as const;

/** A profile with a chosen id, name and creation time, based on a fixture. */
function make(n: number, base = "fresh-sprout"): Profile {
  return {
    ...fixture(base),
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `Kid ${n}`,
    createdAt: 1_700_000_000_000 + n,
  };
}

/** A store plus raw access to its records. */
interface Harness {
  store: SaveStore;
  /** A second store on the same data, as after a page reload. */
  reopen(): SaveStore;
  rawGet(key: string): Promise<unknown>;
  rawPut(key: string, value: unknown): Promise<void>;
  rawDelete(key: string): Promise<void>;
  rawKeys(): Promise<string[]>;
}

let dbCounter = 0;
const harnesses: [string, () => Promise<Harness>][] = [
  [
    "IndexedDB store",
    async () => {
      const name = `vt-test-${++dbCounter}`;
      const store = createIdbStore(name);
      await store.listProfiles(); // creates the database
      const db = await openDB(name, 1);
      return {
        store,
        reopen: () => createIdbStore(name),
        rawGet: async (k) => {
          const v: unknown = await db.get(PROFILES_STORE, k);
          return v;
        },
        rawPut: async (k, v) => {
          await db.put(PROFILES_STORE, v, k);
        },
        rawDelete: (k) => db.delete(PROFILES_STORE, k),
        rawKeys: async () => (await db.getAllKeys(PROFILES_STORE)).map(String),
      };
    },
  ],
  [
    "memory store",
    () => {
      const map = new Map<string, unknown>();
      const backend = createMemoryBackend(map);
      return Promise.resolve({
        store: createStoreOn(backend),
        reopen: () => createStoreOn(createMemoryBackend(map)),
        rawGet: (k) => Promise.resolve(map.get(k)),
        rawPut: (k, v) => {
          map.set(k, v);
          return Promise.resolve();
        },
        rawDelete: (k) => {
          map.delete(k);
          return Promise.resolve();
        },
        rawKeys: () => Promise.resolve([...map.keys()]),
      });
    },
  ],
];

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

function parse(v: unknown): unknown {
  if (typeof v !== "string") throw new Error(`expected JSON text, got ${typeof v}`);
  const out: unknown = JSON.parse(v);
  return out;
}

describe.each(harnesses)("%s", (_name, open) => {
  let h: Harness;
  beforeEach(async () => {
    h = await open();
  });

  describe("round trip", () => {
    it.each(ALL)("save then load deep-equals: %s", async (name) => {
      const p = fixture(name);
      await h.store.save(p);
      expect(await h.store.load(p.id)).toEqual(p);
      // And after a reload.
      expect(await h.reopen().load(p.id)).toEqual(p);
    });

    it("load returns a copy: changing it does not change the store", async () => {
      const p = fixture("pinky-weak");
      await h.store.save(p);
      const a = await h.store.load(p.id);
      if (a === null) throw new Error("not loaded");
      a.name = "Changed";
      a.history.length = 0;
      expect(await h.store.load(p.id)).toEqual(p);
    });

    it("an unknown id loads as null without a warning", async () => {
      expect(await h.store.load("nobody")).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });

    it("ids with ':' never load (so `<id>:prev` is not a profile)", async () => {
      const p = fixture("fresh-sprout");
      await h.store.save(p);
      await h.store.save({ ...p, name: "Second" });
      expect(await h.store.load(`${p.id}:prev`)).toBeNull();
    });
  });

  describe("write path: validate → prev ← current → current", () => {
    it("the first save writes only the current record", async () => {
      const p = fixture("fresh-builder");
      await h.store.save(p);
      expect(await h.rawKeys()).toEqual([p.id]);
      expect(parse(await h.rawGet(p.id))).toEqual(p);
    });

    it("each later save moves the old current to `<id>:prev`", async () => {
      const p = fixture("fresh-builder");
      const v2 = { ...p, sessionCounter: 2 };
      const v3 = { ...p, sessionCounter: 3 };
      await h.store.save(p);
      await h.store.save(v2);
      expect(parse(await h.rawGet(p.id))).toEqual(v2);
      expect(parse(await h.rawGet(`${p.id}:prev`))).toEqual(p);
      await h.store.save(v3);
      expect(parse(await h.rawGet(p.id))).toEqual(v3);
      expect(parse(await h.rawGet(`${p.id}:prev`))).toEqual(v2);
      expect((await h.rawKeys()).toSorted()).toEqual([p.id, `${p.id}:prev`]);
    });

    it("parallel saves of one profile stay consistent: prev is always the save before current", async () => {
      const p = fixture("fresh-builder");
      await h.store.save(p);
      const versions = Array.from({ length: 6 }, (_, i) => ({ ...p, sessionCounter: i + 1 }));
      await Promise.all(versions.map((v) => h.store.save(v)));
      expect(parse(await h.rawGet(p.id))).toEqual(versions[5]);
      expect(parse(await h.rawGet(`${p.id}:prev`))).toEqual(versions[4]);
    });

    it("an invalid profile is rejected and nothing changes", async () => {
      const p = fixture("meadow-done-miner");
      await h.store.save(p);
      await h.store.save({ ...p, sessionCounter: 1 });
      const before = [await h.rawGet(p.id), await h.rawGet(`${p.id}:prev`)];
      const bad: unknown = { ...p, name: "" };
      await expect(h.store.save(Object(bad))).rejects.toThrow(/profile\.name/);
      await expect(h.store.save({ ...p, createdAt: Number.NaN })).rejects.toThrow(/createdAt/);
      await expect(h.store.save({ ...p, schemaVersion: 99 })).rejects.toThrow(/schemaVersion/);
      expect([await h.rawGet(p.id), await h.rawGet(`${p.id}:prev`)]).toEqual(before);
    });

    it("rejects an id with ':'", async () => {
      await expect(h.store.save({ ...fixture("fresh-sprout"), id: "a:prev" })).rejects.toThrow();
      expect(await h.rawKeys()).toEqual([]);
    });

    it("a damaged current is not copied over a good prev", async () => {
      const p = fixture("pinky-weak");
      const v2 = { ...p, sessionCounter: 11 };
      await h.store.save(p);
      await h.store.save(v2); // prev = p
      await h.rawPut(p.id, "{ broken");
      const v3 = { ...p, sessionCounter: 12 };
      await h.store.save(v3);
      expect(parse(await h.rawGet(p.id))).toEqual(v3);
      expect(parse(await h.rawGet(`${p.id}:prev`))).toEqual(p);
    });

    it("compacts history over the cap before writing", async () => {
      const p = fixture("veteran-builder");
      const first = p.history[0];
      if (first === undefined) throw new Error("fixture has no history");
      const history: StoredSummary[] = Array.from({ length: HISTORY_CAP + 20 }, (_, i) => ({
        ...first,
        at: first.at + i * 60_000,
      }));
      await h.store.save({ ...p, history, weekly: [] });
      const loaded = await h.store.load(p.id);
      expect(loaded?.history.length).toBe(HISTORY_CAP);
      expect(loaded?.history).toEqual(history.slice(20));
      expect(loaded?.weekly.reduce((n, w) => n + w.sessions, 0)).toBe(20);
    });
  });

  describe("load path: a damaged current falls back to `<id>:prev`", () => {
    const damages: [string, (p: Profile) => unknown][] = [
      ["not JSON", () => "{ this is not json"],
      ["truncated JSON", (p) => JSON.stringify(p).slice(0, 200)],
      ["empty text", () => ""],
      ["JSON of the wrong shape", () => JSON.stringify({ hello: "world" })],
      ["a field of the wrong type", (p) => JSON.stringify({ ...p, sessionCounter: "lots" })],
      ["another profile's id", (p) => JSON.stringify({ ...p, id: "someone-else" })],
      ["a newer schema version", (p) => JSON.stringify({ ...p, schemaVersion: 999 })],
      ["a number instead of text", () => 42],
      ["null", () => null],
      ["an object instead of text", (p) => ({ ...p })],
    ];

    it.each(damages)("current is %s ⇒ load returns the prev snapshot", async (_label, damage) => {
      const p = fixture("meadow-done-miner");
      const v2 = { ...p, sessionCounter: p.sessionCounter + 1 };
      await h.store.save(p);
      await h.store.save(v2);
      await h.rawPut(p.id, damage(v2));
      expect(await h.store.load(p.id)).toEqual(p);
      expect(warn).toHaveBeenCalled();
      // The fallback shows in the profile list too.
      expect(await h.store.listProfiles()).toEqual([
        { id: p.id, name: p.name, ageBand: p.ageBand, avatar: p.avatar },
      ]);
    });

    it("current missing but prev present ⇒ load returns prev", async () => {
      const p = fixture("fresh-sprout");
      await h.store.save(p);
      await h.store.save({ ...p, sessionCounter: 1 });
      await h.rawDelete(p.id);
      expect(await h.store.load(p.id)).toEqual(p);
    });

    it("both damaged ⇒ load returns null, reports it, and never throws", async () => {
      const p = fixture("fresh-sprout");
      await h.store.save(p);
      await h.store.save({ ...p, sessionCounter: 1 });
      await h.rawPut(p.id, "garbage");
      await h.rawPut(`${p.id}:prev`, 7);
      expect(await h.store.load(p.id)).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("previous snapshot unusable"));
      expect(await h.store.listProfiles()).toEqual([]);
    });

    it("damaged current with no prev ⇒ null", async () => {
      const p = fixture("fresh-sprout");
      await h.store.save(p);
      await h.rawPut(p.id, "garbage");
      expect(await h.store.load(p.id)).toBeNull();
    });

    it("a damaged prev does not matter while current is good", async () => {
      const p = fixture("fresh-sprout");
      await h.store.save(p);
      await h.store.save({ ...p, sessionCounter: 1 });
      await h.rawPut(`${p.id}:prev`, "garbage");
      expect(await h.store.load(p.id)).toEqual({ ...p, sessionCounter: 1 });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("profiles", () => {
    it("lists profiles oldest first, with id, name, band and avatar only", async () => {
      await h.store.save(make(3, "veteran-builder"));
      await h.store.save(make(1));
      await h.store.save(make(2, "pinky-weak"));
      await h.store.save(make(1)); // a second save makes a prev record, which is not listed
      const list = await h.store.listProfiles();
      expect(list.map((p) => p.name)).toEqual(["Kid 1", "Kid 2", "Kid 3"]);
      expect(list[2]).toEqual({
        id: make(3).id,
        name: "Kid 3",
        ageBand: "builder",
        avatar: fixture("veteran-builder").avatar,
      });
    });

    it(`allows at most ${MAX_PROFILES} profiles; a 9th is rejected and nothing is written`, async () => {
      for (let i = 1; i <= MAX_PROFILES; i++) await h.store.save(make(i));
      const keys = (await h.rawKeys()).toSorted();
      await expect(h.store.save(make(9))).rejects.toBeInstanceOf(ProfileLimitError);
      expect((await h.rawKeys()).toSorted()).toEqual(keys);
      // Saving one of the 8 again still works.
      await h.store.save({ ...make(4), sessionCounter: 5 });
      expect((await h.store.load(make(4).id))?.sessionCounter).toBe(5);
    });

    it("remove deletes the profile and its prev, and nothing else", async () => {
      await h.store.save(make(1));
      await h.store.save({ ...make(1), sessionCounter: 1 });
      await h.store.save(make(2));
      await h.store.remove(make(1).id);
      expect(await h.store.load(make(1).id)).toBeNull();
      expect(await h.rawKeys()).toEqual([make(2).id]);
      expect(await h.store.load(make(2).id)).toEqual(make(2));
      await h.store.remove("nobody");
      await h.store.remove("x:prev");
      expect(await h.rawKeys()).toEqual([make(2).id]);
    });

    it("after a remove there is room for a new profile", async () => {
      for (let i = 1; i <= MAX_PROFILES; i++) await h.store.save(make(i));
      await h.store.remove(make(1).id);
      await h.store.save(make(9));
      expect((await h.store.listProfiles()).length).toBe(MAX_PROFILES);
    });
  });

  describe("export", () => {
    it("writes { app: 'voxel-typer', version, profiles } as JSON", async () => {
      await h.store.save(make(2, "pinky-weak"));
      await h.store.save(make(1));
      const blob = await h.store.exportAll();
      expect(blob.type).toBe("application/json");
      expect(JSON.parse(await blob.text())).toEqual({
        app: "voxel-typer",
        version: 1,
        profiles: [make(1), make(2, "pinky-weak")],
      });
    });

    it("exports the prev snapshot of a damaged profile and skips a lost one", async () => {
      await h.store.save(make(1));
      await h.store.save({ ...make(1), sessionCounter: 9 });
      await h.rawPut(make(1).id, "garbage");
      await h.store.save(make(2));
      await h.rawPut(make(2).id, "garbage");
      const body: unknown = JSON.parse(await (await h.store.exportAll()).text());
      expect(Reflect.get(Object(body), "profiles")).toEqual([make(1)]);
    });

    it("export then import into an empty store gives the same profiles", async () => {
      for (const name of ALL) await h.store.save(fixture(name));
      const file = await h.store.exportAll();
      const other = (await harnesses[1]?.[1]())?.store;
      if (other === undefined) throw new Error("no memory harness");
      expect(await other.importAll(file)).toEqual({ imported: 5, skipped: 0, errors: [] });
      for (const name of ALL) expect(await other.load(fixture(name).id)).toEqual(fixture(name));
    });
  });
});
