/**
 * My Blocks, the inventory (task M4-09, PLAN.md §3.3): every block the player has, with its count
 * and a frame that shows how rare it is; blocks not found yet as "?" silhouettes, the collection
 * goal; and a panel about the chosen block: its name, how many, and where it is found. A block
 * that is all on the island still shows, with 0 and a kind note: it is never lost.
 *
 * Keys: the grid is one Tab stop (roving focus) and opens focused on its first slot. The arrows
 * move by slot and by row, Home and End go to the ends, PageUp and PageDown a screenful. The grid
 * handles those itself and calls `preventDefault`, so the screen's `onInput` handler never acts
 * on the same arrow twice (`useScreenInput` drops handled keys; the M2-11 Tabs pattern). Choosing
 * follows focus, so Enter is never needed. Escape goes back (the shell's default).
 *
 * When the grid is taller than its room it scrolls inside it, like My Badges (M3-FIX-8): the cut
 * edge fades and "More blocks below ↓" shows under it while slots are out of sight below.
 */
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { AppApi, ScreenProps } from "@/app/types";
import { blocks } from "@/content/blocks";
import { meadowLoot } from "@/content/loot/meadow";
import type { LootTable } from "@/content/loot/types";
import { t } from "@/i18n";
import type { BiomeId } from "@/types/core";
import { BlockIcon } from "@/ui/components/BlockIcon";
import { announce } from "@/ui/kit/announce";
import { Button } from "@/ui/kit/Button";
import {
  RARITIES,
  collectionCount,
  columnsFromTops,
  filterChoices,
  filterEntries,
  gridMove,
  inventoryEntries,
  isGridKey,
} from "./inventory-logic";
import type { BlockKind, Filter, InventoryEntry } from "./inventory-logic";
import { prefersReducedMotion, useScreenInput } from "./nav";
import screen from "./screen.module.css";
import styles from "./Inventory.module.css";

/**
 * The loot tables lessons roll from. Mine and Defense fall back to the Meadow table on islands
 * without their own; add a biome's table here when it lands.
 */
export const LOOT_TABLES: readonly LootTable[] = [meadowLoot];

/** Island names, read as a list: "Meadow Home", "Meadow Home and Birch Forest". */
export function placesText(biomes: readonly BiomeId[]): string {
  const names = biomes.map((b) => t(`map.biome.${b}`));
  const last = names.at(-1) ?? "";
  if (names.length < 2) return last;
  return t("inventory.detail.and", { first: names.slice(0, -1).join(", "), last });
}

/** A slot's name for screen readers. */
export function slotLabel(e: InventoryEntry): string {
  const name = t(e.def.nameKey);
  if (e.state === "unknown") return t("inventory.cell.unknown");
  if (e.state === "placed") return t("inventory.cell.placed", { name });
  return t("inventory.cell.owned", { name, count: e.count });
}

/**
 * What the panel says about a block. Every lesson rolls from a loot table, and islands without
 * their own table use the Meadow one, so "where" says lessons, not an island. A block whose
 * content tags tie it to an island (`biome:`) also says which.
 */
export function detailView(e: InventoryEntry): {
  name: string;
  have: string;
  rarity: string;
  where: string;
  home: string | null;
} {
  const places = placesText(e.biomes);
  return {
    name: e.state === "unknown" ? t("inventory.detail.unknownName") : t(e.def.nameKey),
    have:
      e.state === "owned"
        ? t("inventory.detail.have", { count: e.count })
        : e.state === "placed"
          ? t("inventory.detail.placed")
          : t("inventory.detail.unknownHave"),
    rarity: t(`inventory.rarity.${e.def.rarity}`),
    where:
      e.lootBiomes.length === 0
        ? t("inventory.detail.whereNone")
        : e.state === "unknown"
          ? t("inventory.detail.whereUnknown")
          : t("inventory.detail.where"),
    home: places === "" ? null : t("inventory.detail.home", { places }),
  };
}

/** What is out of sight in a scroll area. */
interface Hidden {
  above: boolean;
  below: boolean;
}

/** Slack for subpixel scroll positions at zoom and text scale. */
const EDGE_PX = 2;

/** Watches a scroll area, as My Badges does: on scroll, on resize, and when it or its content resize. */
function useHidden(ref: RefObject<HTMLElement | null>, key: unknown): Hidden {
  const [hidden, setHidden] = useState<Hidden>({ above: false, below: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      setHidden({ above: false, below: false });
      return undefined;
    }
    const measure = (): void => {
      const above = el.scrollTop > EDGE_PX;
      const below = el.scrollTop + el.clientHeight < el.scrollHeight - EDGE_PX;
      setHidden((was) => (was.above === above && was.below === below ? was : { above, below }));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const view = el.ownerDocument.defaultView;
    view?.addEventListener("resize", measure);
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    sizes?.observe(el);
    if (el.firstElementChild) sizes?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", measure);
      view?.removeEventListener("resize", measure);
      sizes?.disconnect();
    };
  }, [ref, key]);
  return hidden;
}

