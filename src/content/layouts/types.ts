/**
 * Keyboard layouts (docs/impl/contracts.md §16). Pure. The data is `./<id>.json`.
 */
import type { Finger } from "@/types/core";

/** A physical keyboard layout: which char each key types and which finger presses it. */
export interface LayoutDef {
  /** For example `'en-US'`. */
  id: string;
  /** For example `'US QWERTY'`. */
  name: string;
  rows: {
    keys: {
      /** `KeyboardEvent.code`, e.g. `'KeyF'`. */
      code: string;
      /** The char typed without Shift. */
      base: string;
      /** The char typed with Shift. */
      shift?: string;
      finger: Finger;
      /** Left edge, in key units. */
      x: number;
      /** Width in key units. Default 1. */
      w?: number;
    }[];
  }[];
  /** The home keys with bumps: `KeyF`, `KeyJ`. */
  homeCodes: string[];
}
