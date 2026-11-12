/**
 * Input normalization (docs/impl/contracts.md §9, task M1-08), driven by synthetic
 * `KeyboardEvent`s under happy-dom.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixedStepClock } from "../../../src/app/clock";
import {
  attachKeyboard,
  capsLockOn,
  type ControlInput,
  type InputCtx,
  normalizeKeyEvent,
  type TypedInput,
} from "../../../src/input";

type Init = KeyboardEventInit & { altGraph?: boolean; capsLock?: boolean };

/** A keydown event. `altGraph` / `capsLock` override `getModifierState`, which happy-dom fakes. */
function key(k: string, init: Init = {}): KeyboardEvent {
  const { altGraph, capsLock, ...rest } = init;
  const e = new KeyboardEvent("keydown", { key: k, cancelable: true, ...rest });
  const base = e.getModifierState.bind(e);
  Object.defineProperty(e, "getModifierState", {
    value: (m: string) => {
      if (m === "AltGraph") return altGraph ?? false;
      if (m === "CapsLock") return capsLock ?? false;
      return base(m);
    },
  });
  return e;
}

const PLAY: InputCtx = { inPlay: true };
const MENU: InputCtx = { inPlay: false };

const typedKey = (out: TypedInput | ControlInput | null): string | null =>
  out?.kind === "typed" ? out.input.key : null;
const action = (out: TypedInput | ControlInput | null): string | null =>
  out?.kind === "control" ? out.action : null;

describe("normalizeKeyEvent: ignored events", () => {
  it.each([PLAY, MENU])("ignores repeats, composition, Dead and Process (%o)", (ctx) => {
    expect(normalizeKeyEvent(key("a", { repeat: true }), 0, ctx)).toBeNull();
    expect(normalizeKeyEvent(key("Escape", { repeat: true }), 0, ctx)).toBeNull();
    expect(normalizeKeyEvent(key("a", { isComposing: true }), 0, ctx)).toBeNull();
    expect(normalizeKeyEvent(key("Dead", { code: "Quote" }), 0, ctx)).toBeNull();
    expect(normalizeKeyEvent(key("Process"), 0, ctx)).toBeNull();
  });

  it("ignores ctrl, meta and alt combos", () => {
    for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) {
      expect(normalizeKeyEvent(key("a", { [mod]: true }), 0, PLAY)).toBeNull();
      expect(normalizeKeyEvent(key("Escape", { [mod]: true }), 0, MENU)).toBeNull();
      expect(normalizeKeyEvent(key("Enter", { [mod]: true }), 0, MENU)).toBeNull();
    }
  });

  it("ignores lone modifier keys and other named keys", () => {
    for (const k of ["Shift", "Control", "Alt", "Meta", "CapsLock", "F5", "Home", "Unidentified"]) {
      expect(normalizeKeyEvent(key(k), 0, PLAY)).toBeNull();
    }
  });
});

