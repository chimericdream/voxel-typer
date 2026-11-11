/** @jsxImportSource preact */
/**
 * On-screen keyboard and hand overlay (task M2-09): the next-key table for every layout, the
 * opposite-hand Shift, finger-zone cues and contrast, the wrong-key wobble gate, and the props.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EN_GB, EN_US, LAYOUTS, codeFor, fingerFor } from "../../../src/content/layouts";
import type { LayoutDef } from "../../../src/content/layouts/types";
import { Hands } from "../../../src/ui/keyboard/Hands";
import {
  BOARD_UNITS,
  FINGERS,
  WOBBLE_GAP_MS,
  WOBBLE_IDLE,
  WOBBLE_MS,
  WOBBLE_QUIET_MS,
  boardKeys,
  faceOf,
  feedWobble,
  handOf,
  targetFor,
  wobbleCode,
  zoneOf,
} from "../../../src/ui/keyboard/model";
import type { BoardKey, WobbleGate } from "../../../src/ui/keyboard/model";
import { OnScreenKeyboard } from "../../../src/ui/keyboard/OnScreenKeyboard";
import type { WrongKey } from "../../../src/ui/keyboard/OnScreenKeyboard";
import en from "../../../src/i18n/en";
import {
  INK_IDS,
  SURFACE_IDS,
  TEXT_PAIRS,
  THEMES,
  THEME_IDS,
  composite,
  contrastRatio,
  cssVar,
  parseColor,
  themeProperties,
} from "../../../src/ui/theme/themes";
import type { ColorToken } from "../../../src/ui/theme/themes";

const REPO = resolve(import.meta.dirname, "../../..");
const KB_DIR = join(REPO, "src/ui/keyboard");

/** Printable ASCII, 0x20–0x7E. */
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCodePoint(0x20 + i));

/** Every char a layout types: printable ASCII plus its own extras (en-GB `£`, `¬`). */
function charsOf(layout: LayoutDef): string[] {
  const chars = new Set(ASCII);
  for (const row of layout.rows) {
    for (const k of row.keys) {
      chars.add(k.base);
      if (k.shift !== undefined) chars.add(k.shift);
    }
  }
  return [...chars];
}

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  void act(() => render(null, host));
  host.remove();
});

function mount(node: ComponentChildren): void {
  void act(() => {
    render(node, host);
  });
}

function all(selector: string): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(selector)];
}

function one(selector: string): HTMLElement {
  const found = all(selector);
  expect(found, selector).toHaveLength(1);
  const el = found[0];
  if (!el) throw new Error(`no ${selector}`);
  return el;
}

// ---- Acceptance: the table test ----

describe.each(LAYOUTS.map((l) => [l.id, l] as const))("%s: next-key table", (_id, layout) => {
  it("lights the right key, finger and Shift for every printable char", () => {
    const rows: string[] = [];
    for (const char of charsOf(layout)) {
      const hit = codeFor(layout, char);
      const finger = fingerFor(layout, char);
      // M1-11: every printable ASCII char is on both shipped layouts.
      expect(hit, JSON.stringify(char)).not.toBeNull();
      expect(finger, JSON.stringify(char)).not.toBeNull();
      if (!hit || !finger) continue;

      mount(<OnScreenKeyboard layout={layout} nextKey={char} hands />);
      const lit = one('[data-next="key"]');
      const shift = all('[data-next="shift"]');
      const litFingers = all("svg [data-lit]").map((g) => g.dataset["finger"]);
      const shiftCode = shift[0]?.dataset["code"] ?? null;
      rows.push(
        [
          JSON.stringify(char),
          lit.dataset["code"],
          lit.dataset["finger"],
          shiftCode ?? "-",
          [...new Set(litFingers)].toSorted((a, b) => (a ?? "").localeCompare(b ?? "")).join("+"),
        ].join(" "),
      );

      expect(lit.dataset["code"], JSON.stringify(char)).toBe(hit.code);
      expect(lit.dataset["finger"], JSON.stringify(char)).toBe(finger);
      expect(litFingers, JSON.stringify(char)).toContain(finger);
      if (hit.shift) {
        // Acceptance: Shift uses the opposite hand.
        expect(shift, JSON.stringify(char)).toHaveLength(1);
        const want = handOf(finger) === "left" ? "ShiftRight" : "ShiftLeft";
        expect(shiftCode, JSON.stringify(char)).toBe(want);
        expect(litFingers).toContain(want === "ShiftRight" ? "R5" : "L5");
        expect(handOf(finger)).not.toBe(want === "ShiftRight" ? "right" : "left");
      } else {
        expect(shift, JSON.stringify(char)).toHaveLength(0);
      }
    }
    expect(rows.length).toBeGreaterThanOrEqual(95);
  });

  it("spells out every char in the table (snapshot of code, finger, Shift)", () => {
    const table = charsOf(layout).map((char) => {
      const t = targetFor(layout, char);
      return `${JSON.stringify(char)} ${t?.code} ${t?.finger} ${t?.shiftCode ?? "-"}`;
    });
    expect(table).toMatchSnapshot();
  });
});

