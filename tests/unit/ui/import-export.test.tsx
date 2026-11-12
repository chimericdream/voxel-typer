/** @jsxImportSource preact */
/**
 * Save file export and import (task M3-12): the planning rules, then the component over the real
 * shell and a memory store, then the Settings wiring (the slot and the no-player screen).
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blocks } from "../../../src/content/blocks";
import { createIsland, islandBlocks } from "../../../src/engine/island";
import { t } from "../../../src/i18n";
import type { Profile } from "../../../src/save/schema";
import type { SaveProblem } from "../../../src/save/problems";
import {
  EXPORT_APP,
  MAX_IMPORT_BYTES,
  MAX_PROFILES,
  createMemoryBackend,
  createStoreOn,
  readExportFile,
} from "../../../src/save/store";
import type { ExportFileEntry } from "../../../src/save/store";
import { ImportExport } from "../../../src/ui/components/ImportExport";
import {
  exportFileName,
  idsInExport,
  islandOk,
  lastPlayed,
  leftOut,
  planImport,
  resolveImport,
} from "../../../src/ui/components/import-export-logic";
import type { DeviceState, PlanRow } from "../../../src/ui/components/import-export-logic";
import type { Harness } from "./screens/harness";
import { buttonByText, fixture, mount, text } from "./screens/harness";

const BLOCKS = islandBlocks(blocks);
const NOW = Date.UTC(2026, 10, 12, 15, 0, 0);

let h: Harness | null = null;
let extra: HTMLElement | null = null;
afterEach(() => {
  if (extra) {
    void act(() => render(null, extra!));
    extra.remove();
    extra = null;
  }
  h?.unmount();
  h = null;
});

/** The value, or a test failure when it is missing. */
function only<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("missing");
  return v;
}

const ok = (index: number, profile: Profile): ExportFileEntry => ({ index, ok: true, profile });

function device(profiles: Profile[], damaged: string[] = [], readOnly: string[] = []): DeviceState {
  return {
    ids: new Set([...profiles.map((p) => p.id), ...damaged, ...readOnly]),
    profiles: new Map(profiles.map((p) => [p.id, p])),
    damaged: new Set(damaged),
    readOnly: new Set(readOnly),
  };
}