describe("normalizeKeyEvent: AltGr and Ctrl+Z", () => {
  it("passes AltGraph combos that produce a char", () => {
    // Windows reports AltGr as Ctrl+Alt.
    const e = key("@", { ctrlKey: true, altKey: true, altGraph: true, code: "KeyQ" });
    expect(normalizeKeyEvent(e, 5, PLAY)).toEqual({
      kind: "typed",
      input: { key: "@", t: 5, shift: false, code: "KeyQ" },
    });
    expect(typedKey(normalizeKeyEvent(key("€", { altKey: true, altGraph: true }), 0, PLAY))).toBe(
      "€",
    );
  });

  it("ignores AltGraph combos that produce no char", () => {
    expect(normalizeKeyEvent(key("Dead", { altKey: true, altGraph: true }), 0, PLAY)).toBeNull();
    expect(normalizeKeyEvent(key("AltGraph", { altGraph: true }), 0, PLAY)).toBeNull();
  });

  it("maps Ctrl+Z to Undo only when the ctx asks for it, and not Ctrl+Shift+Z", () => {
    const undo: InputCtx = { inPlay: true, undo: true };
    expect(typedKey(normalizeKeyEvent(key("z", { ctrlKey: true }), 0, undo))).toBe("Undo");
    expect(typedKey(normalizeKeyEvent(key("Z", { ctrlKey: true }), 0, undo))).toBe("Undo");
    expect(normalizeKeyEvent(key("z", { ctrlKey: true }), 0, PLAY)).toBeNull();
    expect(normalizeKeyEvent(key("z", { ctrlKey: true }), 0, { inPlay: true, undo: false })).toBe(
      null,
    );
    // Not other chords.
    expect(normalizeKeyEvent(key("Z", { ctrlKey: true, shiftKey: true }), 0, undo)).toBeNull();
    expect(normalizeKeyEvent(key("z", { ctrlKey: true, altKey: true }), 0, undo)).toBeNull();
    expect(normalizeKeyEvent(key("y", { ctrlKey: true }), 0, undo)).toBeNull();
    expect(normalizeKeyEvent(key("z", { ctrlKey: true, metaKey: true }), 0, undo)).toBeNull();
    // A repeat of Ctrl+Z is still a repeat.
    expect(normalizeKeyEvent(key("z", { ctrlKey: true, repeat: true }), 0, undo)).toBeNull();
  });

  it("maps Cmd+Z (Meta+Z) to Undo too, only when the ctx asks for it", () => {
    const undo: InputCtx = { inPlay: true, undo: true };
    expect(normalizeKeyEvent(key("z", { metaKey: true, code: "KeyZ" }), 4, undo)).toEqual({
      kind: "typed",
      input: { key: "Undo", t: 4, shift: false, code: "KeyZ" },
    });
    expect(typedKey(normalizeKeyEvent(key("Z", { metaKey: true }), 0, undo))).toBe("Undo");
    expect(
      typedKey(normalizeKeyEvent(key("z", { metaKey: true }), 0, { inPlay: false, undo: true })),
    ).toBe("Undo");
    expect(normalizeKeyEvent(key("z", { metaKey: true }), 0, PLAY)).toBeNull();
    // Cmd+Shift+Z is not redo, and Cmd+Alt+Z is not undo.
    expect(normalizeKeyEvent(key("Z", { metaKey: true, shiftKey: true }), 0, undo)).toBeNull();
    expect(normalizeKeyEvent(key("z", { metaKey: true, altKey: true }), 0, undo)).toBeNull();
    expect(normalizeKeyEvent(key("z", { metaKey: true, repeat: true }), 0, undo)).toBeNull();
    expect(prevented("z", undo, { metaKey: true })).toBe(true);
    expect(prevented("z", PLAY, { metaKey: true })).toBe(false);
  });
});

describe("normalizeKeyEvent: control keys", () => {
  it("Escape pauses in play and goes back in menus", () => {
    expect(normalizeKeyEvent(key("Escape"), 7, PLAY)).toEqual({
      kind: "control",
      action: "pause",
      t: 7,
    });
    expect(action(normalizeKeyEvent(key("Escape"), 0, MENU))).toBe("back");
  });

  it("Enter confirms in menus and is ignored in play unless the mode wants it", () => {
    expect(action(normalizeKeyEvent(key("Enter"), 0, MENU))).toBe("confirm");
    expect(normalizeKeyEvent(key("Enter"), 0, PLAY)).toBeNull();
    expect(typedKey(normalizeKeyEvent(key("Enter"), 0, { inPlay: true, wantsEnter: true }))).toBe(
      "Enter",
    );
  });

  it("Tab and Shift+Tab move focus in menus and are ignored in play", () => {
    expect(action(normalizeKeyEvent(key("Tab"), 0, MENU))).toBe("next");
    expect(action(normalizeKeyEvent(key("Tab", { shiftKey: true }), 0, MENU))).toBe("prev");
    expect(normalizeKeyEvent(key("Tab"), 0, PLAY)).toBeNull();
    expect(normalizeKeyEvent(key("Tab", { shiftKey: true }), 0, PLAY)).toBeNull();
  });

  it.each([PLAY, MENU])("arrows map to directions (%o)", (ctx) => {
    expect(action(normalizeKeyEvent(key("ArrowUp"), 0, ctx))).toBe("up");
    expect(action(normalizeKeyEvent(key("ArrowDown"), 0, ctx))).toBe("down");
    expect(action(normalizeKeyEvent(key("ArrowLeft"), 0, ctx))).toBe("left");
    expect(action(normalizeKeyEvent(key("ArrowRight"), 0, ctx))).toBe("right");
  });

  it("F1 is hearAgain; Backquote is hearAgain only in the Sprout band", () => {
    expect(action(normalizeKeyEvent(key("F1"), 0, PLAY))).toBe("hearAgain");
    expect(action(normalizeKeyEvent(key("F1"), 0, MENU))).toBe("hearAgain");
    const sprout: InputCtx = { inPlay: true, band: "sprout" };
    expect(action(normalizeKeyEvent(key("`", { code: "Backquote" }), 0, sprout))).toBe("hearAgain");
    expect(typedKey(normalizeKeyEvent(key("`"), 0, { inPlay: true, band: "miner" }))).toBe("`");
    expect(typedKey(normalizeKeyEvent(key("`"), 0, PLAY))).toBe("`");
    // The Backquote position typing another char is that char, even for Sprout.
    expect(typedKey(normalizeKeyEvent(key("²", { code: "Backquote" }), 0, sprout))).toBe("²");
  });
});