describe("targetFor", () => {
  it("uses the opposite Shift and pinky", () => {
    expect(targetFor(EN_US, "F")).toEqual({
      code: "KeyF",
      finger: "L2",
      shiftCode: "ShiftRight",
      shiftFinger: "R5",
    });
    expect(targetFor(EN_US, "J")).toEqual({
      code: "KeyJ",
      finger: "R2",
      shiftCode: "ShiftLeft",
      shiftFinger: "L5",
    });
    expect(targetFor(EN_US, ":")?.shiftCode).toBe("ShiftLeft");
    expect(targetFor(EN_US, "!")?.shiftCode).toBe("ShiftRight");
    expect(targetFor(EN_GB, "@")).toMatchObject({ code: "Quote", shiftCode: "ShiftLeft" });
    expect(targetFor(EN_GB, "£")).toMatchObject({ code: "Digit3", shiftCode: "ShiftRight" });
    expect(targetFor(EN_GB, "|")).toMatchObject({ code: "IntlBackslash", finger: "L5" });
  });

  it("is null for nothing, chars off the layout and multi-char strings", () => {
    expect(targetFor(EN_US, null)).toBeNull();
    expect(targetFor(EN_US, "€")).toBeNull();
    expect(targetFor(EN_US, "ab")).toBeNull();
    expect(targetFor(EN_US, "\n")).toBeNull();
  });

  it("lights nothing when there is no next key, or the layout can't type it", () => {
    for (const next of [null, "€"]) {
      mount(<OnScreenKeyboard layout={EN_US} nextKey={next} hands />);
      expect(all("[data-next]")).toHaveLength(0);
      expect(all("svg [data-lit]")).toHaveLength(0);
    }
  });
});

// ---- The board ----

function fingerById(keys: readonly BoardKey[], id: string): string | undefined {
  return keys.find((k) => k.id === id)?.finger;
}

describe.each(LAYOUTS.map((l) => [l.id, l] as const))("%s: board", (_id, layout) => {
  const keys = boardKeys(layout);

  it("draws every data key once, plus the modifier keys", () => {
    const dataCodes = layout.rows.flatMap((r) => r.keys.map((k) => k.code));
    for (const code of dataCodes) expect(keys.filter((k) => k.code === code)).toHaveLength(1);
    for (const code of ["Tab", "CapsLock", "ShiftLeft", "ShiftRight", "Enter", "Backspace"]) {
      expect(
        keys.some((k) => k.code === code),
        code,
      ).toBe(true);
    }
    expect(new Set(keys.map((k) => k.id)).size).toBe(keys.length);
  });

  it("keeps keys inside 15 units, with no overlaps in a row", () => {
    const rows = new Map<number, BoardKey[]>();
    for (const k of keys) rows.set(k.row, [...(rows.get(k.row) ?? []), k]);
    for (const [r, row] of rows) {
      const sorted = row.toSorted((a, b) => a.x - b.x);
      let end = 0;
      for (const k of sorted) {
        expect(k.x, `row ${r} ${k.id}`).toBeGreaterThanOrEqual(end - 1e-9);
        end = k.x + k.w;
      }
      expect(end, `row ${r}`).toBeLessThanOrEqual(BOARD_UNITS + 1e-9);
      // Every row but Space fills the full width, like a real keyboard.
      if (!row.some((k) => k.code === "Space")) expect(end).toBeCloseTo(BOARD_UNITS, 9);
    }
  });

  it("puts modifier keys under the right pinky or left pinky", () => {
    expect(fingerById(keys, "Tab")).toBe("L5");
    expect(fingerById(keys, "CapsLock")).toBe("L5");
    expect(fingerById(keys, "ShiftLeft")).toBe("L5");
    expect(fingerById(keys, "ShiftRight")).toBe("R5");
    expect(fingerById(keys, "Enter")).toBe("R5");
    expect(fingerById(keys, "Backspace")).toBe("R5");
  });

  it("has bumps on the home keys only", () => {
    mount(<OnScreenKeyboard layout={layout} nextKey={null} />);
    const bumped = all("[data-code]")
      .filter((slot) => slot.querySelector("kbd [aria-hidden=true]"))
      .map((slot) => slot.dataset["code"]);
    expect(bumped).toEqual(["KeyF", "KeyJ"]);
  });
});

