/**
 * `window.__vt` test hooks (docs/impl/contracts.md §13).
 *
 * They exist in dev and test builds only (`import.meta.env.MODE !== 'production'`); the production
 * build must not contain them. E2E tests wait on `__vt.ready()` instead of sleeping.
 *
 * Type only here; M2-10 installs the hooks.
 */
import type { SessionView } from "@/engine/types";
import type { ModeResult } from "@/modes/types";
import type { Profile } from "@/save/schema";

/** What e2e tests can read from a running game. */
export interface VtTestHooks {
  /** The current route id. */
  screen(): string;
  session(): SessionView | null;
  lastResult(): ModeResult | null;
  profile(): Profile | null;
  /** Rolling average. */
  fps(): number;
  /** Resolves when the current screen has finished loading its assets. */
  ready(): Promise<void>;
}
