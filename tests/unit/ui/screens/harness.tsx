/** @jsxImportSource preact */
/**
 * Test harness for the screens (task M2-11): the real app shell, input router and `App` view, with
 * `attachKeyboard` on `window` as in `main.ts`, over a memory store. Keys are dispatched on the
 * focused element, so they bubble through components to the router like real key presses. The
 * browser's own defaults that happy-dom lacks (Enter or Space clicks a focused button, Enter in a
 * text field submits its form) are applied unless a handler called `preventDefault`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "preact";
import { act } from "preact/test-utils";
import { vi } from "vitest";
import { App } from "../../../../src/app/App";
import { createSilentAudio } from "../../../../src/app/audio";
import { realClock } from "../../../../src/app/clock";
import { createHudStore } from "../../../../src/app/hud";
import type { Route } from "../../../../src/app/routes";
import type { AppScene } from "../../../../src/app/scene-host";
import { createShell } from "../../../../src/app/shell";
import type { Shell } from "../../../../src/app/shell";
import { lessons } from "../../../../src/content/lessons";
import type { Lesson } from "../../../../src/content/lessons/types";
import { attachKeyboard } from "../../../../src/input/keyboard";
import { isProfile } from "../../../../src/save/schema";
import type { Profile } from "../../../../src/save/schema";
import type { SaveProblem } from "../../../../src/save/problems";
import { createMemoryStore } from "../../../../src/save/store";
import type { SaveStore } from "../../../../src/save/store";

const INTERACTIVE = "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export function fixture(name: string): Profile {
  const raw: unknown = JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../../../fixtures/profiles/${name}.json`), "utf8"),
  );
  if (!isProfile(raw)) throw new Error(`fixture ${name} is not a profile`);
  return raw;
}

const target = (): HTMLElement =>
  document.activeElement instanceof HTMLElement ? document.activeElement : document.body;

export interface Harness {
  shell: Shell;
  store: SaveStore;
  audio: ReturnType<typeof makeAudio>;
  root: HTMLElement;
  /** Lets lazy screens load and promises settle. */
  settle(): Promise<void>;
  /** One key press on the focused element (or the body). */
  press(key: string, opts?: { repeat?: boolean; shift?: boolean }): Promise<KeyboardEvent>;
  /** Types text into the focused text field, one char at a time, like a child would. */
  type(text: string): Promise<void>;
  problems: SaveProblem[];
  route(): Route;
  unmount(): void;
}

function makeAudio() {
  return {
    ...createSilentAudio(),
    unlock: vi.fn(() => Promise.resolve()),
    sfx: vi.fn(),
    speak: vi.fn(),
    setVolume: vi.fn(),
    setSpeechEnabled: vi.fn(),
  };
}

export async function mount(
  opts: {
    initial?: Route;
    profiles?: Profile[];
    initialProfile?: Profile;
    store?: SaveStore;
    /** The app's shared scene. By default there is none, so 3D screens run flat. */
    acquireScene?: () => Promise<AppScene>;
    /** The curriculum. By default the shipped lessons. */
    lessons?: readonly Lesson[];
  } = {},
): Promise<Harness> {
  const problems: SaveProblem[] = [];
  const relay: { to: ((p: SaveProblem) => void) | null } = { to: null };
  const store =
    opts.store ??
    createMemoryStore({
      onProblem: (p) => {
        problems.push(p);
        relay.to?.(p);
      },
    });
  for (const p of opts.profiles ?? []) await store.save(p);
  const audio = makeAudio();
  const shell = createShell({
    store,
    lessons: opts.lessons ?? lessons,
    resolveMode: () => {
      throw new Error("no modes in screen tests");
    },
    acquireScene:
      opts.acquireScene ?? (() => Promise.reject(new Error("no scene in screen tests"))),
    hud: createHudStore(),
    audio,
    clock: realClock,
    nextSeed: () => 1,
    frozen: false,
    record: false,
    applySettings: () => undefined,
    focusOnControl: () => document.activeElement?.matches(INTERACTIVE) === true,
    showCanvas: () => undefined,
    ...(opts.initial ? { initial: opts.initial } : {}),
    ...(opts.initialProfile ? { initialProfile: opts.initialProfile } : {}),
  });
  relay.to = (p) => shell.onSaveProblem(p);
  const detach = attachKeyboard(
    window,
    realClock,
    (i) => shell.router.handle(i),
    () => shell.router.ctx(),
  );
  const root = document.createElement("div");
  document.body.append(root);

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await shell.ready();
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  };

  const press: Harness["press"] = async (key, o = {}) => {
    const el = target();
    const e = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      repeat: o.repeat === true,
      shiftKey: o.shift === true,
    });
    void act(() => {
      el.dispatchEvent(e);
    });
    if (!e.defaultPrevented) {
      void act(() => {
        if ((key === "Enter" || key === " ") && el instanceof HTMLButtonElement) el.click();
        else if (key === "Enter" && el instanceof HTMLInputElement && el.form) {
          el.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
      });
    }
    await settle();
    return e;
  };

  const type = async (text: string): Promise<void> => {
    for (const ch of text) {
      const el = target();
      const e = new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true });
      void act(() => {
        el.dispatchEvent(e);
      });
      if (!e.defaultPrevented && el instanceof HTMLInputElement) {
        void act(() => {
          el.value += ch;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
    }
    await settle();
  };

  await act(async () => {
    render(<App shell={shell} />, root);
  });
  await settle();

  return {
    shell,
    store,
    audio,
    root,
    settle,
    press,
    type,
    problems,
    route: () => shell.route.value,
    unmount() {
      void act(() => render(null, root));
      root.remove();
      detach();
    },
  };
}

/** The text of an element, with runs of whitespace collapsed. */
export const text = (el: Element | null): string =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

export function buttonByText(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((b) => text(b).includes(label));
  if (!found) throw new Error(`no button "${label}" in: ${text(root)}`);
  return found;
}
