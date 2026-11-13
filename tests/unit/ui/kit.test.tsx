/** @jsxImportSource preact */
/**
 * UI kit (task M2-07): theme contrast, bevel images, theme application and every component's
 * keyboard behavior and roles, under happy-dom.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BEVEL_ART,
  BEVEL_SCALE,
  bevelDataUri,
  bevelPixels,
  clearBevelCache,
} from "../../../src/ui/kit/bevel";
import type { BevelCanvas, BevelSpec } from "../../../src/ui/kit/bevel";
import { Button } from "../../../src/ui/kit/Button";
import { Dialog, trapTab } from "../../../src/ui/kit/Dialog";
import { HOTBAR_SLOTS, Hotbar } from "../../../src/ui/kit/Hotbar";
import { KeyCap } from "../../../src/ui/kit/KeyCap";
import { Panel } from "../../../src/ui/kit/Panel";
import { ProgressBar, filledSegments } from "../../../src/ui/kit/ProgressBar";
import { Slider } from "../../../src/ui/kit/Slider";
import { Slot } from "../../../src/ui/kit/Slot";
import { Stars } from "../../../src/ui/kit/Stars";
import { Tabs } from "../../../src/ui/kit/Tabs";
import { Toast } from "../../../src/ui/kit/Toast";
import { FIRST_ANNOUNCE_MS, TOAST_AFTER_PAGE_MS, announce } from "../../../src/ui/kit/announce";
import { Toggle } from "../../../src/ui/kit/Toggle";
import {
  FOCUS_BACKDROPS,
  INK_IDS,
  SURFACE_IDS,
  TEXT_PAIRS,
  THEMES,
  THEME_IDS,
  UI_PAIRS,
  applyMotion,
  applyTextScale,
  applyTheme,
  colorOf,
  contrastRatio,
  cssVar,
  parseColor,
  themeFor,
  themeProperties,
  worstContrast,
} from "../../../src/ui/theme/themes";
import type { ColorToken } from "../../../src/ui/theme/themes";

const REPO = resolve(import.meta.dirname, "../../..");
const KIT_DIR = join(REPO, "src/ui/kit");

// ---- Contrast (acceptance: day, night and high contrast) ----

describe("WCAG contrast", () => {
  it("computes known ratios", () => {
    expect(contrastRatio(parseColor("#000000"), parseColor("#ffffff"))).toBeCloseTo(21, 5);
    expect(contrastRatio(parseColor("#777777"), parseColor("#777777"))).toBe(1);
    // #767676 on white is the classic 4.54:1.
    expect(contrastRatio(parseColor("#767676"), parseColor("#ffffff"))).toBeCloseTo(4.54, 2);
  });

  it("checks a semi-opaque background over both black and white", () => {
    // Half-transparent black: fine over black, poor over white, so the worst case is the white one.
    const overWhite = contrastRatio(parseColor("#ffffff"), [127.5, 127.5, 127.5, 1]);
    expect(worstContrast("#ffffff", "rgba(0, 0, 0, 0.5)")).toBeCloseTo(overWhite, 5);
  });

  for (const id of THEME_IDS) {
    describe(`${id} theme`, () => {
      const theme = THEMES[id];

      it.each(TEXT_PAIRS.map(([fg, bg]) => [fg, bg] as const))(
        "text %s on %s is at least 4.5:1",
        (fg, bg) => {
          expect(worstContrast(colorOf(theme, fg), colorOf(theme, bg))).toBeGreaterThanOrEqual(4.5);
        },
      );

      it.each(UI_PAIRS.map(([a, b]) => [a, b] as const))(
        "%s against %s is at least 3:1",
        (a, b) => {
          expect(worstContrast(colorOf(theme, a), colorOf(theme, b))).toBeGreaterThanOrEqual(3);
        },
      );

      it.each(FOCUS_BACKDROPS.map((b) => [b] as const))("the focus ring shows on %s", (bg) => {
        const ring = worstContrast(theme.ink.focus, colorOf(theme, bg));
        const halo = worstContrast(theme.ink.focusHalo, colorOf(theme, bg));
        expect(Math.max(ring, halo)).toBeGreaterThanOrEqual(3);
      });

      it("the selected-slot outline shows on the slot outline and hotbar strip it touches", () => {
        // The outline sits between the slot's own outline and the strip, both `--c-slot-outline`
        // (M2-07 review N1: the old check used the slot face, which it doesn't touch).
        expect(
          worstContrast(theme.ink.selected, theme.surfaces.slot.outline),
        ).toBeGreaterThanOrEqual(3);
      });

      it("text plates are semi-opaque, never clear", () => {
        const [, , , a] = parseColor(theme.ink.plate);
        expect(a).toBeGreaterThanOrEqual(0.75);
        expect(a).toBeLessThan(1);
      });

      it("surface colors are #rrggbb (bevel.ts paints them)", () => {
        for (const s of SURFACE_IDS) {
          for (const c of Object.values(theme.surfaces[s])) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
        }
      });
    });
  }
});

/** CSS custom properties the kit's stylesheets read: `--c-foo-bar`. */
function kitCss(): { file: string; text: string }[] {
  return readdirSync(KIT_DIR)
    .filter((f) => f.endsWith(".module.css"))
    .map((file) => ({ file, text: readFileSync(join(KIT_DIR, file), "utf8") }));
}

