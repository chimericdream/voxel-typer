/**
 * The rules behind Settings → Grown-ups → Save file (task M3-12, PLAN.md §6.6), kept out of the
 * component so they can be tested on their own. Nothing here writes: {@link planImport} looks at
 * a read export file and what is on the device, and {@link resolveImport} turns the grown-up's
 * choices into a list of saves. The component does the saves.
 *
 * The data-loss rules:
 * - A profile already on this device (same id) is never written over unless a grown-up picked
 *   "Use the file's copy" for it. The default is to keep this device's. That replace is final:
 *   the next save drops `:prev`, so the screen offers a backup download first.
 * - One id is written at most once per import: a repeat in the file becomes a copy.
 * - A profile a newer game wrote can't be replaced (the store refuses it too).
 * - A file profile whose island can't be opened never replaces one whose island can.
 * - New profiles fill the free slots of the 8 in file order; the rest are skipped, with a reason.
 */
import { openIsland } from "@/engine/island";
import type { IslandBlocks } from "@/engine/island";
import type { ExportFileEntry } from "@/save/store";
import { MAX_PROFILES, suffixedName } from "@/save/store";
import type { Profile } from "@/save/schema";
import type { EpochMs } from "@/types/core";

/** What this device holds under an id that is also in the file. */
export type DeviceSide =
  | { kind: "player"; profile: Profile }
  /** Both records damaged (`unreadable`). It holds a slot. */
  | { kind: "lost" }
  /** A newer game wrote it. Read-only here. */
  | { kind: "newer" };

export type Choice = "keepDevice" | "useFile" | "keepBoth";

export type PlanRow =
  | { index: number; kind: "add"; profile: Profile }
  | {
      index: number;
      kind: "conflict";
      profile: Profile;
      device: DeviceSide;
      /** In the order the screen offers them; the first is the default. */
      choices: readonly Choice[];
      /** False when the file's island can't be opened and this device's can. */
      fileIslandOk: boolean;
    }
  | { index: number; kind: "bad"; reason: "newer" | "invalid"; detail: string };

export interface DeviceState {
  /** Every stored id: listed, damaged and newer-game profiles (each holds a slot). */
  ids: ReadonlySet<string>;
  /** Readable profiles on this device, by id. */
  profiles: ReadonlyMap<string, Profile>;
  damaged: ReadonlySet<string>;
  readOnly: ReadonlySet<string>;
}

/** True when the island is missing or opens: `openIsland`'s size and decode check (M4-06). */
export function islandOk(p: Profile, blocks: IslandBlocks): boolean {
  if (p.island === null) return true;
  try {
    openIsland({ island: p.island, inventory: p.inventory, blocks, profileId: p.id });
    return true;
  } catch {
    return false;
  }
}

/** Looks at each file profile against the device. Writes nothing. */
export function planImport(
  entries: readonly ExportFileEntry[],
  device: DeviceState,
  blocks: IslandBlocks,
): PlanRow[] {
  const seen = new Set<string>();
  return entries.map((e): PlanRow => {
    if (!e.ok) return { index: e.index, kind: "bad", reason: e.reason, detail: e.detail };
    const p = e.profile;
    // The same id twice in one file: the later one is only ever a new copy ("keep both"), never
    // a replacement. Two replacements of one id would write over this device's copy and then
    // over its `:prev`, and nothing of it would be left (review N1). `resolveImport` checks too.
    const repeat = seen.has(p.id);
    seen.add(p.id);
    if (repeat || !device.ids.has(p.id) || p.id.includes(":")) {
      return { index: e.index, kind: "add", profile: p };
    }
    const mine = device.profiles.get(p.id);
    const side: DeviceSide =
      mine !== undefined
        ? { kind: "player", profile: mine }
        : device.readOnly.has(p.id)
          ? { kind: "newer" }
          : { kind: "lost" };
    // Only a real island that opens is protected; a device copy with none loses nothing.
    const deviceIslandGood =
      side.kind === "player" && side.profile.island !== null && islandOk(side.profile, blocks);
    const fileIslandOk = !deviceIslandGood || islandOk(p, blocks);
    const choices: Choice[] = ["keepDevice"];
    if (side.kind !== "newer" && fileIslandOk) choices.push("useFile");
    choices.push("keepBoth");
    return { index: e.index, kind: "conflict", profile: p, device: side, choices, fileIslandOk };
  });
}

export type SkipReason =
  | "keptDevice"
  | "full"
  | "newer"
  | "invalid"
  /**
   * "Use the file's copy" was picked but isn't allowed: a newer device copy, a bad island, or
   * this import already writes that id.
   */
  | "notAllowed";

