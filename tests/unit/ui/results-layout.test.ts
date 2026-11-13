/**
 * Results' layout choice (task M3-FIX-13): side by side only when one column doesn't fit.
 */
import { describe, expect, it } from "vitest";
import { chooseLayout } from "../../../src/ui/screens/Results";

function setup(scroll: number, client: number): HTMLElement {
  const main = document.createElement("main");
  Object.defineProperty(main, "scrollHeight", { get: () => scroll });
  Object.defineProperty(main, "clientHeight", { get: () => client });
  const page = document.createElement("div");
  main.append(page);
  return page;
}

describe("chooseLayout (M3-FIX-13)", () => {
  it("keeps one column when it fits", () => {
    const page = setup(600, 600);
    chooseLayout(page);
    expect(page.dataset["layout"]).toBe("stack");
  });

  it("goes side by side when one column runs past the window", () => {
    const page = setup(908, 600);
    chooseLayout(page);
    expect(page.dataset["layout"]).toBe("side");
  });
});
