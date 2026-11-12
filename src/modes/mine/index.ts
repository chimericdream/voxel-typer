/**
 * Mine mode (task M2-13, PLAN.md §3.2.1): type the letter or word on the floating block to chip
 * and break it. The registry finds this file; the mode's real code loads on first play.
 */
import type { ModeModule } from "../types";

export const mode: ModeModule = {
  id: "mine",
  load: () => import("./mine"),
};
