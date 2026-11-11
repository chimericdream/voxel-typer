// Fixture: every specifier is inline `type`. check-boundaries treats it as type-only, but TypeScript
// keeps `import {} from "@/ui/hud"` at runtime, so Oxlint makes you write `import type`.
import { type Hud } from "@/ui/hud";
export type H = Hud;
