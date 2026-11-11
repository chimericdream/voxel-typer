/**
 * The key check (tools/i18n-keys.ts) on a fixture tree, and on the real repo: no t() call may ask
 * for a key without English text, and every English key must be used.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkI18nKeys,
  compareKeys,
  definedKeys,
  PENDING_KEYS,
  scanSource,
} from "../../../tools/i18n-keys";

const REPO = resolve(import.meta.dirname, "../../..");
const FIXTURE = resolve(import.meta.dirname, "fixture");

describe("fixture tree", () => {
  it("finds missing keys with their location", async () => {
    const report = await checkI18nKeys(FIXTURE);
    expect(report.missing.map((m) => [m.key, m.file, m.line])).toEqual([
      ["menu.plya", "src/ui/menu.tsx", 8],
      ["shop.title", "src/ui/menu.tsx", 10],
    ]);
  });

  it("finds unused keys, counting data literals and dynamic prefixes as uses", async () => {
    const report = await checkI18nKeys(FIXTURE);
    expect(report.unused).toEqual(["lesson.alsoNeverUsed", "menu.neverUsed"]);
    expect(report.defined).toEqual([
      "lesson.alsoNeverUsed",
      "lesson.title",
      "menu.biome.meadow",
      "menu.biome.shore",
      "menu.neverUsed",
      "menu.play",
      "menu.quit",
    ]);
  });

  it("exits 1 and names each problem when run as a tool", () => {
    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve(REPO, "tools/i18n-keys.ts"), "--root", FIXTURE],
      { cwd: REPO, encoding: "utf8" },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      'src/ui/menu.tsx:8:23: error i18n-keys(missing): no English text for "menu.plya".',
    );
    expect(run.stderr).toContain('i18n-keys(missing): no English text for "shop.title"');
    expect(run.stderr).toContain('i18n-keys(unused): nothing uses "menu.neverUsed"');
    expect(run.stderr).toContain('i18n-keys(unused): nothing uses "lesson.alsoNeverUsed"');
  });
});

describe("scanner details", () => {
  it("ignores other callees and non-literal keys", () => {
    const scan = scanSource(
      "a.ts",
      'obj.t("x.a"); tt("x.b"); set("x.c"); t(key); t(`${ns}.d`); t("x.e");',
    );
    expect(scan.calls.map((c) => c.key)).toEqual(["x.e"]);
    expect(scan.prefixes).toEqual([]);
  });

  it("flattens nested tables and skips non-strings", () => {
    expect(definedKeys({ a: { b: "x", c: { d: "y" }, n: 3 }, e: "z" })).toEqual([
      "a.b",
      "a.c.d",
      "e",
    ]);
    expect(definedKeys(null)).toEqual([]);
  });

  it("reports a clean tree as clean", () => {
    const scan = scanSource("a.ts", 't("a.b"); const k = "a.c";');
    expect(compareKeys({ a: { b: "B", c: "C" } }, [scan])).toEqual({
      missing: [],
      unused: [],
      pending: [],
      stalePending: [],
      defined: ["a.b", "a.c"],
    });
  });

  it("lets pending keys stay unused, and flags pending keys that are used or gone", () => {
    const scan = scanSource("a.ts", 't("a.b");');
    const report = compareKeys({ a: { b: "B", c: "C", d: "D" } }, [scan], {
      "a.b": "now used",
      "a.c": "still waiting",
      "a.gone": "deleted",
    });
    expect(report.unused).toEqual(["a.d"]);
    expect(report.pending).toEqual(["a.c"]);
    expect(report.stalePending).toEqual(["a.b", "a.gone"]);
  });

  it("throws on a file it can't parse", () => {
    expect(() => scanSource("bad.ts", "t(")).toThrow(/bad\.ts: parse error/);
  });
});

describe("the repo", () => {
  it("has English text for every t() call", async () => {
    const report = await checkI18nKeys(REPO);
    expect(report.missing).toEqual([]);
  });

  it("uses every English key except the pending ones", async () => {
    const report = await checkI18nKeys(REPO);
    expect(report.unused).toEqual([]);
  });

  it("has no stale pending keys", async () => {
    const report = await checkI18nKeys(REPO);
    expect(report.stalePending, "used or deleted now; remove them from PENDING_KEYS").toEqual([]);
    expect(report.pending).toEqual(Object.keys(PENDING_KEYS).toSorted());
  });

  it("passes the tool as CI runs it", () => {
    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve(REPO, "tools/i18n-keys.ts")],
      {
        cwd: REPO,
        encoding: "utf8",
      },
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });
});
