// Fixture: one inline `type` specifier does not make the declaration type-only; `makeHud` is a value.
import { type Hud, makeHud } from "@/ui/hud";
export const x: Hud = makeHud();
