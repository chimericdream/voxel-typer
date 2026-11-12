/**
 * Placement test mode (task M3-05, PLAN.md §3.2.8): "Find your level". The registry finds this
 * file; the mode's real code loads on first play.
 */
import type { ModeModule } from "../types";

export const mode: ModeModule = {
  id: "placement",
  load: () => import("./placement"),
};
