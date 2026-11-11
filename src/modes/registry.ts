/**
 * Mode registry (docs/impl/contracts.md §0, §7.3).
 *
 * Modes are discovered, not listed: a worker adds `src/modes/<mode>/index.ts` exporting
 * `mode: ModeModule` and never edits this file.
 *
 * Fallback rule: {@link resolveMode} returns the `mine` module for a mode whose folder doesn't
 * exist yet, and logs that once per mode in dev. So lesson data can name its final mode before the
 * mode exists.
 */
import type { GameModeId } from "@/types/core";
import type { ModeModule } from "./types";

/** Every mode id. The `satisfies` makes the compiler complain when `GameModeId` gains a member. */
const MODE_IDS = {
  mine: true,
  defense: true,
  minecart: true,
  builder: true,
  boss: true,
  daily: true,
  practice: true,
  placement: true,
} as const satisfies Record<GameModeId, true>;

const FALLBACK: GameModeId = "mine";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isGameModeId = (v: unknown): v is GameModeId =>
  typeof v === "string" && Object.hasOwn(MODE_IDS, v);

function isModeModule(v: unknown): v is ModeModule {
  return isRecord(v) && isGameModeId(v["id"]) && typeof v["load"] === "function";
}

export interface ModeRegistry {
  /** The module of mode `id`, or the `mine` module if that mode doesn't exist yet. */
  resolveMode(id: GameModeId): ModeModule;
  /** True when the mode itself exists (no fallback). */
  has(id: GameModeId): boolean;
}

export interface ModeRegistryOptions {
  /** Log each fallback once. Default: `import.meta.env.DEV`. */
  dev?: boolean;
  /** Where the dev log goes. Default: `console.warn`. */
  warn?: (message: string) => void;
}

/**
 * Builds a registry from discovered mode files.
 *
 * `discovered` is the result of an eager `import.meta.glob`: `{ "./mine/index.ts": module, … }`.
 * It is a parameter so tests can pass a fake glob. Each module must export `mode: ModeModule`; the
 * mode's id is `mode.id`, not the folder name. Throws when a file has no valid `mode` export or
 * when two files claim the same id.
 */
export function createModeRegistry(
  discovered: Readonly<Record<string, unknown>>,
  options: ModeRegistryOptions = {},
): ModeRegistry {
  const dev = options.dev ?? import.meta.env.DEV;
  const warn = options.warn ?? ((message: string) => console.warn(message));

  const modes = new Map<GameModeId, ModeModule>();
  const foundIn = new Map<GameModeId, string>();
  for (const path of Object.keys(discovered).toSorted()) {
    const file = discovered[path];
    const mode = isRecord(file) ? file["mode"] : undefined;
    if (!isModeModule(mode)) {
      throw new Error(`modes: ${path} must export "mode", a ModeModule with a known id and load()`);
    }
    const first = foundIn.get(mode.id);
    if (first !== undefined) {
      throw new Error(`modes: "${mode.id}" is defined twice, in ${first} and ${path}`);
    }
    modes.set(mode.id, mode);
    foundIn.set(mode.id, path);
  }

  const warned = new Set<GameModeId>();
  return {
    has: (id) => modes.has(id),
    resolveMode(id) {
      const found = modes.get(id);
      if (found) return found;
      const fallback = modes.get(FALLBACK);
      if (!fallback) {
        throw new Error(`modes: no "${id}" mode and no "${FALLBACK}" mode to fall back to`);
      }
      if (dev && !warned.has(id)) {
        warned.add(id);
        warn(`modes: "${id}" doesn't exist yet; using "${FALLBACK}" instead`);
      }
      return fallback;
    },
  };
}

const registry = createModeRegistry(import.meta.glob("./*/index.ts", { eager: true }));

/**
 * The module of mode `id`. If that mode's folder doesn't exist yet, this returns the `mine` module
 * and logs once in dev (contracts §7.3).
 */
export function resolveMode(id: GameModeId): ModeModule {
  return registry.resolveMode(id);
}
