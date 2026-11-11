/**
 * Content generation: turns allowed keys, weights and word pools into targets
 * (docs/impl/contracts.md §5). Pure.
 *
 * Stubs only; M1-06 implements them.
 */
import type { AgeBand } from "@/types/core";
import type { Rng } from "./rng";
import type { Target } from "./types";

/** What a lesson asks the learner to type. */
export type ContentKind = "letters" | "syllables" | "words" | "phrases" | "sentences";

/** A named list of words, phrases or sentences. Built from `src/content/wordlists/`. */
export interface WordPool {
  id: string;
  band: AgeBand | "all";
  tags: string[];
  items: readonly string[];
}

/** Input of {@link generateTargets}. */
export interface GenerateParams {
  kind: ContentKind;
  /** The generator NEVER emits a char outside `allowed ∪ {' '}`. */
  allowed: readonly string[];
  /** From `keyWeights` (contracts §4). */
  weights: Record<string, number>;
  /** Already filtered to the band. */
  pools: readonly WordPool[];
  /**
   * How much to generate. `{ seconds, estWpm }` converts to chars as
   * `seconds / 60 * estWpm * 5 * 1.3`: 30% headroom, so the learner never runs out.
   */
  length: { chars: number } | { targets: number } | { seconds: number; estWpm: number };
  /** Per target. */
  minLen?: number;
  /** Per target. */
  maxLen?: number;
  capitalize?: "none" | "first" | "mixed";
}

/**
 * Generates the targets of a session. The same params and the same seed give the same output.
 *
 * - `letters`: single chars, weighted by `weights`, no char more than 3 times in a row. The targets
 *   have `trailingSpace: false`.
 * - `syllables`: 2–3-char pseudo-syllables from the allowed chars, consonant–vowel aware when
 *   vowels exist. For early home-row lessons (`a` is the only vowel) it uses patterns like `aa`,
 *   `as`, `sad`, `fa`.
 * - `words` / `phrases` / `sentences`: picks pool items for which `typeable(item, allowed)` holds,
 *   weighted by the sum of their chars' weights. It enforces the comfort cap (§4) by rejection
 *   sampling, with a fallback that relaxes the cap after 200 tries. It never relaxes the allowed
 *   set.
 * - If no pool item is typeable, it falls back to `syllables` and changes nothing else: the caller
 *   just sees fewer word-like targets. The curriculum validator (M3-01) makes sure this never
 *   happens for a shipped lesson.
 */
export function generateTargets(p: GenerateParams, rng: Rng): Target[] {
  void [p, rng];
  throw new Error("not implemented: generateTargets");
}

/** True when `text` can be typed with the `allowed` chars alone. */
export function typeable(text: string, allowed: ReadonlySet<string>): boolean {
  void [text, allowed];
  throw new Error("not implemented: typeable");
}
