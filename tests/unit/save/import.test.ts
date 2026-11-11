/**
 * `SaveStore.importAll` (contracts §15, task M1-09): validates the file, caps it at 5 MB and at 8
 * profiles, gives colliding profiles a new id and a "(2)" name, reports every reason, and never
 * throws.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as fc from "fast-check";
import * as fakeIdb from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isProfile, profileProblem } from "../../../src/save/schema";
import type { Profile } from "../../../src/save/schema";
import {
  MAX_IMPORT_BYTES,
  MAX_PROFILES,
  createIdbStore,
  createMemoryStore,
  suffixedName,
} from "../../../src/save/store";
import type { SaveStore } from "../../../src/save/store";

// indexedDB, IDBKeyRange, IDBRequest … as globals, the way a browser has them.
Object.assign(globalThis, fakeIdb);

const SEED = 20261111;
const FIXTURES = resolve(import.meta.dirname, "../../fixtures/profiles");
function fixture(name: string): Profile {
  const v: unknown = JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), "utf8"));
  if (!isProfile(v)) throw new Error(`${name}: ${profileProblem(v)}`);
  return v;
}

function make(n: number, name = `Kid ${n}`): Profile {
  return {
    ...fixture("fresh-builder"),
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name,
    createdAt: 1_700_000_000_000 + n,
  };
}

const file = (body: unknown): Blob => new Blob([JSON.stringify(body)]);
const exportOf = (profiles: unknown[]): Blob => file({ app: "voxel-typer", version: 1, profiles });

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

let dbCounter = 0;
describe.each<[string, () => SaveStore]>([
  ["memory store", createMemoryStore],
  ["IndexedDB store", () => createIdbStore(`vt-import-${++dbCounter}`)],
])("%s importAll", (_name, open) => {
  let store: SaveStore;
  beforeEach(() => {
    store = open();
  });

  it("imports valid profiles", async () => {
    const res = await store.importAll(exportOf([make(1), make(2)]));
    expect(res).toEqual({ imported: 2, skipped: 0, errors: [] });
    expect(await store.load(make(1).id)).toEqual(make(1));
    expect(await store.load(make(2).id)).toEqual(make(2));
  });

  describe("rejects the whole file, with a reason", () => {
    it.each<[string, () => Blob, RegExp]>([
      ["a wrong `app` field", () => file({ app: "other-game", version: 1, profiles: [] }), /app/],
      ["no `app` field", () => file({ version: 1, profiles: [make(1)] }), /app/],
      ["not JSON", () => new Blob(["{ nope"]), /not JSON/],
      ["an empty file", () => new Blob([]), /not JSON/],
      ["a JSON array", () => file([make(1)]), /not a Voxel Typer save file/],
      ["JSON null", () => file(null), /not a Voxel Typer save file/],
      ["no version", () => file({ app: "voxel-typer", profiles: [make(1)] }), /version/],
      [
        "a newer version",
        () => file({ app: "voxel-typer", version: 99, profiles: [make(1)] }),
        /newer/,
      ],
      ["no profile list", () => file({ app: "voxel-typer", version: 1 }), /profile list/],
      [
        "profiles as an object",
        () => file({ app: "voxel-typer", version: 1, profiles: { a: make(1) } }),
        /profile list/,
      ],
      ["more than 5 MB", () => new Blob([new Uint8Array(MAX_IMPORT_BYTES + 1)]), /5 MB/],
    ])("%s", async (_label, blob, reason) => {
      const res = await store.importAll(blob());
      expect(res.imported).toBe(0);
      expect(res.errors.length).toBe(1);
      expect(res.errors[0]).toMatch(reason);
      expect(await store.listProfiles()).toEqual([]);
    });

    it("does not read a file over 5 MB at all", async () => {
      const big = new Blob([new Uint8Array(MAX_IMPORT_BYTES + 1)]);
      const text = vi.spyOn(big, "text");
      await store.importAll(big);
      expect(text).not.toHaveBeenCalled();
    });

    it("accepts a file of exactly 5 MB", async () => {
      const body = JSON.stringify({ app: "voxel-typer", version: 1, profiles: [make(1)] });
      const padded = body + " ".repeat(MAX_IMPORT_BYTES - body.length);
      const blob = new Blob([padded]);
      expect(blob.size).toBe(MAX_IMPORT_BYTES);
      expect((await store.importAll(blob)).imported).toBe(1);
    });
  });

  it("skips profiles with an invalid structure and says why, keeping the good ones", async () => {
    const { name: _, ...noName } = make(2);
    const res = await store.importAll(
      exportOf([make(1), noName, "text", { ...make(3), ageBand: "toddler" }, make(4)]),
    );
    expect(res.imported).toBe(2);
    expect(res.skipped).toBe(3);
    expect(res.errors).toEqual([
      "Profile 2: profile.name: missing",
      "Profile 3: profile: expected an object",
      expect.stringMatching(/^Profile 4: profile\.ageBand/),
    ]);
    expect((await store.listProfiles()).map((p) => p.name)).toEqual(["Kid 1", "Kid 4"]);
  });

  it("skips a profile from a newer schema version", async () => {
    const res = await store.importAll(exportOf([{ ...make(1), schemaVersion: 2 }]));
    expect(res).toMatchObject({ imported: 0, skipped: 1 });
    expect(res.errors[0]).toMatch(/newer/);
  });

  it(`rejects the 9th profile (${MAX_PROFILES} max) and reports it`, async () => {
    for (let i = 1; i <= 6; i++) await store.save(make(i));
    const res = await store.importAll(exportOf([make(7), make(8), make(9), make(10)]));
    expect(res.imported).toBe(2);
    expect(res.skipped).toBe(2);
    expect(res.errors).toEqual([
      `Profile 3 (Kid 9): there are already ${MAX_PROFILES} profiles.`,
      `Profile 4 (Kid 10): there are already ${MAX_PROFILES} profiles.`,
    ]);
    expect((await store.listProfiles()).length).toBe(MAX_PROFILES);
    expect(await store.load(make(9).id)).toBeNull();
  });

  it('gives a colliding profile a new id and a "(2)" name, and leaves the original alone', async () => {
    await store.save(make(1, "Sam"));
    const res = await store.importAll(exportOf([{ ...make(1, "Sam"), sessionCounter: 7 }]));
    expect(res).toEqual({ imported: 1, skipped: 0, errors: [] });
    expect(await store.load(make(1).id)).toEqual(make(1, "Sam"));
    const list = await store.listProfiles();
    expect(list.map((p) => p.name).toSorted()).toEqual(["Sam", "Sam (2)"]);
    const copy = list.find((p) => p.name === "Sam (2)");
    expect(copy?.id).toMatch(V4);
    expect(copy?.id).not.toBe(make(1).id);
    const loaded = await store.load(copy?.id ?? "");
    expect(loaded?.sessionCounter).toBe(7);
  });

  it("importing the same file again makes (3), and so on", async () => {
    const f = exportOf([make(1, "Sam")]);
    await store.importAll(f);
    await store.importAll(f);
    await store.importAll(f);
    // The copies share a creation time, so the list order between them is by id: compare sorted.
    expect((await store.listProfiles()).map((p) => p.name).toSorted()).toEqual([
      "Sam",
      "Sam (2)",
      "Sam (3)",
    ]);
  });

  it("two profiles with one id in the same file both arrive", async () => {
    const res = await store.importAll(exportOf([make(1, "Ana"), make(1, "Ana")]));
    expect(res.imported).toBe(2);
    expect((await store.listProfiles()).map((p) => p.name).toSorted()).toEqual(["Ana", "Ana (2)"]);
  });

  it("never throws: random JSON values and random text", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.string().map((s) => new Blob([s])),
          fc.jsonValue().map((v) => file(v)),
          fc
            .record({
              app: fc.oneof(fc.constant("voxel-typer"), fc.string()),
              version: fc.oneof(fc.constant(1), fc.jsonValue()),
              profiles: fc.oneof(fc.array(fc.jsonValue(), { maxLength: 3 }), fc.jsonValue()),
            })
            .map((v) => file(v)),
        ),
        async (blob) => {
          const res = await store.importAll(blob);
          expect(res.imported + res.skipped).toBeGreaterThanOrEqual(0);
          expect(Array.isArray(res.errors)).toBe(true);
        },
      ),
      { seed: SEED, numRuns: 150 },
    );
  });

  it("never throws when the file cannot be read", async () => {
    const broken = new Blob(["x"]);
    vi.spyOn(broken, "text").mockRejectedValue(new Error("disk gone"));
    const res = await store.importAll(broken);
    expect(res.imported).toBe(0);
    expect(res.errors.length).toBe(1);
  });
});

describe("suffixedName", () => {
  it("adds (2), then (3) when that is taken", () => {
    expect(suffixedName("Sam", new Set())).toBe("Sam (2)");
    expect(suffixedName("Sam", new Set(["Sam (2)"]))).toBe("Sam (3)");
  });

  it("stays within 16 characters", () => {
    const name = "Abcdefghijklmnop"; // 16
    const out = suffixedName(name, new Set());
    expect(out).toBe("Abcdefghijkl (2)");
    expect(Array.from(out).length).toBe(16);
    expect(Array.from(suffixedName("🦊".repeat(16), new Set())).length).toBe(16);
  });

  it("trims a space left before the suffix", () => {
    expect(suffixedName("Abcdefghijk lmno", new Set())).toBe("Abcdefghijk (2)");
  });
});