const kebabToToken = new Map<string, ColorToken>(
  [...SURFACE_IDS, ...INK_IDS].map((t) => [cssVar(t), t] as const),
);

describe("stylesheets use only checked colors", () => {
  const defined = new Set(themeProperties(THEMES.day).map(([name]) => name));

  it("every --c-* var a kit stylesheet reads is set by applyTheme", () => {
    for (const { file, text } of kitCss()) {
      for (const [name] of text.matchAll(/--c-[a-z-]+/g)) {
        expect(defined.has(name), `${file}: ${name}`).toBe(true);
      }
    }
  });

  it("every text color a kit stylesheet sets is a checked TEXT_PAIRS foreground", () => {
    const foregrounds = new Set<ColorToken>(TEXT_PAIRS.map(([fg]) => fg));
    for (const { file, text } of kitCss()) {
      for (const m of text.matchAll(/(?<![-\w])color:\s*var\((--c-[a-z-]+)\)/g)) {
        const token = kebabToToken.get(m[1] ?? "");
        expect(token, `${file}: ${m[0]}`).toBeDefined();
        if (token) expect(foregrounds.has(token), `${file}: ${m[0]}`).toBe(true);
      }
    }
  });

  it("tokens.css defines the fonts, text scale and spacing, and loads nothing", () => {
    const css = readFileSync(join(REPO, "src/ui/theme/tokens.css"), "utf8");
    for (const name of ["--font-pixel", "--font-body", "--text-scale", "--sp-1", "--sp-6"]) {
      expect(css).toContain(`${name}:`);
    }
    // No network fonts, ever (PLAN.md §6.1): no url(), @import or @font-face here.
    expect(css).not.toMatch(/url\(|@import|@font-face|https?:/);
    expect(css).toMatch(/--font-body:[^;]*sans-serif;/);
    // M3-FIX-2: UI chrome uses the body font. Pixelify's B, C, 5 and 0 misread at every size.
    expect(css).toMatch(/--font-pixel:\s*var\(--font-body\);/);
    expect(css).not.toMatch(/--font-[\w-]+:[^;]*Pixelify/);
  });
});

// ---- Bevels ----

const SPEC: BevelSpec = {
  kind: "raised",
  outline: "#101010",
  shadow: "#202020",
  face: "#808080",
  highlight: "#f0f0f0",
};

/** The RGBA of the screen pixel at the center of art pixel (x, y). */
function art(px: Uint8ClampedArray, x: number, y: number): number[] {
  const size = BEVEL_ART * BEVEL_SCALE;
  const sx = x * BEVEL_SCALE + 1;
  const sy = y * BEVEL_SCALE + 1;
  const i = (sy * size + sx) * 4;
  return [...px.subarray(i, i + 4)];
}
const rgba = (hex: string): number[] => [...parseColor(hex).slice(0, 3), 255];

function noContextCanvas(): BevelCanvas {
  return { width: 0, height: 0, getContext: () => null, toDataURL: () => "" };
}

describe("bevel", () => {
  it("is 7×7 art pixels at BEVEL_SCALE, with notched clear corners", () => {
    const px = bevelPixels(SPEC);
    expect(px.length).toBe((BEVEL_ART * BEVEL_SCALE) ** 2 * 4);
    for (const [x, y] of [
      [0, 0],
      [6, 0],
      [0, 6],
      [6, 6],
    ] as const) {
      expect(art(px, x, y)[3]).toBe(0);
    }
    expect(art(px, 3, 0)).toEqual(rgba(SPEC.outline));
    expect(art(px, 3, 3)).toEqual(rgba(SPEC.face));
  });

  it("raised: light top and left, dark bottom and right", () => {
    const px = bevelPixels(SPEC);
    expect(art(px, 3, 1)).toEqual(rgba(SPEC.highlight));
    expect(art(px, 1, 3)).toEqual(rgba(SPEC.highlight));
    expect(art(px, 3, 5)).toEqual(rgba(SPEC.shadow));
    expect(art(px, 5, 3)).toEqual(rgba(SPEC.shadow));
  });

  it("pressed and inset put the shadow on top", () => {
    const pressed = bevelPixels({ ...SPEC, kind: "pressed" });
    expect(art(pressed, 3, 1)).toEqual(rgba(SPEC.shadow));
    expect(art(pressed, 3, 5)).toEqual(rgba(SPEC.face));
    const inset = bevelPixels({ ...SPEC, kind: "inset" });
    expect(art(inset, 3, 1)).toEqual(rgba(SPEC.shadow));
    expect(art(inset, 3, 5)).toEqual(rgba(SPEC.highlight));
  });

  it("every art pixel is a solid block (hard edges at any scale)", () => {
    const px = bevelPixels(SPEC, 4);
    const size = BEVEL_ART * 4;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const j = ((y - (y % 4)) * size + (x - (x % 4))) * 4;
        expect(px.slice(i, i + 4)).toEqual(px.slice(j, j + 4));
      }
    }
  });

  it("paints once per spec and caches the data URI", () => {
    clearBevelCache();
    const put = vi.fn();
    const canvas = vi.fn((): BevelCanvas => ({
      width: 0,
      height: 0,
      getContext: () => ({ putImageData: put }),
      toDataURL: () => "data:image/png;base64,AAAA",
    }));
    expect(bevelDataUri(SPEC, canvas)).toBe("data:image/png;base64,AAAA");
    expect(bevelDataUri(SPEC, canvas)).toBe("data:image/png;base64,AAAA");
    expect(canvas).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    bevelDataUri({ ...SPEC, kind: "inset" }, canvas);
    expect(canvas).toHaveBeenCalledTimes(2);
  });

  it("returns null where there is no 2D canvas", () => {
    clearBevelCache();
    expect(bevelDataUri(SPEC, () => null)).toBeNull();
    clearBevelCache();
    expect(bevelDataUri(SPEC, noContextCanvas)).toBeNull();
  });
});

