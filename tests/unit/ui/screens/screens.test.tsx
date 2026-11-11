/** @jsxImportSource preact */
/**
 * Screens v1 (task M2-11): every screen works from the keyboard alone, through the real app shell
 * and input router (see `./harness.tsx`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppApi } from "../../../../src/app/types";
import { t } from "../../../../src/i18n";
import en from "../../../../src/i18n/en";
import { NewerSaveError } from "../../../../src/save/store";
import { Tabs } from "../../../../src/ui/kit/Tabs";
import { goalLine } from "../../../../src/ui/screens/LessonIntro";
import { useScreenInput } from "../../../../src/ui/screens/nav";
import { PRIVACY_POINTS } from "../../../../src/ui/screens/Privacy";
import { newProfile } from "../../../../src/ui/screens/ProfileCreate";
import { ARM_MS, STAR_LAND_MS, STAR_STEP_MS } from "../../../../src/ui/screens/Results";
import type { Harness } from "./harness";
import { buttonByText, fixture, mount, text } from "./harness";

let h: Harness | null = null;
afterEach(() => {
  h?.unmount();
  h = null;
});

async function open(opts: Parameters<typeof mount>[0]): Promise<Harness> {
  h = await mount(opts);
  return h;
}

const active = (): Element | null => document.activeElement;

describe("Splash", () => {
  it("shows the voxel logo, the start prompt and the privacy link; nothing plays", async () => {
    const s = await open({});
    expect(s.route().id).toBe("splash");
    expect(text(s.root.querySelector("h1"))).toBe(t("common.appName"));
    expect(s.root.querySelector("h1 svg")?.querySelectorAll("rect").length).toBeGreaterThan(50);
    expect(text(s.root)).toContain(t("screens.splash.press"));
    expect(text(s.root)).toContain(t("screens.splash.privacy"));
    expect(text(s.root.querySelector("footer"))).toBe(t("common.notAffiliated"));
    expect(s.audio.sfx).not.toHaveBeenCalled();
    expect(s.audio.unlock).not.toHaveBeenCalled();
  });

  it("any letter key unlocks audio and, with no players yet, opens New player", async () => {
    const s = await open({});
    await s.press("q");
    expect(s.audio.unlock).toHaveBeenCalled();
    expect(s.route().id).toBe("profileCreate");
  });

  it("with players saved, a key opens Profiles; a held key acts once", async () => {
    const s = await open({ profiles: [fixture("fresh-sprout")] });
    await s.press("Enter");
    await s.press("Enter", { repeat: true });
    expect(s.route().id).toBe("profiles");
    expect(s.shell.api.canGoBack()).toBe(true);
    s.shell.api.back();
    expect(s.route().id).toBe("splash");
  });

  it("Enter on the privacy button opens Privacy and doesn't also start", async () => {
    const s = await open({ profiles: [fixture("fresh-sprout")] });
    void act(() => buttonByText(s.root, t("screens.splash.privacy")).focus());
    await s.press("Enter");
    expect(s.route().id).toBe("privacy");
    await s.settle();
    expect(s.route().id).toBe("privacy");
  });

  it("Tab moves focus without starting", async () => {
    const s = await open({});
    await s.press("Tab");
    expect(s.route().id).toBe("splash");
  });
});

describe("Profiles", () => {
  it("lists players; arrows move focus; Enter picks and goes to the map", async () => {
    const pip = fixture("fresh-sprout");
    const rook = fixture("fresh-builder");
    const s = await open({ initial: { id: "profiles" }, profiles: [pip, rook] });
    expect(text(s.root.querySelector("h1"))).toBe(t("screens.profiles.title"));
    const players = [...s.root.querySelectorAll("li button")];
    expect(players.map((b) => [...b.querySelectorAll("span span")].map((x) => text(x)))).toEqual([
      [pip.name, t(`screens.bands.${pip.ageBand}`)],
      [rook.name, t(`screens.bands.${rook.ageBand}`)],
    ]);
    expect(active()).toBe(players[0]);
    await s.press("ArrowDown");
    expect(active()).toBe(players[1]);
    await s.press("ArrowDown");
    expect(text(active())).toBe(t("screens.profiles.newPlayer"));
    await s.press("ArrowUp");
    await s.press("Enter");
    expect(s.route().id).toBe("map");
    expect(s.shell.api.profile()?.id).toBe(rook.id);
  });

  it("with no players: a kind line and New player", async () => {
    const s = await open({ initial: { id: "profiles" } });
    expect(text(s.root)).toContain(t("screens.profiles.empty"));
    expect(text(active())).toBe(t("screens.profiles.newPlayer"));
    await s.press("Enter");
    expect(s.route().id).toBe("profileCreate");
  });

  it("a held Enter on a player picks once", async () => {
    const pip = fixture("fresh-sprout");
    const s = await open({ initial: { id: "profiles" }, profiles: [pip] });
    const load = vi.spyOn(s.store, "load");
    const e = await s.press("Enter", { repeat: true });
    expect(e.defaultPrevented).toBe(true);
    expect(load).not.toHaveBeenCalled();
    expect(s.route().id).toBe("profiles");
  });

  it("a profile a newer game wrote stays on the list, read-only, with a kind note", async () => {
    const pip = fixture("fresh-sprout");
    const s = await open({ initial: { id: "map" }, profiles: [pip] });
    s.shell.api.setProfile(pip);
    vi.spyOn(s.store, "save").mockRejectedValueOnce(new NewerSaveError(pip.id, 99));
    // The store now refuses to load it, as it would once a newer build wrote it.
    vi.spyOn(s.store, "listProfiles").mockResolvedValue([]);
    expect(await s.shell.api.saveProfile(pip)).toBe(false);
    expect(s.shell.api.readOnlyProfiles().has(pip.id)).toBe(true);
    s.shell.api.navigate({ id: "profiles" });
    await s.settle();
    const row = s.root.querySelector("li button");
    expect(text(row)).toContain(pip.name);
    expect(text(row)).toContain(t("screens.profiles.readOnly"));
    await s.press("Enter");
    expect(s.route().id).toBe("map");
  });

  it("a newer-version profile the store hid is counted, not silently dropped", async () => {
    const s = await open({ initial: { id: "splash" } });
    s.shell.onSaveProblem({ profileId: "x-1", kind: "newerVersion", message: "newer" });
    s.shell.api.navigate({ id: "profiles" });
    await s.settle();
    expect(text(s.root)).toContain(t("screens.profiles.readOnlyHidden", { count: 1 }));
  });
});

const field = (s: Harness): HTMLInputElement => {
  const el = s.root.querySelector("input[type=text]");
  if (!(el instanceof HTMLInputElement)) throw new Error("no name field");
  return el;
};

describe("ProfileCreate", () => {
  it("keyboard only: type a name, Tab to the pickers, arrows choose, Enter makes the player", async () => {
    const s = await open({ initial: { id: "profileCreate" } });
    expect(active()).toBe(field(s));
    await s.type("Mossy Fox");
    expect(text(s.root)).toContain(t("screens.profileCreate.nameCount", { count: 9, max: 16 }));
    // Native radio groups: one Tab stop each, arrows change the choice.
    const miner = s.root.querySelector<HTMLInputElement>("input[value=miner]");
    const skin4 = s.root.querySelector<HTMLInputElement>("input[value=tone-4]");
    void act(() => {
      miner?.focus();
      miner?.click();
      skin4?.focus();
      skin4?.click();
      field(s).focus();
    });
    await s.press("Enter");
    expect(s.route().id).toBe("map");
    const list = await s.store.listProfiles();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: "Mossy Fox",
      ageBand: "miner",
      avatar: { skin: "tone-4" },
    });
    const saved = await s.store.load(list[0]?.id ?? "");
    expect(saved?.settings).toEqual(newProfile("x", "miner", "tone-4", 0).settings);
    // Replaced, so Back from the map doesn't return to an empty form.
    s.shell.api.back();
    expect(s.route().id).not.toBe("profileCreate");
  });

  it("only nickname chars can be typed, up to 16", async () => {
    const s = await open({ initial: { id: "profileCreate" } });
    await s.type("Pip!<>_* Star 12345678901234");
    expect(field(s).value).toBe("Pip Star 1234567");
  });

  it("an empty name gets a gentle line and saves nothing", async () => {
    const s = await open({ initial: { id: "profileCreate" } });
    await s.press("Enter");
    expect(text(s.root)).toContain(t("screens.profileCreate.empty"));
    expect(await s.store.listProfiles()).toEqual([]);
    expect(field(s).getAttribute("aria-invalid")).toBe("true");
  });

  it("a blocked name is refused kindly, without repeating the name", async () => {
    const s = await open({ initial: { id: "profileCreate" } });
    // "steve" is a trademark term of README §4.5, so it is on the blocklist.
    await s.type("Steve");
    await s.press("Enter");
    const msg = t("screens.profileCreate.notAllowed");
    expect(text(s.root)).toContain(msg);
    expect(msg.toLowerCase()).not.toContain("steve");
    expect(msg).not.toMatch(/bad|wrong|not allowed|rude/i);
    expect(await s.store.listProfiles()).toEqual([]);
    expect(s.route().id).toBe("profileCreate");
  });

  it("two quick submits make one player", async () => {
    const s = await open({ initial: { id: "profileCreate" } });
    await s.type("Wren");
    const form = s.root.querySelector("form");
    void act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await s.settle();
    expect(await s.store.listProfiles()).toHaveLength(1);
  });

  it("a held Enter in the name field is ignored after the first press", async () => {
    const s = await open({ initial: { id: "profileCreate" } });
    await s.type("Wren");
    const e = await s.press("Enter", { repeat: true });
    expect(e.defaultPrevented).toBe(true);
    expect(await s.store.listProfiles()).toEqual([]);
  });

  it("with 8 players already, says so and saves nothing", async () => {
    const base = fixture("fresh-sprout");
    const eight = Array.from({ length: 8 }, (_, i) => ({
      ...base,
      id: `00000000-0000-4000-8000-00000000010${i}`,
      name: `P${i}`,
    }));
    const s = await open({ initial: { id: "profileCreate" }, profiles: eight });
    await s.type("Ninth");
    await s.press("Enter");
    expect(text(s.root)).toContain(t("screens.profileCreate.full"));
    expect(await s.store.listProfiles()).toHaveLength(8);
  });

  it("Escape goes back", async () => {
    const s = await open({ initial: { id: "splash" } });
    s.shell.api.navigate({ id: "profileCreate" });
    await s.settle();
    await s.press("Escape");
    expect(s.route().id).toBe("splash");
  });
});

describe("LessonIntro", () => {
  it("meadow-01: title, big F and J caps with bumps and finger hints, the goal, Start", async () => {
    const s = await open({
      initial: { id: "lessonIntro", lesson: "meadow-01" },
      initialProfile: fixture("fresh-sprout"),
    });
    expect(text(s.root.querySelector("h1"))).toBe(t("lessonsMeadow.meadow01"));
    const caps = [...s.root.querySelectorAll("kbd")];
    expect(caps.map((k) => text(k))).toEqual(["F", "J"]);
    expect(caps.every((k) => k.dataset["size"] === "lg")).toBe(true);
    expect(caps.every((k) => k.querySelector("[aria-hidden]") !== null)).toBe(true);
    expect(text(s.root)).toContain(t("screens.fingers.L2"));
    expect(text(s.root)).toContain(t("screens.fingers.R2"));
    expect(text(s.root)).toContain("Find the F and J bumps!");
    expect(text(active())).toBe(t("screens.lessonIntro.start"));
    await s.press("f");
    expect(caps[0]?.dataset["pressed"]).toBe("1");
    await s.press("Enter");
    expect(s.route()).toEqual({ id: "play", lesson: "meadow-01" });
  });

  it("goal lines come from the new keys", () => {
    expect(goalLine(["f", "j"])).toBe("Find the F and J bumps!");
    expect(goalLine(["d", "k"])).toBe("Find the D and K keys!");
    expect(goalLine(["a", ";"])).toBe("Find the A and semicolon keys!");
    expect(goalLine(["q"])).toBe("Find the Q key!");
    expect(goalLine(["q", "w", "e"])).toBe(t("screens.lessonIntro.goalMany"));
    expect(goalLine([])).toBe(t("screens.lessonIntro.goalReview"));
  });

  it("a semicolon cap is named for screen readers", async () => {
    const s = await open({
      initial: { id: "lessonIntro", lesson: "meadow-04" },
      initialProfile: fixture("fresh-sprout"),
    });
    const semi = [...s.root.querySelectorAll("kbd")].find((k) => text(k) === ";");
    expect(semi?.getAttribute("aria-label")).toBe(t("screens.keyNames.;"));
  });

  it("keys use the body font, not the pixel font (M2-08)", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "../../../../src/ui/screens/LessonIntro.module.css"),
      "utf8",
    );
    expect(css).toMatch(/\.key kbd \{\s*font-family: var\(--font-body\);/);
  });

  it("an unknown lesson offers the way back to the map", async () => {
    const s = await open({ initial: { id: "lessonIntro", lesson: "nope" } });
    expect(text(s.root)).toContain(t("screens.lessonIntro.missing"));
    await s.press("Enter");
    expect(s.route().id).toBe("map");
  });
});

/** Puts a finished meadow-01 run in front of the Results screen. */
async function results(
  band: "sprout" | "miner",
  over: { stars?: 0 | 1 | 2 | 3; accuracy?: number; netWpm?: number; earlier?: number[] } = {},
  reduced = false,
): Promise<Harness> {
  const base = fixture(band === "sprout" ? "fresh-sprout" : "meadow-done-miner");
  const summaryBase = { lessonId: "meadow-01", mode: "mine" as const, seed: 1, startedAtT: 0 };
  const summary = {
    ...summaryBase,
    activeMs: 60_000,
    keystrokes: 20,
    correct: 19,
    errors: 1,
    uncorrected: 0,
    grossWpm: 12,
    netWpm: over.netWpm ?? 12,
    accuracy: over.accuracy ?? 0.94,
    consistency: 0.5,
    perKey: {},
    bigrams: {},
    longestStreak: 10,
    targetsCompleted: 10,
  };
  const history = [...(over.earlier ?? []), summary.netWpm].map((w, i) => {
    const { perKey: _p, bigrams: _b, ...rest } = summary;
    return { ...rest, netWpm: w, accuracy: 0.9, at: 1_000 + i };
  });
  const profile = {
    ...base,
    history,
    settings: { ...base.settings, reducedMotion: reduced },
  };
  const s = await open({ initial: { id: "splash" }, initialProfile: profile });
  const result = { summary, loot: { dirt: 3, grass: 1 }, stars: over.stars ?? 2 };
  vi.spyOn(s.shell.api, "lastResult").mockReturnValue(result);
  return s;
}