describe("en-GB", () => {
  it("draws the ISO Enter in two pieces and a short left Shift", () => {
    const keys = boardKeys(EN_GB);
    expect(keys.filter((k) => k.code === "Enter").map((k) => [k.row, k.x, k.w])).toEqual([
      [1, 13.5, 1.5],
      [2, 13.75, 1.25],
    ]);
    // The name is printed on the top piece only.
    expect(keys.filter((k) => k.code === "Enter").map((k) => faceOf(k).kind)).toEqual([
      "named",
      "blank",
    ]);
    expect(faceOf(boardKeys(EN_US).find((k) => k.code === "Enter") ?? usKey("Enter")).kind).toBe(
      "named",
    );
    expect(keys.find((k) => k.id === "ShiftLeft")?.w).toBe(1.25);
    expect(boardKeys(EN_US).find((k) => k.id === "ShiftLeft")?.w).toBe(2.25);
  });
});

function usKey(code: string): BoardKey {
  const k = boardKeys(EN_US).find((b) => b.code === code);
  if (!k) throw new Error(code);
  return k;
}

function glyph(code: string): string | null {
  return one(`[data-code="${code}"] kbd`).textContent;
}

describe("faceOf", () => {
  it("prints capitals on letters, both chars on symbols, names on named keys", () => {
    expect(faceOf(usKey("KeyF"))).toEqual({ kind: "glyph", glyph: "F" });
    expect(faceOf(usKey("Digit1"))).toEqual({ kind: "dual", top: "!", bottom: "1" });
    expect(faceOf(usKey("Semicolon"))).toEqual({ kind: "dual", top: ":", bottom: ";" });
    expect(faceOf(usKey("Space"))).toEqual({ kind: "named", name: "space" });
    expect(faceOf(usKey("ShiftLeft"))).toEqual({ kind: "named", name: "shift" });
  });

  it("renders the glyphs in the key caps", () => {
    mount(<OnScreenKeyboard layout={EN_US} nextKey={null} />);
    expect(glyph("KeyB")).toBe("B");
    expect(glyph("KeyD")).toBe("D");
    expect(glyph("Digit2")).toBe("@\n2");
    expect(glyph("Space")).toBe(en.keyboard.key.space);
    expect(glyph("CapsLock")).toBe(en.keyboard.key.caps);
  });
});

// ---- Finger zones: color AND pattern AND label ----

const ZONE_TOKENS = {
  pinky: "zonePinky",
  ring: "zoneRing",
  middle: "zoneMiddle",
  index: "zoneIndex",
  thumb: "zoneThumb",
} as const;

const css = readFileSync(join(KB_DIR, "OnScreenKeyboard.module.css"), "utf8");

/** The `--pattern` a zone selector sets in the stylesheet ("" if none). */
function patternOf(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const block = css.slice(at, css.indexOf("}", at));
  return /--pattern:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? "";
}

