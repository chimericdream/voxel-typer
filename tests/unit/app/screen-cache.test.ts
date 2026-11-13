import { describe, expect, it } from "vitest";
import type { ScreenLoader } from "../../../src/app/routes";
import { loadScreen, loadedScreen } from "../../../src/app/screen-cache";

const Screen = (): null => null;
const failing: ScreenLoader = () => Promise.reject(new Error("offline"));

describe("screen cache (M4-FIX-7)", () => {
  it("knows a screen only once its code has arrived, and then at once", async () => {
    let calls = 0;
    const loader: ScreenLoader = () => {
      calls++;
      return Promise.resolve({ default: Screen });
    };
    expect(loadedScreen(loader)).toBeNull();
    expect(loadedScreen(undefined)).toBeNull();
    const p = loadScreen(loader);
    // Still on its way: nothing yet.
    expect(loadedScreen(loader)).toBeNull();
    expect(await p).toBe(Screen);
    expect(loadedScreen(loader)).toBe(Screen);
    expect(calls).toBe(1);
  });

  it("a failed fetch leaves nothing behind", async () => {
    await expect(loadScreen(failing)).rejects.toThrow("offline");
    expect(loadedScreen(failing)).toBeNull();
  });
});