describe("normalizeKeyEvent: typed keys", () => {
  it("passes single printable chars through with shift and code", () => {
    expect(normalizeKeyEvent(key("A", { shiftKey: true, code: "KeyA" }), 12, PLAY)).toEqual({
      kind: "typed",
      input: { key: "A", t: 12, shift: true, code: "KeyA" },
    });
    expect(normalizeKeyEvent(key("a"), 3, PLAY)).toEqual({
      kind: "typed",
      input: { key: "a", t: 3, shift: false },
    });
    for (const k of [";", "1", "!", "é", "😀"]) {
      expect(typedKey(normalizeKeyEvent(key(k), 0, PLAY))).toBe(k);
    }
  });

  it("passes Space as ' ' and Backspace", () => {
    expect(typedKey(normalizeKeyEvent(key(" ", { code: "Space" }), 0, PLAY))).toBe(" ");
    expect(typedKey(normalizeKeyEvent(key("Backspace"), 0, PLAY))).toBe("Backspace");
  });

  it("delivers typed keys in menus too, without control handling", () => {
    expect(typedKey(normalizeKeyEvent(key("q"), 0, MENU))).toBe("q");
    expect(typedKey(normalizeKeyEvent(key("Backspace"), 0, MENU))).toBe("Backspace");
  });

  it("normalizes typographic quotes", () => {
    expect(typedKey(normalizeKeyEvent(key("’"), 0, PLAY))).toBe("'");
    expect(typedKey(normalizeKeyEvent(key("‘"), 0, PLAY))).toBe("'");
    expect(typedKey(normalizeKeyEvent(key("“"), 0, PLAY))).toBe('"');
    expect(typedKey(normalizeKeyEvent(key("”"), 0, PLAY))).toBe('"');
    expect(typedKey(normalizeKeyEvent(key("’", { altKey: true, altGraph: true }), 0, PLAY))).toBe(
      "'",
    );
  });

  it("rejects control chars and multi-char keys", () => {
    for (const k of ["\u0000", "\u001b", "\u007f", "\u0085", "ab", ""]) {
      expect(normalizeKeyEvent(key(k), 0, PLAY)).toBeNull();
    }
  });
});

/** Whether `normalizeKeyEvent` cancelled the event's default action. */
function prevented(k: string, ctx: InputCtx, init: Init = {}): boolean {
  const e = key(k, init);
  normalizeKeyEvent(e, 0, ctx);
  return e.defaultPrevented;
}