// ---- Applying themes ----

describe("applyTheme and friends", () => {
  it("sets data-theme, color-scheme and every color var", () => {
    const el = document.createElement("div");
    applyTheme(el, "night");
    expect(el.dataset["theme"]).toBe("night");
    expect(el.style.colorScheme).toBe("dark");
    expect(el.style.getPropertyValue("--c-text")).toBe(THEMES.night.ink.text);
    expect(el.style.getPropertyValue("--c-toast-info-text")).toBe(THEMES.night.ink.toastInfoText);
    expect(el.style.getPropertyValue("--c-panel")).toBe(THEMES.night.surfaces.panel.face);
    expect(el.style.getPropertyValue("--c-panel-outline")).toBe(
      THEMES.night.surfaces.panel.outline,
    );
  });

  it("themeFor: high contrast wins; dusk and night are cool", () => {
    expect(themeFor(true, "day")).toBe("contrast");
    expect(themeFor(false, "day")).toBe("day");
    expect(themeFor(false, "dawn")).toBe("day");
    expect(themeFor(false, "dusk")).toBe("night");
    expect(themeFor(false, "night")).toBe("night");
  });

  it("applyTextScale clamps to the settings range 1–2", () => {
    const el = document.createElement("div");
    applyTextScale(el, 1.5);
    expect(el.style.getPropertyValue("--text-scale")).toBe("1.5");
    applyTextScale(el, 9);
    expect(el.style.getPropertyValue("--text-scale")).toBe("2");
    applyTextScale(el, Number.NaN);
    expect(el.style.getPropertyValue("--text-scale")).toBe("1");
  });

  it("applyMotion overrides the system only when told to", () => {
    const el = document.createElement("div");
    applyMotion(el, true);
    expect(el.dataset["motion"]).toBe("reduced");
    applyMotion(el, false);
    expect(el.dataset["motion"]).toBe("full");
    applyMotion(el, "system");
    expect(el.dataset["motion"]).toBeUndefined();
  });
});

