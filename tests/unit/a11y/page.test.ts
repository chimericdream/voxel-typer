// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appMotion } from "../../../src/a11y/motion";
import { applyPageSettings, DYSLEXIC_STACK, fontOverrides } from "../../../src/a11y/page";
import { defaultSettings } from "../../../src/save/settings";
import type { Settings } from "../../../src/save/settings";
import { colorOf, THEMES, worstContrast } from "../../../src/ui/theme/themes";

const base = (patch: Partial<Settings> = {}): Settings => ({
  ...defaultSettings("miner"),
  ...patch,
});

describe("page look settings", () => {
  it("high contrast picks the contrast theme; off, the day theme", () => {
    const el = document.createElement("div");
    applyPageSettings(el, base({ highContrast: true }));
    expect(el.dataset["theme"]).toBe("contrast");
    applyPageSettings(el, base({ highContrast: false }));
    expect(el.dataset["theme"]).toBe("day");
  });

  it("text size sets --text-scale only (no root font scaling, decision 74), clamped 1–2", () => {
    const el = document.createElement("div");
    applyPageSettings(el, base({ textScale: 1.75 }));
    expect(el.style.getPropertyValue("--text-scale")).toBe("1.75");
    expect(el.style.fontSize).toBe("");
    applyPageSettings(el, base({ textScale: 9 }));
    expect(el.style.getPropertyValue("--text-scale")).toBe("2");
  });

  it("reduced motion sets data-motion and the app's shared flag", () => {
    const el = document.createElement("div");
    applyPageSettings(el, base({ reducedMotion: true }));
    expect(el.dataset["motion"]).toBe("reduced");
    expect(appMotion().reduced()).toBe(true);
    applyPageSettings(el, base({ reducedMotion: false }));
    expect(el.dataset["motion"]).toBe("full");
    expect(appMotion().reduced()).toBe(false);
    applyPageSettings(el, base({ reducedMotion: "system" }));
    expect(el.dataset["motion"]).toBeUndefined();
    expect(appMotion().setting()).toBe("system");
  });

  it("fonts: pixel is the default look, clean drops the pixel font, dyslexic uses OpenDyslexic", () => {
    const el = document.createElement("div");
    applyPageSettings(el, base({ font: "dyslexic" }));
    expect(el.dataset["font"]).toBe("dyslexic");
    expect(el.style.getPropertyValue("--font-body")).toBe(DYSLEXIC_STACK);
    expect(el.style.getPropertyValue("--font-pixel")).toBe(DYSLEXIC_STACK);
    applyPageSettings(el, base({ font: "clean" }));
    expect(el.style.getPropertyValue("--font-body")).toBe("");
    expect(el.style.getPropertyValue("--font-pixel")).toBe("var(--font-body)");
    applyPageSettings(el, base({ font: "pixel" }));
    expect(el.style.getPropertyValue("--font-body")).toBe("");
    expect(el.style.getPropertyValue("--font-pixel")).toBe("");
  });

  it("no font setting ever puts the pixel font on --font-body (typing targets, decision 68)", () => {
    for (const font of ["pixel", "clean", "dyslexic"] as const) {
      for (const [prop, value] of fontOverrides(font)) {
        if (prop === "--font-body") expect(value ?? "").not.toMatch(/Pixelify|--font-pixel/);
      }
    }
  });

  it("typing targets use --font-body in the HUD stylesheet (decision 68)", () => {
    const css = readFileSync("src/ui/hud/Hud.module.css", "utf8");
    const word = /\.word\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(word).toContain("font-family: var(--font-body)");
  });
});

describe("high contrast HUD word (M2-FIX-2 still holds)", () => {
  const theme = THEMES.contrast;
  const text = colorOf(theme, "text");
  const muted = colorOf(theme, "textMuted");
  const panel = colorOf(theme, "panel");

  it("typed letters (textMuted) and letters still to type (text) are different colors", () => {
    expect(muted).not.toBe(text);
    // Clearly apart from each other, not just a hair.
    expect(worstContrast(text, muted)).toBeGreaterThanOrEqual(1.5);
  });

  it("both still read at 4.5:1 on the panel", () => {
    expect(worstContrast(text, panel)).toBeGreaterThanOrEqual(4.5);
    expect(worstContrast(muted, panel)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("a11y stylesheets", () => {
  const motion = readFileSync("src/ui/theme/motion.css", "utf8");
  const contrast = readFileSync("src/ui/theme/high-contrast.css", "utf8");

  it("reduced motion ends every animation and transition, by setting and by OS preference", () => {
    expect(motion).toContain(':root[data-motion="reduced"] *');
    expect(motion).toContain("@media (prefers-reduced-motion: reduce)");
    expect(motion).toContain(":root:not([data-motion]) *");
    expect(motion).toMatch(/animation-duration: 0s !important/);
    expect(motion).toMatch(/transition-duration: 0s !important/);
    // A child who turned motion on keeps it.
    expect(motion).not.toContain('[data-motion="full"] *');
  });

  it("high contrast has a forced-colors fallback and no network or font loads", () => {
    expect(contrast).toContain("@media (forced-colors: active)");
    for (const css of [motion, contrast]) {
      expect(css).not.toMatch(/url\(|@import|@font-face/);
    }
  });
});
