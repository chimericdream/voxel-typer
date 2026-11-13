/** @jsxImportSource preact */
/**
 * HUD (task M2-14): the signals bridge, the four mark kinds, render counts at 60 Hz, the timer,
 * the Caps Lock hint and banner, the keyboard's wrong-key slice, and the stylesheet's colors.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effect } from "@preact/signals";
import { options, render } from "preact";
import type { ComponentChildren, VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EN_US } from "../../../src/content/layouts";
import { t } from "../../../src/i18n";
import { defaultSettings } from "../../../src/save/settings";
import {
  HANDS_SLICE,
  HOTBAR_SLICE,
  HUD_FIELDS,
  STAGE_SLICE,
  WRONG_KEY_SLICE,
  createHudStore,
  emptyHudState,
  handsCaptionOnly,
  hotbarOf,
  reportWrongKey,
  stageMinOf,
  wrongKeyOf,
} from "../../../src/ui/hud/bridge";
import type { HudState } from "../../../src/ui/hud/bridge";
import {
  Hud,
  HudCombo,
  HudKeyboard,
  HudMessage,
  HudProgress,
  HudStage,
  HudTimer,
  HudWord,
  formatTime,
  timerHidden,
} from "../../../src/ui/hud/Hud";
import { SPACE_GLYPH, WordDisplay, sizeOf, wordCells } from "../../../src/ui/hud/WordDisplay";
import { TEXT_PAIRS } from "../../../src/ui/theme/themes";
import { createHudStore as appCreateHudStore } from "../../../src/app/hud";

const REPO = resolve(import.meta.dirname, "../../..");

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

describe("bridge", () => {
  it("lists every field once", () => {
    expect([...HUD_FIELDS].toSorted()).toEqual(Object.keys(emptyHudState()).toSorted());
  });

  it("set merges a patch; get returns the whole state", () => {
    const hud = createHudStore();
    hud.set({ combo: 3, nextKey: "f" });
    hud.set({ progress01: 0.5 });
    expect(hud.get()).toEqual({ ...emptyHudState(), combo: 3, nextKey: "f", progress01: 0.5 });
  });

  it("an equal patch writes nothing, even with fresh objects", () => {
    const hud = createHudStore();
    const state: Partial<HudState> = {
      word: { text: "cat", marks: ["ok", "pending", "pending"], typed: 1 },
      banner: { key: "hud.progress", params: { n: 1 }, tone: "info" },
      timer: { remainingMs: 1000 },
      custom: { a: 1 },
      combo: 2,
    };
    hud.set(state);
    const writes: string[] = [];
    const stops = HUD_FIELDS.map((k) =>
      effect(() => {
        void hud.fields[k].value;
        writes.push(k);
      }),
    );
    writes.length = 0;
    hud.set(structuredClone(state));
    expect(writes).toEqual([]);
    hud.set({ word: { text: "cat", marks: ["ok", "ok", "pending"], typed: 2 } });
    expect(writes).toEqual(["word"]);
    for (const stop of stops) stop();
  });

  it("reset empties everything but Caps Lock", () => {
    const hud = createHudStore();
    hud.set({ capsLock: true, combo: 9, nextKey: "j" });
    hud.reset();
    expect(hud.get()).toEqual({ ...emptyHudState(), capsLock: true });
  });

  it("the app's store is this bridge", () => {
    expect(appCreateHudStore).toBe(createHudStore);
  });

  it("reportWrongKey bumps seq and keeps other custom slices", () => {
    const hud = createHudStore();
    hud.set({ custom: { other: 1 } });
    reportWrongKey(hud, "k");
    reportWrongKey(hud, "k");
    expect(hud.get().custom).toEqual({ other: 1, [WRONG_KEY_SLICE]: { got: "k", seq: 2 } });
    expect(wrongKeyOf(hud.get().custom)).toEqual({ got: "k", seq: 2 });
    expect(wrongKeyOf({ wrongKey: { got: 1 } })).toBeNull();
    expect(wrongKeyOf({})).toBeNull();
  });
});

describe("word display: marks", () => {
  it("renders all four mark kinds, the cursor and the trailing space", () => {
    mount(
      <WordDisplay
        word={{ text: "dogs", marks: ["ok", "fixed", "wrong", "pending", "pending"], typed: 2 }}
      />,
    );
    const word = host.querySelector('[role="img"]');
    expect(word?.getAttribute("aria-label")).toBe(t("hud.wordSpace", { word: "dogs" }));
    const cells = [...host.querySelectorAll<HTMLElement>("[data-mark]")];
    expect(cells.map((c) => c.textContent)).toEqual(["d", "o", "g", "s", SPACE_GLYPH]);
    expect(cells.map((c) => c.dataset["mark"])).toEqual([
      "ok",
      "fixed",
      "wrong",
      "pending",
      "pending",
    ]);
    expect(cells.map((c) => c.dataset["next"] ?? "")).toEqual(["", "", "1", "", ""]);
    expect(cells[4]?.dataset["space"]).toBe("1");
    expect(cells.every((c) => c.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("names the word without a space when none is needed", () => {
    mount(<WordDisplay word={{ text: "f", marks: ["pending"], typed: 0 }} />);
    expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      t("hud.word", { word: "f" }),
    );
    expect(host.querySelector('[role="img"]')?.getAttribute("data-size")).toBe("letter");
  });

  it("draws nothing without a word", () => {
    mount(<WordDisplay word={null} />);
    expect(host.innerHTML).toBe("");
  });

  it("wordCells and sizeOf", () => {
    expect(wordCells({ text: "a b", marks: ["ok", "pending", "pending"], typed: 1 })).toEqual([
      { char: "a", mark: "ok", next: false },
      { char: " ", mark: "pending", next: true },
      { char: "b", mark: "pending", next: false },
    ]);
    expect([sizeOf(1), sizeOf(4), sizeOf(10), sizeOf(11)]).toEqual([
      "letter",
      "word",
      "word",
      "long",
    ]);
  });
});

describe("stylesheet", () => {
  const css = readFileSync(join(REPO, "src/ui/hud/Hud.module.css"), "utf8");
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };

  it("wrong is a wavy underline plus a pattern, and never animates", () => {
    const wrong = rule('.char[data-mark="wrong"]');
    expect(wrong).toMatch(/text-decoration: underline wavy/);
    expect(wrong).toMatch(/background-image: repeating-linear-gradient/);
    expect(wrong).not.toMatch(/animation|transition/);
  });

  it("fixed is a dotted underline; ok is the muted ink", () => {
    expect(rule('.char[data-mark="fixed"]')).toMatch(/underline dotted/);
    expect(rule('.char[data-mark="ok"]')).toMatch(/var\(--c-text-muted\)/);
  });

  it("the cursor bob scales with --motion-ok and has a static bar", () => {
    expect(rule(".char[data-next]")).toMatch(/animation: bob calc\([^)]*var\(--motion-ok\)\)/);
    expect(rule(".char[data-next]::after")).toMatch(/height: max\(4px/);
  });

  it("target text uses --font-body (M2-08), never the pixel font", () => {
    expect(rule(".word")).toMatch(/font-family: var\(--font-body\)/);
  });

  it("a message pops in quickly, and at once under reduced motion (M4-FIX-4)", () => {
    const pop = rule(".messages output:not([data-still])");
    expect(pop).toMatch(/animation: message-in calc\(var\(--t-fast\) \* var\(--motion-ok\)\)/);
    // It starts part-way visible, so the message reads from its first frame.
    expect(rule("@keyframes message-in")).toMatch(/opacity: 0\.4/);
  });

  it("a stage floor gives way to the keyboard row, which fills what is left (M4-FIX-4)", () => {
    expect(rule(".stage[data-min]")).toMatch(/min-height: min\(var\(--stage-min\), 55dvh\)/);
    const field = rule(".hud:has(> .stage[data-min])");
    expect(field).toMatch(
      /grid-template-rows: auto auto 1fr minmax\(var\(--kb-min\), var\(--kb-h\)\)/,
    );
    // The keys' floor (review B1): a 28 px key unit, never more than the usual height.
    expect(field).toMatch(
      /--kb-min: min\(var\(--kb-h\), calc\(var\(--kb-units\) \* 28px \+ var\(--kb-fixed\)\)\)/,
    );
    const keys = rule(".hud:has(> .stage[data-min]) > .keyboard");
    expect(keys).toMatch(/height: auto/);
    expect(keys).toMatch(/min-height: var\(--kb-min\)/);
    // In a short row letters are half the key (≥ 14 px at the 28 px floor), and a key whose label
    // is hidden keeps its letter in the middle (review B2).
    const board = readFileSync(join(REPO, "src/ui/keyboard/OnScreenKeyboard.module.css"), "utf8");
    const short = board.slice(board.indexOf("@container (max-height: 198px)"));
    expect(short).toMatch(
      /\.slot\[data-face="glyph"\] > kbd \{\s*font-size: calc\(var\(--u\) \* 0\.5\);/,
    );
    expect(short).toMatch(/:not\(\[data-next\], :hover\) > kbd \{\s*padding-bottom: 0;/);
    // Without the hint line (a Miner), the lit key keeps its label even when it is wide.
    expect(short).toMatch(
      /\[data-hud="keyboard"\]:not\(\[data-hands-caption\]\) \.root \.slot\[data-next\]\[data-label-off\] \.label \{\s*visibility: visible;/,
    );
  });

  it("caps the top row's hotbar badges at 30 % of a slot, and hides an empty bar in place", () => {
    expect(rule(".top")).toMatch(
      /--slot-badge-max: calc\(var\(--slot-base\) \* var\(--text-scale\) \* 0\.3\)/,
    );
    expect(rule(".combo[data-hidden]")).toMatch(/visibility: hidden/);
    const slot = readFileSync(join(REPO, "src/ui/kit/Slot.module.css"), "utf8");
    expect(slot).toMatch(
      /font-size: min\(calc\(var\(--fs-sm\) \* var\(--text-scale\)\), var\(--slot-badge-max, 100vw\)\)/,
    );
  });

  it("uses only checked text colors and no rem", () => {
    const fgs = new Set(
      TEXT_PAIRS.map(([fg]) => fg.replaceAll(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)),
    );
    const colors = [...css.matchAll(/(?:^|\s)color:\s*var\(--c-([a-z-]+)\)/g)].map((m) => m[1]);
    expect(colors.length).toBeGreaterThan(0);
    for (const c of colors) expect(fgs, c).toContain(c);
    expect(css).not.toMatch(/\d+(?:\.\d+)?rem\b/);
  });
});

const comboOf = (): Element | null | undefined =>
  host.querySelector('[role="group"]')?.parentElement;
const stageOf = (): HTMLElement | null => host.querySelector<HTMLElement>('[data-hud="stage"]');

describe("parts", () => {
  it("formatTime rounds up", () => {
    expect([
      formatTime(42_000),
      formatTime(41_001),
      formatTime(61_000),
      formatTime(0),
      formatTime(-5),
    ]).toEqual(["0:42", "0:42", "1:01", "0:00", "0:00"]);
  });

  it("with labels on and the hands off, the hint line still names the finger (M3-FIX-12)", () => {
    const hud = createHudStore();
    hud.set({ nextKey: "f" });
    const props = { fields: hud.fields, layout: EN_US } as const;
    const handsOff = { ...defaultSettings("sprout"), showHands: false };
    mount(<Hud {...props} band="sprout" settings={handsOff} />);
    const keys = host.querySelector('[data-hud="keyboard"]');
    expect(keys?.getAttribute("data-hands-caption")).toBe("1");
    expect(keys?.querySelectorAll("svg")).toHaveLength(0);
    expect(keys?.textContent).toContain("Use your left pointer finger.");
    // Labels off too: no hint line, as before.
    mount(<Hud {...props} band="sprout" settings={handsOff} labels={false} />);
    expect(host.querySelector('[data-hud="keyboard"]')?.hasAttribute("data-hands-caption")).toBe(
      false,
    );
    expect(host.textContent).not.toContain("Use your");
  });

  it("the timer is hidden for Sprout and calm mode", () => {
    expect(timerHidden("sprout", { calmMode: false })).toBe(true);
    expect(timerHidden("miner", { calmMode: true })).toBe(true);
    expect(timerHidden("miner", { calmMode: false })).toBe(false);
    const hud = createHudStore();
    hud.set({ timer: { remainingMs: 5000 } });
    const props = { fields: hud.fields, layout: EN_US } as const;
    mount(<Hud {...props} band="sprout" settings={defaultSettings("sprout")} />);
    expect(host.textContent).not.toContain("0:05");
    mount(
      <Hud {...props} band="miner" settings={{ ...defaultSettings("miner"), calmMode: true }} />,
    );
    expect(host.textContent).not.toContain("0:05");
    mount(<Hud {...props} band="miner" settings={defaultSettings("miner")} />);
    expect(host.textContent).toContain(`${t("hud.timeLeft")} ⏱0:05`);
  });

  it("the Caps Lock hint wins over the banner", () => {
    const hud = createHudStore();
    hud.set({ banner: { key: "hud.progress", tone: "cheer" } });
    mount(<HudMessage fields={hud.fields} />);
    expect(host.querySelector("output")?.textContent).toContain(t("hud.progress"));
    void act(() => hud.set({ capsLock: true }));
    expect(host.querySelectorAll("output")).toHaveLength(1);
    expect(host.querySelector("output")?.textContent).toContain(
      "Caps Lock is on! Tap it to turn it off.",
    );
    void act(() => hud.set({ capsLock: false, banner: null }));
    expect(host.querySelector("output")).toBeNull();
  });

  it("combo lights min(9, combo) hotbar slots", () => {
    const hud = createHudStore();
    hud.set({ combo: 12 });
    mount(<HudCombo fields={hud.fields} />);
    expect(host.querySelector('[role="group"]')?.getAttribute("data-lit")).toBe("9");
    expect(host.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe(
      t("hud.combo", { count: 9 }),
    );
  });

  it("fills hotbar slots from the hotbar slice (M2-13), and ignores a malformed one", () => {
    const hud = createHudStore();
    mount(<HudCombo fields={hud.fields} />);
    expect(host.querySelectorAll('[role="img"]')).toHaveLength(0);
    void act(() => {
      hud.set({
        custom: {
          [HOTBAR_SLICE]: {
            slots: [{ label: "Dirt, 3", count: 3, icon: "data:image/png;base64,AAAA" }, null],
          },
        },
      });
    });
    const filled = host.querySelectorAll('[role="img"]');
    expect(filled).toHaveLength(1);
    expect(filled[0]?.getAttribute("aria-label")).toBe("Dirt, 3");
    expect(filled[0]?.querySelector("img")?.getAttribute("src")).toContain("data:image/png");
    expect(filled[0]?.textContent).toContain("3");
    expect(host.querySelector('[role="group"]')?.children).toHaveLength(9);
    expect(hotbarOf({ [HOTBAR_SLICE]: { slots: [{ label: 1 }] } })).toBeNull();
    expect(hotbarOf({ [HOTBAR_SLICE]: "no" })).toBeNull();
    expect(hotbarOf({})).toBeNull();
  });

  it("a mode can hide the hotbar while it is empty; it shows once lit or filled (M4-FIX-4)", () => {
    const hud = createHudStore();
    hud.set({ custom: { [HOTBAR_SLICE]: { slots: [], hideEmpty: true } } });
    mount(<HudCombo fields={hud.fields} />);
    expect(comboOf()?.getAttribute("data-hidden")).toBe("1");
    // A lit combo slot shows it.
    void act(() => hud.set({ combo: 3 }));
    expect(comboOf()?.hasAttribute("data-hidden")).toBe(false);
    void act(() => hud.set({ combo: 0 }));
    expect(comboOf()?.getAttribute("data-hidden")).toBe("1");
    // So does the first item.
    const dirt = { label: "Dirt, 1", count: 1, icon: "" };
    void act(() => hud.set({ custom: { [HOTBAR_SLICE]: { slots: [dirt], hideEmpty: true } } }));
    expect(comboOf()?.hasAttribute("data-hidden")).toBe(false);
    // Without the flag an empty bar shows, as in Mine.
    void act(() => hud.set({ custom: { [HOTBAR_SLICE]: { slots: [] } } }));
    expect(comboOf()?.hasAttribute("data-hidden")).toBe(false);
    expect(hotbarOf({ [HOTBAR_SLICE]: { slots: [], hideEmpty: "yes" } })).toBeNull();
  });

  it("a mode can ask for a least stage height (M4-FIX-4)", () => {
    const hud = createHudStore();
    mount(<HudStage fields={hud.fields} />);
    expect(stageOf()?.hasAttribute("data-min")).toBe(false);
    void act(() => hud.set({ custom: { [STAGE_SLICE]: { minPx: 301.6 } } }));
    expect(stageOf()?.getAttribute("data-min")).toBe("1");
    expect(stageOf()?.style.getPropertyValue("--stage-min")).toBe("302px");
    void act(() => hud.reset());
    expect(stageOf()?.hasAttribute("data-min")).toBe(false);
    expect(stageMinOf({ [STAGE_SLICE]: { minPx: -4 } })).toBeNull();
    expect(stageMinOf({ [STAGE_SLICE]: { minPx: Number.NaN } })).toBeNull();
    expect(stageMinOf({ [STAGE_SLICE]: 300 })).toBeNull();
    expect(stageMinOf({})).toBeNull();
  });

  it("the keyboard follows nextKey and wobbles the key of a reported wrong press", () => {
    const hud = createHudStore();
    hud.set({ nextKey: "f" });
    mount(<HudKeyboard fields={hud.fields} layout={EN_US} hands={false} labels={false} />);
    expect(host.querySelector('[data-next="key"]')?.getAttribute("data-code")).toBe("KeyF");
    void act(() => reportWrongKey(hud, "k"));
    expect(host.querySelector('[data-wobble="1"]')?.getAttribute("data-code")).toBe("KeyK");
  });

  it("a mode can ask for the hint line without the drawn hands (M4-04)", () => {
    const hud = createHudStore();
    hud.set({ nextKey: "a" });
    mount(<HudKeyboard fields={hud.fields} layout={EN_US} hands labels />);
    const row = (): Element | null => host.querySelector('[data-hud="keyboard"]');
    expect(row()?.hasAttribute("data-hands-caption")).toBe(false);
    expect(host.querySelectorAll("svg").length).toBe(2);
    const hint = t("keyboard.useFinger", { finger: t("keyboard.finger.L5") });
    expect(host.textContent).toContain(hint);

    void act(() => hud.set({ custom: { ...hud.get().custom, [HANDS_SLICE]: "caption" } }));
    expect(row()?.getAttribute("data-hands-caption")).toBe("1");
    // The hands are gone; the keys, their finger labels and the hint line stay.
    expect(host.querySelectorAll("svg").length).toBe(0);
    expect(host.textContent).toContain(hint);
    expect(host.querySelector('[data-next="key"]')?.getAttribute("data-code")).toBe("KeyA");
    expect(host.textContent).toContain(t("keyboard.zone.pinky"));

    // Other slices beside it change nothing, and clearing it brings the hands back.
    void act(() => reportWrongKey(hud, "k"));
    expect(host.querySelectorAll("svg").length).toBe(0);
    void act(() => hud.reset());
    expect(host.querySelectorAll("svg").length).toBe(2);
    expect(handsCaptionOnly({ [HANDS_SLICE]: true })).toBe(false);
  });

  it("the hint line is never forced on: without the hands setting there is none", () => {
    const hud = createHudStore();
    hud.set({ nextKey: "a", custom: { [HANDS_SLICE]: "caption" } });
    // (With finger labels on it shows anyway, to name the finger: M3-FIX-12, tested above.)
    mount(<HudKeyboard fields={hud.fields} layout={EN_US} hands={false} labels={false} />);
    expect(host.querySelector('[data-hud="keyboard"]')?.hasAttribute("data-hands-caption")).toBe(
      false,
    );
    expect(host.textContent).not.toContain("Use your");
  });

  it("no keyboard when showKeyboard is off; labels on for Sprout", () => {
    const hud = createHudStore();
    hud.set({ nextKey: "f" });
    mount(
      <Hud
        fields={hud.fields}
        layout={EN_US}
        band="builder"
        settings={defaultSettings("builder")}
      />,
    );
    expect(host.querySelector("[data-layout]")).toBeNull();
    mount(
      <Hud fields={hud.fields} layout={EN_US} band="sprout" settings={defaultSettings("sprout")} />,
    );
    expect(host.querySelector("[data-labels]")).not.toBeNull();
  });
});

/** A mounted miner HUD with a word, a next key and a timer. */
function setupHud() {
  const hud = createHudStore();
  hud.set({
    word: {
      text: "salad",
      marks: ["pending", "pending", "pending", "pending", "pending"],
      typed: 0,
    },
    nextKey: "s",
    timer: { remainingMs: 30_000 },
  });
  mount(
    <Hud fields={hud.fields} layout={EN_US} band="miner" settings={defaultSettings("miner")} />,
  );
  return hud;
}

