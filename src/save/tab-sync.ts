/**
 * Two-tab safety (task M3-FIX-9). Two tabs of the game share one IndexedDB, so without this a tab
 * holding an old copy of a player could save it over newer progress from another tab.
 *
 * - The guard itself is `SaveStore.saveIfUnchanged`: the shell (`src/app/shell.ts`) saves only if
 *   the stored record is still the one it last saw, checked inside the write's own transaction.
 *   So a stale tab never writes over a newer record, with or without the extras below.
 * - {@link guardedStore} wraps the store. After every save and remove it posts a small message on
 *   a `BroadcastChannel`, so the other tabs fetch the newest copy at once. And every write of one
 *   player (the shell's, an import's, the Players screen's, a remove) holds that player's Web Lock
 *   when the browser has them: an extra guard on top of the transaction.
 *
 * Messages carry only a profile id; they stay inside this browser on this device. Nothing goes
 * over the network.
 */
import type { SaveStore } from "./store";

/** The channel name every tab of the game uses. */
export const TAB_CHANNEL = "voxel-typer-saves";

/**
 * What one tab tells the others. `from` is the sending tab's id, so a tab ignores its own.
 * `changed` with no id means "any player may have changed" (`importAll`).
 */
export type TabMessage =
  | { v: 1; type: "saved" | "removed"; id: string; from: string }
  | { v: 1; type: "changed"; from: string };

/** A message bus between tabs. {@link openTabChannel} gives the browser's; tests use a fake. */
export interface TabChannel {
  post(m: TabMessage): void;
  /** Listens for other tabs' messages. Returns the unsubscribe. */
  listen(fn: (m: TabMessage) => void): () => void;
}

/** Runs `fn` while holding the lock for one player, across every tab of the game. */
export interface ProfileLocks {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

/** What the shell needs for two-tab safety. */
export interface TabSync {
  /** This tab's id (random, made once per page load). */
  tabId: string;
  /** Null when the browser has no `BroadcastChannel`: the save-time check still guards. */
  channel: TabChannel | null;
  /** Web Locks, when the browser has them. Only {@link guardedStore} uses them. */
  locks?: ProfileLocks;
}

const isRecord = (x: unknown): x is object => typeof x === "object" && x !== null;

/** True for a well-formed {@link TabMessage}. Anything else on the channel is ignored. */
export function isTabMessage(x: unknown): x is TabMessage {
  if (!isRecord(x)) return false;
  const v: unknown = Reflect.get(x, "v");
  const type: unknown = Reflect.get(x, "type");
  const from: unknown = Reflect.get(x, "from");
  if (v !== 1 || typeof from !== "string") return false;
  if (type === "changed") return true;
  if (type !== "saved" && type !== "removed") return false;
  const id: unknown = Reflect.get(x, "id");
  return typeof id === "string" && id !== "";
}

/** The constructor this module needs; `globalThis.BroadcastChannel` in a browser. */
type ChannelCtor = new (name: string) => {
  postMessage(m: unknown): void;
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  removeEventListener(type: "message", fn: (e: MessageEvent) => void): void;
};

/** The browser's `BroadcastChannel`, or null when there is none (very old browsers, some tests). */
export function openTabChannel(
  name: string = TAB_CHANNEL,
  Ctor: ChannelCtor | null | undefined = globalThis.BroadcastChannel,
): TabChannel | null {
  if (Ctor === undefined || Ctor === null) return null;
  let bc: InstanceType<ChannelCtor>;
  try {
    bc = new Ctor(name);
  } catch {
    return null;
  }
  return {
    post(m) {
      try {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- reason: a BroadcastChannel has no target origin; it only reaches this origin's tabs
        bc.postMessage(m);
      } catch (e) {
        // A closed channel must not break saving; the save-time check still guards.
        console.warn("[save] tab message not sent", e);
      }
    },
    listen(fn) {
      const handler = (e: MessageEvent): void => {
        const data: unknown = e.data;
        if (isTabMessage(data)) fn(data);
      };
      bc.addEventListener("message", handler);
      return () => bc.removeEventListener("message", handler);
    },
  };
}

/** The part of `navigator.locks` this module uses. */
export interface LockManagerLike {
  request<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

/** The lock name for one player. */
export const lockName = (id: string): string => `voxel-typer:profile:${id}`;

/**
 * Web Locks when the browser has them (`navigator.locks`, secure contexts only), else null: the
 * app can be served over plain HTTP on a LAN (contracts §15), where there are none.
 */
export function browserLocks(
  locks: LockManagerLike | null | undefined = globalThis.navigator?.locks,
): ProfileLocks | null {
  if (locks === undefined || locks === null || typeof locks.request !== "function") return null;
  return {
    run: (id, fn) => locks.request(lockName(id), fn),
  };
}

/**
 * The store, telling the other tabs after every write, with each player's writes under its lock.
 * Posting happens only after the write succeeded; a failed write posts nothing. Reads are
 * unchanged. `importAll` takes no lock: it never writes over a stored id (a clash gets a new one).
 */
export function guardedStore(store: SaveStore, sync: TabSync): SaveStore {
  const { channel, tabId, locks } = sync;
  const locked = <T>(id: string, fn: () => Promise<T>): Promise<T> =>
    locks === undefined ? fn() : locks.run(id, fn);
  const post = (m: TabMessage): void => channel?.post(m);
  return {
    listProfiles: () => store.listProfiles(),
    load: (id) => store.load(id),
    async save(p) {
      await locked(p.id, () => store.save(p));
      post({ v: 1, type: "saved", id: p.id, from: tabId });
    },
    async saveIfUnchanged(p, expected) {
      const json = await locked(p.id, () => store.saveIfUnchanged(p, expected));
      post({ v: 1, type: "saved", id: p.id, from: tabId });
      return json;
    },
    async remove(id) {
      await locked(id, () => store.remove(id));
      post({ v: 1, type: "removed", id, from: tabId });
    },
    exportAll: () => store.exportAll(),
    async importAll(file) {
      const out = await store.importAll(file);
      if (out.imported > 0) post({ v: 1, type: "changed", from: tabId });
      return out;
    },
  };
}
