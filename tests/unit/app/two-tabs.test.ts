/**
 * Two-tab safety (task M3-FIX-9): two tabs of the game share one store, and a stale tab never
 * writes over another tab's newer progress. Each "tab" here is its own shell, with its own store
 * object over one shared backend (like two tabs over one IndexedDB), joined by a fake channel.
 */
import { describe, expect, it, vi } from "vitest";
import { createSilentAudio } from "../../../src/app/audio";
import { realClock } from "../../../src/app/clock";
import { createHudStore } from "../../../src/app/hud";
import { rebaseCounts } from "../../../src/app/play-host";
import { foundBlocks } from "../../../src/engine/achievements";
import { createShell } from "../../../src/app/shell";
import { BUILDER_ISLAND_EXTRA, BUILDER_SAVE_EVENT } from "../../../src/modes/builder/lesson";
import type { IslandPatch } from "../../../src/modes/builder/lesson";
import type { Profile } from "../../../src/save/schema";
import { createMemoryBackend, createStoreOn } from "../../../src/save/store";
import type { Backend } from "../../../src/save/store";
import { guardedStore } from "../../../src/save/tab-sync";
import type { ProfileLocks, TabChannel, TabMessage } from "../../../src/save/tab-sync";
import { fakeMode, fakeScene, fixture, flush, lesson, result, summary } from "./helpers";

