/** @jsxImportSource preact */
/**
 * Profiles (task M3-09): change mode, the grown-up check, rename, change group, delete with the
 * typed name, damaged and read-only profiles, and the 9th-player block. Keyboard only, through
 * the real shell and router (see `./harness.tsx`).
 */
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../../src/i18n";
import type { SaveProblem } from "../../../../src/save/problems";
import type { Profile } from "../../../../src/save/schema";
import { defaultSettings } from "../../../../src/save/settings";
import { createMemoryBackend, createStoreOn } from "../../../../src/save/store";
import {
  gameIsFull,
  nameMatches,
  settingsForBand,
  usedSlots,
  withBand,
} from "../../../../src/ui/screens/profiles-logic";
import type { Harness } from "./harness";
import { buttonByText, fixture, mount, text } from "./harness";

let h: Harness | null = null;
afterEach(() => {
  h?.unmount();
  h = null;
});

const active = (): Element | null => document.activeElement;

/** A store over a map the test can look into (and damage), wired to the shell's problems. */
async function openWithBackend(profiles: Profile[], damage: (map: Map<string, unknown>) => void) {
  const map = new Map<string, unknown>();
  const relay: { to: ((p: SaveProblem) => void) | null } = { to: null };
  const store = createStoreOn(createMemoryBackend(map), { onProblem: (p) => relay.to?.(p) });
  for (const p of profiles) await store.save(p);
  damage(map);
  h = await mount({ initial: { id: "splash" }, store });
  const s = h;
  relay.to = (p) => s.shell.onSaveProblem(p);
  s.shell.api.navigate({ id: "profiles" });
  await s.settle();
  return { s, map };
}

async function open(opts: Parameters<typeof mount>[0]): Promise<Harness> {
  h = await mount(opts);
  return h;
}

const dialog = (s: Harness): HTMLElement => {
  const el = s.root.querySelector("dialog");
  if (!(el instanceof HTMLElement)) throw new Error(`no dialog in: ${text(s.root)}`);
  return el;
};

const focusButton = async (s: Harness, root: HTMLElement, label: string): Promise<void> => {
  void act(() => buttonByText(root, label).focus());
  await s.settle();
};

/** Change mode → the card → a menu item → the grown-up says yes. */
async function startChange(s: Harness, name: string, item: string, yes = true): Promise<void> {
  await focusButton(s, s.root, t("profiles.manage"));
  await s.press("Enter");
  expect(text(s.root.querySelector("h1"))).toBe(t("profiles.manageTitle"));
  await focusButton(s, s.root, name);
  await s.press("Enter");
  await focusButton(s, dialog(s), item);
  await s.press("Enter");
  expect(dialog(s).querySelector("[data-gate]")).not.toBeNull();
  expect(text(active())).toBe(t("profiles.gate.yes"));
  if (yes) await s.press("Enter");
  else await focusButton(s, dialog(s), t("profiles.gate.no")).then(() => s.press("Enter"));
}

describe("Profiles: cards", () => {
  it("each card shows the flat avatar when there is no WebGL (lite fallback)", async () => {
    const s = await open({ initial: { id: "profiles" }, profiles: [fixture("fresh-sprout")] });
    const card = s.root.querySelector("li button");
    expect(card?.querySelector("svg rect")).not.toBeNull();
    expect(card?.querySelector("img")).toBeNull();
  });
});

