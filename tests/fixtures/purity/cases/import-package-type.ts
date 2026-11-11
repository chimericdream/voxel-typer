// Fixture: even a type-only import of a package not on PURE_PACKAGES fails.
import type { ZodType } from "zod";
export type X = ZodType;