export type ImportStep =
  | { index: number; kind: "add"; profile: Profile; copyOf?: string }
  | { index: number; kind: "replace"; profile: Profile; previousName: string | null }
  | { index: number; kind: "skip"; name: string | null; reason: SkipReason };

/**
 * The saves to make, in file order. `choices` maps a conflict's file index to the grown-up's
 * pick; a missing one means the default (keep this device's). New profiles and "keep both"
 * copies use a free slot each; replacements don't.
 */
export function resolveImport(
  rows: readonly PlanRow[],
  choices: ReadonlyMap<number, Choice>,
  device: DeviceState,
  newId: () => string,
): ImportStep[] {
  let free = Math.max(0, MAX_PROFILES - device.ids.size);
  const ids = new Set(device.ids);
  const names = new Set([...device.profiles.values()].map((p) => p.name));
  const steps: ImportStep[] = [];
  /** Ids this import writes. A second write of one id is refused (review N1). */
  const written = new Set<string>();

  const freshId = (): string => {
    for (;;) {
      const id = newId();
      if (!ids.has(id)) return id;
    }
  };
  const add = (index: number, p: Profile, copy: boolean): void => {
    if (free <= 0) {
      steps.push({ index, kind: "skip", name: p.name, reason: "full" });
      return;
    }
    const renamed = copy || ids.has(p.id) || p.id.includes(":");
    const profile = renamed ? { ...p, id: freshId(), name: suffixedName(p.name, names) } : p;
    free--;
    ids.add(profile.id);
    written.add(profile.id);
    names.add(profile.name);
    steps.push(
      renamed ? { index, kind: "add", profile, copyOf: p.name } : { index, kind: "add", profile },
    );
  };

  for (const row of rows) {
    if (row.kind === "bad") {
      steps.push({ index: row.index, kind: "skip", name: null, reason: row.reason });
    } else if (row.kind === "add") {
      add(row.index, row.profile, false);
    } else {
      const pick = choices.get(row.index) ?? row.choices[0] ?? "keepDevice";
      if (pick === "keepBoth") {
        add(row.index, row.profile, true);
      } else if (
        pick === "useFile" &&
        row.choices.includes("useFile") &&
        !written.has(row.profile.id)
      ) {
        written.add(row.profile.id);
        steps.push({
          index: row.index,
          kind: "replace",
          profile: row.profile,
          previousName: row.device.kind === "player" ? row.device.profile.name : null,
        });
        names.add(row.profile.name);
      } else {
        steps.push({
          index: row.index,
          kind: "skip",
          name: row.profile.name,
          reason: pick === "useFile" ? "notAllowed" : "keptDevice",
        });
      }
    }
  }
  return steps;
}

/** The latest time a profile was played (or made), to say which copy is newer. */
export function lastPlayed(p: Profile): EpochMs {
  let at = p.createdAt;
  for (const h of p.history) at = Math.max(at, h.at);
  for (const l of Object.values(p.progress.lessons)) at = Math.max(at, l.lastPlayed);
  return at;
}

/** Lessons with at least one star. */
/** True when the player has a Home Island (review N4: the check says which copy has one). */
export function hasIsland(p: Profile): boolean {
  return p.island !== null;
}

export function lessonsDone(p: Profile): number {
  return Object.values(p.progress.lessons).filter((l) => l.bestStars > 0).length;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `voxel-typer-YYYY-MM-DD.json`, the local date of `at`. */
export function exportFileName(at: EpochMs): string {
  const d = new Date(at);
  return `voxel-typer-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

/**
 * Which device profiles an export left out: damaged and newer-game ones the store skips. Counts
 * only ids that really are missing from the file.
 */
export function leftOut(
  exportedIds: ReadonlySet<string>,
  damaged: ReadonlySet<string>,
  readOnly: ReadonlySet<string>,
): { lost: number; newer: number } {
  const missing = (s: ReadonlySet<string>): number =>
    [...s].filter((id) => !exportedIds.has(id)).length;
  return { lost: missing(damaged), newer: missing(readOnly) };
}

/** The ids in an export file's text, or null when it can't be read. */
export function idsInExport(text: string): Set<string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const list: unknown = Reflect.get(parsed, "profiles");
  if (!Array.isArray(list)) return null;
  const ids = new Set<string>();
  for (const p of list) {
    const id: unknown = typeof p === "object" && p !== null ? Reflect.get(p, "id") : undefined;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}