describe("finger zones", () => {
  it("map every finger to a zone and a hand", () => {
    expect(FINGERS.map(zoneOf)).toEqual([
      "pinky",
      "ring",
      "middle",
      "index",
      "index",
      "middle",
      "ring",
      "pinky",
      "thumb",
    ]);
    expect(FINGERS.map(handOf).join(",")).toBe("left,left,left,left,right,right,right,right,left");
  });

  it("give each zone its own pattern, mirrored between the pointer fingers", () => {
    const patterns = [
      patternOf('.slot[data-zone="pinky"]'),
      patternOf('.slot[data-zone="ring"]'),
      patternOf('.slot[data-zone="middle"]'),
      patternOf('.slot[data-zone="index"][data-hand="left"]'),
      patternOf('.slot[data-zone="index"][data-hand="right"]'),
    ];
    for (const p of patterns) expect(p).toContain("var(--c-zone-pattern)");
    expect(new Set(patterns).size).toBe(patterns.length);
    // The thumb is the plain (solid) zone.
    expect(patternOf('.slot[data-zone="thumb"]')).toBe("");
  });

  it("label every key with its finger, shown with `labels`, on hover and on the lit keys", () => {
    mount(<OnScreenKeyboard layout={EN_US} nextKey="a" />);
    expect(host.querySelector("[data-labels]")).toBeNull();
    for (const slot of all("[data-code]")) {
      const zone = slot.dataset["zone"];
      expect(zone).toBeDefined();
      if (!zone) continue;
      const want = Reflect.get(en.keyboard.zone, zone);
      expect(slot.querySelector("[aria-hidden=true] > span")?.textContent).toBe(want);
    }
    mount(<OnScreenKeyboard layout={EN_US} nextKey="a" labels />);
    expect(host.querySelector("[data-labels]")).not.toBeNull();
    expect(css).toMatch(
      /\.root\[data-labels\] \.label,\s*\.slot:hover \.label,\s*\.slot\[data-next\] \.label/,
    );
  });

  for (const id of THEME_IDS) {
    it(`${id}: glyphs reach 4.5:1 on each zone with its pattern laid over it`, () => {
      const th = THEMES[id];
      const text = parseColor(th.ink.keycapText);
      const pattern = parseColor(th.ink.zonePattern);
      expect(pattern[3]).toBeGreaterThan(0);
      expect(pattern[3]).toBeLessThan(1);
      for (const token of Object.values(ZONE_TOKENS)) {
        const zone = parseColor(th.ink[token]);
        const shaded = composite(pattern, zone);
        expect(contrastRatio(text, zone), token).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(text, shaded), token).toBeGreaterThanOrEqual(4.5);
        // The pattern must show in grayscale too: a clear lightness step from its zone.
        expect(contrastRatio(zone, shaded), token).toBeGreaterThanOrEqual(1.4);
      }
    });
  }

  it("are in the kit's checked text pairs", () => {
    for (const token of Object.values(ZONE_TOKENS)) {
      expect(TEXT_PAIRS).toContainEqual(["keycapText", token]);
    }
  });
});

// ---- The stylesheets use only checked colors (same rule as the kit's) ----

const kebabToToken = new Map<string, ColorToken>(
  [...SURFACE_IDS, ...INK_IDS].map((tok) => [cssVar(tok), tok] as const),
);