describe("normalizeKeyEvent: preventDefault in play", () => {
  it("prevents every key that becomes typed", () => {
    for (const k of ["a", "Z", "1", ";", "é", " ", "'", "/", "Backspace", "’"]) {
      expect(prevented(k, PLAY), k).toBe(true);
    }
    expect(prevented("@", PLAY, { ctrlKey: true, altKey: true, altGraph: true })).toBe(true);
    expect(prevented("z", { inPlay: true, undo: true }, { ctrlKey: true })).toBe(true);
    expect(prevented("Enter", { inPlay: true, wantsEnter: true })).toBe(true);
  });

  it("prevents Space, ', /, Backspace and Tab even when the event is ignored", () => {
    expect(prevented("Tab", PLAY)).toBe(true);
    expect(prevented("Tab", PLAY, { shiftKey: true })).toBe(true);
    for (const k of [" ", "'", "/", "Backspace"]) {
      expect(prevented(k, PLAY, { repeat: true }), k).toBe(true);
    }
  });

  it("leaves every other key alone", () => {
    for (const k of ["Escape", "Enter", "ArrowUp", "ArrowLeft", "F5", "Shift", "Dead"]) {
      expect(prevented(k, PLAY), k).toBe(false);
    }
    expect(prevented("`", { inPlay: true, band: "sprout" })).toBe(false);
    expect(prevented("a", PLAY, { repeat: true })).toBe(false);
    expect(prevented("a", PLAY, { ctrlKey: true })).toBe(false);
    expect(prevented("z", PLAY, { ctrlKey: true })).toBe(false);
    expect(prevented("r", PLAY, { metaKey: true })).toBe(false);
  });

  it("prevents F1 everywhere, so it never opens the browser's help page (M3-07 review B1)", () => {
    expect(prevented("F1", PLAY)).toBe(true);
    expect(prevented("F1", MENU)).toBe(true);
    expect(prevented("F1", PLAY, { repeat: true })).toBe(true);
    expect(prevented("F1", MENU, { shiftKey: true })).toBe(true);
    expect(prevented("F1", PLAY, { ctrlKey: true })).toBe(false);
  });

  it("never prevents during IME composition", () => {
    expect(prevented(" ", PLAY, { isComposing: true })).toBe(false);
    expect(prevented("Backspace", PLAY, { isComposing: true })).toBe(false);
  });

  it("never prevents in menus", () => {
    for (const k of ["a", " ", "'", "/", "Backspace", "Tab", "Enter", "Escape", "ArrowDown"]) {
      expect(prevented(k, MENU), k).toBe(false);
    }
  });
});

describe("attachKeyboard", () => {
  let detach: (() => void) | undefined;
  afterEach(() => {
    detach?.();
    detach = undefined;
    vi.restoreAllMocks();
  });

  function setup(ctx: InputCtx = PLAY): (TypedInput | ControlInput)[] {
    const got: (TypedInput | ControlInput)[] = [];
    detach = attachKeyboard(
      window,
      fixedStepClock(100, 10),
      (i) => got.push(i),
      () => ctx,
    );
    return got;
  }

  it("normalizes keydown events with clock time and the current ctx", () => {
    let ctx: InputCtx = PLAY;
    const got: (TypedInput | ControlInput)[] = [];
    detach = attachKeyboard(
      window,
      fixedStepClock(100, 10),
      (i) => got.push(i),
      () => ctx,
    );
    const a = key("a");
    window.dispatchEvent(a);
    window.dispatchEvent(key("a", { repeat: true }));
    window.dispatchEvent(key("Shift"));
    ctx = MENU;
    window.dispatchEvent(key("Escape"));
    expect(a.defaultPrevented).toBe(true);
    expect(got[0]).toEqual({ kind: "typed", input: { key: "a", t: 100, shift: false } });
    expect(got[1]).toEqual({ kind: "control", action: "back", t: 130 });
    expect(got).toHaveLength(2);
  });

  it("ignores keyup", () => {
    const got = setup();
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "a" }));
    expect(got).toEqual([]);
  });

  it("turns window blur into pause", () => {
    const got = setup();
    window.dispatchEvent(new Event("blur"));
    expect(got).toEqual([{ kind: "control", action: "pause", t: 100 }]);
  });

  it("turns visibilitychange to hidden into pause, and ignores visible", () => {
    const got = setup(MENU);
    const state = vi.spyOn(document, "visibilityState", "get");
    state.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(got).toEqual([]);
    state.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(got).toEqual([{ kind: "control", action: "pause", t: 100 }]);
  });

  it("stops listening after detach", () => {
    const got = setup();
    detach?.();
    detach = undefined;
    window.dispatchEvent(key("a"));
    window.dispatchEvent(new Event("blur"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(got).toEqual([]);
  });
});

describe("capsLockOn", () => {
  it("reads the CapsLock modifier state", () => {
    expect(capsLockOn(key("A", { capsLock: true }))).toBe(true);
    expect(capsLockOn(key("a"))).toBe(false);
  });
});
