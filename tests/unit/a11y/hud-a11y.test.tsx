/** @jsxImportSource preact */
// @vitest-environment happy-dom
/**
 * The HUD's accessibility options (M3-07): finger labels for every band, the "hear it again" hint,
 * and the keyboard's wrong-key outline going through the shared flash guard.
 */
import { render } from "preact";
import type { VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flashGuard } from "../../../src/a11y/flashes";
import { EN_US } from "../../../src/content/layouts";
import { defaultSettings } from "../../../src/save/settings";
import { createHudStore } from "../../../src/ui/hud/bridge";
import { Hud } from "../../../src/ui/hud/Hud";
import { OnScreenKeyboard } from "../../../src/ui/keyboard/OnScreenKeyboard";

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  flashGuard().reset();
});

afterEach(() => {
  render(null, host);
  host.remove();
});

function mount(node: VNode): void {
  void act(() => {
    render(node, host);
  });
}

describe("HUD accessibility options", () => {
  it("finger labels follow the labels prop for any band", () => {
    const hud = createHudStore();
    const miner = defaultSettings("miner");
    mount(<Hud fields={hud.fields} layout={EN_US} band="miner" settings={miner} labels />);
    expect(host.querySelector("[data-labels]")).not.toBeNull();
    mount(
      <Hud
        fields={hud.fields}
        layout={EN_US}
        band="sprout"
        settings={defaultSettings("sprout")}
        labels={false}
      />,
    );
    expect(host.querySelector("[data-labels]")).toBeNull();
  });

  it("shows the hear-again hint only when given a key", () => {
    const hud = createHudStore();
    const s = defaultSettings("sprout");
    mount(<Hud fields={hud.fields} layout={EN_US} band="sprout" settings={s} />);
    expect(host.textContent).not.toContain("Hear it again");
    mount(<Hud fields={hud.fields} layout={EN_US} band="sprout" settings={s} hearAgainKey="`" />);
    expect(host.textContent).toContain("Hear it again");
    expect(host.querySelector("kbd")?.textContent).toBe("`");
  });
});

describe("keyboard wrong-key outline and the flash guard", () => {
  it("a wobble is refused while the page already flashed 3 times this second", () => {
    let t = 10_000;
    const now = () => t;
    // Something else on the page flashed 3 times just now.
    for (let i = 0; i < 3; i++) expect(flashGuard().tryFlash(t)).toBe(true);
    mount(
      <OnScreenKeyboard layout={EN_US} nextKey="f" show wrong={{ got: "k", seq: 1 }} now={now} />,
    );
    expect(host.querySelector("[data-wobble]")).toBeNull();
    // A second later the guard lets the next wrong key wobble.
    t += 1000;
    mount(
      <OnScreenKeyboard layout={EN_US} nextKey="f" show wrong={{ got: "j", seq: 2 }} now={now} />,
    );
    expect(host.querySelector("[data-wobble]")).not.toBeNull();
  });
});
