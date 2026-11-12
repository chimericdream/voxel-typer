// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { guardHeldActivation, isHeldActivation } from "../../../src/a11y/key-repeat";

afterEach(() => {
  document.body.replaceChildren();
});

function keydown(target: Element, key: string, repeat: boolean): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, repeat, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

describe("a held Enter presses a control once (PLAN.md §4.6)", () => {
  it("cancels repeated Enter on buttons, switches and tabs", () => {
    const off = guardHeldActivation(window);
    const button = document.createElement("button");
    const toggle = document.createElement("button");
    toggle.setAttribute("role", "switch");
    const inner = document.createElement("span");
    const tab = document.createElement("div");
    tab.setAttribute("role", "tab");
    tab.append(inner);
    document.body.append(button, toggle, tab);
    for (const el of [button, toggle, inner]) {
      expect(keydown(el, "Enter", false).defaultPrevented).toBe(false);
      expect(keydown(el, "Enter", true).defaultPrevented).toBe(true);
    }
    off();
    expect(keydown(button, "Enter", true).defaultPrevented).toBe(false);
  });

  it("leaves other keys and text fields alone", () => {
    const off = guardHeldActivation(window);
    const button = document.createElement("button");
    const input = document.createElement("input");
    document.body.append(button, input);
    expect(keydown(button, " ", true).defaultPrevented).toBe(false);
    expect(keydown(input, "Enter", true).defaultPrevented).toBe(false);
    expect(keydown(input, "a", true).defaultPrevented).toBe(false);
    off();
  });

  it("isHeldActivation is false for a non-element target", () => {
    expect(isHeldActivation({ key: "Enter", repeat: true, target: null })).toBe(false);
    expect(isHeldActivation({ key: "Enter", repeat: true, target: window })).toBe(false);
  });
});