/** Rarity as pips, 1 to 4, so it never rests on color alone. */
function Pips({ rarity }: { rarity: InventoryEntry["def"]["rarity"] }) {
  const n = RARITIES.indexOf(rarity) + 1;
  return (
    <span class={styles.pips} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} class={styles.pip} />
      ))}
    </span>
  );
}

function Details({ app, entry }: { app: AppApi; entry: InventoryEntry }) {
  const ref = useRef<HTMLElement>(null);
  const hidden = useHidden(ref, entry.def.id);
  const view = detailView(entry);
  const scrolls = hidden.above || hidden.below;
  return (
    <section
      ref={ref}
      class={styles.details}
      aria-label={t("inventory.detail.label")}
      data-testid="inventory-details"
      data-below={hidden.below ? "1" : undefined}
      // Only when its words don't fit (text scale 2 on a short window), so a keyboard can scroll it.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- reason: a scroll area must take focus to scroll by keyboard
      tabIndex={scrolls ? 0 : undefined}
    >
      <div class={styles.detailHead}>
        <span class={styles.bigIcon} data-rarity={entry.def.rarity}>
          <BlockIcon app={app} def={entry.def} unknown={entry.state === "unknown"} />
        </span>
        <h2 class={styles.detailName}>{view.name}</h2>
      </div>
      <p class={styles.detailText}>{view.have}</p>
      <p class={styles.detailText}>
        <Pips rarity={entry.def.rarity} />
        <span>{view.rarity}</span>
      </p>
      <p class={styles.detailText}>{view.where}</p>
      {view.home === null ? null : <p class={styles.detailText}>{view.home}</p>}
    </section>
  );
}

