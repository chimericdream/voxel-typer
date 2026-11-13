/** @jsxImportSource preact */
/**
 * My Blocks, the inventory screen (task M4-09): what it lists (owned, all on the island, not found
 * yet), the filters, the details panel's words, and keyboard navigation in the grid.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { blocks } from "../../../src/content/blocks";
import { meadowLoot } from "../../../src/content/loot/meadow";
import { soundsUnsafe } from "../../../src/content/wordlists/spoken-blocklist";
import { t } from "../../../src/i18n";
import type { MessageKey } from "../../../src/i18n";
import type { Profile } from "../../../src/save/schema";
import { announcer } from "../../../src/ui/kit/announce";
import { detailView, slotLabel } from "../../../src/ui/screens/Inventory";
import {
  KINDS,
  collectionCount,
  columnsFromTops,
  filterChoices,
  filterEntries,
  gridMove,
  inventoryEntries,
  kindOf,
} from "../../../src/ui/screens/inventory-logic";
import type { InventoryEntry } from "../../../src/ui/screens/inventory-logic";
import type { Harness } from "./screens/harness";
import { fixture, mount, text } from "./screens/harness";

const TABLES = [meadowLoot];

const entry = (list: readonly InventoryEntry[], id: string): InventoryEntry => {
  const e = list.find((x) => x.def.id === id);
  if (!e) throw new Error(`no slot for ${id}`);
  return e;
};

describe("inventoryEntries", () => {
  it("lists owned blocks with counts, found-but-placed ones with 0, and the rest as unknown", () => {
    const list = inventoryEntries(blocks, TABLES, {
      inventory: { "oak-planks": 12, glass: 0 },
      found: { "oak-planks": 20, glass: 3 },
    });
    expect(entry(list, "oak-planks")).toMatchObject({ state: "owned", count: 12 });
    // Every glass block is on the island: it still shows, with 0, never as lost.
    expect(entry(list, "glass")).toMatchObject({ state: "placed", count: 0 });
    expect(entry(list, "copper-ore")).toMatchObject({ state: "unknown", count: 0 });
  });

  it("reads a save without `found` as a copy of the inventory (foundBlocks)", () => {
    const list = inventoryEntries(blocks, TABLES, { inventory: { cobble: 4 } });
    expect(entry(list, "cobble").state).toBe("owned");
    expect(entry(list, "grass").state).toBe("unknown");
  });

  it("leaves out a block no lesson gives unless the player has found it", () => {
    const none = inventoryEntries(blocks, TABLES, { inventory: {}, found: {} });
    expect(none.some((e) => e.def.id === "water")).toBe(false);
    expect(none.some((e) => e.def.id === "birch-log")).toBe(false);
    // Every "?" can be found in some lesson.
    expect(none.every((e) => e.lootBiomes.length > 0)).toBe(true);
    expect(none).toHaveLength(meadowLoot.entries.length);
    const some = inventoryEntries(blocks, TABLES, { inventory: { "birch-log": 2 }, found: {} });
    expect(entry(some, "birch-log")).toMatchObject({
      state: "owned",
      lootBiomes: [],
      biomes: ["birch"],
    });
  });

  it("orders slots kind by kind, then by block number, and every block has a kind", () => {
    const list = inventoryEntries(blocks, TABLES, { inventory: {}, found: {} });
    const ranks = list.map((e) => KINDS.indexOf(e.kind));
    expect(ranks).toEqual(ranks.toSorted((a, b) => a - b));
    expect(kindOf({ tags: ["flower", "placeable"] })).toBe("flower");
    expect(kindOf({ tags: ["placeable", "transparent"] })).toBe("stone");
    expect(kindOf({ tags: ["terrain", "placeable"] })).toBe("ground");
  });

  it("counts found blocks out of every block listed", () => {
    const list = inventoryEntries(blocks, TABLES, fixture("collector-miner"));
    const counts = collectionCount(list);
    expect(counts.total).toBe(list.length);
    expect(counts.found).toBe(list.filter((e) => e.state !== "unknown").length);
    expect(counts.found).toBe(23);
  });
});

describe("filters", () => {
  const list = inventoryEntries(blocks, TABLES, { inventory: { "birch-log": 1 }, found: {} });

  it("filters by island and by kind, together", () => {
    expect(filterEntries(list, "birch", "all").map((e) => e.def.id)).toEqual(["birch-log"]);
    const flowers = filterEntries(list, "meadow", "flower");
    expect(flowers.length).toBe(4);
    expect(flowers.every((e) => e.kind === "flower")).toBe(true);
    expect(filterEntries(list, "birch", "flower")).toEqual([]);
    expect(filterEntries(list, "all", "all")).toEqual(list);
  });

  it("offers only islands and kinds that have a slot", () => {
    const choices = filterChoices(list);
    expect(choices.biomes).toEqual(["meadow", "birch"]);
    expect(choices.kinds).toEqual([...KINDS]);
    expect(filterChoices([]).biomes).toEqual([]);
  });
});

describe("the details panel's words", () => {
  const list = inventoryEntries(blocks, TABLES, fixture("collector-miner"));

  it("names an owned block, its count, how rare it is and where it is found", () => {
    const view = detailView(entry(list, "oak-planks"));
    expect(view).toEqual({
      name: "Oak Planks",
      have: "You have 1250.",
      rarity: t("inventory.rarity.common"),
      where: "Found in lessons.",
      // Planks belong to no one island (no `biome:` tag).
      home: null,
    });
    // Grass is a Meadow block: the panel says so, and the Island filter lists it there.
    expect(detailView(entry(list, "grass")).home).toBe("It comes from Meadow Home.");
    expect(entry(list, "oak-planks").biomes).toEqual([]);
    expect(slotLabel(entry(list, "oak-planks"))).toBe("Oak Planks, 1250");
  });

  it("says a block that is all on the island is there, kindly", () => {
    const glass = entry(list, "glass");
    expect(detailView(glass).have).toBe(t("inventory.detail.placed"));
    expect(slotLabel(glass)).toBe("Glass, 0. All on your island");
  });

  it("keeps an unknown block's name to itself and says where to look", () => {
    const gem = entry(list, "green-wool");
    expect(gem.state).toBe("unknown");
    const view = detailView(gem);
    expect(view.name).toBe(t("inventory.detail.unknownName"));
    expect(view.where).toBe("Look for it in lessons.");
    // Every lesson rolls from a loot table, so no island is named for a block without one.
    expect(view.home).toBeNull();
    expect(slotLabel(gem)).toBe(t("inventory.cell.unknown"));
    expect(JSON.stringify(view)).not.toContain("Green Wool");
  });

  it("has no pressure or loss words, and every block name is safe to read aloud", () => {
    const words = list.flatMap((e) =>
      Object.values(detailView(e))
        .filter((w): w is string => w !== null)
        .concat(slotLabel(e)),
    );
    for (const w of words) expect(w).not.toMatch(/\b(lost|gone|wrong|hurry|fast|fail)/i);
    for (const def of blocks) {
      // Decision 100: a name a screen reader or read-aloud says must not sound unsafe.
      expect(soundsUnsafe(t(def.nameKey)), def.id).toBe(false);
      expect(soundsUnsafe(def.typedName), def.id).toBe(false);
    }
  });

  it("uses the right plural", () => {
    expect(t("inventory.count", { found: 1, total: 1 })).toBe("1 of 1 block found");
    expect(t("inventory.count", { found: 3, total: 26 })).toBe("3 of 26 blocks found");
    expect(t("inventory.filter.showing", { count: 1 })).toBe("1 block here");
  });
});

describe("gridMove", () => {
  // 10 slots, 4 to a row:  0 1 2 3 / 4 5 6 7 / 8 9
  const n = 10;
  const cols = 4;
  it("Left and Right step in reading order and stop at the ends", () => {
    expect(gridMove(3, "ArrowRight", n, cols, 1)).toBe(4);
    expect(gridMove(9, "ArrowRight", n, cols, 1)).toBe(9);
    expect(gridMove(0, "ArrowLeft", n, cols, 1)).toBe(0);
  });
  it("Up and Down keep the column; Down into a short last row goes to the last slot", () => {
    expect(gridMove(1, "ArrowDown", n, cols, 1)).toBe(5);
    expect(gridMove(5, "ArrowDown", n, cols, 1)).toBe(9);
    expect(gridMove(6, "ArrowDown", n, cols, 1)).toBe(9);
    expect(gridMove(9, "ArrowDown", n, cols, 1)).toBe(9);
    expect(gridMove(9, "ArrowUp", n, cols, 1)).toBe(5);
    expect(gridMove(2, "ArrowUp", n, cols, 1)).toBe(2);
  });
  it("PageUp and PageDown move a screenful in the column; Home and End go to the ends", () => {
    expect(gridMove(1, "PageDown", n, cols, 2)).toBe(9);
    expect(gridMove(0, "PageDown", n, cols, 1)).toBe(4);
    expect(gridMove(9, "PageUp", n, cols, 2)).toBe(1);
    expect(gridMove(9, "PageUp", n, cols, 9)).toBe(1);
    expect(gridMove(6, "Home", n, cols, 1)).toBe(0);
    expect(gridMove(2, "End", n, cols, 1)).toBe(9);
  });
  it("copes with no slots and odd sizes", () => {
    expect(gridMove(0, "ArrowDown", 0, 4, 1)).toBe(0);
    expect(gridMove(5, "ArrowRight", 3, 0, 0)).toBe(2);
  });
  it("counts columns from the slots' top edges", () => {
    expect(columnsFromTops([10, 10, 10.5, 90, 90])).toBe(3);
    expect(columnsFromTops([])).toBe(1);
    expect(columnsFromTops([0, 0, 0])).toBe(3);
  });
});

// ---- The screen ----

let h: Harness | null = null;
afterEach(() => {
  h?.unmount();
  h = null;
  vi.useRealTimers();
});

const slots = (root: HTMLElement): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>('[role="option"]'),
];
const details = (root: HTMLElement): string =>
  text(root.querySelector('[data-testid="inventory-details"]'));

/** jsdom has no layout: lay the slots out `cols` to a row, 100 px apart, in a 250 px tall view. */
function layOut(root: HTMLElement, cols: number): void {
  slots(root).forEach((el, i) => {
    el.getBoundingClientRect = () => {
      const top = Math.floor(i / cols) * 100;
      return {
        top,
        bottom: top + 90,
        left: 0,
        right: 90,
        width: 90,
        height: 90,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    };
  });
  const scroll = root.querySelector('[role="listbox"]')?.parentElement;
  if (scroll) Object.defineProperty(scroll, "clientHeight", { value: 250, configurable: true });
}

/** The index of the focused slot, or -1. */
function at(): number {
  const el = document.activeElement;
  return el instanceof HTMLElement ? Number(el.dataset["index"]) : -1;
}

async function openInventory(profile: Profile): Promise<Harness> {
  const s = await mount({ initial: { id: "map" }, initialProfile: profile });
  s.shell.api.navigate({ id: "inventory" });
  await s.settle();
  return s;
}

describe("My Blocks", () => {
  it("opens on the first slot, shows counts, 0 for placed blocks and ? for unknown ones", async () => {
    h = await openInventory(fixture("collector-miner"));
    const all = slots(h.root);
    expect(all.length).toBe(meadowLoot.entries.length);
    expect(document.activeElement).toBe(all[0]);
    expect(all[0]?.getAttribute("aria-selected")).toBe("true");
    expect(all.filter((el) => el.tabIndex === 0)).toHaveLength(1);
    const glass = h.root.querySelector<HTMLElement>('[data-block="glass"]');
    expect(glass?.dataset["state"]).toBe("placed");
    expect(glass?.querySelector("[data-count]")?.getAttribute("data-count")).toBe("0");
    const wool = h.root.querySelector<HTMLElement>('[data-block="green-wool"]');
    expect(wool?.dataset["state"]).toBe("unknown");
    expect(text(wool)).toBe("?");
    expect(text(h.root)).toContain("23 of 26 blocks found");
    // Without WebGL the icons are the flat tiles.
    expect(h.root.querySelector('[data-icon="cube"]')).toBeNull();
    expect(h.root.querySelector('[data-icon="flat"]')).not.toBeNull();
  });

  it("arrows, Home, End and the page keys move the choice, once per press", async () => {
    h = await openInventory(fixture("collector-miner"));
    const root = h.root;
    layOut(root, 4);
    const chosen = (): string | null =>
      root.querySelector('[aria-selected="true"]')?.getAttribute("data-index") ?? null;

    let e = await h.press("ArrowRight");
    expect(e.defaultPrevented).toBe(true);
    expect(at()).toBe(1);
    expect(chosen()).toBe("1");
    expect(details(root)).toContain(t(entryAt(root, 1)));
    await h.press("ArrowDown");
    expect(at()).toBe(5);
    await h.press("ArrowLeft");
    expect(at()).toBe(4);
    await h.press("ArrowUp");
    expect(at()).toBe(0);
    await h.press("PageDown");
    expect(at()).toBe(8);
    await h.press("PageUp");
    expect(at()).toBe(0);
    await h.press("End");
    expect(at()).toBe(slots(root).length - 1);
    await h.press("Home");
    expect(at()).toBe(0);
    // A held key doesn't run on.
    e = await h.press("ArrowRight", { repeat: true });
    expect(at()).toBe(0);
    // Still one Tab stop, on the chosen slot.
    expect(slots(root).filter((el) => el.tabIndex === 0)).toEqual([document.activeElement]);
    expect(h.route().id).toBe("inventory");
  });

  it("a click chooses a slot and the panel tells about it", async () => {
    h = await openInventory(fixture("collector-miner"));
    const glass = h.root.querySelector<HTMLElement>('[data-block="glass"]');
    glass?.click();
    await h.settle();
    expect(glass?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(glass);
    expect(details(h.root)).toContain("Glass");
    expect(details(h.root)).toContain(t("inventory.detail.placed"));
  });

  it("the filters narrow the grid and say how many show", async () => {
    h = await openInventory(fixture("collector-miner"));
    const kind = h.root.querySelector<HTMLSelectElement>('[data-testid="filter-kind"]');
    if (!kind) throw new Error("no kind filter");
    kind.focus();
    kind.value = "flower";
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    await h.settle();
    const ids = slots(h.root).map((el) => el.dataset["block"]);
    expect(ids).toEqual(["red-blooms", "sunny-flowers", "bluebells", "purple-puffs"]);
    // The choice moved to a slot that shows; focus stays on the filter.
    expect(slots(h.root)[0]?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(kind);
    await new Promise((r) => setTimeout(r, 200));
    expect(announcer(document).region.textContent).toBe("4 blocks here");
  });

  it("a new player sees every block as a ? to find", async () => {
    h = await openInventory(fixture("fresh-sprout"));
    const all = slots(h.root);
    expect(all.every((el) => el.dataset["state"] === "unknown")).toBe(true);
    expect(text(h.root)).toContain("0 of 26 blocks found");
    expect(details(h.root)).toContain(t("inventory.detail.unknownHave"));
  });

  it("Escape goes back, and the map's corner opens it", async () => {
    h = await mount({ initial: { id: "map" }, initialProfile: fixture("collector-miner") });
    const button = [...h.root.querySelectorAll("button")].find(
      (b) => text(b) === t("inventory.title"),
    );
    button?.click();
    await h.settle();
    expect(h.route().id).toBe("inventory");
    await h.press("Escape");
    expect(h.route().id).toBe("map");
  });
});

/** The name key of the slot at `i`. */
function entryAt(root: HTMLElement, i: number): MessageKey {
  const id = slots(root)[i]?.dataset["block"];
  const def = blocks.find((b) => b.id === id);
  if (!def) throw new Error(`no block at ${i}`);
  return def.nameKey;
}
