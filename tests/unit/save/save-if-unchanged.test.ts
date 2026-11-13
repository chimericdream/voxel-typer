/** `SaveStore.saveIfUnchanged`: the in-transaction compare-and-swap (M3-FIX-9). */
import { describe, expect, it } from "vitest";
import {
  NewerSaveError,
  StaleSaveError,
  createMemoryBackend,
  createStoreOn,
} from "../../../src/save/store";
import { fixture } from "../app/helpers";

function setup() {
  const map = new Map<string, unknown>();
  const store = createStoreOn(createMemoryBackend(map));
  return { map, store };
}

describe("saveIfUnchanged", () => {
  it("writes when the stored record is the expected one, and returns the new record", async () => {
    const { map, store } = setup();
    const p = fixture("fresh-sprout");
    await store.save(p);
    const expected = map.get(p.id);
    if (typeof expected !== "string") throw new Error("no record");
    const json = await store.saveIfUnchanged({ ...p, name: "Two" }, expected);
    expect(map.get(p.id)).toBe(json);
    expect(map.get(`${p.id}:prev`)).toBe(expected);
    // The returned record is the next `expected`.
    await store.saveIfUnchanged({ ...p, name: "Three" }, json);
    expect((await store.load(p.id))?.name).toBe("Three");
  });

  it("refuses, writing nothing, when another tab saved since; the error holds that copy", async () => {
    const { map, store } = setup();
    const p = fixture("fresh-sprout");
    await store.save(p);
    const old = map.get(p.id);
    if (typeof old !== "string") throw new Error("no record");
    await store.save({ ...p, name: "Other" });
    const before = new Map(map);
    const err = await store.saveIfUnchanged({ ...p, name: "Mine" }, old).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleSaveError);
    if (!(err instanceof StaleSaveError)) return;
    expect(err.current?.name).toBe("Other");
    expect(err.record).toBe(map.get(p.id));
    expect(map).toEqual(before);
  });

  it("refuses when the player was removed: it is never written back", async () => {
    const { map, store } = setup();
    const p = fixture("fresh-sprout");
    await store.save(p);
    const old = map.get(p.id);
    if (typeof old !== "string") throw new Error("no record");
    await store.remove(p.id);
    const err = await store.saveIfUnchanged(p, old).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleSaveError);
    if (err instanceof StaleSaveError) expect(err.current).toBeNull();
    expect(map.size).toBe(0);
  });

  it("a damaged current record is nobody's save: the write repairs it and keeps the good prev", async () => {
    const { map, store } = setup();
    const p = fixture("fresh-sprout");
    await store.save(p);
    const first = map.get(p.id);
    await store.save({ ...p, name: "Two" });
    const known = map.get(p.id);
    if (typeof known !== "string") throw new Error("no record");
    map.set(p.id, "{garbage");
    await store.saveIfUnchanged({ ...p, name: "Three" }, known);
    expect((await store.load(p.id))?.name).toBe("Three");
    // The damaged record never becomes `:prev`; the good one before it stays.
    expect(map.get(`${p.id}:prev`)).toBe(first);
  });

  it("a newer game's record still wins over the check", async () => {
    const { map, store } = setup();
    const p = fixture("fresh-sprout");
    map.set(p.id, JSON.stringify({ ...p, schemaVersion: 99 }));
    const err = await store.saveIfUnchanged(p, "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NewerSaveError);
  });
});
