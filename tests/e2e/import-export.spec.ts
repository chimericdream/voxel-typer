/**
 * Save file export and import in a real browser (task M3-12), on real IndexedDB (no `?nosave`
 * and no `?profile`):
 * - one browser context makes a player through the UI, gets two more from fixtures and one damaged
 *   record, then downloads the save file from Settings → Grown-ups;
 * - a fresh context loads that file from the splash's grown-up link (no player yet), behind the
 *   parent gate;
 * - the profiles stored in the second context equal the first's (one fixture carries M3-10's
 *   optional `found`, one doesn't), and the damaged one was listed as
 *   left out. Axe is clean on the check and on the summary;
 * - the same file again: replacing one player offers "Download a save file first" (review N2).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expectNoAxeViolations, expectScreen } from "./helpers/slice";
import { collectErrors, ready } from "./helpers/vt";

const load = (name: string): unknown =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../fixtures/profiles/${name}.json`), "utf8"),
  );

/** One older save without `found`, one with it (M3-10's optional field): both must survive. */
const FIXTURES: unknown[] = [
  load("meadow-done-miner"),
  { ...Object(load("veteran-builder")), found: { grass: 40, dirt: 12, "oak-log": 5 } },
];

/** A record that can't be read: the export leaves it out and lists it. */
const DAMAGED = "00000000-0000-4000-8000-0000000000ff";

/** Every record in the game's IndexedDB store, as raw values by key. */
async function records(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((done, fail) => {
        const open = indexedDB.open("voxel-typer", 1);
        open.addEventListener("upgradeneeded", () => open.result.createObjectStore("profiles"));
        open.addEventListener("error", () => fail(open.error ?? new Error("open failed")));
        open.addEventListener("success", () => {
          const db = open.result;
          const out: Record<string, unknown> = {};
          const cursor = db
            .transaction("profiles", "readonly")
            .objectStore("profiles")
            .openCursor();
          cursor.addEventListener("error", () => fail(cursor.error ?? new Error("read failed")));
          cursor.addEventListener("success", () => {
            const c = cursor.result;
            if (c === null) {
              db.close();
              done(out);
              return;
            }
            if (typeof c.key === "string") out[c.key] = c.value;
            c.continue();
          });
        });
      }),
  );
}

/** Writes raw records straight into the game's store, as an older session would have. */
async function seed(page: Page, entries: [string, string][]): Promise<void> {
  await page.evaluate(
    (list) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open("voxel-typer", 1);
        open.addEventListener("upgradeneeded", () => open.result.createObjectStore("profiles"));
        open.addEventListener("error", () => fail(open.error ?? new Error("open failed")));
        open.addEventListener("success", () => {
          const db = open.result;
          const tx = db.transaction("profiles", "readwrite");
          for (const [key, value] of list) tx.objectStore("profiles").put(value, key);
          tx.addEventListener("complete", () => {
            db.close();
            done();
          });
          tx.addEventListener("error", () => fail(tx.error ?? new Error("write failed")));
        });
      }),
    entries,
  );
}

/** The current (not `:prev`) records, parsed, by id; the planted damaged one is left out. */
async function profiles(page: Page): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(await records(page))) {
    if (key.endsWith(":prev") || key === DAMAGED) continue;
    out[key] = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  }
  return out;
}

async function passGate(page: Page): Promise<void> {
  const word = (await page.locator("[data-gate-word]").textContent())?.trim() ?? "";
  expect(word).toMatch(/^[a-z]{6,8}$/);
  const field = page.getByLabel("Type the word");
  await expect(field).toBeFocused();
  await page.keyboard.type(word);
  await page.keyboard.press("Enter");
}

async function freshContext(browser: Browser): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL;
  return browser.newContext({
    ...(baseURL === undefined ? {} : { baseURL }),
    viewport: { width: 1280, height: 720 },
    acceptDownloads: true,
  });
}