/** A fake `BroadcastChannel`: delivery is async, and can be held back to open a race. */
function fakeBus() {
  const listeners = new Set<(m: TabMessage) => void>();
  const held: TabMessage[] = [];
  let holding = false;
  const deliver = (m: TabMessage): void => {
    // Like the real one: a copy of the data, in a later task.
    const copy = structuredClone(m);
    queueMicrotask(() => {
      for (const l of listeners) l(copy);
    });
  };
  return {
    channel(): TabChannel {
      return {
        post(m) {
          if (holding) held.push(m);
          else deliver(m);
        },
        listen(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      };
    },
    /** Messages wait until {@link release}. */
    hold() {
      holding = true;
    },
    release() {
      holding = false;
      for (const m of held.splice(0)) deliver(m);
    },
    /** Messages are lost, as if the browser had no channel. */
    drop() {
      holding = true;
      held.length = 0;
      return () => {
        held.length = 0;
      };
    },
  };
}

/** One lock per name for every tab, like `navigator.locks`. */
function fakeLocks(): ProfileLocks & { names: string[] } {
  const tails = new Map<string, Promise<unknown>>();
  const names: string[] = [];
  return {
    names,
    run(id, fn) {
      names.push(id);
      const before = tails.get(id) ?? Promise.resolve();
      const next = before.then(fn, fn);
      tails.set(
        id,
        next.catch(() => undefined),
      );
      return next;
    },
  };
}

type Bus = ReturnType<typeof fakeBus>;

function openTab(backend: Backend, bus: Bus, locks: ProfileLocks, tabId: string) {
  const mode = fakeMode();
  const channel = bus.channel();
  const store = guardedStore(createStoreOn(backend), { tabId, channel, locks });
  const shell = createShell({
    store,
    lessons: [lesson(), lesson({ id: "meadow-02", order: 2 })],
    resolveMode: () => mode.module,
    acquireScene: () => Promise.resolve(fakeScene()),
    hud: createHudStore(),
    audio: { ...createSilentAudio(), setSpeechEnabled: vi.fn() },
    clock: realClock,
    nextSeed: () => 1,
    frozen: false,
    record: false,
    applySettings: () => undefined,
    focusOnControl: () => false,
    showCanvas: () => undefined,
    tabs: { tabId, channel },
  });
  return { shell, store, mode, api: shell.api };
}

async function twoTabs(name = "fresh-sprout") {
  const map = new Map<string, unknown>();
  const backend = createMemoryBackend(map);
  const bus = fakeBus();
  const locks = fakeLocks();
  const p = fixture(name);
  await createStoreOn(backend).save(p);
  const a = openTab(backend, bus, locks, "tab-a");
  const b = openTab(backend, bus, locks, "tab-b");
  // Both tabs pick the same player from the Players screen (a fresh load each).
  for (const t of [a, b]) {
    const loaded = await t.store.load(p.id);
    if (loaded === null) throw new Error("not stored");
    t.api.setProfile(loaded);
    t.api.navigate({ id: "map" });
  }
  const stored = async (): Promise<Profile> => {
    const s = await createStoreOn(backend).load(p.id);
    if (s === null) throw new Error("gone from the store");
    return s;
  };
  const settle = async (): Promise<void> => {
    await flush();
    await Promise.all([a.shell.ready(), b.shell.ready()]);
    await flush();
  };
  return { a, b, bus, locks, p, map, stored, settle };
}

const bigger = (p: Profile): Profile => ({ ...p, settings: { ...p.settings, textScale: 1.25 } });
const kinds = (t: { shell: { notices: { value: readonly { kind: string }[] } } }): string[] =>
  t.shell.notices.value.map((n) => n.kind);

describe("two tabs (M3-FIX-9)", () => {
  it("after another tab saves, the other tab reloads that player and says so kindly", async () => {
    const s = await twoTabs();
    const next = bigger(s.p);
    expect(await s.a.api.saveProfile(next)).toBe(true);
    await s.settle();
    expect(s.b.api.profile()?.settings.textScale).toBe(1.25);
    expect(s.b.api.profile()).toEqual(await s.stored());
    expect(kinds(s.b)).toEqual(["otherTab"]);
    // The tab that saved is not told about its own save.
    expect(kinds(s.a)).toEqual([]);
    // Every check-and-save ran under the player's lock.
    expect(new Set(s.locks.names)).toEqual(new Set([s.p.id]));
  });

  it("a stale tab refuses to save over newer progress when the message never came", async () => {
    const s = await twoTabs();
    s.bus.drop();
    expect(await s.a.api.saveProfile(bigger(s.p))).toBe(true);
    await s.settle();
    // B still shows its old copy, and saves a change made from it.
    const stale = s.b.api.profile();
    if (stale === null) throw new Error("no profile");
    expect(stale.settings.textScale).toBe(s.p.settings.textScale);
    const ok = await s.b.api.saveProfile({ ...stale, settings: { ...stale.settings, tts: false } });
    await s.settle();
    expect(ok).toBe(false);
    // A's change is still there; B now shows it, and tells the child.
    const now = await s.stored();
    expect(now.settings.textScale).toBe(1.25);
    expect(now.settings.tts).toBe(s.p.settings.tts);
    expect(s.b.api.profile()).toEqual(now);
    expect(kinds(s.b)).toEqual(["otherTab"]);
    // Once B has the newest copy, its next change saves as usual.
    const fresh = s.b.api.profile();
    if (fresh === null) throw new Error("no profile");
    expect(await s.b.api.saveProfile({ ...fresh, name: "Zed" })).toBe(true);
    expect((await s.stored()).settings.textScale).toBe(1.25);
    expect((await s.stored()).name).toBe("Zed");
  });

  it("a save asked for from the old copy, before the reload ran, is refused too", async () => {
    const s = await twoTabs();
    s.bus.hold();
    await s.a.api.saveProfile(bigger(s.p));
    const old = s.b.api.profile();
    if (old === null) throw new Error("no profile");
    // The message arrives, and in the same moment B's screen saves from the copy it had.
    s.bus.release();
    await Promise.resolve();
    await Promise.resolve();
    const ok = s.b.api.saveProfile({ ...old, name: "Old" });
    expect(await ok).toBe(false);
    await s.settle();
    expect((await s.stored()).name).toBe(s.p.name);
    expect((await s.stored()).settings.textScale).toBe(1.25);
  });

  it("a lesson finished in the stale tab is added to the newer copy: nothing is lost", async () => {
    const s = await twoTabs();
    s.b.api.navigate({ id: "play", lesson: "meadow-01" });
    await s.settle();
    expect(s.b.shell.playStatus.value).toBe("running");
    // A changes the player while B's lesson runs, and B never hears about it.
    s.bus.drop();
    const aCopy = { ...bigger(s.p), inventory: { ...s.p.inventory, "found-a": 3 } };
    expect(await s.a.api.saveProfile(aCopy)).toBe(true);
    s.b.mode.ctx().finish(result());
    await s.settle();
    const now = await s.stored();
    // A's change stays …
    expect(now.settings.textScale).toBe(1.25);
    expect(now.inventory["found-a"]).toBe(3);
    // … and B's lesson is recorded on top of it.
    expect(now.progress.lessons["meadow-01"]?.plays).toBe(1);
    expect(now.history).toHaveLength(s.p.history.length + 1);
    expect(s.b.api.profile()).toEqual(now);
    expect(s.b.shell.route.value.id).toBe("results");
  });

  it("with the message, the stale tab's lesson starts from the newer copy too", async () => {
    const s = await twoTabs();
    s.b.api.navigate({ id: "play", lesson: "meadow-01" });
    await s.settle();
    s.a.api.navigate({ id: "play", lesson: "meadow-02" });
    await s.settle();
    s.a.mode.ctx().finish(result());
    await s.settle();
    // B took A's result while its own lesson ran, then adds its own.
    expect(s.b.api.profile()?.progress.lessons["meadow-02"]?.plays).toBe(1);
    s.b.mode.ctx().finish(result());
    await s.settle();
    const now = await s.stored();
    expect(now.progress.lessons["meadow-01"]?.plays).toBe(1);
    expect(now.progress.lessons["meadow-02"]?.plays).toBe(1);
    expect(now.history).toHaveLength(s.p.history.length + 2);
    // A hears about B's lesson in turn.
    expect(s.a.api.profile()).toEqual(now);
  });

  it("a player removed in another tab is never written back", async () => {
    const s = await twoTabs();
    const old = s.b.api.profile();
    if (old === null) throw new Error("no profile");
    expect(await s.a.api.removeProfile(s.p.id)).toBe(true);
    await s.settle();
    expect(s.b.api.profile()).toBeNull();
    expect(s.b.shell.route.value.id).toBe("profiles");
    expect(kinds(s.b)).toEqual(["otherTabRemoved"]);
    expect(await s.b.api.saveProfile(old)).toBe(false);
    await s.settle();
    expect(s.map.has(s.p.id)).toBe(false);
  });

  it("Builder keeps blocks another tab found, and adds its own building to them", async () => {
    const s = await twoTabs("veteran-builder");
    const start = s.b.api.profile();
    if (start?.island === null || start === null) throw new Error("no island");
    s.b.api.navigate({ id: "island" });
    await s.settle();
    // A's lesson finds 5 glass; B hears it and stays on its island (the island didn't change).
    const aCopy = {
      ...s.p,
      inventory: { ...s.p.inventory, glass: (s.p.inventory.glass ?? 0) + 5 },
    };
    await s.a.api.saveProfile(aCopy);
    await s.settle();
    expect(s.b.shell.route.value.id).toBe("play");
    // B places 2 cobble and saves.
    const patch: IslandPatch = {
      island: { ...start.island, lastEdited: start.island.lastEdited + 1000 },
      inventory: { ...start.inventory, cobble: (start.inventory.cobble ?? 0) - 2 },
    };
    s.b.mode.ctx().bus.emit(BUILDER_SAVE_EVENT, patch);
    await s.settle();
    const now = await s.stored();
    expect(now.inventory.glass).toBe((s.p.inventory.glass ?? 0) + 5);
    expect(now.inventory.cobble).toBe((s.p.inventory.cobble ?? 0) - 2);
    expect(now.island?.lastEdited).toBe(start.island.lastEdited + 1000);
  });

  it("two islands can't be merged: B keeps A's island and blocks, and still saves its session (B2)", async () => {
    const s = await twoTabs("veteran-builder");
    const start = s.b.api.profile();
    if (start?.island === null || start === null) throw new Error("no island");
    s.b.api.navigate({ id: "island" });
    await s.settle();
    s.bus.drop();
    // A changes the island and spends 3 cobble on it.
    const aIsland = { ...start.island, lastEdited: start.island.lastEdited + 5 };
    const aInventory = { ...s.p.inventory, cobble: (s.p.inventory.cobble ?? 0) - 3 };
    await s.a.api.saveProfile({ ...s.p, island: aIsland, inventory: aInventory });
    const before = await s.stored();
    // B leaves its island after typing, with an island of its own and a badge earned live.
    s.b.mode.ctx().finish({
      summary: summary({ lessonId: "builder", mode: "builder", keystrokes: 12 }),
      loot: {},
      stars: 0,
      extra: {
        [BUILDER_ISLAND_EXTRA]: {
          island: { ...start.island, lastEdited: start.island.lastEdited + 9 },
          inventory: { ...start.inventory, cobble: (start.inventory.cobble ?? 0) - 7 },
        },
      },
    });
    await s.settle();
    const now = await s.stored();
    // Blocks are conserved: A's island and inventory, as A left them; `found` untouched.
    expect(now.island).toEqual(aIsland);
    expect(now.inventory).toEqual(aInventory);
    expect(foundBlocks(now)).toEqual(foundBlocks(before));
    // B's practice still counts.
    expect(now.history).toHaveLength(before.history.length + 1);
    expect(now.sessionCounter).toBe(before.sessionCounter + 1);
  });

  it("two islands can't be merged: the stale Builder tab leaves, and its island isn't written", async () => {
    const s = await twoTabs("veteran-builder");
    const start = s.b.api.profile();
    if (start?.island === null || start === null) throw new Error("no island");
    s.b.api.navigate({ id: "island" });
    await s.settle();
    // A edits the island in its own window first; B doesn't hear it in time.
    s.bus.drop();
    const aIsland = { ...start.island, lastEdited: start.island.lastEdited + 5 };
    await s.a.api.saveProfile({ ...s.p, island: aIsland });
    s.b.mode.ctx().bus.emit(BUILDER_SAVE_EVENT, {
      island: { ...start.island, lastEdited: start.island.lastEdited + 9 },
      inventory: start.inventory,
    });
    await s.settle();
    expect((await s.stored()).island?.lastEdited).toBe(aIsland.lastEdited);
    expect(s.b.shell.route.value.id).toBe("map");
    expect(kinds(s.b)).toEqual(["otherTab"]);
  });

  it("an import in another tab that replaces the player is taken, not written over", async () => {
    const s = await twoTabs();
    // The import screen writes with `store.save`, as ImportExport does.
    await s.a.store.save({ ...s.p, name: "Imported" });
    await s.settle();
    expect(s.b.api.profile()?.name).toBe("Imported");
    const b = s.b.api.profile();
    if (b === null) throw new Error("no profile");
    await s.b.api.saveProfile(bigger(b));
    expect((await s.stored()).name).toBe("Imported");
  });
});

describe("two tabs: the review's cases (M3-FIX-9 rework)", () => {
  it("one tab, damaged current record: the next save keeps everything, no 'other window' (B1)", async () => {
    const s = await twoTabs("meadow-done-miner");
    // Only tab A plays. Two saves, so `:prev` is the older one.
    const first = s.a.api.profile();
    if (first === null) throw new Error("no profile");
    s.a.api.navigate({ id: "play", lesson: "meadow-01" });
    await s.settle();
    s.a.mode.ctx().finish(result({ loot: { "loot-one": 1 } }));
    await s.settle();
    s.a.api.navigate({ id: "play", lesson: "meadow-02" });
    await s.settle();
    s.a.mode.ctx().finish(result({ loot: { "loot-two": 1 } }));
    await s.settle();
    const live = s.a.api.profile();
    if (live === null) throw new Error("no profile");
    s.map.set(s.p.id, "{garbage");
    await s.a.api.saveProfile({ ...live, settings: { ...live.settings, tts: !live.settings.tts } });
    await s.settle();
    const now = await s.stored();
    expect(now.inventory["loot-one"]).toBe(1);
    expect(now.inventory["loot-two"]).toBe(1);
    expect(now.found?.["loot-two"]).toBe(1);
    expect(now.progress.lessons).toEqual(live.progress.lessons);
    expect(now.history).toEqual(live.history);
    expect(now.settings.tts).toBe(!live.settings.tts);
    expect(kinds(s.a)).not.toContain("otherTab");
    expect(s.a.api.profile()).toEqual(now);
  });

  it("removed in another tab with the message lost: a lesson or plain save never brings it back", async () => {
    const s = await twoTabs();
    s.b.api.navigate({ id: "play", lesson: "meadow-01" });
    await s.settle();
    s.bus.drop();
    expect(await s.a.api.removeProfile(s.p.id)).toBe(true);
    s.b.mode.ctx().finish(result());
    await s.settle();
    expect(s.map.has(s.p.id)).toBe(false);
    expect(kinds(s.b)).toContain("otherTabRemoved");
    expect(await s.b.api.saveProfile(bigger(s.p))).toBe(false);
    expect(s.map.has(s.p.id)).toBe(false);
  });

  it("imports, the Players screen's edits and removes take the player's lock", async () => {
    const s = await twoTabs();
    s.locks.names.length = 0;
    await s.a.store.save({ ...s.p, name: "Imported" });
    await s.a.store.remove(s.p.id);
    expect(s.locks.names).toEqual([s.p.id, s.p.id]);
  });

  it("picking a player whose copy changed elsewhere keeps the placement-test mark", async () => {
    const s = await twoTabs();
    // B moves to nobody, so the copy it knew of this player goes old.
    s.b.api.setProfile(null);
    s.bus.drop();
    await s.a.api.saveProfile(bigger(s.p));
    // The Players screen: load, pick, then save the mark (Profiles.tsx).
    const loaded = await s.b.store.load(s.p.id);
    if (loaded === null) throw new Error("no profile");
    s.b.api.setProfile(loaded);
    const marked = { ...loaded, name: "Marked" };
    expect(await s.b.api.saveProfile(marked)).toBe(true);
    expect((await s.stored()).name).toBe("Marked");
    expect((await s.stored()).settings.textScale).toBe(1.25);
  });
});

describe("rebaseCounts (Builder inventory onto a newer copy)", () => {
  it("adds this tab's change to the newer counts, never below 0, keeping keys at 0", () => {
    expect(rebaseCounts({ a: 10, b: 1 }, { a: 4, b: 3 }, { a: 2, b: 0, c: 1 })).toEqual({
      a: 8,
      b: 0,
      c: 1,
    });
    expect(rebaseCounts({ a: 5 }, { a: 5 }, { a: 5 })).toEqual({ a: 5 });
  });
});
