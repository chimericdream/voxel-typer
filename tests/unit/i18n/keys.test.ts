/**
 * The key check (tools/i18n-keys.ts) on a fixture tree, and on the real repo: no t() call may ask
 * for a key without English text, and every English key must be used.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkI18nKeys, compareKeys, definedKeys, scanSource } from "../../../tools/i18n-keys";

const REPO = resolve(import.meta.dirname, "../../..");
const FIXTURE = resolve(import.meta.dirname, "fixture");

/**
 * Keys defined before the screens that show them exist, with the work that will use them. Delete an
 * entry when that work lands (the last test below fails until you do).
 */
const PENDING_KEYS: Record<string, string> = {
  "common.appName": "title screen and menus (M2)",
  "common.notAffiliated": "the required footer, PLAN.md §1 (M2)",
};

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
      defined: ["a.b", "a.c"],
    });
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

  it("uses every English key (or lists it as pending)", async () => {
    const report = await checkI18nKeys(REPO);
    expect(report.unused.filter((k) => !(k in PENDING_KEYS))).toEqual([]);
  });

  it("has no stale pending keys", async () => {
    const report = await checkI18nKeys(REPO);
    const stale = Object.keys(PENDING_KEYS).filter((k) => !report.unused.includes(k));
    expect(stale, "these keys are used now; delete them from PENDING_KEYS").toEqual([]);
  });
});
