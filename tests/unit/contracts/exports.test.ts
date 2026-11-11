/**
 * The runtime side of the contracts (docs/impl/contracts.md, task M1-01): every function a later
 * task implements is exported under its contract name, and every remaining stub says which
 * function it is.
 *
 * The stub list is read from the source, so nothing here needs editing when a stub gets implemented
 * or when content is added.
 */
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as a11y from "../../../src/a11y";
import * as audio from "../../../src/audio";
import * as content from "../../../src/content";
import * as engine from "../../../src/engine";
import * as i18n from "../../../src/i18n";
import en from "../../../src/i18n/en";
import * as input from "../../../src/input";
import * as modes from "../../../src/modes";
import * as render from "../../../src/render";
import { VoxelGrid } from "../../../src/render/mesher/voxel-grid";
import * as save from "../../../src/save";
import { BIOME_ORDER } from "../../../src/types/core";
import * as ui from "../../../src/ui";

const isCallable = (v: unknown): v is () => unknown => typeof v === "function";

const REPO = resolve(import.meta.dirname, "../../..");

describe("folder barrels export the contract functions", () => {
  it.each([
    [
      "engine",
      engine,
      [
        // §2
        "createRng",
        "hashString",
        "dailySeed",
        // §3
        "createSession",
        "restoreSession",
        "foldSummaryIntoKeyStats",
        // §4
        "keyWeights",
        "weakKeys",
        "dueReviewKeys",
        "scheduleSrs",
        // §5
        "generateTargets",
        "typeable",
        // §18
        "rollLoot",
      ],
    ],
    ["input", input, ["normalizeKeyEvent", "attachKeyboard", "capsLockOn"]],
    ["save", save, ["defaultSettings", "createIdbStore", "createMemoryStore", "newId"]],
    ["render", render, ["VoxelGrid", "meshChunk", "paintTile", "buildAtlas"]],
    ["modes", modes, ["resolveMode", "createModeRegistry"]],
    [
      "content",
      content,
      ["allowedKeysFor", "fingerFor", "codeFor", "lessonsFromModules", "blocksFromModules"],
    ],
    ["i18n", i18n, ["t", "setLocale"]],
    // Types only so far: nothing to export at runtime, but the barrel must load.
    ["audio", audio, []],
    ["ui", ui, []],
    ["a11y", a11y, []],
  ] as const)("../../../src/%s", (_name, barrel, names) => {
    const exported: Record<string, unknown> = barrel;
    for (const name of names) expect(exported[name], name).toBeTypeOf("function");
  });
});

describe("stubs", () => {
  const stubs = globSync("src/**/*.ts", { cwd: REPO }).flatMap((file) => {
    const source = readFileSync(resolve(REPO, file), "utf8");
    return [...source.matchAll(/not implemented: ([\w.]+)/g)].map((m) => ({
      file: file.replaceAll("\\", "/"),
      name: m[1] ?? "",
      source,
    }));
  });

  it("every stub message names a function", () => {
    expect(stubs.filter((s) => s.name === "")).toEqual([]);
  });

  it.each(stubs)("$file: `not implemented: $name` sits in a function of that name", (stub) => {
    const fn = stub.name.split(".").pop() ?? "";
    const declared = new RegExp(`(?:function |static |^  )${fn}[(]`, "m");
    expect(stub.source).toMatch(declared);
  });

  // Stubs ignore their arguments, so they can be called with none.
  const exported: Record<string, unknown> = {
    ...engine,
    ...input,
    ...save,
    ...render,
    ...content,
    ...i18n,
  };
  const topLevel = stubs.filter((s) => !s.name.includes("."));

  it.each(topLevel)("$name() throws `not implemented: $name`", ({ name }) => {
    const fn = exported[name];
    expect(isCallable(fn), `${name} is exported from its folder barrel`).toBe(true);
    expect(() => (isCallable(fn) ? fn() : undefined)).toThrow(
      new Error(`not implemented: ${name}`),
    );
  });
});

describe("contract values", () => {
  it("BIOME_ORDER is the curriculum order (§1)", () => {
    expect(BIOME_ORDER).toEqual([
      "meadow",
      "birch",
      "shore",
      "frosty",
      "mines",
      "marsh",
      "caverns",
      "sparkstone",
      "citadel",
    ]);
  });

  it("VoxelGrid allocates one cell per voxel, or adopts the given data (§8.2)", () => {
    const grid = new VoxelGrid(2, 3, 4);
    expect([grid.sx, grid.sy, grid.sz]).toEqual([2, 3, 4]);
    expect(grid.data).toBeInstanceOf(Uint16Array);
    expect(grid.data).toHaveLength(24);
    const given = new Uint16Array(24);
    expect(new VoxelGrid(2, 3, 4, given).data).toBe(given);
  });

  it("the content aggregators load (§0)", () => {
    expect(Array.isArray(content.lessons)).toBe(true);
    expect(Array.isArray(content.blocks)).toBe(true);
  });

  it("en aggregates the common namespace (§11)", () => {
    expect(Object.keys(en)).toContain("common");
  });
});