describe("Profiles: change mode", () => {
  it("rename: grown-up says yes, type a new name, Enter saves it", async () => {
    const pip = fixture("fresh-sprout");
    const s = await open({ initial: { id: "profiles" }, profiles: [pip] });
    await startChange(s, pip.name, t("profiles.menu.rename"));
    const field = dialog(s).querySelector("input");
    expect(active()).toBe(field);
    void act(() => {
      if (field) field.value = "";
    });
    await s.type("Moss");
    await s.press("Enter");
    expect(s.root.querySelector("dialog")).toBeNull();
    expect((await s.store.load(pip.id))?.name).toBe("Moss");
    expect(text(s.root)).toContain(t("profiles.done.rename", { name: "Moss" }));
    expect(s.route().id).toBe("profiles");
  });

  it("rename: a name on the blocklist is refused kindly", async () => {
    const pip = fixture("fresh-sprout");
    const s = await open({ initial: { id: "profiles" }, profiles: [pip] });
    await startChange(s, pip.name, t("profiles.menu.rename"));
    const field = dialog(s).querySelector("input");
    void act(() => {
      if (field) field.value = "";
    });
    await s.type("Steve");
    await s.press("Enter");
    expect(text(dialog(s))).toContain(t("profiles.rename.notAllowed"));
    expect((await s.store.load(pip.id))?.name).toBe(pip.name);
  });

  it("the grown-up says no: nothing opens, the menu stays", async () => {
    const pip = fixture("fresh-sprout");
    const s = await open({ initial: { id: "profiles" }, profiles: [pip] });
    await startChange(s, pip.name, t("profiles.menu.remove"), false);
    expect(dialog(s).querySelector("[data-view]")?.getAttribute("data-view")).toBe("menu");
    expect(await s.store.listProfiles()).toHaveLength(1);
  });

  it("change group: the band changes, and band settings still at their default follow it", async () => {
    const pip = fixture("fresh-sprout");
    const s = await open({ initial: { id: "profiles" }, profiles: [pip] });
    await startChange(s, pip.name, t("profiles.menu.band"));
    const builder = dialog(s).querySelector<HTMLInputElement>("input[value=builder]");
    void act(() => {
      builder?.click();
    });
    await s.settle();
    await focusButton(s, dialog(s), t("profiles.band.save"));
    await s.press("Enter");
    const saved = await s.store.load(pip.id);
    expect(saved?.ageBand).toBe("builder");
    expect(saved?.settings.textScale).toBe(defaultSettings("builder").textScale);
  });

  it("delete: needs the name typed; it removes the profile and its prev record", async () => {
    const pip = fixture("fresh-sprout");
    const rook = fixture("fresh-builder");
    const { s, map } = await openWithBackend([pip, rook], () => undefined);
    // A second save makes a `:prev` record.
    await s.store.save({ ...pip, sessionCounter: 1 });
    expect(map.has(`${pip.id}:prev`)).toBe(true);

    await startChange(s, pip.name, t("profiles.menu.remove"));
    expect(text(dialog(s))).toContain(t("profiles.remove.warn", { name: pip.name }));
    const field = dialog(s).querySelector("input");
    expect(active()).toBe(field);
    await s.type("Pi");
    await s.press("Enter");
    expect(text(dialog(s))).toContain(t("profiles.remove.mismatch", { name: pip.name }));
    expect(map.has(pip.id)).toBe(true);

    await s.type("p");
    await s.press("Enter");
    expect(s.root.querySelector("dialog")).toBeNull();
    expect(map.has(pip.id)).toBe(false);
    expect(map.has(`${pip.id}:prev`)).toBe(false);
    expect(map.has(rook.id)).toBe(true);
    expect(text(s.root)).toContain(t("profiles.done.remove"));
    expect(s.root.querySelectorAll("li button")).toHaveLength(1);
    // Focus lands back on a card, not lost on the page.
    expect(s.root.contains(active())).toBe(true);
  });

  it("deleting the player in play leaves no active profile", async () => {
    const pip = fixture("fresh-sprout");
    const s = await open({ initial: { id: "profiles" }, profiles: [pip], initialProfile: pip });
    await startChange(s, pip.name, t("profiles.menu.remove"));
    await s.type("pip");
    await s.press("Enter");
    expect(s.shell.api.profile()).toBeNull();
    expect(await s.store.listProfiles()).toEqual([]);
  });

  it("Escape closes the dialog first, then leaves change mode, then goes back", async () => {
    const pip = fixture("fresh-sprout");
    const s = await open({ initial: { id: "splash" }, profiles: [pip] });
    s.shell.api.navigate({ id: "profiles" });
    await s.settle();
    await focusButton(s, s.root, t("profiles.manage"));
    await s.press("Enter");
    await focusButton(s, s.root, pip.name);
    await s.press("Enter");
    expect(s.root.querySelector("dialog")).not.toBeNull();
    // Arrows inside the dialog don't move the cards behind it.
    await s.press("ArrowDown");
    expect(dialog(s).contains(active())).toBe(true);
    await s.press("Escape");
    expect(s.root.querySelector("dialog")).toBeNull();
    expect(s.route().id).toBe("profiles");
    expect(s.root.querySelector("[data-manage]")).not.toBeNull();
    await s.press("Escape");
    expect(s.root.querySelector("[data-manage]")).toBeNull();
    expect(s.route().id).toBe("profiles");
    await s.press("Escape");
    expect(s.route().id).toBe("splash");
  });

  it("a held Enter on a card in change mode opens the dialog once", async () => {
    const pip = fixture("fresh-sprout");
    const s = await open({ initial: { id: "profiles" }, profiles: [pip] });
    await focusButton(s, s.root, t("profiles.manage"));
    await s.press("Enter");
    await focusButton(s, s.root, pip.name);
    const e = await s.press("Enter", { repeat: true });
    expect(e.defaultPrevented).toBe(true);
    expect(s.root.querySelector("dialog")).toBeNull();
  });
});

function eight(): Profile[] {
  const base = fixture("fresh-sprout");
  return Array.from({ length: 8 }, (_, i) => ({
    ...base,
    id: `00000000-0000-4000-8000-00000000020${i}`,
    name: `Kid${i}`,
    createdAt: base.createdAt + i,
  }));
}

