/**
 * The voxel model JSON schema (task M4-01): every `*.model.json` in the repo passes both
 * `src/render/models/schema.json` and the runtime guard, and the two agree on broken models.
 *
 * The repo has no JSON-schema library, and one runtime dependency for a test isn't worth it, so
 * this file has a small draft-07 checker for exactly the keywords the schema uses. It refuses any
 * keyword it doesn't know, so the schema can't silently grow a rule nobody checks.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { blocks } from "../../../src/content/blocks";
import { buildModel } from "../../../src/render/models/build";
import schemaJson from "../../../src/render/models/schema.json";
import { isVoxelModel, modelErrors, parseModel } from "../../../src/render/models/validate";
import { critter } from "./helpers";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-test",
  "coverage",
  "test-results",
  "playwright-report",
]);

const KNOWN_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$ref",
  "title",
  "description",
  "definitions",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "propertyNames",
  "items",
  "minItems",
  "maxItems",
  "minLength",
  "pattern",
  "enum",
  "minimum",
  "exclusiveMinimum",
  "anyOf",
]);

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

function typeOk(type: unknown, x: unknown): boolean {
  switch (type) {
    case "object":
      return isObj(x);
    case "array":
      return Array.isArray(x);
    case "string":
      return typeof x === "string";
    case "number":
      return typeof x === "number" && Number.isFinite(x);
    case "integer":
      return Number.isInteger(x);
    case "boolean":
      return typeof x === "boolean";
    default:
      throw new Error(`unsupported type ${String(type)}`);
  }
}

/** Errors from checking `x` against `schema` (draft-07 subset). */
function check(root: Record<string, unknown>, schema: unknown, x: unknown, path = "$"): string[] {
  if (!isObj(schema)) throw new Error(`schema at ${path} is not an object`);
  const out: string[] = [];
  for (const k of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(k)) throw new Error(`the test's checker doesn't know "${k}" (${path})`);
  }
  if (typeof schema.$ref === "string") {
    const name = /^#\/definitions\/(.+)$/.exec(schema.$ref)?.[1];
    const defs = root.definitions;
    if (!name || !isObj(defs) || !(name in defs)) throw new Error(`bad $ref ${schema.$ref}`);
    return check(root, defs[name], x, path);
  }
  if (schema.type !== undefined && !typeOk(schema.type, x)) {
    return [`${path}: expected ${JSON.stringify(schema.type)}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(x)) out.push(`${path}: not in enum`);
  if (typeof x === "string") {
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(x))
      out.push(`${path}: pattern`);
    if (typeof schema.minLength === "number" && x.length < schema.minLength)
      out.push(`${path}: minLength`);
  }
  if (typeof x === "number") {
    if (typeof schema.minimum === "number" && x < schema.minimum) out.push(`${path}: minimum`);
    if (typeof schema.exclusiveMinimum === "number" && x <= schema.exclusiveMinimum) {
      out.push(`${path}: exclusiveMinimum`);
    }
  }
  if (Array.isArray(x)) {
    if (typeof schema.minItems === "number" && x.length < schema.minItems)
      out.push(`${path}: minItems`);
    if (typeof schema.maxItems === "number" && x.length > schema.maxItems)
      out.push(`${path}: maxItems`);
    if (schema.items !== undefined)
      x.forEach((item, i) => out.push(...check(root, schema.items, item, `${path}[${i}]`)));
  }
  if (isObj(x)) {
    const props = isObj(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const r of schema.required)
        if (typeof r === "string" && !(r in x)) out.push(`${path}.${r}: required`);
    }
    for (const [k, v] of Object.entries(x)) {
      if (schema.propertyNames !== undefined)
        out.push(...check(root, schema.propertyNames, k, `${path}{${k}}`));
      if (k in props) out.push(...check(root, props[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) out.push(`${path}.${k}: not allowed`);
      else if (isObj(schema.additionalProperties))
        out.push(...check(root, schema.additionalProperties, v, `${path}.${k}`));
    }
  }
  if (
    Array.isArray(schema.anyOf) &&
    !schema.anyOf.some((s) => check(root, s, x, path).length === 0)
  ) {
    out.push(`${path}: matches none of anyOf`);
  }
  return out;
}

const schema: Record<string, unknown> = schemaJson;
const schemaErrors = (x: unknown): string[] => check(schema, schema, x);

function modelFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...modelFiles(join(dir, entry.name)));
    } else if (entry.name.endsWith(".model.json")) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

const files = modelFiles(REPO);
const blockIds = new Set(blocks.map((b) => b.id));

describe("every *.model.json in the repo", () => {
  it("finds at least the sample model", () => {
    expect(files.map((f) => relative(REPO, f).replaceAll("\\", "/"))).toContain(
      "tests/unit/models/box-critter.model.json",
    );
  });

  for (const file of files) {
    const name = relative(REPO, file).replaceAll("\\", "/");
    describe(name, () => {
      const json: unknown = JSON.parse(readFileSync(file, "utf8"));
      it("matches schema.json", () => {
        expect(schemaErrors(json)).toEqual([]);
      });
      it("passes the runtime guard (names, parents, tracks, key order)", () => {
        expect(modelErrors(json)).toEqual([]);
      });
      it("tiles name real blocks, and the file name is the model id", () => {
        const model = parseModel(json, name);
        expect(file.endsWith(`${model.id}.model.json`)).toBe(true);
        for (const part of model.parts) {
          if (part.tile) expect(blockIds, `${part.name} tile`).toContain(part.tile.blockId);
        }
      });
      it("builds and plays every anim to its end", () => {
        const model = buildModel(parseModel(json, name), null);
        for (const anim of Object.keys(parseModel(json, name).anims)) {
          expect(model.play(anim, { fadeMs: 0, loop: false })).toBe(true);
          model.update(1e6);
        }
        model.dispose();
      });
    });
  }
});

type Mutate = (m: Record<string, unknown>) => void;
const parts = (m: Record<string, unknown>): Record<string, unknown>[] => {
  const p = m.parts;
  if (!Array.isArray(p)) throw new Error("parts");
  return p.filter(isObj);
};
const partAt = (m: Record<string, unknown>, i: number): Record<string, unknown> => {
  const p = parts(m)[i];
  if (!p) throw new Error(`part ${i}`);
  return p;
};
const firstPart = (m: Record<string, unknown>): Record<string, unknown> => partAt(m, 0);
const idle = (m: Record<string, unknown>): Record<string, unknown> => {
  const anims = m.anims;
  if (!isObj(anims)) throw new Error("anims");
  const a = anims.idle;
  if (!isObj(a)) throw new Error("idle");
  return a;
};

const fresh = (): Record<string, unknown> => {
  const json: unknown = JSON.parse(
    readFileSync(new URL("./box-critter.model.json", import.meta.url), "utf8"),
  );
  if (!isObj(json)) throw new Error("fixture");
  return json;
};

describe("schema.json and the guard agree", () => {
  const broken: [string, Mutate][] = [
    ["no id", (m) => void delete m.id],
    ["bad id", (m) => void (m.id = "Box Critter")],
    ["extra top-level key", (m) => void (m.extra = 1)],
    ["no parts", (m) => void (m.parts = [])],
    ["size with a zero", (m) => void (firstPart(m).size = [0, 1, 1])],
    ["size of two numbers", (m) => void (firstPart(m).size = [1, 1])],
    ["pivot as a string", (m) => void (firstPart(m).pivot = "middle")],
    ["neither color nor tile", (m) => void delete firstPart(m).color],
    ["bad colour", (m) => void (firstPart(m).color = "green")],
    ["bad tile face", (m) => void (partAt(m, 4).tile = { blockId: "grass", face: "front" })],
    ["unknown part key", (m) => void (firstPart(m).spin = true)],
    ["anim without loop", (m) => void delete idle(m).loop],
    ["zero duration", (m) => void (idle(m).durationMs = 0)],
    [
      "bad prop",
      (m) => {
        const tracks = idle(m).tracks;
        if (Array.isArray(tracks) && isObj(tracks[0])) tracks[0] = { ...tracks[0], prop: "color" };
      },
    ],
    [
      "negative key time",
      (m) => {
        const tracks = idle(m).tracks;
        if (Array.isArray(tracks) && isObj(tracks[0]))
          tracks[0] = { ...tracks[0], keys: [{ t: -1, v: [0, 0, 0] }] };
      },
    ],
    [
      "bad anim name",
      (m) => {
        if (isObj(m.anims)) m.anims = { ...m.anims, "Big Jump": idle(m) };
      },
    ],
  ];

  it("the fixture is valid to both", () => {
    expect(schemaErrors(fresh())).toEqual([]);
    expect(isVoxelModel(fresh())).toBe(true);
    expect(critter().id).toBe("box-critter");
  });

  for (const [label, mutate] of broken) {
    it(`both reject: ${label}`, () => {
      const m = fresh();
      mutate(m);
      expect(schemaErrors(m).length, "schema").toBeGreaterThan(0);
      expect(modelErrors(m).length, "guard").toBeGreaterThan(0);
    });
  }

  // Cross-references only the guard can see.
  const guardOnly: [string, Mutate][] = [
    ["duplicate part name", (m) => void (partAt(m, 1).name = "body")],
    ["unknown parent", (m) => void (partAt(m, 1).parent = "tail")],
    ["self parent", (m) => void (firstPart(m).parent = "body")],
    ["parent cycle", (m) => void (firstPart(m).parent = "head")],
    [
      "track on a missing part",
      (m) => {
        const tracks = idle(m).tracks;
        if (Array.isArray(tracks) && isObj(tracks[0])) tracks[0] = { ...tracks[0], part: "tail" };
      },
    ],
    [
      "two tracks for one part and prop",
      (m) => {
        const tracks = idle(m).tracks;
        if (Array.isArray(tracks) && tracks[0] !== undefined) tracks.push(tracks[0]);
      },
    ],
    [
      "keys out of order",
      (m) => {
        const tracks = idle(m).tracks;
        if (Array.isArray(tracks) && isObj(tracks[0])) {
          tracks[0] = {
            ...tracks[0],
            keys: [
              { t: 600, v: [0, 0, 0] },
              { t: 0, v: [0, 0, 0] },
            ],
          };
        }
      },
    ],
    [
      "key after the end",
      (m) => {
        const tracks = idle(m).tracks;
        if (Array.isArray(tracks) && isObj(tracks[0]))
          tracks[0] = { ...tracks[0], keys: [{ t: 5000, v: [0, 0, 0] }] };
      },
    ],
  ];
  for (const [label, mutate] of guardOnly) {
    it(`the guard rejects: ${label}`, () => {
      const m = fresh();
      mutate(m);
      expect(modelErrors(m).length).toBeGreaterThan(0);
      expect(() => parseModel(m)).toThrow(/not a valid voxel model/);
    });
  }

  it("rejects non-objects with a clear message", () => {
    expect(modelErrors(null)).toEqual(["$: must be an object"]);
    expect(modelErrors([])).toEqual(["$: must be an object"]);
    expect(schemaErrors("x").length).toBeGreaterThan(0);
  });
});