function counter(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-1000000000${String(++n).padStart(2, "0")}`;
}

/** A copy with a new id and name, so a test can make up to 8 different players. */
function player(n: number, base = fixture("fresh-builder")): Profile {
  return {
    ...base,
    id: `00000000-0000-4000-8000-2000000000${String(n).padStart(2, "0")}`,
    name: `P${n}`,
  };
}

function withIsland(p: Profile): Profile {
  return { ...p, island: createIsland(p.id, BLOCKS, NOW) };
}

function badIsland(p: Profile): Profile {
  const good = createIsland(p.id, BLOCKS, NOW);
  return { ...p, island: { ...good, grid: { ...good.grid, sx: 47 } } };
}

const fileOf = (profiles: unknown[], extraFields: Record<string, unknown> = {}): File =>
  new File(
    [JSON.stringify({ app: EXPORT_APP, version: 1, profiles, ...extraFields })],
    "save.json",
    {
      type: "application/json",
    },
  );

describe("planImport", () => {
  it("new ids are added; a stored id is a conflict whose default keeps this device's", () => {
    const sam = fixture("meadow-done-miner");
    const pip = fixture("fresh-sprout");
    const rows = planImport([ok(0, sam), ok(1, pip)], device([sam]), BLOCKS);
    expect(rows[0]).toMatchObject({ kind: "conflict", device: { kind: "player" } });
    expect(rows[0]?.kind === "conflict" && rows[0].choices).toEqual([
      "keepDevice",
      "useFile",
      "keepBoth",
    ]);
    expect(rows[1]).toMatchObject({ kind: "add" });
  });

  it("a damaged slot can be replaced; a newer game's copy can't", () => {
    const a = fixture("fresh-sprout");
    const b = fixture("fresh-builder");
    const rows = planImport([ok(0, a), ok(1, b)], device([], [a.id], [b.id]), BLOCKS);
    expect(rows[0]).toMatchObject({ kind: "conflict", device: { kind: "lost" } });
    expect(rows[0]?.kind === "conflict" && rows[0].choices).toContain("useFile");
    expect(rows[1]).toMatchObject({ kind: "conflict", device: { kind: "newer" } });
    expect(rows[1]?.kind === "conflict" && rows[1].choices).toEqual(["keepDevice", "keepBoth"]);
  });

  it("bad file entries say why; the same id twice in a file adds the second as a copy", () => {
    const a = fixture("fresh-sprout");
    const rows = planImport(
      [
        { index: 0, ok: false, reason: "invalid", detail: "profile.name: missing" },
        ok(1, a),
        ok(2, a),
      ],
      device([]),
      BLOCKS,
    );
    expect(rows.map((r) => r.kind)).toEqual(["bad", "add", "add"]);
    const steps = resolveImport(rows, new Map(), device([]), counter());
    expect(steps[1]).toMatchObject({ kind: "add", profile: { id: a.id, name: "Pip" } });
    expect(steps[2]).toMatchObject({ kind: "add", copyOf: "Pip", profile: { name: "Pip (2)" } });
    expect(steps[2]?.kind === "add" && steps[2].profile.id).not.toBe(a.id);
  });

  it("a file island that can't open never replaces one that can", () => {
    const mine = withIsland(fixture("meadow-done-miner"));
    const theirs = badIsland(fixture("meadow-done-miner"));
    expect(islandOk(mine, BLOCKS)).toBe(true);
    expect(islandOk(theirs, BLOCKS)).toBe(false);
    const [row] = planImport([ok(0, theirs)], device([mine]), BLOCKS);
    expect(row).toMatchObject({ kind: "conflict", fileIslandOk: false });
    expect(row?.kind === "conflict" && row.choices).toEqual(["keepDevice", "keepBoth"]);
    // Even if "use the file's" is asked for, nothing replaces this device's copy.
    const steps = resolveImport([only(row)], new Map([[0, "useFile"]]), device([mine]), counter());
    expect(steps).toEqual([{ index: 0, kind: "skip", name: mine.name, reason: "notAllowed" }]);
  });

  it("a bad file island may replace a device copy with no island (nothing good is lost)", () => {
    const mine = fixture("meadow-done-miner");
    const [row] = planImport([ok(0, badIsland(mine))], device([mine]), BLOCKS);
    expect(row?.kind === "conflict" && row.choices).toContain("useFile");
  });
});

const rowsFor = (d: DeviceState, ...ps: Profile[]): PlanRow[] =>
  planImport(
    ps.map((p, i) => ok(i, p)),
    d,
    BLOCKS,
  );

describe("resolveImport", () => {
  const sam = fixture("meadow-done-miner");

  it("default: keep this device's copy, write nothing for it", () => {
    const d = device([sam]);
    const steps = resolveImport(rowsFor(d, { ...sam, name: "Other" }), new Map(), d, counter());
    expect(steps).toEqual([{ index: 0, kind: "skip", name: "Other", reason: "keptDevice" }]);
  });

  it("use the file's copy: replace, same id, no new slot", () => {
    const full = Array.from({ length: MAX_PROFILES - 1 }, (_, i) => player(i + 1));
    const d = device([sam, ...full]);
    const file = { ...sam, sessionCounter: 99 };
    const steps = resolveImport(rowsFor(d, file), new Map([[0, "useFile"]]), d, counter());
    expect(steps).toEqual([{ index: 0, kind: "replace", profile: file, previousName: sam.name }]);
  });

  it("keep both: a fresh id and a suffixed name", () => {
    const d = device([sam]);
    const steps = resolveImport(rowsFor(d, sam), new Map([[0, "keepBoth"]]), d, counter());
    expect(steps[0]).toMatchObject({ kind: "add", copyOf: "Juniper" });
    expect(steps[0]?.kind === "add" && steps[0].profile.name).toBe("Juniper (2)");
    expect(steps[0]?.kind === "add" && steps[0].profile.id).not.toBe(sam.id);
  });

  it("new players fill the free slots in file order; the rest are skipped as full", () => {
    const six = Array.from({ length: 6 }, (_, i) => player(i + 1));
    const d = device(six, ["damaged-id"]);
    const steps = resolveImport(rowsFor(d, player(10), player(11)), new Map(), d, counter());
    expect(steps.map((s) => s.kind)).toEqual(["add", "skip"]);
    expect(steps[1]).toMatchObject({ reason: "full", name: "P11" });
  });
});

describe("helpers", () => {
  it("file name uses the local date", () => {
    const at = new Date(2026, 0, 5, 23, 59).getTime();
    expect(exportFileName(at)).toBe("voxel-typer-2026-01-05.json");
  });

  it("left out: only ids missing from the file count", () => {
    expect(leftOut(new Set(["a"]), new Set(["a", "b"]), new Set(["c"]))).toEqual({
      lost: 1,
      newer: 1,
    });
  });

  it("idsInExport reads ids, and null for junk", () => {
    expect(idsInExport('{"profiles":[{"id":"x"},{"id":2},null]}')).toEqual(new Set(["x"]));
    expect(idsInExport("nope")).toBeNull();
  });

  it("lastPlayed is the latest of created, history and lessons", () => {
    const p = fixture("meadow-done-miner");
    expect(lastPlayed(p)).toBeGreaterThanOrEqual(p.createdAt);
    expect(lastPlayed({ ...p, history: [], progress: { ...p.progress, lessons: {} } })).toBe(
      p.createdAt,
    );
  });
});

describe("readExportFile", () => {
  it("never reads a file over 5 MB", async () => {
    const big = new Blob(["x"]);
    Object.defineProperty(big, "size", { value: MAX_IMPORT_BYTES + 1 });
    const spy = vi.spyOn(big, "text");
    expect(await readExportFile(big)).toEqual({ ok: false, problem: "tooBig" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("marks a profile from a newer game apart from a damaged one", async () => {
    const p = fixture("fresh-sprout");
    const read = await readExportFile(fileOf([{ ...p, schemaVersion: 9 }, { id: "x" }, p]));
    expect(read.ok && read.entries.map((e) => (e.ok ? "ok" : e.reason))).toEqual([
      "newer",
      "invalid",
      "ok",
    ]);
  });
});

// ------------------------------------------------------------------------------------------------
// The component, over the real shell.
// ------------------------------------------------------------------------------------------------

interface Setup {
  h: Harness;
  map: Map<string, unknown>;
  downloads: { blob: Blob; name: string }[];
  root: HTMLElement;
}

async function setup(opts: { profiles?: Profile[]; active?: Profile; canExport?: boolean } = {}) {
  const map = new Map<string, unknown>();
  const relay: { to: ((p: SaveProblem) => void) | null } = { to: null };
  const store = createStoreOn(createMemoryBackend(map), { onProblem: (p) => relay.to?.(p) });
  for (const p of opts.profiles ?? []) await store.save(p);
  h = await mount({ store, ...(opts.active ? { initialProfile: opts.active } : {}) });
  relay.to = (p) => h!.shell.onSaveProblem(p);
  const downloads: { blob: Blob; name: string }[] = [];
  const root = document.createElement("div");
  extra = root;
  document.body.append(root);
  await act(async () => {
    render(
      <ImportExport
        app={h!.shell.api}
        canExport={opts.canExport ?? true}
        now={() => NOW}
        download={(blob, name) => downloads.push({ blob, name })}
      />,
      root,
    );
  });
  const s: Setup = { h, map, downloads, root };
  return s;
}

async function settle(s: Setup): Promise<void> {
  await s.h.settle();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function click(s: Setup, label: string): Promise<void> {
  void act(() => buttonByText(s.root, label).click());
  await settle(s);
}

async function pick(s: Setup, file: File): Promise<void> {
  const input = s.root.querySelector<HTMLInputElement>("[data-import-file]");
  if (!input) throw new Error("no file input");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  void act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle(s);
}

async function choose(s: Setup, index: number, value: string): Promise<void> {
  const input = s.root.querySelector<HTMLInputElement>(
    `input[name='import-choice-${index}'][value='${value}']`,
  );
  if (!input) throw new Error(`no choice ${index}=${value}`);
  void act(() => input.click());
  await settle(s);
}

const outcomes = (s: Setup): string[] =>
  [...s.root.querySelectorAll("[data-outcome]")].map(
    (el) =>
      `${el.getAttribute("data-outcome")}${el.getAttribute("data-reason") ? `:${el.getAttribute("data-reason")}` : ""}`,
  );

describe("ImportExport: export", () => {
  it("downloads voxel-typer-<date>.json holding every readable player", async () => {
    const a = fixture("meadow-done-miner");
    const b = fixture("veteran-builder");
    const s = await setup({ profiles: [a, b] });
    await click(s, t("importexport.export.button"));
    expect(s.downloads).toHaveLength(1);
    expect(s.downloads[0]?.name).toBe(exportFileName(NOW));
    const read = await readExportFile(only(s.downloads[0]).blob);
    expect(read.ok && read.entries.map((e) => e.ok && e.profile)).toEqual([a, b]);
    expect(text(s.root)).toContain(
      t("importexport.export.done", { count: 2, file: exportFileName(NOW) }),
    );
    expect(s.root.querySelector("[data-left-out]")).toBeNull();
  });

  it("lists the damaged and newer-game players it left out", async () => {
    const a = fixture("meadow-done-miner");
    const s = await setup({ profiles: [a] });
    s.map.set("lost-1", "{not json");
    s.map.set(
      "newer-1",
      JSON.stringify({ ...fixture("fresh-sprout"), id: "newer-1", schemaVersion: 2 }),
    );
    await click(s, t("importexport.export.button"));
    const read = await readExportFile(only(s.downloads[0]).blob);
    expect(read.ok && read.entries).toHaveLength(1);
    expect(text(s.root.querySelector("[data-left-out='lost']"))).toBe(
      t("importexport.export.leftOutLost", { count: 1 }),
    );
    expect(text(s.root.querySelector("[data-left-out='newer']"))).toBe(
      t("importexport.export.leftOutNewer", { count: 1 }),
    );
  });

  it("no players: says so and downloads nothing", async () => {
    const s = await setup();
    await click(s, t("importexport.export.button"));
    expect(s.downloads).toEqual([]);
    expect(text(s.root)).toContain(t("importexport.export.none"));
  });
});

describe("ImportExport: import", () => {
  it("into an empty device: every player added, equal to the file", async () => {
    const a = fixture("meadow-done-miner");
    const b = fixture("veteran-builder");
    const s = await setup({ canExport: false });
    expect(s.root.querySelector("[data-export]")).toBeNull();
    await pick(s, fileOf([a, b]));
    expect(s.root.querySelectorAll("[data-row='add']")).toHaveLength(2);
    // Nothing is written before the grown-up says go.
    expect(s.map.size).toBe(0);
    await click(s, t("importexport.import.go"));
    expect(outcomes(s)).toEqual(["added", "added"]);
    expect(await s.h.store.load(a.id)).toEqual(a);
    expect(await s.h.store.load(b.id)).toEqual(b);
    expect(text(s.root)).toContain(
      t("importexport.import.result.counts", { added: 2, updated: 0, skipped: 0 }),
    );
  });

  it("a conflict keeps this device's copy unless the grown-up picks otherwise", async () => {
    const mine = fixture("meadow-done-miner");
    const theirs = { ...mine, sessionCounter: mine.sessionCounter + 5 };
    const s = await setup({ profiles: [mine] });
    await pick(s, fileOf([theirs]));
    const wins = s.root.querySelector("[data-wins]");
    expect(wins?.getAttribute("data-wins")).toBe("keepDevice");
    expect(text(wins)).toBe(t("importexport.import.wins.keepDevice", { name: mine.name }));
    await click(s, t("importexport.import.go"));
    expect(outcomes(s)).toEqual(["skipped:keptDevice"]);
    expect(await s.h.store.load(mine.id)).toEqual(mine);
  });

  it("use the file's copy: replaces it, and this device's copy is kept as prev", async () => {
    const mine = fixture("meadow-done-miner");
    const theirs = { ...mine, sessionCounter: mine.sessionCounter + 5 };
    const s = await setup({ profiles: [mine] });
    await pick(s, fileOf([theirs]));
    await choose(s, 0, "useFile");
    expect(text(s.root.querySelector("[data-wins]"))).toBe(
      t("importexport.import.wins.useFile", { name: mine.name }),
    );
    await click(s, t("importexport.import.go"));
    expect(outcomes(s)).toEqual(["updated"]);
    expect(await s.h.store.load(mine.id)).toEqual(theirs);
    expect(s.map.get(`${mine.id}:prev`)).toBe(JSON.stringify(mine));
  });

  it("keep both: the file's copy arrives under a new id and name", async () => {
    const mine = fixture("meadow-done-miner");
    const s = await setup({ profiles: [mine] });
    await pick(s, fileOf([mine]));
    await choose(s, 0, "keepBoth");
    expect(text(s.root.querySelector("[data-wins]"))).toBe(
      t("importexport.import.wins.keepBoth", { copy: "Juniper (2)" }),
    );
    await click(s, t("importexport.import.go"));
    expect(outcomes(s)).toEqual(["added"]);
    const names = (await s.h.store.listProfiles()).map((p) => p.name).toSorted();
    expect(names).toEqual(["Juniper", "Juniper (2)"]);
    expect(await s.h.store.load(mine.id)).toEqual(mine);
  });

  it("replacing the active player switches the shell to the new copy", async () => {
    const mine = fixture("meadow-done-miner");
    const theirs = { ...mine, sessionCounter: 77 };
    const s = await setup({ profiles: [mine], active: mine });
    await pick(s, fileOf([theirs]));
    await choose(s, 0, "useFile");
    await click(s, t("importexport.import.go"));
    expect(s.h.shell.api.profile()).toEqual(theirs);
  });

  it("a damaged slot with the same id is fixed by the file's copy", async () => {
    const a = fixture("fresh-sprout");
    const s = await setup();
    s.map.set(a.id, "{broken");
    await pick(s, fileOf([a]));
    expect(s.root.querySelector("[data-row='conflict']")).not.toBeNull();
    await choose(s, 0, "useFile");
    await click(s, t("importexport.import.go"));
    expect(outcomes(s)).toEqual(["updated"]);
    expect(await s.h.store.load(a.id)).toEqual(a);
  });

  it("the 8-player cap holds: extra players are skipped with a reason", async () => {
    const seven = Array.from({ length: 7 }, (_, i) => player(i + 1));
    const s = await setup({ profiles: seven });
    await pick(s, fileOf([player(20), player(21)]));
    expect(text(s.root)).toContain(t("importexport.import.rowFull", { name: "P21" }));
    await click(s, t("importexport.import.go"));
    expect(outcomes(s)).toEqual(["added", "skipped:full"]);
    expect(await s.h.store.listProfiles()).toHaveLength(MAX_PROFILES);
  });

  it("a bad island in the file never replaces a good one", async () => {
    const mine = withIsland(fixture("meadow-done-miner"));
    const s = await setup({ profiles: [mine] });
    await pick(s, fileOf([badIsland(mine)]));
    expect(text(s.root)).toContain(t("importexport.import.islandBad"));
    expect(s.root.querySelector("input[value='useFile']")).toBeNull();
    await click(s, t("importexport.import.go"));
    expect(await s.h.store.load(mine.id)).toEqual(mine);
  });

  it("whole-file problems change nothing and say why", async () => {
    const mine = fixture("meadow-done-miner");
    const s = await setup({ profiles: [mine] });
    const before = new Map(s.map);
    const cases: [File, string][] = [
      [new File(["{"], "a.json"), "notJson"],
      [
        new File([JSON.stringify({ app: "other", version: 1, profiles: [] })], "b.json"),
        "wrongApp",
      ],
      [fileOf([], { version: 2 }), "newerFile"],
      [fileOf([]), "empty"],
    ];
    for (const [file, problem] of cases) {
      await pick(s, file);
      expect(
        s.root.querySelector("[data-import-problem]")?.getAttribute("data-import-problem"),
      ).toBe(problem);
    }
    const big = new File(["x"], "big.json");
    Object.defineProperty(big, "size", { value: MAX_IMPORT_BYTES + 1 });
    await pick(s, big);
    expect(text(s.root)).toContain(t("importexport.import.problem.tooBig"));
    expect(s.map).toEqual(before);
  });

  it("damaged and newer entries in the file are listed and skipped", async () => {
    const s = await setup();
    const p = fixture("fresh-sprout");
    await pick(s, fileOf([{ ...p, schemaVersion: 3 }, { nope: true }]));
    expect(text(s.root)).toContain(t("importexport.import.rowBadNewer", { n: 1 }));
    expect(text(s.root)).toContain(t("importexport.import.rowBadInvalid", { n: 2 }));
    await click(s, t("importexport.import.go"));
    expect(outcomes(s)).toEqual(["skipped:newer", "skipped:invalid"]);
    expect(s.map.size).toBe(0);
  });

  it("Not now leaves everything as it was", async () => {
    const s = await setup();
    await pick(s, fileOf([fixture("fresh-sprout")]));
    await click(s, t("importexport.import.cancel"));
    expect(s.root.querySelector("[data-import-review]")).toBeNull();
    expect(s.map.size).toBe(0);
  });

  it("round trip: export, then import into another device, profiles equal", async () => {
    const all = [fixture("meadow-done-miner"), fixture("veteran-builder"), fixture("pinky-weak")];
    const a = await setup({ profiles: all });
    await click(a, t("importexport.export.button"));
    const blob = only(a.downloads[0]).blob;
    h?.unmount();
    extra?.remove();
    extra = null;
    const b = await setup({ canExport: false });
    await pick(b, new File([await blob.text()], only(a.downloads[0]).name));
    await click(b, t("importexport.import.go"));
    for (const p of all) expect(await b.h.store.load(p.id)).toEqual(p);
  });
});

/** A profile with M3-10's optional lifetime `found` counts. */
const withFound = (): Profile => ({
  ...fixture("meadow-done-miner"),
  found: { grass: 12, dirt: 7, "oak-log": 3 },
});

describe("ImportExport: Profile.found (M3-10)", () => {
  it("round trip keeps found: export, import into another device, equal", async () => {
    const p = withFound();
    const a = await setup({ profiles: [p] });
    await click(a, t("importexport.export.button"));
    const blob = only(a.downloads[0]).blob;
    expect(await blob.text()).toContain('"found"');
    h?.unmount();
    extra?.remove();
    extra = null;
    const b = await setup({ canExport: false });
    await pick(b, new File([await blob.text()], "save.json"));
    await click(b, t("importexport.import.go"));
    const back = await b.h.store.load(p.id);
    expect(back).toEqual(p);
    expect(back?.found).toEqual(p.found);
  });

  it("an old profile without found imports fine and stays without it", async () => {
    const p = fixture("meadow-done-miner");
    expect(Object.hasOwn(p, "found")).toBe(false);
    const s = await setup({ canExport: false });
    await pick(s, fileOf([p]));
    await click(s, t("importexport.import.go"));
    expect(outcomes(s)).toEqual(["added"]);
    const back = await s.h.store.load(p.id);
    expect(back).toEqual(p);
    expect(back !== null && Object.hasOwn(back, "found")).toBe(false);
  });

  it("use the file's copy and keep both carry found over", async () => {
    const mine = fixture("meadow-done-miner");
    const theirs = withFound();
    const s = await setup({ profiles: [mine] });
    await pick(s, fileOf([theirs]));
    await choose(s, 0, "useFile");
    await click(s, t("importexport.import.go"));
    expect((await s.h.store.load(mine.id))?.found).toEqual(theirs.found);

    await pick(s, fileOf([theirs]));
    await choose(s, 0, "keepBoth");
    await click(s, t("importexport.import.go"));
    const copy = (await s.h.store.listProfiles()).find((x) => x.name === "Juniper (2)");
    expect(copy).toBeDefined();
    expect((await s.h.store.load(only(copy).id))?.found).toEqual(theirs.found);
  });
});

describe("Settings wiring", () => {
  it("the splash links to a gated import on the no-player screen", async () => {
    h = await mount();
    void act(() => buttonByText(h!.root, t("importexport.fromSplash")).click());
    await h.settle();
    expect(h.route().id).toBe("settings");
    expect(h.root.querySelector("[data-no-player]")).not.toBeNull();
    void act(() => buttonByText(h!.root, t("importexport.import.button")).click());
    await h.settle();
    const gate = h.root.querySelector("[data-gate]");
    expect(gate).not.toBeNull();
    expect(h.root.querySelector("[data-import-export]")).toBeNull();
    await h.type(text(gate?.querySelector("[data-gate-word]") ?? null));
    await h.press("Enter");
    expect(h.root.querySelector("[data-import-export]")).not.toBeNull();
    expect(h.root.querySelector("[data-export]")).toBeNull();
  });
});
