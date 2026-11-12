/** @jsxImportSource preact */
/**
 * Builder's HUD (task M4-07): the command line, the palette (key caps for Sprout, words for the
 * older bands), the calm note for an island that won't open, and the stylesheet's colors.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { t } from "../../../src/i18n";
import BuilderHud from "../../../src/modes/builder/BuilderHud";
import { BUILDER_SLICE, builderHudOf } from "../../../src/modes/builder/hud";
import type { BuilderHudSlice } from "../../../src/modes/builder/hud";
import { createHudStore } from "../../../src/ui/hud/bridge";
import { TEXT_PAIRS } from "../../../src/ui/theme/themes";

const REPO = resolve(import.meta.dirname, "../../..");

let host: HTMLElement;
let store: ReturnType<typeof createHudStore>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  store = createHudStore();
  void act(() => render(<BuilderHud fields={store.fields} />, host));
});

afterEach(() => {
  void act(() => render(null, host));
  host.remove();
});

const base: BuilderHudSlice = {
  status: "ready",
  band: "miner",
  line: "",
  completion: "",
  waits: false,
  hint: null,
  armed: "cobble",
  palette: [
    { block: "cobble", name: "Cobble", word: "cobble", count: 30 },
    { block: "oak-planks", name: "Oak Planks", word: "planks", count: 12 },
  ],
  layer: 6,
  facing: "north",
  undo: 0,
};

function show(over: Partial<BuilderHudSlice> = {}): void {
  void act(() =>
    store.set({ custom: { ...store.get().custom, [BUILDER_SLICE]: { ...base, ...over } } }),
  );
}

const q = (sel: string): Element | null => host.querySelector(sel);
const text = (sel: string): string => q(sel)?.textContent ?? "";

describe("builder HUD", () => {
  it("shows nothing before the mode has published, or while the island loads", () => {
    expect(host.innerHTML).toBe("");
    show({ status: "loading" });
    expect(host.innerHTML).toBe("");
  });

  it("the empty line invites typing", () => {
    show();
    expect(q('[data-builder="line"]')?.getAttribute("aria-label")).toBe(t("builder.line.empty"));
    expect(text('[data-builder="line"]')).toContain("Type a word to build");
  });

  it("shows what is typed, the rest of the word dimmed, and names the line", () => {
    show({ line: "plan", completion: "ks" });
    const line = q('[data-builder="line"]');
    expect(line?.getAttribute("data-text")).toBe("plan");
    expect(line?.getAttribute("aria-label")).toBe("You typed: plan");
    expect(line?.textContent).toBe("›planks");
  });

  it("shows the Space key only for a word that waits", () => {
    show({ line: "blu" });
    expect(host.querySelectorAll("kbd")).toHaveLength(0);
    show({ line: "blue", waits: true });
    expect(text("kbd")).toBe("Space");
  });

  it("Miner and Builder see each block's word; the block in hand is marked", () => {
    show();
    const items = [...host.querySelectorAll('[data-builder="palette"] li')];
    expect(items.map((li) => li.getAttribute("data-block"))).toEqual(["cobble", "oak-planks"]);
    expect(items.map((li) => li.getAttribute("data-armed"))).toEqual(["1", null]);
    expect(items[1]?.textContent).toContain("planks");
    expect(items[1]?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "Oak Planks, 12. Type planks.",
    );
    expect(host.querySelectorAll("kbd")).toHaveLength(0);
    expect(text('[data-builder="armed"]')).toBe("In your hand: Cobble");
  });

  it("Sprout sees key caps, one per letter of the short code", () => {
    show({
      band: "sprout",
      palette: [
        { block: "dirt", name: "Dirt", word: "dir", count: 3 },
        { block: "grass", name: "Grass", word: "gras", count: 2 },
      ],
      armed: "dirt",
    });
    const caps = [...host.querySelectorAll('[data-builder="palette"] li')].map((li) =>
      [...li.querySelectorAll("kbd")].map((k) => k.textContent),
    );
    expect(caps).toEqual([
      ["d", "i", "r"],
      ["g", "r", "a", "s"],
    ]);
  });

  it("says the layer and which way is up, and when no block is in hand", () => {
    show({ layer: 9, facing: "east", armed: null });
    expect(text('[data-builder="layer"]')).toBe("Layer 9 · East is up");
    expect(text('[data-builder="armed"]')).toBe(t("builder.palette.none"));
  });

  it("shows one hint, through t()", () => {
    show({ hint: { key: "builder.hint.keepGoing", params: { word: "planks" }, tone: "info" } });
    expect(text("output")).toBe("Keep going: planks");
    show({ hint: null });
    expect(q("output")).toBeNull();
  });

  it("lists the command words", () => {
    show();
    expect(text('[data-builder="help"]')).toContain("putdigundo");
    expect(text('[data-builder="help"]')).toContain("north south east west up down");
  });

  it("an island that won't open: the calm note only, with no command line", () => {
    show({ status: "damaged", palette: [], armed: null });
    expect(text('[data-builder="damaged"]')).toContain(t("builder.damaged.title"));
    expect(text('[data-builder="damaged"]')).toContain(t("builder.damaged.body"));
    expect(text('[data-builder="damaged"]')).toContain(t("builder.damaged.help"));
    expect(q('[data-builder="line"]')).toBeNull();
    expect(q('[data-builder="palette"]')).toBeNull();
  });

  it("takes no pointer input and holds nothing focusable", () => {
    show();
    expect(host.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
  });

  it("the reader ignores other slices and malformed ones", () => {
    expect(builderHudOf({})).toBeNull();
    expect(builderHudOf({ [BUILDER_SLICE]: { status: 1 } })).toBeNull();
    expect(builderHudOf({ [BUILDER_SLICE]: base, hotbar: {} })).toBe(base);
  });
});

describe("builder copy", () => {
  it("never scolds: no pressure words in any hint", () => {
    const keys = [
      "welcome",
      "welcomeEmpty",
      "keepGoing",
      "oneOf",
      "pressSpace",
      "number",
      "tryWord",
      "pickFirst",
      "noneYet",
      "noneLeft",
      "needMore",
      "tooHigh",
      "needsGround",
      "nothingToDig",
      "cantMove",
      "edge",
      "top",
      "bottom",
      "nothingToUndo",
      "noRoom",
      "alreadyThere",
      "built",
    ] as const;
    for (const k of keys) {
      const line = t(`builder.hint.${k}`, {
        word: "w",
        words: "a, b",
        name: "n",
        count: 2,
        max: 9,
      });
      expect(line).not.toMatch(/⟦/);
      expect(line).not.toMatch(/wrong|error|invalid|fail|bad|can't|cannot|oops|!!/i);
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });
});

describe("builder stylesheet", () => {
  const css = readFileSync(resolve(REPO, "src/modes/builder/BuilderHud.module.css"), "utf8");

  it("uses only checked text colors", () => {
    const fgs = new Set(
      TEXT_PAIRS.map(([fg]) => fg.replaceAll(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)),
    );
    const colors = [...css.matchAll(/(?:^|\s)color:\s*var\(--c-([a-z-]+)\)/g)].map((m) => m[1]);
    expect(colors.length).toBeGreaterThan(0);
    for (const c of colors) expect(fgs, c).toContain(c);
  });

  it("typing text uses the body font, and the caret holds still without motion", () => {
    expect(css).toMatch(/\.line \{[^}]*font-family: var\(--font-body\)/);
    expect(css).toMatch(/animation: caret calc\(1\.2s \* var\(--motion-ok\)\)/);
  });
});
