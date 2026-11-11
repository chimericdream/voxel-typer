// Fixture: relative import that resolves into a forbidden folder (oxlint cannot see this; check-boundaries does).
import { thing } from "../ui/thing";
export const x = thing;
