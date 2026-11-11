/**
 * Keyboard layout lookups (docs/impl/contracts.md §16). Pure.
 *
 * Stubs only; M1-11 implements them and adds the layout JSON.
 */
import type { Finger } from "@/types/core";
import type { LayoutDef } from "./types";

/** The finger that types `char` on this layout, or `null` if the layout can't type it. */
export function fingerFor(layout: LayoutDef, char: string): Finger | null {
  void [layout, char];
  throw new Error("not implemented: fingerFor");
}

/** The key that types `char` and whether it needs Shift, or `null` if the layout can't type it. */
export function codeFor(layout: LayoutDef, char: string): { code: string; shift: boolean } | null {
  void [layout, char];
  throw new Error("not implemented: codeFor");
}

export * from "./types";