test("export from one browser, import into a fresh one: the profiles are equal", async ({
  browser,
}) => {
  test.slow();
  const from = await freshContext(browser);
  const a = await from.newPage();
  const errorsA = collectErrors(a);

  // A player made through the UI, then two older ones and a damaged record.
  await a.goto("/", { waitUntil: "domcontentloaded" });
  await ready(a);
  await a.keyboard.press("k");
  await expectScreen(a, "profileCreate");
  await a.getByRole("textbox").fill("Basil");
  await a.keyboard.press("Enter");
  await expectScreen(a, "placement");
  await a.getByRole("button", { name: "Skip" }).click();
  await expectScreen(a, "map");
  await seed(a, [
    ...FIXTURES.map((p): [string, string] => [
      String(Reflect.get(Object(p), "id")),
      JSON.stringify(p),
    ]),
    [DAMAGED, "{damaged"],
  ]);

  await a.getByRole("button", { name: "Settings", exact: true }).click();
  await expectScreen(a, "settings");
  await a.getByRole("tab", { name: "Grown-ups" }).click();
  await passGate(a);
  const [download] = await Promise.all([
    a.waitForEvent("download"),
    a.getByRole("button", { name: "Download a save file" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^voxel-typer-\d{4}-\d{2}-\d{2}\.json$/);
  const file = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(file);
  await expect(a.locator("[data-export-result='done']")).toContainText("Saved 3 players");
  await expect(a.locator("[data-left-out='lost']")).toContainText(
    "One damaged player was left out",
  );
  await expectNoAxeViolations(a, "export: done");

  const expected = await profiles(a);
  expect(Object.keys(expected)).toHaveLength(3);
  expect(errorsA).toEqual([]);
  await from.close();

  // A new device: nothing stored yet.
  const to = await freshContext(browser);
  const b = await to.newPage();
  const errorsB = collectErrors(b);
  await b.goto("/", { waitUntil: "domcontentloaded" });
  await ready(b);
  await b.getByRole("button", { name: "Grown-ups: load a save file" }).click();
  await expectScreen(b, "settings");
  await b.getByRole("button", { name: "Load a save file", exact: true }).click();
  await passGate(b);
  const [chooser] = await Promise.all([
    b.waitForEvent("filechooser"),
    b.getByRole("button", { name: "Load a save file", exact: true }).click(),
  ]);
  await chooser.setFiles(file);
  const review = b.locator("[data-import-review]");
  await expect(review).toBeVisible();
  await expect(review).toBeFocused();
  await expect(review.locator("[data-row='add']")).toHaveCount(3);
  // Nothing is written before the grown-up says go.
  expect(await profiles(b)).toEqual({});
  await expectNoAxeViolations(b, "import: check");

  await b.getByRole("button", { name: "Load players" }).click();
  const result = b.locator("[data-import-result]");
  await expect(result).toContainText("Added 3, updated 0, not loaded 0.");
  await expectNoAxeViolations(b, "import: done");
  expect(await profiles(b)).toEqual(expected);

  // After a reload the players are there to pick.
  await b.goto("/", { waitUntil: "domcontentloaded" });
  await ready(b);
  await b.keyboard.press("k");
  await expectScreen(b, "profiles");
  for (const name of ["Basil", "Juniper", "Captain Quill"]) {
    await expect(b.getByRole("button", { name: new RegExp(name) })).toBeVisible();
  }

  // The same file again: every player is a conflict. Replacing one offers a backup first.
  await b.getByRole("button", { name: /Juniper/ }).click();
  await expectScreen(b, "map");
  await b.getByRole("button", { name: "Settings", exact: true }).click();
  await expectScreen(b, "settings");
  await b.getByRole("tab", { name: "Grown-ups" }).click();
  await passGate(b);
  const [again] = await Promise.all([
    b.waitForEvent("filechooser"),
    b.getByRole("button", { name: "Load a save file", exact: true }).click(),
  ]);
  await again.setFiles(file);
  await expect(review.locator("[data-row='conflict']")).toHaveCount(3);
  await expect(b.locator("[data-backup]")).toHaveCount(0);
  const juniper = review.locator("[data-row='conflict']").filter({ hasText: "Juniper" });
  await juniper.getByRole("radio", { name: "Use the file's copy" }).check();
  await expect(juniper.locator("[data-wins]")).toContainText("can't be brought back");
  await expectNoAxeViolations(b, "import: check with a replace");
  const [backup] = await Promise.all([
    b.waitForEvent("download"),
    b.getByRole("button", { name: "Download a save file first" }).click(),
  ]);
  expect(backup.suggestedFilename()).toMatch(/^voxel-typer-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(b.locator("[data-backup]")).toContainText("Saved 3 players");
  await b.getByRole("button", { name: "Load players" }).click();
  await expect(result).toContainText("Added 0, updated 1, not loaded 2.");
  expect(await profiles(b)).toEqual(expected);
  expect(errorsB).toEqual([]);
  await to.close();
});
