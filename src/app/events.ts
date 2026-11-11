/**
 * Game events bus (docs/impl/contracts.md §7.2).
 *
 * Achievements, audio reactions and the HUD subscribe to `engine` events here, so modes don't call
 * them directly.
 */
import type { Rarity } from "@/content/blocks/types";
import type { EngineEvent } from "@/engine/types";
import type { AchievementId, BlockId, QualityLevel } from "@/types/core";

/** A typed publish/subscribe channel. `E` maps each event name to its payload. */
export interface Emitter<E extends Record<string, unknown>> {
  /** Subscribes `fn` to event `k`. Returns the unsubscribe function. */
  on<K extends keyof E>(k: K, fn: (e: E[K]) => void): () => void;
  /** Calls every subscriber of `k`, in subscription order, synchronously. */
  emit<K extends keyof E>(k: K, e: E[K]): void;
}

/** The events of a play session. */
export interface GameEvents {
  /** Modes re-emit every engine event here. */
  engine: EngineEvent;
  loot: { block: BlockId; count: number; rarity: Rarity };
  achievement: { id: AchievementId };
  quality: { level: QualityLevel };
  /** Modes may add namespaced events, e.g. `'defense:wave'`. */
  [k: string]: unknown;
}

/**
 * A listener of any payload type. Written as a method on purpose: method parameters are checked
 * bivariantly, so a `(e: E[K]) => void` fits without a cast. `on` and `emit` keep the pairing of
 * event name and payload type sound.
 */
type AnyListener = { call(e: unknown): void }["call"];

/**
 * Creates an emitter.
 *
 * - Subscribers run in subscription order. Subscribing the same function twice calls it twice.
 * - `emit` works on a snapshot: a subscriber added or removed during an emit takes effect from the
 *   next emit.
 * - The unsubscribe function is idempotent and removes only its own subscription.
 * - A subscriber that throws stops the emit; the error reaches the caller of `emit`.
 */
export function createEmitter<E extends Record<string, unknown>>(): Emitter<E> {
  const subs = new Map<keyof E, { fn: AnyListener }[]>();
  return {
    on(k, fn) {
      const entry: { fn: AnyListener } = { fn };
      subs.set(k, [...(subs.get(k) ?? []), entry]);
      return () => {
        const list = subs.get(k);
        if (!list?.includes(entry)) return;
        const rest = list.filter((s) => s !== entry);
        if (rest.length === 0) subs.delete(k);
        else subs.set(k, rest);
      };
    },
    emit(k, e) {
      // The arrays are never mutated (on/off replace them), so this iterates a snapshot.
      for (const s of subs.get(k) ?? []) s.fn(e);
    },
  };
}