// ---- Components ----

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

function $(selector: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no ${selector}`);
  return el;
}

function key(el: Element, type: "keydown" | "keyup", k: string, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, ...init });
  void act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

function click(el: Element): void {
  void act(() => {
    if (el instanceof HTMLElement) el.click();
  });
}

describe("Button", () => {
  it("is a native button that clicks and shows pressed while Enter or Space is held", () => {
    const onClick = vi.fn();
    mount(<Button onClick={onClick}>Go</Button>);
    const b = $("button");
    expect(b.getAttribute("type")).toBe("button");
    key(b, "keydown", " ");
    expect(b.dataset["pressed"]).toBe("1");
    key(b, "keyup", " ");
    expect(b.dataset["pressed"]).toBeUndefined();
    key(b, "keydown", "Enter");
    expect(b.dataset["pressed"]).toBe("1");
    void act(() => {
      b.dispatchEvent(new FocusEvent("blur"));
    });
    expect(b.dataset["pressed"]).toBeUndefined();
    key(b, "keydown", "a");
    expect(b.dataset["pressed"]).toBeUndefined();
    click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ignores auto-repeated Enter, so a held key clicks once", () => {
    mount(<Button>Go</Button>);
    const b = $("button");
    expect(key(b, "keydown", "Enter").defaultPrevented).toBe(false);
    expect(key(b, "keydown", "Enter", { repeat: true }).defaultPrevented).toBe(true);
  });

  it("disabled stays focusable but does nothing, and blocks a form submit (M2-07 N7)", () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    mount(
      <form onSubmit={onSubmit}>
        <Button type="submit" disabled onClick={onClick}>
          Locked
        </Button>
      </form>,
    );
    const b = $("button");
    expect(b.hasAttribute("disabled")).toBe(false);
    expect(b.getAttribute("aria-disabled")).toBe("true");
    b.focus();
    expect(document.activeElement).toBe(b);
    key(b, "keydown", "Enter");
    expect(b.dataset["pressed"]).toBeUndefined();
    click(b);
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("takes a label for icon-only content, and a variant", () => {
    mount(
      <Button label="Play" variant="primary">
        ▶
      </Button>,
    );
    expect($("button").getAttribute("aria-label")).toBe("Play");
    expect($("button").dataset["variant"]).toBe("primary");
  });
});

describe("Panel", () => {
  it("is a region named by its heading", () => {
    mount(<Panel heading="Hello">body</Panel>);
    const section = $("section");
    const h = $("h2");
    expect(h.textContent).toBe("Hello");
    expect(section.getAttribute("aria-labelledby")).toBe(h.id);
  });

  it("plate tone has no heading unless asked", () => {
    mount(<Panel tone="plate">text</Panel>);
    expect($("section").dataset["tone"]).toBe("plate");
    expect(host.querySelector("h2")).toBeNull();
  });
});

describe("Slot and Hotbar", () => {
  it("a labelled slot is an image; its badge is hidden from assistive tech", () => {
    mount(<Slot label="Stone, 30" count={30} />);
    const slot = $("[role=img]");
    expect(slot.getAttribute("aria-label")).toBe("Stone, 30");
    const badge = slot.querySelector("[aria-hidden=true]");
    expect(badge?.textContent).toBe("30");
  });

  it("a count of 1 shows no badge; huge counts cap", () => {
    mount(<Slot label="Wool" count={1} />);
    expect(host.textContent).toBe("");
    mount(<Slot label="Sand" count={5000} />);
    expect(host.textContent).toBe("999+");
  });

  it("a clickable slot is a toggle button", () => {
    const onClick = vi.fn();
    mount(<Slot label="Oak" selected onClick={onClick} />);
    const b = $("button");
    expect(b.getAttribute("aria-pressed")).toBe("true");
    click(b);
    expect(onClick).toHaveBeenCalled();
  });

  it("an empty slot is decoration", () => {
    mount(<Slot />);
    expect($("span").getAttribute("aria-hidden")).toBe("true");
  });

  it("the hotbar always has 9 slots and lights the first `lit`", () => {
    mount(<Hotbar label="Hotbar" slots={[{ label: "Oak" }]} lit={4} selected={0} />);
    const bar = $("[role=group]");
    expect(bar.getAttribute("aria-label")).toBe("Hotbar");
    expect(bar.children).toHaveLength(HOTBAR_SLOTS);
    expect(bar.querySelectorAll("[data-lit]")).toHaveLength(4);
    expect(bar.querySelectorAll("[data-selected]")).toHaveLength(1);
    expect(bar.querySelectorAll("[role=img]")).toHaveLength(1);
  });
});

describe("ProgressBar", () => {
  it("fills blocks and reports a percent", () => {
    mount(<ProgressBar value01={0.6} label="Progress" valueText="6 of 10" />);
    const bar = $("[role=progressbar]");
    expect(bar.getAttribute("aria-valuenow")).toBe("60");
    expect(bar.getAttribute("aria-valuetext")).toBe("6 of 10");
    expect(bar.getAttribute("aria-label")).toBe("Progress");
    expect(bar.children).toHaveLength(10);
    expect(bar.querySelectorAll("[data-filled]")).toHaveLength(6);
  });

  it("clamps, and any progress shows at least one block", () => {
    expect(filledSegments(0, 10)).toBe(0);
    expect(filledSegments(0.01, 10)).toBe(1);
    expect(filledSegments(1, 10)).toBe(10);
    expect(filledSegments(7, 10)).toBe(10);
    expect(filledSegments(-1, 10)).toBe(0);
    expect(filledSegments(Number.NaN, 10)).toBe(0);
  });
});

describe("Toast", () => {
  it("is a status message read out through one persistent live region (M2-07 N5)", () => {
    vi.useFakeTimers();
    try {
      document.getElementById("vt-announcer-toast")?.remove();
      mount(<Toast tone="cheer">Nice!</Toast>);
      const out = $("output");
      // The toast itself isn't live: a region that mounts with its text is often not announced.
      expect(out.getAttribute("aria-live")).toBe("off");
      expect(out.dataset["tone"]).toBe("cheer");
      expect(out.textContent).toContain("Nice!");
      // The toasts' own region, apart from route announcements (M3-07 review N6).
      const region = document.getElementById("vt-announcer-toast");
      expect(region?.getAttribute("aria-live")).toBe("polite");
      // Created empty, filled a moment later, so even the first message is read.
      expect(region?.textContent).toBe("");
      vi.advanceTimersByTime(FIRST_ANNOUNCE_MS);
      expect(region?.textContent).toBe("Nice!");
      // A second toast reuses the same region.
      mount(<Toast>Again</Toast>);
      vi.advanceTimersByTime(FIRST_ANNOUNCE_MS);
      expect(document.querySelectorAll("#vt-announcer-toast")).toHaveLength(1);
      expect(region?.textContent).toBe("Again");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("announce: page first, then toast (M3-FIX-4 review S2)", () => {
  it("a toast that comes with a page message waits until a second after it", () => {
    vi.useFakeTimers();
    try {
      announce(document, "Results. 2 stars.");
      announce(document, "New badge!", "toast");
      const page = document.getElementById("vt-announcer");
      const toast = document.getElementById("vt-announcer-toast");
      vi.advanceTimersByTime(FIRST_ANNOUNCE_MS);
      expect(page?.textContent).toBe("Results. 2 stars.");
      expect(toast?.textContent).toBe("");
      vi.advanceTimersByTime(TOAST_AFTER_PAGE_MS - 10);
      expect(toast?.textContent).toBe("");
      vi.advanceTimersByTime(20);
      expect(toast?.textContent).toBe("New badge!");
      // Long after the page message, a toast is read at its usual pace.
      vi.advanceTimersByTime(5000);
      announce(document, "Again!", "toast");
      vi.advanceTimersByTime(FIRST_ANNOUNCE_MS);
      expect(toast?.textContent).toBe("Again!");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Stars", () => {
  it("is one image with a label, and marks earned stars", () => {
    mount(<Stars value={2} label="2 of 3 stars" />);
    const stars = $("[role=img]");
    expect(stars.getAttribute("aria-label")).toBe("2 of 3 stars");
    expect(stars.querySelectorAll("svg")).toHaveLength(3);
    expect(stars.querySelectorAll("svg[data-earned]")).toHaveLength(2);
  });

  it("clamps the value", () => {
    mount(<Stars value={7} label="x" />);
    expect(host.querySelectorAll("svg[data-earned]")).toHaveLength(3);
    mount(<Stars value={-2} label="x" />);
    expect(host.querySelectorAll("svg[data-earned]")).toHaveLength(0);
  });
});

describe("KeyCap", () => {
  it("prints its glyph, with an optional bump and spoken name", () => {
    mount(<KeyCap glyph=";" label="semicolon" bump />);
    const kbd = $("kbd");
    expect(kbd.textContent).toBe(";");
    expect(kbd.getAttribute("aria-label")).toBe("semicolon");
    expect(kbd.getAttribute("role")).toBe("img");
    expect(kbd.querySelector("[aria-hidden=true]")).not.toBeNull();
  });

  it("is plain text without a label", () => {
    mount(<KeyCap glyph="F" />);
    expect($("kbd").getAttribute("role")).toBeNull();
  });
});

function ToggleHarness() {
  const [on, setOn] = useState(false);
  return <Toggle checked={on} onChange={setOn} label="Music" />;
}

describe("Toggle", () => {
  it("is a switch named by its label that flips on click (Space/Enter on a native button)", () => {
    mount(<ToggleHarness />);
    const sw = $("[role=switch]");
    expect(sw.tagName).toBe("BUTTON");
    expect(sw.textContent).toContain("Music");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.textContent).toContain("✓");
  });
});

describe("Slider", () => {
  it("is a labelled native range with a value text", () => {
    const onChange = vi.fn();
    mount(
      <Slider
        value={80}
        min={0}
        max={100}
        step={10}
        onChange={onChange}
        label="Sound"
        valueText={(v) => `${v}%`}
      />,
    );
    const input = $("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("no range input");
    const label = $("label");
    expect(input.type).toBe("range");
    expect(label.getAttribute("for")).toBe(input.id);
    expect(label.textContent).toBe("Sound");
    expect(input.getAttribute("aria-valuetext")).toBe("80%");
    expect($("output").textContent).toBe("80%");
    void act(() => {
      input.value = "70";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(70);
  });
});

function tabs(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("[role=tab]")];
}

function tab(i: number): HTMLElement {
  const el = tabs()[i];
  if (!el) throw new Error(`no tab ${i}`);
  return el;
}

describe("Tabs", () => {
  const TABS = [
    { id: "a", label: "Alpha", content: "A body" },
    { id: "b", label: "Beta", content: "B body" },
    { id: "c", label: "Gamma", content: "C body" },
  ];

  it("follows the tabs pattern: one tab stop, arrows wrap, Home/End", () => {
    const onSelect = vi.fn();
    mount(<Tabs label="Pages" tabs={TABS} onSelect={onSelect} />);
    const list = $("[role=tablist]");
    expect(list.getAttribute("aria-label")).toBe("Pages");
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    const panel = (): HTMLElement => $("[role=tabpanel]");
    expect(panel().textContent).toBe("A body");
    expect(panel().getAttribute("aria-labelledby")).toBe(tabs()[0]?.id);

    tabs()[0]?.focus();
    key(tab(0), "keydown", "ArrowLeft");
    expect(tabs()[2]?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs()[2]);
    expect(panel().textContent).toBe("C body");
    key(tab(2), "keydown", "ArrowRight");
    expect(tabs()[0]?.getAttribute("aria-selected")).toBe("true");
    key(tab(0), "keydown", "End");
    expect(document.activeElement).toBe(tabs()[2]);
    key(tab(2), "keydown", "Home");
    expect(document.activeElement).toBe(tabs()[0]);
    click(tab(1));
    expect(panel().textContent).toBe("B body");
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    expect(onSelect).toHaveBeenLastCalledWith("b");
  });
});

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" id="opener" onClick={() => setOpen(true)}>
        open
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Hi" closeLabel="Close">
        <button type="button" id="one">
          one
        </button>
        <button type="button" id="two">
          two
        </button>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  const windowKey = vi.fn();

  beforeEach(() => {
    windowKey.mockClear();
    window.addEventListener("keydown", windowKey);
  });

  afterEach(() => {
    window.removeEventListener("keydown", windowKey);
  });

  it("opens modal and named, focuses inside, traps Tab, closes on Escape and restores focus", () => {
    mount(<DialogHarness />);
    const opener = $("#opener");
    opener.focus();
    click(opener);

    const dialog = $("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect($(`#${CSS.escape(dialog.getAttribute("aria-labelledby") ?? "")}`).textContent).toBe(
      "Hi",
    );
    const close = dialog.querySelector("button");
    expect(close?.textContent).toContain("Close");
    expect(document.activeElement).toBe(close);

    // Shift+Tab from the first control wraps to the last; Tab from the last wraps to the first.
    const shiftTab = key(dialog, "keydown", "Tab", { shiftKey: true });
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe($("#two"));
    key(dialog, "keydown", "Tab");
    expect(document.activeElement).toBe(close);
    // Tab in the middle is left to the browser.
    $("#one").focus();
    expect(key(dialog, "keydown", "Tab").defaultPrevented).toBe(false);

    // Escape closes, and doesn't reach the window (the app's `back`).
    key($("#one"), "keydown", "Escape");
    expect(host.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(windowKey).not.toHaveBeenCalled();
  });

  it("swallows auto-repeated Enter and Space, so a held key can't flash it shut and open", () => {
    mount(<DialogHarness />);
    click($("#opener"));
    const close = $("dialog button");
    for (const k of ["Enter", " "]) {
      const e = key(close, "keydown", k, { repeat: true });
      expect(e.defaultPrevented).toBe(true);
    }
    expect(host.querySelector("dialog")).not.toBeNull();
    expect(windowKey).not.toHaveBeenCalled();
  });

  it("the close button closes it", () => {
    mount(<DialogHarness />);
    click($("#opener"));
    click($("dialog button"));
    expect(host.querySelector("dialog")).toBeNull();
  });

  it("trapTab pulls focus from outside back in", () => {
    const root = document.createElement("div");
    root.innerHTML = '<button id="x">x</button><button id="y">y</button>';
    document.body.append(root, document.createElement("input"));
    expect(trapTab(root, false, document.body)).toBe(true);
    expect(document.activeElement?.id).toBe("x");
    expect(trapTab(root, true, document.body)).toBe(true);
    expect(document.activeElement?.id).toBe("y");
    root.remove();
  });
});