async function showResults(s: Harness): Promise<void> {
  s.shell.api.navigate({ id: "results", lesson: "meadow-01" }, { replace: true });
  await s.settle();
}

describe("Results", () => {
  it("stars fill one by one: one star sound per star at the stagger, then the buttons arm", async () => {
    const s = await results("miner", { stars: 3 });
    const times: number[] = [];
    s.audio.sfx.mockImplementation(() => {
      times.push(performance.now());
    });
    const shown = performance.now();
    await showResults(s);
    expect(s.root.querySelectorAll("svg[data-animate]").length).toBe(3);
    // Presses before the screen is armed do nothing (a stray Space can't skip the stars).
    void act(() => buttonByText(s.root, t("screens.results.map")).click());
    expect(s.route().id).toBe("results");
    await new Promise((r) => setTimeout(r, STAR_LAND_MS + 2 * STAR_STEP_MS + 150));
    expect(s.audio.sfx.mock.calls).toEqual([["star"], ["star"], ["star"]]);
    expect((times[0] ?? 0) - shown).toBeGreaterThanOrEqual(STAR_LAND_MS - 20);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(STAR_STEP_MS - 20);
    expect((times[2] ?? 0) - (times[1] ?? 0)).toBeGreaterThanOrEqual(STAR_STEP_MS - 20);
    await new Promise((r) =>
      setTimeout(r, Math.max(0, ARM_MS - STAR_LAND_MS - 2 * STAR_STEP_MS) + 50),
    );
    void act(() => buttonByText(s.root, t("screens.results.map")).click());
    expect(s.route().id).toBe("map");
  });

  it("under reduced motion the stars show at once, with one sound", async () => {
    const s = await results("miner", { stars: 3 }, true);
    s.audio.sfx.mockClear();
    await showResults(s);
    expect(s.root.querySelectorAll("svg[data-animate]").length).toBe(0);
    expect(s.root.querySelectorAll("svg[data-earned]").length).toBe(3);
    expect(s.audio.sfx).toHaveBeenCalledTimes(1);
    expect(s.root.querySelector("ul[data-animate]")).toBeNull();
  });

  it("Miner sees 'Great aim: 94%'; Sprout sees stars only", async () => {
    const miner = await results("miner");
    await showResults(miner);
    expect(text(miner.root)).toContain("Great aim: 94%");
    miner.unmount();
    h = null;
    const sprout = await results("sprout");
    await showResults(sprout);
    expect(text(sprout.root)).not.toMatch(/aim|%/i);
    expect(text(sprout.root)).toContain(t("screens.results.sproutMessage.two"));
  });

  it("a run that beats every earlier one gets the New best badge; a first play doesn't", async () => {
    const better = await results("miner", { netWpm: 20, earlier: [10, 15] });
    await showResults(better);
    expect(text(better.root)).toContain(t("screens.results.best"));
    better.unmount();
    h = null;
    const first = await results("miner", { netWpm: 20 });
    await showResults(first);
    expect(text(first.root)).not.toContain(t("screens.results.best"));
  });

  it("the blocks found fill named slots", async () => {
    const s = await results("miner");
    await showResults(s);
    const slots = [...s.root.querySelectorAll("[role=img]")].map((el) =>
      el.getAttribute("aria-label"),
    );
    expect(slots).toContain(t("screens.results.lootItem", { name: t("blocks.dirt"), count: 3 }));
    expect(slots).toContain(t("screens.results.lootItem", { name: t("blocks.grass"), count: 1 }));
  });

  it("Next is focused first and opens the next lesson's intro; Again replays; Map", async () => {
    const s = await results("miner");
    await showResults(s);
    await new Promise((r) => setTimeout(r, ARM_MS + 50));
    expect(text(active())).toBe(t("screens.results.next"));
    await s.press("Enter");
    expect(s.route()).toEqual({ id: "lessonIntro", lesson: "meadow-02" });
  });

  it("Again replays the same lesson", async () => {
    const s = await results("miner");
    await showResults(s);
    await new Promise((r) => setTimeout(r, ARM_MS + 50));
    await s.press("Tab");
    void act(() => buttonByText(s.root, t("screens.results.again")).focus());
    await s.press("Enter");
    expect(s.route()).toEqual({ id: "play", lesson: "meadow-01" });
  });

  it("every message is warm, for every star count and band", () => {
    const all = [
      ...Object.values(en.screens.results.message),
      ...Object.values(en.screens.results.sproutMessage),
      en.screens.results.noLoot,
    ];
    for (const m of all) {
      expect(m).not.toMatch(/wrong|bad|fail|lost|lose|poor|only|hurry|faster|try harder|oops/i);
    }
  });
});