describe("render counts at 60 Hz", () => {
  type RenderHook = (vnode: VNode) => void;
  let counts: Map<unknown, number>;
  let raw: unknown;

  beforeEach(() => {
    counts = new Map();
    // Preact's render hook (`options._render`, mangled to `__r`) runs before every component render.
    raw = Reflect.get(options, "__r");
    const hook = raw;
    const prev: RenderHook | undefined =
      typeof hook === "function" ? (vnode) => Reflect.apply(hook, options, [vnode]) : undefined;
    Reflect.set(options, "__r", (vnode: VNode) => {
      counts.set(vnode.type, (counts.get(vnode.type) ?? 0) + 1);
      prev?.(vnode);
    });
  });

  afterEach(() => {
    Reflect.set(options, "__r", raw);
  });

  const PARTS = [HudWord, HudCombo, HudProgress, HudTimer, HudMessage, HudKeyboard, Hud] as const;

  function frames(hud: ReturnType<typeof createHudStore>, patch: (i: number) => Partial<HudState>) {
    counts.clear();
    for (let i = 0; i < 60; i++) void act(() => hud.set(patch(i)));
    return Object.fromEntries(PARTS.map((c) => [c.name, counts.get(c) ?? 0]));
  }

  it("re-sending the same state every frame re-renders nothing", () => {
    const hud = setupHud();
    const same = hud.get();
    const r = frames(hud, () => structuredClone(same));
    expect(r).toEqual({
      HudWord: 0,
      HudCombo: 0,
      HudProgress: 0,
      HudTimer: 0,
      HudMessage: 0,
      HudKeyboard: 0,
      Hud: 0,
    });
  });

  it("progress every frame re-renders only the progress bar", () => {
    const hud = setupHud();
    const r = frames(hud, (i) => ({ progress01: (i + 1) / 60 }));
    expect(r).toEqual({
      HudWord: 0,
      HudCombo: 0,
      HudProgress: 60,
      HudTimer: 0,
      HudMessage: 0,
      HudKeyboard: 0,
      Hud: 0,
    });
  });

  it("a timer sent every frame re-renders only the timer, once a second", () => {
    const hud = setupHud();
    // 60 frames of 16.67 ms from 30 s: the display changes once (0:30 → 0:29).
    const r = frames(hud, (i) => ({ timer: { remainingMs: 30_000 - (i + 1) * (1000 / 60) } }));
    expect(r).toEqual({
      HudWord: 0,
      HudCombo: 0,
      HudProgress: 0,
      HudTimer: 1,
      HudMessage: 0,
      HudKeyboard: 0,
      Hud: 0,
    });
  });

  it("typing a word re-renders the word and the keyboard, nothing else", () => {
    const hud = setupHud();
    const text = "salad";
    const r = frames(hud, (i) => {
      const typed = Math.min(text.length, Math.floor(i / 12));
      return {
        word: { text, marks: Array.from(text, (_, j) => (j < typed ? "ok" : "pending")), typed },
        nextKey: text[typed] ?? null,
      };
    });
    expect(r["HudWord"]).toBe(4);
    expect(r["HudKeyboard"]).toBe(4);
    expect({ ...r, HudWord: 0, HudKeyboard: 0 }).toEqual({
      HudWord: 0,
      HudCombo: 0,
      HudProgress: 0,
      HudTimer: 0,
      HudMessage: 0,
      HudKeyboard: 0,
      Hud: 0,
    });
  });

  it("another custom slice doesn't re-render the hotbar, and the same hotbar slice doesn't either", () => {
    const hud = setupHud();
    const slice = { slots: [{ label: "Dirt, 1", count: 1, icon: "" }] };
    void act(() => hud.set({ custom: { [HOTBAR_SLICE]: slice } }));
    const r = frames(hud, (i) => ({ custom: { ...hud.get().custom, other: i } }));
    expect(r["HudCombo"]).toBe(0);
  });

  it("another custom slice doesn't re-render the keyboard", () => {
    const hud = setupHud();
    const r = frames(hud, (i) => ({ custom: { ...hud.get().custom, mine: i } }));
    expect(r["HudKeyboard"]).toBe(0);
  });
});
