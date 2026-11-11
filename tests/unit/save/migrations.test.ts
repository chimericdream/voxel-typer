import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { migrateProfile, migrations } from "../../../src/save/migrations";
import { SCHEMA_VERSION, profileProblem } from "../../../src/save/schema";
import { createMemoryStore } from "../../../src/save/store";

const V1 = resolve(import.meta.dirname, "../../fixtures/saves/v1.json");

describe("migrations", () => {
  it("has one step per version below the current one", () => {
    for (let v = 1; v < SCHEMA_VERSION; v++) expect(migrations[v], `v${v}`).toBeTypeOf("function");
    expect(Object.keys(migrations).length).toBe(SCHEMA_VERSION - 1);
  });

  it("v1 fixture: every profile migrates to a valid current profile", () => {
    const file: unknown = JSON.parse(readFileSync(V1, "utf8"));
    const profiles: unknown = Reflect.get(Object(file), "profiles");
    expect(Array.isArray(profiles)).toBe(true);
    if (!Array.isArray(profiles)) return;
    expect(profiles.length).toBeGreaterThan(0);
    for (const raw of profiles) {
      const r = migrateProfile(raw);
      expect(r.ok).toBe(true);
      if (r.ok) expect(profileProblem(r.value)).toBeNull();
    }
  });

  it("v1 fixture: a store imports it and loads the same data", async () => {
    const text = readFileSync(V1, "utf8");
    const store = createMemoryStore();
    const res = await store.importAll(new Blob([text]));
    expect(res).toEqual({ imported: 1, skipped: 0, errors: [] });
    const file: unknown = JSON.parse(text);
    const profiles: unknown = Reflect.get(Object(file), "profiles");
    const first: unknown = Array.isArray(profiles) ? profiles[0] : undefined;
    const id: unknown = Reflect.get(Object(first), "id");
    expect(typeof id).toBe("string");
    expect(await store.load(String(id))).toEqual(first);
  });

  it("runs the steps in order from the stored version", () => {
    const seen: number[] = [];
    const steps = {
      1: (o: unknown) => (seen.push(1), { ...Object(o), schemaVersion: 2, a: 1 }),
      2: (o: unknown) => (seen.push(2), { ...Object(o), schemaVersion: 3, b: 2 }),
    };
    expect(migrateProfile({ schemaVersion: 1 }, steps, 3)).toEqual({
      ok: true,
      value: { schemaVersion: 3, a: 1, b: 2 },
    });
    expect(seen).toEqual([1, 2]);
    seen.length = 0;
    expect(migrateProfile({ schemaVersion: 2 }, steps, 3)).toEqual({
      ok: true,
      value: { schemaVersion: 3, b: 2 },
    });
    expect(seen).toEqual([2]);
  });

  it("leaves a current-version profile alone", () => {
    const p = { schemaVersion: SCHEMA_VERSION, x: 1 };
    expect(migrateProfile(p)).toEqual({ ok: true, value: p });
  });

  it.each([
    ["not an object", "x"],
    ["null", null],
    ["no version", {}],
    ["version 0", { schemaVersion: 0 }],
    ["text version", { schemaVersion: "1" }],
    ["fractional version", { schemaVersion: 1.5 }],
    ["a newer version", { schemaVersion: SCHEMA_VERSION + 1 }],
  ])("fails, without throwing, on %s", (_label, raw) => {
    expect(migrateProfile(raw).ok).toBe(false);
  });

  it("fails on a missing step or a step that throws", () => {
    expect(migrateProfile({ schemaVersion: 1 }, {}, 2)).toEqual({
      ok: false,
      error: "no migration from version 1",
    });
    const r = migrateProfile(
      { schemaVersion: 1 },
      {
        1: () => {
          throw new Error("boom");
        },
      },
      2,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("boom");
  });
});
