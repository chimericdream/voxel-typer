/**
 * What My Blocks shows (task M4-09), as plain data: no DOM, so it is tested directly.
 *
 * Three kinds of slot:
 * - **owned**: the player has some (`inventory`), shown with its count;
 * - **placed**: found once (`foundBlocks`), but every one is on the island now: shown with 0 and
 *   a kind note, never as lost;
 * - **unknown**: never found, shown as a "?" silhouette, the collection goal. Only blocks a lesson
 *   can give are listed this way, so every "?" can be found.
 */
import type { BlockDef, Rarity } from "@/content/blocks/types";
import type { LootTable } from "@/content/loot/types";
import { foundBlocks } from "@/engine/achievements";
import type { Profile } from "@/save/schema";
import type { BiomeId } from "@/types/core";
import { BIOME_ORDER } from "@/types/core";

/** A slot's state. */
export type SlotState = "owned" | "placed" | "unknown";

/** The kinds the "Kind" filter offers, in the order the grid lists them. */
export const KINDS = ["ground", "wood", "stone", "ore", "flower", "wool", "light"] as const;
export type BlockKind = (typeof KINDS)[number];

export const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "epic"];

/** A block's kind, from its tags. Building blocks with no group tag (brick, glass) are stone. */
export function kindOf(def: Pick<BlockDef, "tags">): BlockKind {
  const has = (tag: string): boolean => def.tags.includes(tag);
  if (has("flower")) return "flower";
  if (has("wool")) return "wool";
  if (has("light")) return "light";
  if (has("ore")) return "ore";
  if (has("wood")) return "wood";
  if (has("terrain")) return "ground";
  return "stone";
}

export interface InventoryEntry {
  def: BlockDef;
  state: SlotState;
  /** How many the player has now (0 unless owned). */
  count: number;
  kind: BlockKind;
  /**
   * The loot tables that list this block, in curriculum order. Lessons on an island without its
   * own table roll from the Meadow table, so this says whether lessons give the block at all, not
   * on which island.
   */
  lootBiomes: BiomeId[];
  /** The block's own islands, from its `biome:` tags: what the "Island" filter lists it under. */
  biomes: BiomeId[];
}

const biomeRank = (b: BiomeId): number => BIOME_ORDER.indexOf(b);

/** Every slot the grid shows, kind by kind, then by block number. */
export function inventoryEntries(
  blocks: readonly BlockDef[],
  tables: readonly LootTable[],
  profile: Pick<Profile, "inventory" | "found">,
): InventoryEntry[] {
  const found = foundBlocks(profile);
  const loot = new Map<string, Set<BiomeId>>();
  for (const table of tables) {
    for (const e of table.entries) {
      const set = loot.get(e.block) ?? new Set<BiomeId>();
      set.add(table.biome);
      loot.set(e.block, set);
    }
  }
  const out: InventoryEntry[] = [];
  for (const def of blocks) {
    const owned = Math.max(0, Math.floor(profile.inventory[def.id] ?? 0));
    const known = owned > 0 || (found[def.id] ?? 0) > 0;
    const lootBiomes = [...(loot.get(def.id) ?? [])].toSorted(
      (a, b) => biomeRank(a) - biomeRank(b),
    );
    // A block no lesson gives would be a "?" that can never be found: leave it out.
    if (!known && lootBiomes.length === 0) continue;
    const tagged = def.tags
      .filter((tag) => tag.startsWith("biome:"))
      .map((tag) => tag.slice("biome:".length))
      .filter((b): b is BiomeId => (BIOME_ORDER as readonly string[]).includes(b));
    const biomes = [...new Set(tagged)].toSorted((a, b) => biomeRank(a) - biomeRank(b));
    out.push({
      def,
      state: owned > 0 ? "owned" : known ? "placed" : "unknown",
      count: owned,
      kind: kindOf(def),
      lootBiomes,
      biomes,
    });
  }
  return out.toSorted(
    (a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.def.num - b.def.num,
  );
}

/** A filter value: everything, or one island or kind. */
export type Filter<T extends string> = "all" | T;

export function filterEntries(
  entries: readonly InventoryEntry[],
  biome: Filter<BiomeId>,
  kind: Filter<BlockKind>,
): InventoryEntry[] {
  return entries.filter(
    (e) => (biome === "all" || e.biomes.includes(biome)) && (kind === "all" || e.kind === kind),
  );
}

/** The islands and kinds that have at least one slot, for the filters' choices. */
export function filterChoices(entries: readonly InventoryEntry[]): {
  biomes: BiomeId[];
  kinds: BlockKind[];
} {
  const biomes = new Set(entries.flatMap((e) => e.biomes));
  const kinds = new Set(entries.map((e) => e.kind));
  return {
    biomes: BIOME_ORDER.filter((b) => biomes.has(b)),
    kinds: KINDS.filter((k) => kinds.has(k)),
  };
}

/** Found blocks (owned or on the island) and every block listed. */
export function collectionCount(entries: readonly InventoryEntry[]): {
  found: number;
  total: number;
} {
  return {
    found: entries.filter((e) => e.state !== "unknown").length,
    total: entries.length,
  };
}

/** The keys that move in the grid. */
export type GridKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown";

export function isGridKey(key: string): key is GridKey {
  return (
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "Home" ||
    key === "End" ||
    key === "PageUp" ||
    key === "PageDown"
  );
}

/**
 * Where a key moves in a grid of `n` slots laid out `cols` to a row, `pageRows` rows to a screen.
 * Left and Right step through the slots in reading order and stop at the ends (no wrap, so a
 * child always knows where the edge is). Up and Down keep the column; Down from a column the
 * last, short row doesn't reach goes to the last slot. PageUp and PageDown move a screenful in
 * the column, stopping at its top or bottom. Home and End go to the first and last slot.
 */
export function gridMove(
  at: number,
  key: GridKey,
  n: number,
  cols: number,
  pageRows: number,
): number {
  if (n <= 0) return 0;
  const c = Math.max(1, Math.floor(cols));
  const rows = Math.max(1, Math.floor(pageRows));
  const last = n - 1;
  const i = Math.min(last, Math.max(0, at));
  const lastRow = Math.floor(last / c);
  const down = (steps: number): number => {
    let to = i;
    for (let s = 0; s < steps && to + c <= last; s++) to += c;
    // The row below exists but is too short for this column.
    if (to === i && Math.floor(i / c) < lastRow) return last;
    return to;
  };
  const up = (steps: number): number => {
    let to = i;
    for (let s = 0; s < steps && to - c >= 0; s++) to -= c;
    return to;
  };
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, i - 1);
    case "ArrowRight":
      return Math.min(last, i + 1);
    case "ArrowUp":
      return up(1);
    case "ArrowDown":
      return down(1);
    case "PageUp":
      return up(rows);
    case "PageDown":
      return down(rows);
    case "Home":
      return 0;
    case "End":
    default:
      return last;
  }
}

/** How many slots share the first row, from each slot's top edge in pixels. */
export function columnsFromTops(tops: readonly number[]): number {
  const first = tops[0];
  if (first === undefined) return 1;
  let n = 0;
  for (const top of tops) {
    if (Math.abs(top - first) > 1) break;
    n++;
  }
  return Math.max(1, n);
}
