/**
 * i18n (docs/impl/contracts.md §11). All kid-facing text goes through {@link t}.
 *
 * Plurals use a minimal ICU subset, implemented in-house (no dependency):
 * `{count, plural, one {# block} other {# blocks}}`. The syntax is documented in `./format.ts`.
 * `tools/i18n-keys.ts` finds missing and unused keys, and a unit test runs it.
 */
import en from "./en";
import { formatMessage } from "./format";

/** A namespace: the name of a file in `src/i18n/en/`. */
export type Namespace = keyof typeof en;

/**
 * `"<namespace>.<key>"`, e.g. `"common.appName"`. Only the namespace is checked by the type system;
 * a test checks the exact keys.
 */
export type MessageKey = `${Namespace}.${string}`;

type LocaleId = "en" | "en-XA";

/**
 * String tables by locale. A locale without a table, or a key missing from its table, falls back to
 * English. `en-XA` (the pseudo-locale) has no table until M6 builds it, so it shows English for now.
 */
const tables: Partial<Record<LocaleId, unknown>> = { en };

let current: LocaleId = "en";
const warned = new Set<string>();

/** Follows the dotted `path` through nested string tables. Undefined unless it ends on a string. */
function lookup(table: unknown, path: readonly string[]): string | undefined {
  let node: unknown = table;
  for (const segment of path) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, segment)) {
      return undefined;
    }
    node = Reflect.get(node, segment);
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * The text for `key` in the current locale, with `{name}` params filled in.
 *
 * A key with no English text is a bug. In dev builds `t` returns `⟦key⟧` so it stands out on screen,
 * and warns once per key. In production it returns the key's last segment (`"menu.play"` → `"play"`),
 * which is better than nothing in front of a child.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const path = key.split(".");
  const pattern = lookup(tables[current], path) ?? lookup(en, path);
  if (pattern !== undefined) return formatMessage(pattern, params);
  if (import.meta.env.DEV) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`i18n: no text for "${key}". Add it to src/i18n/en/.`);
    }
    return `⟦${key}⟧`;
  }
  return path.at(-1) ?? key;
}

/** The current locale, for `Intl` formatting next to `t()` text (M3-FIX-9, review N5). */
export function locale(): LocaleId {
  return current;
}

/** Switches the locale. `en-XA` is the pseudo-locale (M6). */
export function setLocale(id: LocaleId): void {
  current = id;
}
