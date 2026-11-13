/**
 * Two tabs racing (M3-FIX-9 rework; the data-safety review's harness). Two real shells over one
 * slow backend: every read and write waits a random 0–2 tasks, so the gap between one tab's read
 * and its write is open. Messages arrive on time, late (0–5 tasks) or never. Each tab finishes 4
 * lessons with loot of its own, at random moments. 40 seeds, with and without Web Locks.
 *
 * It must show zero lost lessons and zero double counts: 8 plays, 8 history entries, 8 sessions,
 * and every loot id exactly once in both `inventory` and `found`.
 */
import * as fakeIdb from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createSilentAudio } from "../../../src/app/audio";
import { realClock } from "../../../src/app/clock";
import { createHudStore } from "../../../src/app/hud";
import { createShell } from "../../../src/app/shell";
import { createIdbStore, createMemoryBackend, createStoreOn } from "../../../src/save/store";
import type { Backend } from "../../../src/save/store";
import { guardedStore } from "../../../src/save/tab-sync";
import type { ProfileLocks, TabChannel, TabMessage } from "../../../src/save/tab-sync";
import { fakeMode, fakeScene, fixture, lesson, result } from "./helpers";

/** A small seeded generator (mulberry32), so every run is the same. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` rounds of queued work. Microtasks keep 240 races fast; their order is still random. */
let macro = false;
const ticks = async (n: number): Promise<void> => {
  // Real IndexedDB (fake-indexeddb) finishes requests on macrotasks, so waiting on microtasks
  // alone would starve it: the IDB cells yield real timer turns instead.
  if (macro) {
    for (let i = 0; i < Math.max(1, n); i++) await new Promise((r) => setTimeout(r, 0));
    return;
  }
  for (let i = 0; i < n * 4; i++) await Promise.resolve();
};

/** A backend whose reads and writes each take a random number of tasks (like IDB transactions). */
function slow(inner: Backend, rnd: () => number): Backend {
  const wait = (): Promise<void> => ticks(Math.floor(rnd() * 3));
  return {
    keys: async () => {
      await wait();
      return inner.keys();
    },
    get: async (k) => {
      await wait();
      return inner.get(k);
    },
    write: async (id, plan) => {
      await wait();
      return inner.write(id, plan);
    },
    removeBoth: async (id) => {
      await wait();
      return inner.removeBoth(id);
    },
  };
}

/** Each message is dropped with probability `dropP`, else delivered 0–5 tasks later. */
function bus(rnd: () => number, dropP: number): () => TabChannel {
  const listeners = new Set<(m: TabMessage) => void>();
  return () => ({
    post(m) {
      if (rnd() < dropP) return;
      const copy = structuredClone(m);
      void ticks(Math.floor(rnd() * 6)).then(() => {
        for (const l of listeners) l(copy);
      });
    },
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
}

function fakeLocks(): ProfileLocks {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run(id, fn) {
      const next = (tails.get(id) ?? Promise.resolve()).then(fn, fn);
      tails.set(
        id,
        next.catch(() => undefined),
      );
      return next;
    },
  };
}

// indexedDB and friends as globals, the way a browser has them (for the real-IndexedDB cells).
Object.assign(globalThis, fakeIdb);

const LESSONS = 4;

async function race(
  seed: number,
  withLocks: boolean,
  dropP: number,
  idb = false,
): Promise<string[]> {
  const rnd = seeded(seed);
  const backend = createMemoryBackend();
  // Real IndexedDB code over fake-indexeddb: two connections to one database, like two tabs.
  const dbName = `vt-race-${seed}-${withLocks ? 1 : 0}-${dropP}`;
  const baseStore = () => (idb ? createIdbStore(dbName) : createStoreOn(slow(backend, rnd)));
  const p = fixture("fresh-sprout");
  await (idb ? createIdbStore(dbName) : createStoreOn(backend)).save(p);
  const channelFor = bus(rnd, dropP);
  const locks = withLocks ? fakeLocks() : undefined;
  const tabs = ["a", "b"].map((tabId) => {
    const mode = fakeMode();
    const channel = channelFor();
    const store = guardedStore(baseStore(), {
      tabId,
      channel,
      ...(locks && { locks }),
    });
    const shell = createShell({
      store,
      lessons: [lesson()],
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
    return { tabId, shell, mode, store };
  });
  for (const t of tabs) {
    const loaded = await t.store.load(p.id);
    if (loaded === null) throw new Error("not stored");
    t.shell.api.setProfile(loaded);
    t.shell.api.navigate({ id: "map" });
  }
  const play = async (t: (typeof tabs)[number]): Promise<void> => {
    for (let i = 0; i < LESSONS; i++) {
      t.shell.api.navigate({ id: "play", lesson: "meadow-01" });
      await ticks(3);
      while (t.shell.playStatus.value !== "running") await ticks(1);
      await ticks(Math.floor(rnd() * 8));
      t.mode.ctx().finish(result({ loot: { [`${t.tabId}${i}`]: 1 } }));
      while (t.shell.route.value.id !== "results") await ticks(1);
      await t.shell.ready();
      t.shell.api.navigate({ id: "map" });
      await ticks(Math.floor(rnd() * 4));
    }
  };
  await Promise.all(tabs.map(play));
  await ticks(20);
  for (const t of tabs) await t.shell.ready();
  const now = await (idb ? createIdbStore(dbName) : createStoreOn(backend)).load(p.id);
  if (now === null) return ["the player is gone"];
  const bad: string[] = [];
  const total = 2 * LESSONS;
  const plays = now.progress.lessons["meadow-01"]?.plays ?? 0;
  if (plays !== total) bad.push(`plays ${plays}`);
  if (now.history.length - p.history.length !== total) bad.push(`history ${now.history.length}`);
  if (now.sessionCounter - p.sessionCounter !== total) bad.push(`sessions ${now.sessionCounter}`);
  for (const t of tabs) {
    for (let i = 0; i < LESSONS; i++) {
      const k = `${t.tabId}${i}`;
      if (now.inventory[k] !== 1) bad.push(`inventory ${k}=${now.inventory[k] ?? 0}`);
      if (now.found?.[k] !== 1) bad.push(`found ${k}=${now.found?.[k] ?? 0}`);
    }
  }
  return bad;
}

describe("two tabs racing (M3-FIX-9)", () => {
  for (const withLocks of [true, false]) {
    for (const dropP of [0, 0.5, 1]) {
      it(`40 seeds, ${withLocks ? "Web Locks" : "no locks"}, ${dropP * 100}% messages lost: nothing lost or counted twice`, async () => {
        const failures: string[] = [];
        for (let seed = 1; seed <= 40; seed++) {
          const bad = await race(seed, withLocks, dropP);
          if (bad.length > 0) failures.push(`seed ${seed}: ${bad.join(", ")}`);
        }
        expect(failures).toEqual([]);
      }, 120_000);
    }
  }
  // The re-review's B3 harness: real IndexedDB code, where writes take real turns (M3-FIX-9).
  for (const withLocks of [true, false]) {
    it(`real IndexedDB, 20 seeds, ${withLocks ? "Web Locks" : "no locks"}, 50% messages lost: nothing lost`, async () => {
      const failures: string[] = [];
      macro = true;
      try {
        for (let seed = 1; seed <= 20; seed++) {
          const bad = await race(seed, withLocks, 0.5, true);
          if (bad.length > 0) failures.push(`seed ${seed}: ${bad.join(", ")}`);
        }
      } finally {
        macro = false;
      }
      expect(failures).toEqual([]);
    }, 240_000);
  }
});