describe("Profiles: slots", () => {
  it("with 8 players, New player says the game is full and stays here", async () => {
    const s = await open({ initial: { id: "profiles" }, profiles: eight() });
    await focusButton(s, s.root, t("profiles.newPlayer"));
    await s.press("Enter");
    expect(s.route().id).toBe("profiles");
    expect(text(s.root)).toContain(t("profiles.full"));
  });

  it("a damaged profile shows as a lost player, holds a slot, and a grown-up can delete it", async () => {
    const seven = eight().slice(0, 7);
    const lostId = "00000000-0000-4000-8000-0000000002ff";
    const { s, map } = await openWithBackend(seven, (m) => {
      m.set(lostId, "{ not json");
      m.set(`${lostId}:prev`, "also broken");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const lost = s.root.querySelector(`[data-profile="${lostId}"]`);
    expect(lost?.getAttribute("data-lost")).toBe("1");
    expect(text(lost)).toContain(t("profiles.lostName"));
    // 7 good + 1 damaged = full.
    await focusButton(s, s.root, t("profiles.newPlayer"));
    await s.press("Enter");
    expect(text(s.root)).toContain(t("profiles.full"));

    // Picking it (no change mode needed) offers the delete.
    void act(() => {
      if (lost instanceof HTMLElement) lost.focus();
    });
    await s.press("Enter");
    expect(text(dialog(s))).toContain(t("profiles.menu.lost"));
    await focusButton(s, dialog(s), t("profiles.menu.remove"));
    await s.press("Enter");
    expect(text(active())).toBe(t("profiles.gate.yes"));
    await s.press("Enter");
    expect(text(active())).toBe(t("profiles.remove.lostConfirm"));
    await s.press("Enter");
    expect(map.has(lostId)).toBe(false);
    expect(map.has(`${lostId}:prev`)).toBe(false);
    expect(s.root.querySelector(`[data-profile="${lostId}"]`)).toBeNull();
    await focusButton(s, s.root, t("profiles.newPlayer"));
    await s.press("Enter");
    expect(s.route().id).toBe("profileCreate");
    warn.mockRestore();
  });

  it("ProfileCreate counts the damaged slot too", async () => {
    const seven = eight().slice(0, 7);
    const { s, map } = await openWithBackend(seven, (m) => m.set("lost-1", "broken"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    s.shell.api.navigate({ id: "profileCreate" });
    await s.settle();
    await s.type("Ninth");
    await s.press("Enter");
    expect(text(s.root)).toContain(t("screens.profileCreate.full"));
    expect([...map.keys()].filter((k) => !k.endsWith(":prev"))).toHaveLength(8);
    warn.mockRestore();
  });

  it("a read-only profile (newer game) can be played but not changed", async () => {
    const pip = fixture("fresh-sprout");
    const s = await open({ initial: { id: "splash" }, profiles: [pip] });
    s.shell.onSaveProblem({ profileId: pip.id, kind: "newerVersion", message: "newer" });
    s.shell.api.navigate({ id: "profiles" });
    await s.settle();
    await focusButton(s, s.root, t("profiles.manage"));
    await s.press("Enter");
    await focusButton(s, s.root, pip.name);
    await s.press("Enter");
    expect(text(dialog(s))).toContain(t("profiles.menu.readOnly"));
    expect(text(dialog(s))).not.toContain(t("profiles.menu.rename"));
    expect(text(dialog(s))).not.toContain(t("profiles.menu.remove"));
    const remove = vi.spyOn(s.store, "remove");
    expect(await s.shell.api.removeProfile(pip.id)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("profiles-logic", () => {
  it("usedSlots counts each id once across listed, damaged and read-only", () => {
    const listed = [{ id: "a" }, { id: "b" }];
    expect(usedSlots(listed, new Set(["c"]), new Set(["b", "d"]))).toBe(4);
    expect(gameIsFull(listed, new Set(), new Set())).toBe(false);
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}` }));
    expect(gameIsFull(many, new Set(["x"]), new Set())).toBe(true);
  });

  it("nameMatches ignores case and edge spaces, but not missing letters", () => {
    expect(nameMatches("pip", "Pip")).toBe(true);
    expect(nameMatches("  Pip ", "Pip")).toBe(true);
    expect(nameMatches("Pi", "Pip")).toBe(false);
    expect(nameMatches("", "")).toBe(false);
    expect(nameMatches("Moss  Kid", "Moss Kid")).toBe(true);
  });

  it("settingsForBand keeps what a grown-up changed and moves the rest", () => {
    const sprout = defaultSettings("sprout");
    const tuned = { ...sprout, showKeyboard: false, volume: { ...sprout.volume, music: 0.1 } };
    const out = settingsForBand(tuned, "sprout", "builder");
    const builder = defaultSettings("builder");
    expect(out.textScale).toBe(builder.textScale);
    expect(out.tts).toBe(builder.tts);
    expect(out.calmMode).toBe(builder.calmMode);
    expect(out.showKeyboard).toBe(false);
    expect(out.volume.music).toBe(0.1);
    expect(tuned.textScale).toBe(sprout.textScale);
  });

  it("withBand changes the band and leaves the rest of the profile", () => {
    const pip = fixture("fresh-sprout");
    const moved = withBand(pip, "miner");
    expect(moved.ageBand).toBe("miner");
    expect(moved.id).toBe(pip.id);
    expect(moved.progress).toEqual(pip.progress);
    expect(withBand(pip, "sprout").settings).toEqual(pip.settings);
  });
});
