/**
 * Screens whose code has arrived (M4-FIX-7). A lesson fetches the screen it ends on as it starts
 * (`preloadScreen`); once that code is here, the app draws the screen in the same render as the
 * route change, without waiting a frame for an effect and a promise. On CI's software renderer
 * that wait alone was about 2 s, with an empty page.
 */
import type { ComponentType } from "preact";
import type { ScreenLoader } from "./routes";
import type { ScreenProps } from "./types";

type Screen = ComponentType<ScreenProps>;

const loaded = new Map<ScreenLoader, Screen>();

/** Fetches a screen's code (the module cache keeps it), remembers it, and returns it. */
export async function loadScreen(loader: ScreenLoader): Promise<Screen> {
  const m = await loader();
  loaded.set(loader, m.default);
  return m.default;
}

/** The screen for this loader, if its code has already arrived; otherwise null. */
export function loadedScreen(loader: ScreenLoader | undefined): Screen | null {
  return loader === undefined ? null : (loaded.get(loader) ?? null);
}
