/**
 * Escape and a screen that isn't up yet (task M3-FIX-13): while a route's screen code is still
 * loading, an Escape no screen takes is dropped; once the code has failed to load (offline, say),
 * Escape goes back again, so the child is never stuck.
 */
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { screens } from "../../../../src/app/routes";
import type { Harness } from "./harness";
import { mount } from "./harness";

let h: Harness | undefined;
const found = screens.privacy;
if (!found) throw new Error("no privacy screen");
const real = found;

afterEach(() => {
  h?.unmount();
  h = undefined;
  screens.privacy = real;
});

const escape = (s: Harness): void =>
  s.shell.router.handle({ kind: "control", action: "back", t: 0 });

describe("Escape before the screen is up (M3-FIX-13)", () => {
  it("is dropped while the screen's code is still loading", async () => {
    let arrive: (() => void) | undefined;
    const held = real();
    screens.privacy = () =>
      new Promise((done) => {
        arrive = () => done(held);
      });
    const s = await mount();
    h = s;
    // Draw the new route: its screen starts loading, and is held.
    await act(async () => {
      s.shell.api.navigate({ id: "privacy" });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(arrive).toBeDefined();
    escape(s);
    expect(s.route().id).toBe("privacy");
    // The screen arrives and is up: Escape goes back again.
    arrive?.();
    await s.settle();
    escape(s);
    expect(s.route().id).toBe("splash");
  });

  it("goes back once the screen's code has failed to load", async () => {
    screens.privacy = () => Promise.reject(new Error("offline"));
    const s = await mount();
    h = s;
    s.shell.api.navigate({ id: "privacy" });
    await s.settle();
    await s.press("Escape");
    expect(s.route().id).toBe("splash");
  });
});
