/**
 * i18n (docs/impl/contracts.md §11). All kid-facing text goes through {@link t}.
 *
 * Plurals use a minimal ICU subset, implemented in-house (no dependency):
 * `{count, plural, one {# block} other {# blocks}}`. A unit test fails on missing or unused keys.
 *
 * Stubs only; M1-12 implements them.
 */
import type en from "./en";

/** A namespace: the name of a file in `src/i18n/en/`. */
export type Namespace = keyof typeof en;

/**
 * `"<namespace>.<key>"`, e.g. `"common.appName"`. Only the namespace is checked by the type system;
 * a test checks the exact keys.
 */
export type MessageKey = `${Namespace}.${string}`;

/** The text for `key` in the current locale, with `{name}` params filled in. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  void [key, params];
  throw new Error("not implemented: t");
}

/** Switches the locale. `en-XA` is the pseudo-locale (M6). */
export function setLocale(id: "en" | "en-XA"): void {
  void id;
  throw new Error("not implemented: setLocale");
}