describe("keyboard stylesheets", () => {
  const sheets = readdirSync(KB_DIR)
    .filter((f) => f.endsWith(".module.css"))
    .map((file) => ({ file, text: readFileSync(join(KB_DIR, file), "utf8") }));
  const defined = new Set(themeProperties(THEMES.day).map(([name]) => name));

  it("read only --c-* vars that applyTheme sets", () => {
    expect(sheets.length).toBe(2);
    for (const { file, text } of sheets) {
      for (const [name] of text.matchAll(/--c-[a-z-]+/g)) {
        expect(defined.has(name), `${file}: ${name}`).toBe(true);
      }
    }
  });

  it("set text colors only from checked TEXT_PAIRS foregrounds", () => {
    const foregrounds = new Set<ColorToken>(TEXT_PAIRS.map(([fg]) => fg));
    for (const { file, text } of sheets) {
      for (const m of text.matchAll(/(?<![-\w])color:\s*var\((--c-[a-z-]+)\)/g)) {
        const token = kebabToToken.get(m[1] ?? "");
        expect(token, `${file}: ${m[0]}`).toBeDefined();
        if (token) expect(foregrounds.has(token), `${file}: ${m[0]}`).toBe(true);
      }
    }
  });

  it("use no literal colors and no red", () => {
    for (const { file, text } of sheets) {
      const rules = text.replaceAll(/\/\*[\s\S]*?\*\//g, "");
      expect(rules, file).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|\bred\b/i);
    }
  });

  it("scale with --text-scale, capped by the container width", () => {
    expect(css).toMatch(/--u: min\(\s*calc\(40px \* var\(--text-scale\)\),/);
    expect(css).toContain("calc((100cqi - 2 * var(--sp-3)) / 15)");
    expect(css).toContain("container-type: inline-size");
    expect(css).toContain("font-family: var(--font-body)");
  });

  it("wobble only with motion on; the dashed outline shows either way", () => {
    const at = css.indexOf(".slot[data-wobble] > kbd {");
    const block = css.slice(at, css.indexOf("}", at));
    expect(block).toContain("outline: var(--bevel-unit) dashed");
    expect(block).toContain(`animation: wobble calc(${WOBBLE_MS}ms * var(--motion-ok))`);
    expect(css).toContain("animation: bob calc(1.2s * var(--motion-ok))");
  });
});

// ---- Wrong-key wobble ----

/** Feeds `(code, t)` signals and returns the times that started a wobble. */
function run(signals: readonly (readonly [string, number])[]): number[] {
  let gate: WobbleGate = WOBBLE_IDLE;
  const out: number[] = [];
  for (const [code, now] of signals) {
    const fed = feedWobble(gate, code, now);
    gate = fed.gate;
    if (fed.wobble) out.push(now);
  }
  return out;
}

describe("wobble gate", () => {
  it("wobbles once for a held key, however long it repeats", () => {
    // 500 ms repeat delay, then a repeat every 33 ms, for 5 s.
    const held: [string, number][] = [["KeyK", 0]];
    for (let at = 500; at < 5000; at += 33) held.push(["KeyK", at]);
    expect(run(held)).toEqual([0]);
  });

  it("wobbles at most once per WOBBLE_GAP_MS, under 3 a second, when keys are mashed", () => {
    const codes = ["KeyK", "KeyL", "KeyD", "KeyS"];
    const mash = Array.from({ length: 100 }, (_, i) => [codes[i % 4] ?? "KeyK", i * 50] as const);
    const starts = run(mash);
    for (let i = 1; i < starts.length; i++) {
      expect((starts[i] ?? 0) - (starts[i - 1] ?? 0)).toBeGreaterThanOrEqual(WOBBLE_GAP_MS);
    }
    expect(starts.length).toBeLessThanOrEqual(Math.ceil(5000 / WOBBLE_GAP_MS));
    expect(1000 / WOBBLE_GAP_MS).toBeLessThan(3);
    expect(WOBBLE_GAP_MS).toBeGreaterThan(WOBBLE_MS);
  });

  it("wobbles again for the same key once it has been quiet", () => {
    const presses = [0, 500, 1000, 1700].map((at) => ["KeyK", at] as const);
    // 500: too soon after the 0 wobble. 1000: 500 ms quiet and 1000 ms since the last wobble.
    expect(run(presses)).toEqual([0, 1000, 1700]);
    expect(WOBBLE_QUIET_MS).toBeLessThan(WOBBLE_GAP_MS);
  });

  it("wobbles the pressed key, or the needed key when the pressed char is off the layout", () => {
    expect(wobbleCode(EN_US, "k", "f")).toBe("KeyK");
    expect(wobbleCode(EN_US, "K", "f")).toBe("KeyK");
    expect(wobbleCode(EN_US, "€", "f")).toBe("KeyF");
    expect(wobbleCode(EN_US, "€", null)).toBeNull();
  });
});

function Harness({ wrong, at }: { wrong: WrongKey | null; at: number }) {
  return <OnScreenKeyboard layout={EN_US} nextKey="f" wrong={wrong} now={() => at} />;
}

describe("wobble in the component", () => {
  it("marks the key, ignores repeats, and clears after WOBBLE_MS", () => {
    vi.useFakeTimers();
    try {
      mount(<Harness wrong={{ got: "k", seq: 1 }} at={0} />);
      expect(one("[data-wobble]").dataset["code"]).toBe("KeyK");
      // Key-repeat: the same key every 33 ms keeps one wobble and never restarts it.
      for (let i = 2; i < 10; i++)
        mount(<Harness wrong={{ got: "k", seq: i }} at={500 + i * 33} />);
      void act(() => {
        vi.advanceTimersByTime(WOBBLE_MS);
      });
      expect(all("[data-wobble]")).toHaveLength(0);
      mount(<Harness wrong={{ got: "k", seq: 10 }} at={900} />);
      expect(all("[data-wobble]")).toHaveLength(0);
      // A different key after the gap wobbles.
      mount(<Harness wrong={{ got: "d", seq: 11 }} at={1200} />);
      expect(one("[data-wobble]").dataset["code"]).toBe("KeyD");
      // The same props again (a re-render, not a new press) don't feed the gate.
      mount(<Harness wrong={{ got: "d", seq: 11 }} at={5000} />);
      expect(one("[data-wobble]").dataset["code"]).toBe("KeyD");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---- Props, hands and spoken names ----

describe("OnScreenKeyboard", () => {
  it("renders nothing, not even the hands, when showKeyboard is off", () => {
    mount(<OnScreenKeyboard layout={EN_US} nextKey="f" show={false} hands />);
    expect(host.innerHTML).toBe("");
  });

  it("draws the hands only when asked", () => {
    mount(<OnScreenKeyboard layout={EN_US} nextKey="f" />);
    expect(all("svg")).toHaveLength(0);
    mount(<OnScreenKeyboard layout={EN_US} nextKey="f" hands />);
    expect(all("svg")).toHaveLength(2);
  });

  it("names the next key and finger for screen readers", () => {
    mount(<OnScreenKeyboard layout={EN_US} nextKey="f" />);
    expect(one("[role=img][data-layout]").getAttribute("aria-label")).toBe(
      "Next key: f. Use your left pointer finger.",
    );
    mount(<OnScreenKeyboard layout={EN_US} nextKey="F" />);
    expect(one("[role=img][data-layout]").getAttribute("aria-label")).toBe(
      "Next key: F. Use your left pointer finger. Hold shift with your right pinky.",
    );
    mount(<OnScreenKeyboard layout={EN_US} nextKey=" " />);
    expect(one("[role=img][data-layout]").getAttribute("aria-label")).toBe(
      "Next key: space. Use your thumb.",
    );
    mount(<OnScreenKeyboard layout={EN_US} nextKey={null} />);
    expect(one("[role=img][data-layout]").getAttribute("aria-label")).toBe("Keyboard");
  });
});

function fingersOf(svg: Element | undefined): (string | undefined)[] {
  return [...(svg?.querySelectorAll<SVGElement>("[data-finger]") ?? [])].map(
    (g) => g.dataset["finger"],
  );
}

describe("Hands", () => {
  it("raises the finger and the Shift pinky, and says which to use", () => {
    mount(<Hands finger="L2" shiftFinger="R5" />);
    const lit = all("[data-lit]").map((g) => g.dataset["finger"]);
    expect(lit.toSorted((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual(["L2", "R5"]);
    expect(host.querySelector("p")?.textContent).toBe(
      "Use your left pointer finger.Hold shift with your right pinky.",
    );
  });

  it("draws five digits a hand, each tip in its zone, and both thumbs for Space", () => {
    mount(<Hands finger="T" shiftFinger={null} />);
    const [left, right] = all("svg");
    expect(fingersOf(left)).toEqual(["L5", "L4", "L3", "L2", "T"]);
    expect(fingersOf(right)).toEqual(["R5", "R4", "R3", "R2", "T"]);
    for (const g of all("[data-finger]")) {
      const finger = FINGERS.find((f) => f === g.dataset["finger"]);
      expect(finger).toBeDefined();
      if (finger) expect(g.dataset["zone"]).toBe(zoneOf(finger));
    }
    expect(all("[data-lit]")).toHaveLength(2);
    expect(host.querySelector("p")?.textContent).toBe("Use your thumb.");
  });

  it("shows no caption when nothing is lit", () => {
    mount(<Hands finger={null} shiftFinger={null} />);
    expect(host.querySelector("p")).toBeNull();
    expect(all("[data-lit]")).toHaveLength(0);
  });
});
