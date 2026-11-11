/**
 * Keyboard layouts as data (task M1-11, contracts §16): the shipped JSON, the structural guard,
 * and the `codeFor` / `fingerFor` lookups.
 */
import { describe, expect, it } from "vitest";
import {
  EN_GB,
  EN_US,
  LAYOUTS,
  codeFor,
  fingerFor,
  isLayoutDef,
  layoutById,
  type LayoutDef,
} from "../../../src/content/layouts";
import type { Finger } from "../../../src/types/core";

/** Every printable ASCII char, 0x20 (space) through 0x7E (`~`). */
const PRINTABLE_ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) =>
  String.fromCharCode(0x20 + i),
);

function allKeys(layout: LayoutDef): LayoutDef["rows"][number]["keys"] {
  return layout.rows.flatMap((row) => row.keys);
}

describe("shipped layouts", () => {
  it("lists en-US first, then en-GB, each findable by id", () => {
    expect(LAYOUTS.map((l) => l.id)).toEqual(["en-US", "en-GB"]);
    expect(layoutById("en-US")).toBe(EN_US);
    expect(layoutById("en-GB")).toBe(EN_GB);
    expect(layoutById("fr-FR")).toBeNull();
  });

  it.each(LAYOUTS.map((l) => [l.id, l] as const))("%s passes the structural guard", (_, layout) => {
    expect(isLayoutDef(layout)).toBe(true);
    expect(layout.homeCodes).toEqual(["KeyF", "KeyJ"]);
  });

  it.each(LAYOUTS.map((l) => [l.id, l] as const))(
    "%s keys in a row are left to right and don't overlap",
    (_, layout) => {
      for (const row of layout.rows) {
        for (let i = 1; i < row.keys.length; i++) {
          const prev = row.keys[i - 1];
          const key = row.keys[i];
          if (prev === undefined || key === undefined) throw new Error("unreachable");
          expect(key.x).toBeGreaterThanOrEqual(prev.x + (prev.w ?? 1));
        }
      }
    },
  );
});

describe("en-US", () => {
  it.each(PRINTABLE_ASCII.map((c) => [JSON.stringify(c), c]))(
    "%s resolves via codeFor and fingerFor",
    (_, char) => {
      const hit = codeFor(EN_US, char);
      expect(hit).not.toBeNull();
      expect(fingerFor(EN_US, char)).not.toBeNull();
      const key = allKeys(EN_US).find((k) => k.code === hit?.code);
      expect(hit?.shift ? key?.shift : key?.base).toBe(char);
    },
  );

  it("types letters unshifted lowercase and shifted uppercase on the same key", () => {
    for (const letter of "abcdefghijklmnopqrstuvwxyz") {
      const code = `Key${letter.toUpperCase()}`;
      expect(codeFor(EN_US, letter)).toEqual({ code, shift: false });
      expect(codeFor(EN_US, letter.toUpperCase())).toEqual({ code, shift: true });
    }
  });

  it("puts shifted symbols on their US keys", () => {
    expect(codeFor(EN_US, '"')).toEqual({ code: "Quote", shift: true });
    expect(codeFor(EN_US, "@")).toEqual({ code: "Digit2", shift: true });
    expect(codeFor(EN_US, "#")).toEqual({ code: "Digit3", shift: true });
    expect(codeFor(EN_US, "~")).toEqual({ code: "Backquote", shift: true });
    expect(codeFor(EN_US, "|")).toEqual({ code: "Backslash", shift: true });
    expect(codeFor(EN_US, "\\")).toEqual({ code: "Backslash", shift: false });
    expect(codeFor(EN_US, " ")).toEqual({ code: "Space", shift: false });
  });

  it("uses the standard touch-typing finger map", () => {
    const expected: Record<Finger, string> = {
      L5: "`1qaz~!QAZ",
      L4: "2wsx@WSX",
      L3: "3edc#EDC",
      L2: "456rtfgvb$%^RTFGVB",
      R2: "7yuhjnm&YUHJNM",
      R3: "8ik,*IK<",
      R4: "9ol.(OL>",
      R5: "0-=p[]\\;'/)_+P{}|:\"?",
      T: " ",
    };
    for (const [finger, chars] of Object.entries(expected)) {
      for (const char of chars) expect([char, fingerFor(EN_US, char)]).toEqual([char, finger]);
    }
  });

  it("can't type chars outside the layout", () => {
    for (const char of ["£", "¬", "é", "\n", "\t", "", "ab"]) {
      expect(codeFor(EN_US, char)).toBeNull();
      expect(fingerFor(EN_US, char)).toBeNull();
    }
  });
});

