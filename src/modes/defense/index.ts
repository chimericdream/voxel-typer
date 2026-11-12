/**
 * Night Defense (task M4-04, PLAN.md §3.2.2): friendly visitors walk down lanes toward the camp,
 * each carrying a word; typing the word sends its visitor home. The registry finds this file; the
 * mode's real code loads on first play.
 */
import type { ModeModule } from "../types";

export const mode: ModeModule = {
  id: "defense",
  load: () => import("./defense"),
};