export default function Inventory({ app }: ScreenProps) {
  const profile = app.profile();
  const all = useMemo(
    () => inventoryEntries(blocks, LOOT_TABLES, profile ?? { inventory: {}, found: {} }),
    [profile],
  );
  const choices = useMemo(() => filterChoices(all), [all]);
  const counts = collectionCount(all);
  const [biome, setBiome] = useState<Filter<BiomeId>>("all");
  const [kind, setKind] = useState<Filter<BlockKind>>("all");
  const shown = useMemo(() => filterEntries(all, biome, kind), [all, biome, kind]);
  const [chosenId, setChosenId] = useState<string | null>(() => all[0]?.def.id ?? null);
  const chosenAt = Math.max(
    0,
    shown.findIndex((e) => e.def.id === chosenId),
  );
  const chosen = shown[chosenAt] ?? null;

  const scroll = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const hidden = useHidden(scroll, shown.length);
  const focusNextRef = useRef(true);

  const slotEl = (i: number): HTMLElement | null =>
    grid.current?.querySelector<HTMLElement>(`[data-index="${i}"]`) ?? null;

  // Focus follows the chosen slot after a key or on opening, never on a filter change (focus
  // stays on the filter there).
  useEffect(() => {
    if (!focusNextRef.current) return;
    focusNextRef.current = false;
    slotEl(chosenAt)?.focus();
  });

  const choose = (i: number, focus: boolean): void => {
    const e = shown[i];
    if (!e) return;
    if (e.def.id === chosen?.def.id) {
      // No render follows: focus it now.
      if (focus) slotEl(i)?.focus();
      return;
    }
    focusNextRef.current = focus;
    setChosenId(e.def.id);
  };

  const onGridKey = (e: KeyboardEvent): void => {
    if (!isGridKey(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    // Held keys don't run on (PLAN.md §6.5: key-repeat is ignored everywhere).
    if (e.repeat) return;
    const items = [...(grid.current?.querySelectorAll<HTMLElement>("[data-index]") ?? [])];
    const tops = items.map((el) => el.getBoundingClientRect().top);
    const cols = columnsFromTops(tops);
    const rowStep = (tops[cols] ?? 0) - (tops[0] ?? 0);
    const room = scroll.current?.clientHeight ?? 0;
    const pageRows = rowStep > 0 ? Math.max(1, Math.floor(room / rowStep)) : 1;
    choose(gridMove(chosenAt, e.key, shown.length, cols, pageRows), true);
  };

  useScreenInput(app, (i) => {
    if (i.kind !== "control") return false;
    // An arrow with nothing focused (after a click on the page) comes back to the grid. Arrows
    // on a filter belong to the filter.
    const nothing = document.activeElement === null || document.activeElement === document.body;
    if (
      nothing &&
      (i.action === "up" ||
        i.action === "down" ||
        i.action === "left" ||
        i.action === "right" ||
        i.action === "confirm")
    ) {
      const el = slotEl(chosenAt);
      el?.focus();
      return el !== null;
    }
    return false;
  });

  const setFilter = (next: { biome?: Filter<BiomeId>; kind?: Filter<BlockKind> }): void => {
    const b = next.biome ?? biome;
    const k = next.kind ?? kind;
    setBiome(b);
    setKind(k);
    const list = filterEntries(all, b, k);
    focusNextRef.current = false;
    if (!list.some((e) => e.def.id === chosenId)) setChosenId(list[0]?.def.id ?? null);
    scroll.current?.scrollTo({ top: 0 });
    announce(
      document,
      list.length === 0
        ? t("inventory.filter.empty")
        : t("inventory.filter.showing", { count: list.length }),
    );
  };

  // Most of a screenful down, so the last row seen stays in sight as the top row.
  const showMore = (): void => {
    const el = scroll.current;
    if (!el) return;
    const reduce = prefersReducedMotion(app.profile()?.settings.reducedMotion);
    el.scrollBy({ top: el.clientHeight * 0.8, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div class={`${screen.screen} ${styles.page}`}>
      <div class={styles.head}>
        <h1 class={`${screen.title} ${styles.title}`}>{t("inventory.title")}</h1>
        <p class={styles.count}>
          {t("inventory.count", { found: counts.found, total: counts.total })}
        </p>
      </div>
      <div class={styles.bar}>
        <label class={styles.filter}>
          <span>{t("inventory.filter.biome")}</span>
          <select
            class={styles.select}
            value={biome}
            data-testid="filter-biome"
            onChange={(e) => {
              const v = e.currentTarget.value;
              const b = choices.biomes.find((x) => x === v);
              setFilter({ biome: b ?? "all" });
            }}
          >
            <option value="all">{t("inventory.filter.allBiomes")}</option>
            {choices.biomes.map((b) => (
              <option key={b} value={b}>
                {t(`map.biome.${b}`)}
              </option>
            ))}
          </select>
        </label>
        <label class={styles.filter}>
          <span>{t("inventory.filter.kind")}</span>
          <select
            class={styles.select}
            value={kind}
            data-testid="filter-kind"
            onChange={(e) => {
              const v = e.currentTarget.value;
              const k = choices.kinds.find((x) => x === v);
              setFilter({ kind: k ?? "all" });
            }}
          >
            <option value="all">{t("inventory.filter.allKinds")}</option>
            {choices.kinds.map((k) => (
              <option key={k} value={k}>
                {t(`inventory.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class={styles.body}>
        <div class={styles.frame}>
          <div
            ref={scroll}
            class={styles.scroll}
            data-above={hidden.above ? "1" : undefined}
            data-below={hidden.below ? "1" : undefined}
          >
            {shown.length === 0 ? (
              <p class={styles.empty}>{t("inventory.filter.empty")}</p>
            ) : (
              <div
                ref={grid}
                class={styles.grid}
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- reason: a grid of block pictures; a <select> can't show pictures or rows
                role="listbox"
                // Focus lives on its options (roving tabindex); -1 only so a click on a gap lands here.
                tabIndex={-1}
                aria-label={t("inventory.listLabel")}
                onKeyDown={onGridKey}
              >
                {shown.map((e, i) => {
                  const selected = i === chosenAt;
                  return (
                    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- reason: the listbox handles the keys for every option (onGridKey) and choosing follows focus
                    <div
                      key={e.def.id}
                      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- reason: an <option> can't hold a picture
                      role="option"
                      class={styles.slot}
                      aria-selected={selected}
                      aria-label={slotLabel(e)}
                      tabIndex={selected ? 0 : -1}
                      data-index={i}
                      data-block={e.def.id}
                      data-state={e.state}
                      data-rarity={e.def.rarity}
                      onClick={() => choose(i, true)}
                      onFocus={() => {
                        if (!selected) choose(i, false);
                      }}
                    >
                      <span class={styles.slotIcon}>
                        <BlockIcon app={app} def={e.def} unknown={e.state === "unknown"} />
                      </span>
                      <Pips rarity={e.def.rarity} />
                      {e.state === "unknown" ? null : (
                        // Drawn by CSS from data-count, so the name a screen reader hears ("Oak
                        // Planks, 1250") never disagrees with a shortened "999+" in the text.
                        <span
                          class={styles.badge}
                          data-count={e.count > 999 ? "999+" : String(e.count)}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {chosen ? <Details app={app} entry={chosen} /> : null}
      </div>
      <div class={styles.foot}>
        {/*
          Shown while slots are hidden below; space is kept for it once the grid scrolls at all,
          so the grid doesn't jump at its end. Keyboard users move in the grid itself, so the cue
          stays out of the Tab order; a pointer or a screen reader can press it.
        */}
        {hidden.above || hidden.below ? (
          <button
            type="button"
            class={styles.more}
            data-testid="inventory-more"
            data-show={hidden.below ? "1" : undefined}
            tabIndex={-1}
            onClick={showMore}
          >
            {t("inventory.moreBelow")}
            <span class={styles.arrow} aria-hidden="true" />
          </button>
        ) : null}
        <div class={screen.actions}>
          <Button variant="primary" onClick={() => app.back()}>
            {t("inventory.back")}
          </Button>
        </div>
      </div>
    </div>
  );
}
