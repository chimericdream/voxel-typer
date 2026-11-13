/** @jsxImportSource preact */
// @vitest-environment happy-dom
/**
 * `useReducedMotion` (M3-FIX-4, M3-07 review N7): a screen that reads the motion flag through it
 * follows a change while it is up, as Results does.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setMotionSetting } from "../../../src/a11y/motion";
import { useReducedMotion } from "../../../src/ui/screens/nav";

function Probe() {
  return <p>{useReducedMotion(undefined) ? "still" : "moving"}</p>;
}

let host: HTMLElement | null = null;

afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = null;
  setMotionSetting("system");
});

describe("useReducedMotion", () => {
  it("renders again when the motion flag changes", () => {
    setMotionSetting(false);
    const el = document.createElement("div");
    host = el;
    document.body.append(el);
    void act(() => render(<Probe />, el));
    expect(el.textContent).toBe("moving");
    void act(() => setMotionSetting(true));
    expect(el.textContent).toBe("still");
    void act(() => setMotionSetting(false));
    expect(el.textContent).toBe("moving");
  });
});