describe("Privacy", () => {
  it("reads in short kid-level sentences and goes back with Enter or Escape", async () => {
    const s = await open({ initial: { id: "splash" } });
    s.shell.api.navigate({ id: "privacy" });
    await s.settle();
    const items = [...s.root.querySelectorAll("li")].map((li) => text(li));
    expect(items).toEqual(PRIVACY_POINTS.map((p) => t(`screens.privacy.points.${p}`)));
    for (const sentence of items) expect(sentence.split(" ").length).toBeLessThanOrEqual(12);
    expect(text(s.root.querySelector("footer"))).toBe(t("common.notAffiliated"));
    expect(text(active())).toBe(t("screens.privacy.back"));
    await s.press("Enter");
    expect(s.route().id).toBe("splash");
    s.shell.api.navigate({ id: "privacy" });
    await s.settle();
    await s.press("Escape");
    expect(s.route().id).toBe("splash");
  });
});

describe("ComingSoon", () => {
  it("on the map, offers the next lesson to play", async () => {
    const s = await open({ initial: { id: "map" }, initialProfile: fixture("fresh-sprout") });
    expect(text(s.root)).toContain(t("screens.comingSoon.mapBody"));
    const play = t("screens.comingSoon.next", { title: t("lessonsMeadow.meadow01") });
    expect(text(active())).toBe(play);
    await s.press("Enter");
    expect(s.route()).toEqual({ id: "lessonIntro", lesson: "meadow-01" });
  });

  it("other routes without a screen offer the way back", async () => {
    const s = await open({ initial: { id: "splash" }, initialProfile: fixture("fresh-sprout") });
    s.shell.api.navigate({ id: "settings" });
    await s.settle();
    expect(text(s.root)).toContain(t("screens.comingSoon.body"));
    await s.press("Enter");
    expect(s.route().id).toBe("splash");
  });
});

function TabsScreen({ app, seen }: { app: AppApi; seen: string[] }) {
  useScreenInput(app, (i) => {
    if (i.kind === "control") seen.push(i.action);
    return i.kind === "control" && i.action === "right";
  });
  return (
    <div>
      <Tabs
        label="tabs"
        tabs={[
          { id: "a", label: "A", content: <button type="button">in A</button> },
          { id: "b", label: "B", content: <p>B</p> },
        ]}
      />
      <button type="button" id="other">
        other
      </button>
    </div>
  );
}

describe("keys a component already handled", () => {
  it("Left/Right on kit Tabs move the tab once and never reach the screen", async () => {
    const s = await open({ initial: { id: "map" } });
    const seen: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    void act(() => render(<TabsScreen app={s.shell.api} seen={seen} />, host));
    const first = host.querySelector<HTMLButtonElement>("[role=tab]");
    void act(() => first?.focus());
    await s.press("ArrowRight");
    const tabs = [...host.querySelectorAll("[role=tab]")];
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(seen).toEqual([]);
    void act(() => host.querySelector<HTMLButtonElement>("#other")?.focus());
    await s.press("ArrowRight");
    expect(seen).toEqual(["right"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    void act(() => render(null, host));
    host.remove();
  });
});
