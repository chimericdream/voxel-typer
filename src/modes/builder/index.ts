/**
 * Builder mode (task M4-07, PLAN.md §3.2.4): build on the Home Island by typing commands. The
 * registry finds this file; the mode's real code loads on first use.
 */
import type { ModeModule } from "../types";

export const mode: ModeModule = {
  id: "builder",
  load: () => import("./builder"),
};
