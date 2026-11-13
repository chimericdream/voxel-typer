/**
 * Helpers for the M4 e2e suite (task M4-10): reading a night through `window.__vt`, and putting a
 * fixture player into the game's real IndexedDB store, so a reload keeps what was saved
 * (`?profile=` uses a throwaway memory store).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expectScreen } from "../helpers/slice";
import { ready } from "../helpers/vt";

export interface NightState {
  /** Words on the field, in the order their mobs set out. */
  words: string[];
  /** The key that moves the night on: the locked word's next char, or a first letter. */
  next: string | null;
  locked: boolean;
}

/** Reads the night's typing session (the `lockOn` view) through `window.__vt`. */
export async function night(page: Page): Promise<NightState> {
  return page.evaluate(() => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- reason: this runs in the page; page.evaluate sends only the function it is given
    const get = (o: unknown, k: string): unknown =>
      typeof o === "object" && o !== null ? Reflect.get(o, k) : undefined;
    const hooks: unknown = Reflect.get(window, "__vt");
    const fn = get(hooks, "session");
    const session: unknown = typeof fn === "function" ? Reflect.apply(fn, hooks, []) : null;
    const raw = get(session, "targets");
    const targets: unknown[] = Array.isArray(raw) ? raw : [];
    const open = targets.filter((x) => get(x, "complete") !== true);
    const words = open.flatMap((x) => {
      const word = get(x, "text");
      return typeof word === "string" ? [word] : [];
    });
    const active = get(session, "active");
    const text = get(active, "text");
    if (typeof text === "string") {
      const typed = Number(get(active, "typed") ?? 0);
      return { words, next: Array.from(text)[typed] ?? null, locked: true };
    }
    return { words, next: Array.from(words[0] ?? "")[0] ?? null, locked: false };
  });
}

/** A fixture profile as parsed JSON, with its id. */
export function fixtureJson(name: string): { id: string; json: string } {
  const json = readFileSync(
    resolve(import.meta.dirname, `../../fixtures/profiles/${name}.json`),
    "utf8",
  );
  const raw: unknown = JSON.parse(json);
  const id: unknown = typeof raw === "object" && raw !== null ? Reflect.get(raw, "id") : null;
  if (typeof id !== "string") throw new Error(`fixture ${name} has no id`);
  return { id, json: JSON.stringify(raw) };
}

/** Writes one stored record (a profile as JSON, under its id) into the game's IndexedDB store. */
export async function seedRecord(page: Page, id: string, json: string): Promise<void> {
  await page.evaluate(
    ([key, value]) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open("voxel-typer", 1);
        open.addEventListener("upgradeneeded", () => open.result.createObjectStore("profiles"));
        open.addEventListener("error", () => fail(open.error ?? new Error("open failed")));
        open.addEventListener("success", () => {
          const db = open.result;
          const tx = db.transaction("profiles", "readwrite");
          tx.objectStore("profiles").put(value, key);
          tx.addEventListener("complete", () => {
            db.close();
            done();
          });
          tx.addEventListener("error", () => fail(tx.error ?? new Error("write failed")));
        });
      }),
    [id, json] as const,
  );
}

/** The stored record of `id` in the game's IndexedDB store, parsed, or null. */
export async function storedRecord(page: Page, id: string): Promise<unknown> {
  const raw = await page.evaluate(
    (key) =>
      new Promise<unknown>((done, fail) => {
        const open = indexedDB.open("voxel-typer", 1);
        open.addEventListener("upgradeneeded", () => open.result.createObjectStore("profiles"));
        open.addEventListener("error", () => fail(open.error ?? new Error("open failed")));
        open.addEventListener("success", () => {
          const db = open.result;
          const req = db.transaction("profiles", "readonly").objectStore("profiles").get(key);
          req.addEventListener("error", () => fail(req.error ?? new Error("read failed")));
          req.addEventListener("success", () => {
            const value: unknown = req.result;
            db.close();
            done(value ?? null);
          });
        });
      }),
    id,
  );
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

/**
 * Puts fixture `name` into the real store, reloads, and picks that player on the Players screen,
 * as a child coming back the next day would. Ends on the map.
 */
export async function comeBackAs(page: Page, name: string, playerName: RegExp): Promise<string> {
  const { id, json } = fixtureJson(name);
  await page.goto("/?seed=1");
  await ready(page);
  await seedRecord(page, id, json);
  await pickPlayer(page, playerName);
  return id;
}

/** Reloads the page and picks `playerName` on the Players screen. Ends on the map. */
export async function pickPlayer(page: Page, playerName: RegExp): Promise<void> {
  await page.goto("/?seed=1");
  await ready(page);
  await page.keyboard.press("Enter");
  await expectScreen(page, "profiles");
  await page.getByRole("button", { name: playerName }).click();
  await expectScreen(page, "map");
}
