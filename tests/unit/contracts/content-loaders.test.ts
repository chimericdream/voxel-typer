/**
 * Content loading (docs/decisions.md item 45): the app aggregates content with `import.meta.glob`,
 * and tools, which run under tsx without it, load the same files with node:fs and hand them to the
 * pure loaders. Both paths go through `collectExport`, so they give the same list.
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { blocks } from "../../../src/content/blocks";
import { blocksFromModules } from "../../../src/content/blocks/load";
import { collectExport, hasStringId, isContentDataFile } from "../../../src/content/collect";
import { lessons } from "../../../src/content/lessons";
import { lessonsFromModules } from "../../../src/content/lessons/load";

const REPO = resolve(import.meta.dirname, "../../..");

/** How a tool loads a content folder: no Vite, only node:fs and `import()`. */
async function loadFolderLikeATool(folder: string): Promise<Record<string, unknown>> {
  const dir = join(REPO, folder);
  const modules: Record<string, unknown> = {};
  for (const name of readdirSync(dir).filter(isContentDataFile)) {
    const loaded: unknown = await import(/* @vite-ignore */ pathToFileURL(join(dir, name)).href);
    modules[`./${name}`] = loaded;
  }
  return modules;
}

const lesson = (id: string) => ({ id, biome: "meadow", order: 1 });

describe("isContentDataFile", () => {
  it.each([
    ["./meadow.ts", true],
    ["./biome-frosty.ts", true],
    ["src/content/lessons/meadow.ts", true],
    ["C:\\repo\\src\\content\\blocks\\terrain.ts", true],
    ["./indexes.ts", true],
    ["./index.ts", false],
    ["./types.ts", false],
    ["./load.ts", false],
    ["src/content/lessons/index.ts", false],
    ["C:\\repo\\src\\content\\blocks\\types.ts", false],
    ["./meadow.test.ts", false],
    ["./globals.d.ts", false],
    ["./en-US.json", false],
    ["./README.md", false],
    ["./sub", false],
  ])("%s → %s", (path, expected) => {
    expect(isContentDataFile(path)).toBe(expected);
  });
});

describe("collectExport", () => {
  it("flattens the named export of every data module, ordered by path then position", () => {
    const modules = {
      "./shore.ts": { lessons: [lesson("shore-01")] },
      "./meadow.ts": { lessons: [lesson("meadow-02"), lesson("meadow-01")] },
      "./birch.ts": { lessons: [lesson("birch-01")] },
    };
    expect(lessonsFromModules(modules).map((l) => l.id)).toEqual([
      "birch-01",
      "meadow-02",
      "meadow-01",
      "shore-01",
    ]);
  });

  it("does not depend on the order the modules were listed in", () => {
    const a = { "./b.ts": { lessons: [lesson("b-01")] }, "./a.ts": { lessons: [lesson("a-01")] } };
    const b = { "./a.ts": { lessons: [lesson("a-01")] }, "./b.ts": { lessons: [lesson("b-01")] } };
    expect(lessonsFromModules(a)).toEqual(lessonsFromModules(b));
  });

  it("skips the aggregator, the types and the loader, so a caller may pass the whole folder", () => {
    const modules = {
      "./index.ts": { lessons: [lesson("from-index")] },
      "./types.ts": {},
      "./load.ts": { lessonsFromModules },
      "./meadow.ts": { lessons: [lesson("meadow-01")] },
    };
    expect(lessonsFromModules(modules).map((l) => l.id)).toEqual(["meadow-01"]);
  });

  it("returns the items themselves, not copies", () => {
    const first = lesson("meadow-01");
    expect(lessonsFromModules({ "./meadow.ts": { lessons: [first] } })[0]).toBe(first);
  });

  it("returns an empty list for no modules", () => {
    expect(lessonsFromModules({})).toEqual([]);
    expect(blocksFromModules({})).toEqual([]);
  });

  it.each([
    ["no such export", { blocks: [] }],
    ["a default export only", { default: [lesson("meadow-01")] }],
    ["an export that is not an array", { lessons: { id: "meadow-01" } }],
    ["a module that is not an object", null],
  ])("throws on a data file with %s, naming the file and the export", (_label, mod) => {
    expect(() => lessonsFromModules({ "./meadow.ts": mod })).toThrow(
      'content: ./meadow.ts must export an array named "lessons"',
    );
  });

  it.each([[null], ["meadow-01"], [{}], [{ id: 7 }], [[lesson("meadow-01")]]])(
    "throws on the invalid entry %j",
    (entry) => {
      expect(() => lessonsFromModules({ "./meadow.ts": { lessons: [entry] } })).toThrow(
        'content: ./meadow.ts has an invalid entry in "lessons"',
      );
    },
  );

  it("throws on a duplicate id, across files and inside one file, naming both files", () => {
    expect(() =>
      lessonsFromModules({
        "./a.ts": { lessons: [lesson("meadow-01")] },
        "./b.ts": { lessons: [lesson("meadow-01")] },
      }),
    ).toThrow('content: duplicate id "meadow-01" in ./a.ts and ./b.ts');
    expect(() =>
      blocksFromModules({ "./wood.ts": { blocks: [{ id: "oak-log" }, { id: "oak-log" }] } }),
    ).toThrow('content: duplicate id "oak-log" in ./wood.ts and ./wood.ts');
  });

  it("reads the export it is asked for", () => {
    const modules = { "./a.ts": { lessons: [lesson("a-01")], blocks: [{ id: "dirt" }] } };
    expect(collectExport(modules, "blocks", hasStringId)).toEqual([{ id: "dirt" }]);
    expect(blocksFromModules(modules)).toEqual([{ id: "dirt" }]);
  });
});

describe("the glob aggregators and the tool path agree", () => {
  it("lessons: import.meta.glob (app) equals node:fs + import() (tools)", async () => {
    const viaTool = lessonsFromModules(await loadFolderLikeATool("src/content/lessons"));
    expect(lessons).toEqual(viaTool);
  });

  it("blocks: import.meta.glob (app) equals node:fs + import() (tools)", async () => {
    const viaTool = blocksFromModules(await loadFolderLikeATool("src/content/blocks"));
    expect(blocks).toEqual(viaTool);
  });
});
