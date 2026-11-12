/**
 * What Builder publishes for its HUD in `HudState.custom` (task M4-07, contracts §10). The mode
 * writes a new slice object whenever something on it changes; `BuilderHud.tsx` reads it. No Preact
 * here, so the mode and its tests can import it.
 */
import type { MessageKey } from "@/i18n";
import type { AgeBand, BlockId } from "@/types/core";
import type { Direction } from "./commands";

export const BUILDER_SLICE = "builder";

export interface BuilderHint {
  key: MessageKey;
  params?: Record<string, string | number>;
  tone: "info" | "cheer";
}

export interface PaletteItem {
  block: BlockId;
  /** Display name, already through `t()`. */
  name: string;
  /** What to type to arm it: the name, or its short code for Sprout. */
  word: string;
  count: number;
}

export interface BuilderHudSlice {
  /**
   * `damaged`: the saved island could not be opened. Nothing can be built and nothing is saved, so
   * the old data stays exactly as it is.
   */
  status: "loading" | "ready" | "damaged";
  band: AgeBand;
  /** The command line's text. */
  line: string;
  /** The rest of the word, when only one word fits what is typed. Shown dimmed. */
  completion: string;
  /** The line is a whole word waiting for Space (a longer word starts with it, or a direction). */
  waits: boolean;
  hint: BuilderHint | null;
  /** The armed block, or null. */
  armed: BlockId | null;
  palette: readonly PaletteItem[];
  /** The cursor's layer, 1-based from the bottom of the island. */
  layer: number;
  /** The compass direction at the top of the screen. */
  facing: Direction;
  /** Undo steps available. */
  undo: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function isSlice(v: unknown): v is BuilderHudSlice {
  return (
    isRecord(v) &&
    typeof v["status"] === "string" &&
    typeof v["line"] === "string" &&
    Array.isArray(v["palette"])
  );
}

/** Builder's slice in `custom`, or null. The same object until the mode sends a new one. */
export function builderHudOf(custom: Readonly<Record<string, unknown>>): BuilderHudSlice | null {
  const v = custom[BUILDER_SLICE];
  return isSlice(v) ? v : null;
}
