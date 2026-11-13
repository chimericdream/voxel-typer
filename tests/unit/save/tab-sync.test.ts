/** The tab channel, locks and announcing store (task M3-FIX-9). */
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../../../src/save/store";
import {
  TAB_CHANNEL,
  announcingStore,
  browserLocks,
  isTabMessage,
  lockName,
  openTabChannel,
} from "../../../src/save/tab-sync";
import type { TabChannel, TabMessage } from "../../../src/save/tab-sync";
import { fixture } from "../app/helpers";

function recorder(): TabChannel & { sent: TabMessage[] } {
  const sent: TabMessage[] = [];
  return { sent, post: (m) => sent.push(m), listen: () => () => undefined };
}

describe("isTabMessage", () => {
  it("accepts the three message shapes and nothing else", () => {
    expect(isTabMessage({ v: 1, type: "saved", id: "a", from: "t" })).toBe(true);
    expect(isTabMessage({ v: 1, type: "removed", id: "a", from: "t" })).toBe(true);
    expect(isTabMessage({ v: 1, type: "changed", from: "t" })).toBe(true);
    for (const bad of [
      null,
      "saved",
      { v: 2, type: "saved", id: "a", from: "t" },
      { v: 1, type: "saved", from: "t" },
      { v: 1, type: "saved", id: "", from: "t" },
      { v: 1, type: "other", id: "a", from: "t" },
      { v: 1, type: "saved", id: "a" },
    ]) {
      expect(isTabMessage(bad)).toBe(false);
    }
  });
});

describe("openTabChannel", () => {
  it("is null without BroadcastChannel", () => {
    expect(openTabChannel(TAB_CHANNEL, null)).toBeNull();
  });

  it("passes on well-formed messages only, under the game's channel name", () => {
    const made: string[] = [];
    const handlers = new Set<(e: MessageEvent) => void>();
    const posted: unknown[] = [];
    class Fake {
      constructor(name: string) {
        made.push(name);
      }
      postMessage(m: unknown) {
        posted.push(m);
      }
      addEventListener(_: "message", fn: (e: MessageEvent) => void) {
        handlers.add(fn);
      }
      removeEventListener(_: "message", fn: (e: MessageEvent) => void) {
        handlers.delete(fn);
      }
    }
    const ch = openTabChannel(undefined, Fake);
    if (ch === null) throw new Error("no channel");
    expect(made).toEqual(["voxel-typer-saves"]);
    const got: TabMessage[] = [];
    const off = ch.listen((m) => got.push(m));
    const good: TabMessage = { v: 1, type: "saved", id: "a", from: "t" };
    for (const h of handlers) h(new MessageEvent("message", { data: { nope: true } }));
    for (const h of handlers) h(new MessageEvent("message", { data: good }));
    expect(got).toEqual([good]);
    ch.post(good);
    expect(posted).toEqual([good]);
    off();
    expect(handlers.size).toBe(0);
  });
});

describe("browserLocks", () => {
  it("is null without navigator.locks, and uses one lock per player when there are", async () => {
    expect(browserLocks(null)).toBeNull();
    const names: string[] = [];
    const locks = browserLocks({
      request<T>(name: string, fn: () => Promise<T>) {
        names.push(name);
        return fn();
      },
    });
    expect(await locks?.run("p1", () => Promise.resolve(7))).toBe(7);
    expect(names).toEqual([lockName("p1")]);
    expect(lockName("p1")).toBe("voxel-typer:profile:p1");
  });
});

describe("announcingStore", () => {
  it("tells other tabs after a save or remove succeeds, and only then", async () => {
    const ch = recorder();
    const store = announcingStore(createMemoryStore(), ch, "tab-a");
    const p = fixture("fresh-sprout");
    await store.save(p);
    await store.remove(p.id);
    expect(ch.sent).toEqual([
      { v: 1, type: "saved", id: p.id, from: "tab-a" },
      { v: 1, type: "removed", id: p.id, from: "tab-a" },
    ]);
    // A save the store refuses posts nothing.
    await expect(store.save({ ...p, name: "" })).rejects.toThrow();
    expect(ch.sent).toHaveLength(2);
  });

  it("an import that added someone says any player may have changed", async () => {
    const ch = recorder();
    const store = announcingStore(createMemoryStore(), ch, "tab-a");
    const file = new Blob([
      JSON.stringify({ app: "voxel-typer", version: 1, profiles: [fixture("fresh-sprout")] }),
    ]);
    expect((await store.importAll(file)).imported).toBe(1);
    expect(ch.sent).toEqual([{ v: 1, type: "changed", from: "tab-a" }]);
    await store.importAll(new Blob(["{"]));
    expect(ch.sent).toHaveLength(1);
  });
});