describe("en-GB", () => {
  it.each(PRINTABLE_ASCII.map((c) => [JSON.stringify(c), c]))(
    "%s resolves via codeFor and fingerFor",
    (_, char) => {
      expect(codeFor(EN_GB, char)).not.toBeNull();
      expect(fingerFor(EN_GB, char)).not.toBeNull();
    },
  );

  it('swaps " and @', () => {
    expect(codeFor(EN_GB, '"')).toEqual({ code: "Digit2", shift: true });
    expect(codeFor(EN_GB, "@")).toEqual({ code: "Quote", shift: true });
    expect(fingerFor(EN_GB, '"')).toBe("L4");
    expect(fingerFor(EN_GB, "@")).toBe("R5");
  });

  it("has £ on Shift+3", () => {
    expect(codeFor(EN_GB, "£")).toEqual({ code: "Digit3", shift: true });
    expect(fingerFor(EN_GB, "£")).toBe("L3");
  });

  it("has a #/~ key by Enter (code Backslash) and \\/| left of Z (code IntlBackslash)", () => {
    expect(codeFor(EN_GB, "#")).toEqual({ code: "Backslash", shift: false });
    expect(codeFor(EN_GB, "~")).toEqual({ code: "Backslash", shift: true });
    expect(fingerFor(EN_GB, "#")).toBe("R5");
    expect(codeFor(EN_GB, "\\")).toEqual({ code: "IntlBackslash", shift: false });
    expect(codeFor(EN_GB, "|")).toEqual({ code: "IntlBackslash", shift: true });
    expect(fingerFor(EN_GB, "\\")).toBe("L5");
  });

  it("has ¬ on Shift+` and keeps ` unshifted", () => {
    expect(codeFor(EN_GB, "¬")).toEqual({ code: "Backquote", shift: true });
    expect(codeFor(EN_GB, "`")).toEqual({ code: "Backquote", shift: false });
  });

  it("matches en-US on every other key", () => {
    const differs = new Set(["Digit2", "Digit3", "Quote", "Backquote", "Backslash"]);
    const us = new Map(allKeys(EN_US).map((k) => [k.code, k]));
    for (const key of allKeys(EN_GB)) {
      if (differs.has(key.code) || key.code === "IntlBackslash") continue;
      const twin = us.get(key.code);
      expect(twin && { base: twin.base, shift: twin.shift, finger: twin.finger }).toEqual({
        base: key.base,
        shift: key.shift,
        finger: key.finger,
      });
    }
  });
});

/** A small valid layout, fresh on each call. */
function good(): Record<string, unknown> {
  return {
    id: "t",
    name: "Test",
    rows: [
      {
        keys: [
          { code: "KeyF", base: "f", shift: "F", finger: "L2", x: 0 },
          { code: "KeyJ", base: "j", finger: "R2", x: 1, w: 1 },
        ],
      },
    ],
    homeCodes: ["KeyF", "KeyJ"],
  };
}

/** A one-key layout whose key is patched. */
function withKey(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...good(),
    rows: [{ keys: [{ code: "KeyF", base: "f", finger: "L2", x: 0, ...patch }] }],
    homeCodes: ["KeyF"],
  };
}

describe("isLayoutDef", () => {
  it("accepts a minimal layout", () => {
    expect(isLayoutDef(good())).toBe(true);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a missing id", { ...good(), id: undefined }],
    ["an empty name", { ...good(), name: "" }],
    ["rows not an array", { ...good(), rows: {} }],
    ["a row without keys", { ...good(), rows: [{}] }],
    ["an unknown finger", withKey({ finger: "L1" })],
    ["a two-char base", withKey({ base: "ff" })],
    ["an empty shift", withKey({ shift: "" })],
    ["a string x", withKey({ x: "0" })],
    ["a negative x", withKey({ x: -1 })],
    ["a zero width", withKey({ w: 0 })],
    ["an empty code", withKey({ code: "" })],
    ["a home code not in the rows", { ...good(), homeCodes: ["KeyF", "KeyK"] }],
    [
      "a duplicate code",
      {
        ...good(),
        rows: [
          {
            keys: [
              { code: "KeyF", base: "f", finger: "L2", x: 0 },
              { code: "KeyF", base: "g", finger: "L2", x: 1 },
            ],
          },
        ],
        homeCodes: [],
      },
    ],
    [
      "a char on two keys",
      {
        ...good(),
        rows: [
          {
            keys: [
              { code: "KeyF", base: "f", finger: "L2", x: 0 },
              { code: "KeyG", base: "g", shift: "f", finger: "L2", x: 1 },
            ],
          },
        ],
        homeCodes: [],
      },
    ],
  ])("rejects %s", (_, value) => {
    expect(isLayoutDef(value)).toBe(false);
  });

  it("indexes each layout object on its own", () => {
    const value = good();
    if (!isLayoutDef(value)) throw new Error("fixture should be valid");
    expect(codeFor(value, "F")).toEqual({ code: "KeyF", shift: true });
    expect(fingerFor(value, "j")).toBe("R2");
    expect(codeFor(value, "a")).toBeNull();
  });
});
