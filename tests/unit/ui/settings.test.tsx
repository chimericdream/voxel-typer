/** @jsxImportSource preact */
/**
 * Settings and the parent gate (task M3-08): the gate's rules, the gate component, and the
 * Settings screen through the real app shell and input router (`./screens/harness.tsx`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRng } from "../../../src/engine/rng";
import { t } from "../../../src/i18n";
import type { Profile } from "../../../src/save/schema";
import { isProfile } from "../../../src/save/schema";
import { defaultSettings } from "../../../src/save/settings";
import { NewerSaveError } from "../../../src/save/store";
import {
  GATE_COOLDOWN_MS,
  GATE_TRIES,
  GATE_WORDS,
  ParentGate,
  createGateTracker,
  gateWords,
  pickGateWord,
  wordMatches,
} from "../../../src/ui/components/ParentGate";
import { motionChoice, motionValue, withSettings } from "../../../src/ui/screens/Settings";
import type { Harness } from "./screens/harness";
import { buttonByText, fixture, mount, text } from "./screens/harness";

let h: Harness | null = null;
afterEach(() => {
  h?.unmount();
  h = null;
  vi.useRealTimers();
});

const active = (): Element | null => document.activeElement;

describe("gate words", () => {
  it("keeps plain 6–8 letter words and skips comments, tags and others", () => {
    const words = gateWords(
      "# tags: band=builder\nlantern\nox\nharbors\nNope\nwalkways\n# hello\n",
    );
    expect(words).toEqual(["lantern", "harbors", "walkways"]);
  });

  it("ships plenty of Builder words, each one checked by the word-list validator", () => {
    expect(GATE_WORDS.length).toBeGreaterThan(100);
    const lists = ["birch-builder", "shore-builder"].map((id) =>
      readFileSync(
        resolve(import.meta.dirname, `../../../src/content/wordlists/${id}.txt`),
        "utf8",
      ),
    );
    for (const list of lists) expect(list).toMatch(/band=builder/);
    for (const w of GATE_WORDS) expect(w).toMatch(/^[a-z]{6,8}$/);
  });

  it("picks through a seeded stream: same seed, same word; a new word avoids the last", () => {
    const a = pickGateWord(createRng(5), GATE_WORDS);
    expect(pickGateWord(createRng(5), GATE_WORDS)).toBe(a);
    const rng = createRng(9);
    for (let i = 0; i < 50; i++) expect(pickGateWord(rng, ["one", "two"], "one")).toBe("two");
    expect(pickGateWord(rng, ["only"], "only")).toBe("only");
  });

  it("matches without caring about case or spaces at the ends", () => {
    expect(wordMatches("  Lantern ", "lantern")).toBe(true);
    expect(wordMatches("lanterns", "lantern")).toBe(false);
    expect(wordMatches("", "lantern")).toBe(false);
  });
});

describe("gate tries and the cool-down", () => {
  it("3 wrong tries start a 30 s rest; then it opens again with fresh tries", () => {
    expect(GATE_TRIES).toBe(3);
    expect(GATE_COOLDOWN_MS).toBe(30_000);
    const g = createGateTracker();
    expect(g.attempt(false, 0)).toBe("retry");
    expect(g.triesLeft(0)).toBe(2);
    expect(g.attempt(false, 1)).toBe("retry");
    expect(g.attempt(false, 2)).toBe("rest");
    expect(g.restLeft(2)).toBe(30_000);
    // Even the right word waits out the rest.
    expect(g.attempt(true, 10_000)).toBe("rest");
    expect(g.restLeft(29_999 + 2)).toBe(1);
    expect(g.restLeft(30_002)).toBe(0);
    expect(g.triesLeft(30_002)).toBe(3);
    expect(g.attempt(true, 30_003)).toBe("pass");
  });

  it("a pass resets the count", () => {
    const g = createGateTracker();
    g.attempt(false, 0);
    g.attempt(false, 0);
    expect(g.attempt(true, 0)).toBe("pass");
    expect(g.triesLeft(0)).toBe(3);
  });
});

function renderGate(opts: { now: () => number; tracker: ReturnType<typeof createGateTracker> }) {
  const root = document.createElement("div");
  document.body.append(root);
  const onPass = vi.fn();
  const onCancel = vi.fn();
  void act(() =>
    render(
      <ParentGate
        action="deleteProfile"
        onPass={onPass}
        onCancel={onCancel}
        rng={createRng(3)}
        words={["lantern", "harbors"]}
        {...opts}
      />,
      root,
    ),
  );
  const field = (): HTMLInputElement => {
    const el = root.querySelector("input");
    if (!el) throw new Error("no field");
    return el;
  };
  const tryWord = (w: string): void => {
    void act(() => {
      field().value = w;
      field().dispatchEvent(new Event("input", { bubbles: true }));
    });
    void act(() => {
      root.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
    });
  };
  const word = (): string => text(root.querySelector("[data-gate-word]"));
  return {
    root,
    onPass,
    onCancel,
    field,
    tryWord,
    word,
    done: () => {
      void act(() => render(null, root));
      root.remove();
    },
  };
}
describe("ParentGate", () => {
  it("shows a grown-up the word as text, focuses the field and passes on the word", () => {
    const g = renderGate({ now: () => 0, tracker: createGateTracker() });
    expect(text(g.root)).toContain(t("settings.gate.ask"));
    expect(text(g.root)).toContain(t("settings.gate.why.deleteProfile"));
    expect(["lantern", "harbors"]).toContain(g.word());
    expect(active()).toBe(g.field());
    g.tryWord(g.word().toUpperCase());
    expect(g.onPass).toHaveBeenCalledOnce();
    g.done();
  });

  it("a wrong word says so kindly and counts down the tries; 3 misses rest for 30 s", () => {
    vi.useFakeTimers();
    let now = 0;
    const g = renderGate({ now: () => now, tracker: createGateTracker() });
    const first = g.word();
    g.tryWord("nope");
    expect(text(g.root)).toContain(t("settings.gate.miss", { count: 2 }));
    expect(g.field().value).toBe("");
    g.tryWord("nope");
    g.tryWord("nope");
    expect(g.onPass).not.toHaveBeenCalled();
    expect(g.field().disabled).toBe(true);
    expect(text(g.root)).toContain(t("settings.gate.rest", { seconds: 30 }));
    // The right word does nothing while resting.
    g.tryWord(first);
    expect(g.onPass).not.toHaveBeenCalled();

    now = 20_000;
    void act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(text(g.root)).toContain(t("settings.gate.rest", { seconds: 10 }));
    now = 30_000;
    void act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(g.field().disabled).toBe(false);
    // A new word after the rest.
    expect(g.word()).not.toBe(first);
    g.tryWord(g.word());
    expect(g.onPass).toHaveBeenCalledOnce();
    g.done();
  });

  it("closing and reopening keeps the rest (the tracker outlives the gate)", () => {
    const tracker = createGateTracker();
    for (let i = 0; i < GATE_TRIES; i++) tracker.attempt(false, 0);
    const g = renderGate({ now: () => 5000, tracker });
    expect(g.field().disabled).toBe(true);
    expect(text(g.root)).toContain(t("settings.gate.rest", { seconds: 25 }));
    void act(() => buttonByText(g.root, t("settings.gate.cancel")).click());
    expect(g.onCancel).toHaveBeenCalledOnce();
    g.done();
  });
});

describe("settings helpers", () => {
  it("motion choices round-trip", () => {
    for (const v of [true, false, "system"] as const) expect(motionValue(motionChoice(v))).toBe(v);
  });

  it("withSettings changes only the patch", () => {
    const p = fixture("fresh-sprout");
    const next = withSettings(p, { calmMode: false });
    expect(next.settings).toEqual({ ...p.settings, calmMode: false });
    expect(p.settings.calmMode).toBe(true);
  });

  it("a save with fingerLabels is valid, and one without it still is (decision 93)", () => {
    const p = fixture("fresh-sprout");
    expect(isProfile({ ...p, settings: { ...p.settings, fingerLabels: false } })).toBe(true);
    expect(isProfile({ ...p, settings: defaultSettings("sprout") })).toBe(true);
    expect(isProfile({ ...p, settings: { ...p.settings, fingerLabels: "yes" } })).toBe(false);
  });
});

// ---- The screen ----

async function openSettings(p: Profile = fixture("fresh-sprout")): Promise<Harness> {
  h = await mount({ initial: { id: "map" }, profiles: [p], initialProfile: p });
  // From the map, like a child would.
  void act(() => buttonByText(h!.root, t("settings.title")).focus());
  await h.press("Enter");
  expect(h.route().id).toBe("settings");
  return h;
}

const tab = (s: Harness, id: string): HTMLElement => {
  const el = [...s.root.querySelectorAll<HTMLElement>("[role='tab']")].find(
    (b) => text(b) === t(`settings.tab.${id}`),
  );
  if (!el) throw new Error(`no tab ${id}`);
  return el;
};

async function toTab(s: Harness, id: string): Promise<void> {
  void act(() => tab(s, id).click());
  await s.settle();
}

const toggle = (s: Harness, label: string): HTMLButtonElement => {
  const el = [...s.root.querySelectorAll<HTMLButtonElement>("[role='switch']")].find((b) =>
    text(b).includes(label),
  );
  if (!el) throw new Error(`no toggle ${label}`);
  return el;
};

async function flip(s: Harness, label: string): Promise<void> {
  void act(() => toggle(s, label).focus());
  await s.press("Enter");
}

async function slide(s: Harness, label: string, value: number): Promise<void> {
  const lab = [...s.root.querySelectorAll("label")].find((l) => text(l) === label);
  const input = lab ? s.root.querySelector<HTMLInputElement>(`#${CSS.escape(lab.htmlFor)}`) : null;
  if (!input) throw new Error(`no slider ${label}`);
  void act(() => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await s.settle();
}

async function choose(s: Harness, name: string, value: string): Promise<void> {
  const input = s.root.querySelector<HTMLInputElement>(`input[name='${name}'][value='${value}']`);
  if (!input) throw new Error(`no choice ${name}=${value}`);
  void act(() => input.click());
  await s.settle();
}

async function saved(s: Harness, id: string): Promise<Profile> {
  const p = await s.store.load(id);
  if (!p) throw new Error("not saved");
  return p;
}

async function passGate(s: Harness): Promise<void> {
  const gate = s.root.querySelector("[data-gate]");
  expect(gate).not.toBeNull();
  expect(active()).toBe(gate?.querySelector("input"));
  await s.type(text(gate?.querySelector("[data-gate-word]") ?? null));
  await s.press("Enter");
}

describe("Settings screen", () => {
  it("without a player, points to Players", async () => {
    h = await mount({ initial: { id: "settings" } });
    expect(text(h.root)).toContain(t("settings.noPlayer"));
    await h.press("Enter");
    void act(() => buttonByText(h!.root, t("settings.players")).click());
    await h.settle();
    expect(h.route().id).toBe("profiles");
  });

  it("every setting changes live and is saved", async () => {
    const p = fixture("fresh-sprout");
    const s = await openSettings(p);
    expect(s.root.querySelector("[data-settings-tab='play']")).not.toBeNull();

    await flip(s, t("settings.play.hands"));
    await flip(s, t("settings.play.fingerLabels"));
    await flip(s, t("settings.play.calm"));
    await choose(s, "layout", "en-GB");
    await slide(s, t("settings.play.breaks"), 25);
    await flip(s, t("settings.play.keyboard"));
    // With the keyboard off, its hands and labels can't change.
    expect(toggle(s, t("settings.play.hands")).disabled).toBe(true);

    await toTab(s, "look");
    await slide(s, t("settings.look.size"), 2);
    expect(text(s.root)).toContain(t("settings.look.sizeValue", { pct: 200 }));
    expect(s.root.querySelector("[data-preview]")).not.toBeNull();
    await choose(s, "font", "dyslexic");
    await flip(s, t("settings.look.contrast"));
    await choose(s, "motion", "reduced");
    await choose(s, "quality", "low");

    await toTab(s, "sound");
    await slide(s, t("settings.sound.volume.master"), 50);
    await slide(s, t("settings.sound.volume.music"), 0);
    await slide(s, t("settings.sound.volume.sfx"), 30);
    await slide(s, t("settings.sound.volume.voice"), 70);
    await flip(s, t("settings.sound.tts"));
    void act(() => buttonByText(s.root, t("settings.sound.test")).click());
    expect(s.audio.sfx).toHaveBeenCalledWith("chime");

    const want = {
      ...p.settings,
      showKeyboard: false,
      showHands: false,
      fingerLabels: false,
      calmMode: false,
      layout: "en-GB",
      breakReminderMin: 25,
      textScale: 2,
      font: "dyslexic",
      highContrast: true,
      reducedMotion: true,
      quality: "low",
      volume: { master: 0.5, music: 0, sfx: 0.3, voice: 0.7 },
      tts: false,
    };
    expect(s.shell.api.profile()?.settings).toEqual(want);
    expect((await saved(s, p.id)).settings).toEqual(want);
    // Volumes went to the audio engine at once.
    expect(s.audio.setVolume).toHaveBeenLastCalledWith("voice", 0.7);
    expect(s.audio.setSpeechEnabled).toHaveBeenLastCalledWith(false);
  });

  it("keyboard: Down from the tab reaches the controls; arrows inside a slider stay there", async () => {
    const s = await openSettings();
    // The screen opens with the cursor on the chosen tab.
    expect(active()).toBe(tab(s, "play"));
    await s.press("ArrowDown");
    expect(active()).toBe(toggle(s, t("settings.play.keyboard")));
    await s.press("ArrowUp");
    expect(active()).toBe(tab(s, "play"));
    // Right on a tab is the Tabs' own key; the screen doesn't also move focus.
    await s.press("ArrowRight");
    expect(active()).toBe(tab(s, "look"));
    expect(s.root.querySelector("[data-settings-tab='look']")).not.toBeNull();
    await s.press("ArrowDown");
    const range = active();
    expect(range instanceof HTMLInputElement && range.type).toBe("range");
    await s.press("ArrowDown");
    expect(active()).toBe(range);
    await s.press("Escape");
    expect(s.route().id).toBe("map");
  });

  it("the Grown-ups tab is behind the gate; Not now goes back to Play", async () => {
    const s = await openSettings();
    await toTab(s, "sound");
    void act(() => tab(s, "sound").focus());
    await s.press("ArrowRight");
    expect(s.root.querySelector("[data-gate='grownUps']")).not.toBeNull();
    expect(s.root.querySelector("[data-grown-ups]")).toBeNull();
    expect(text(s.root)).not.toContain(t("settings.grown.dangerTitle"));
    await s.type("wrong");
    await s.press("Enter");
    expect(text(s.root)).toContain(t("settings.gate.miss", { count: 2 }));
    void act(() => buttonByText(s.root, t("settings.gate.cancel")).focus());
    await s.press("Enter");
    await new Promise((r) => requestAnimationFrame(r));
    expect(s.root.querySelector("[data-settings-tab='play']")).not.toBeNull();
    expect(tab(s, "play").getAttribute("aria-selected")).toBe("true");
  });

  it("past the gate: change the group, then delete the player", async () => {
    const p = fixture("fresh-sprout");
    const s = await openSettings(p);
    await toTab(s, "grownUps");
    await passGate(s);
    expect(s.root.querySelector("[data-grown-ups]")).not.toBeNull();
    expect(s.root.querySelector("[data-slot='import-export']")).not.toBeNull();

    // Group: Sprout → Builder, with a confirm.
    const builder = t("screens.bands.builder");
    void act(() => buttonByText(s.root, builder).focus());
    await s.press("Enter");
    const dlg = (): HTMLElement => {
      const d = s.root.querySelector<HTMLElement>("dialog[open]");
      if (!d) throw new Error("no dialog");
      return d;
    };
    expect(dlg().querySelector("[data-confirm='band']")).not.toBeNull();
    void act(() => buttonByText(dlg(), t("settings.grown.bandYes")).focus());
    await s.press("Enter");
    const moved = await saved(s, p.id);
    expect(moved.ageBand).toBe("builder");
    // Band defaults follow the new band (text size untouched since creation).
    expect(moved.settings.textScale).toBe(defaultSettings("builder").textScale);
    expect(text(s.root)).toContain(t("settings.grown.bandNow", { name: p.name, band: builder }));

    // Delete: a confirm, then gone (with its :prev), and on to Players.
    void act(() => buttonByText(s.root, t("settings.grown.remove", { name: p.name })).focus());
    await s.press("Enter");
    // Escape keeps it.
    await s.press("Escape");
    expect(s.root.querySelector("dialog[open]")).toBeNull();
    expect(s.route().id).toBe("settings");
    void act(() => buttonByText(s.root, t("settings.grown.remove", { name: p.name })).focus());
    await s.press("Enter");
    void act(() => buttonByText(dlg(), t("settings.grown.removeYes")).focus());
    await s.press("Enter");
    expect(await s.store.load(p.id)).toBeNull();
    expect(s.shell.api.profile()).toBeNull();
    expect(s.route().id).toBe("profiles");
  });

  it("a profile saved by a newer game is read-only: nothing can change", async () => {
    const p = fixture("fresh-builder");
    const s = await openSettings(p);
    vi.spyOn(s.store, "save").mockRejectedValue(new NewerSaveError(p.id, 99));
    expect(await s.shell.api.saveProfile(p)).toBe(false);
    s.shell.api.navigate({ id: "map" });
    await s.settle();
    s.shell.api.navigate({ id: "settings" });
    await s.settle();
    expect(s.root.querySelector("[data-read-only]")).not.toBeNull();
    expect(toggle(s, t("settings.play.keyboard")).disabled).toBe(true);
    await toTab(s, "look");
    expect(s.root.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    await toTab(s, "grownUps");
    await passGate(s);
    expect(
      buttonByText(s.root, t("settings.grown.remove", { name: p.name })).getAttribute(
        "aria-disabled",
      ),
    ).toBe("true");
    expect(s.shell.api.profile()?.settings).toEqual(p.settings);
  });
});
