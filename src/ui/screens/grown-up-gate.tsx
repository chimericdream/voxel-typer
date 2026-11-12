/**
 * The grown-up check for profile changes (task M3-09). Every gated action asks through
 * `useGrownUpGate().requireGrownUp(action)`, which resolves true when a grown-up passed the gate.
 * While it waits, the hook's `view` is the gate; the caller shows it in place of its own content
 * (inside its dialog, so focus stays trapped there).
 *
 * Since M3-08 this is the real parent gate (`src/ui/components/ParentGate.tsx`): type a shown word,
 * 3 tries, then a 30 s rest. The hook's shape is unchanged, so callers didn't change.
 */
export { useParentGate as useGrownUpGate } from "@/ui/components/ParentGate";
export type { GrownUpAction, GrownUpGate } from "@/ui/components/ParentGate";
