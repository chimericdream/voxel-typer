/**
 * Input routing (task M2-10, docs/impl/contracts.md §9).
 *
 * One window-level keyboard listener feeds this router. `typed` keys reach the mode only during
 * live play; in menus, keys go to the current screen's handler, and an unhandled `back` goes back.
 *
 * Pause comes from Escape in play and from every window blur or hide, also while already paused or
 * in a menu, so pause handling is idempotent. While paused, the shell is in "menu" key mode:
 * Escape (`back`) or Enter (`confirm`) resumes. Enter on a focused button is left to the button's
 * own click, so it isn't handled twice.
 */
import type { ControlInput, InputCtx, TypedInput } from "@/input/keyboard";
import type { AgeBand } from "@/types/core";
import type { PlayHost } from "./play-host";

export interface InputRouterDeps {
  /** True while the `play` route is shown. */
  onPlayRoute(): boolean;
  play: Pick<PlayHost, "status" | "input" | "pause" | "resume" | "hearAgain" | "modeId">;
  /** The current screen's handler. Returns true when it used the input. */
  menu(i: TypedInput | ControlInput): boolean;
  back(): void;
  /** True when keyboard focus sits on a button, link or field (Enter belongs to it). */
  focusOnControl(): boolean;
  /** The active profile's band, if any. */
  band(): AgeBand | null;
}

export interface InputRouter {
  handle(i: TypedInput | ControlInput): void;
  /** For `attachKeyboard`'s `getCtx`. Cheap: it runs on every keydown. */
  ctx(): InputCtx;
}

export function createInputRouter(deps: InputRouterDeps): InputRouter {
  const live = (): boolean => deps.onPlayRoute() && deps.play.status() === "running";

  return {
    ctx() {
      const band = deps.band();
      const ctx: InputCtx = { inPlay: live() };
      if (band !== null) ctx.band = band;
      if (ctx.inPlay && deps.play.modeId() === "builder") ctx.undo = true;
      return ctx;
    },

    handle(i) {
      if (deps.onPlayRoute()) {
        const status = deps.play.status();
        if (status === "running") {
          if (i.kind === "typed") deps.play.input(i.input);
          else if (i.action === "pause") deps.play.pause(i.t);
          else if (i.action === "hearAgain") deps.play.hearAgain(i.t);
          return;
        }
        if (status === "paused" || status === "break") {
          if (i.kind !== "control") return;
          if (i.action === "back") deps.play.resume(i.t);
          else if (i.action === "confirm" && !deps.focusOnControl()) deps.play.resume(i.t);
          return;
        }
        // Loading, failed or finished: the panel on screen works like a menu.
        if (i.kind === "control" && i.action === "pause") return;
        if (!deps.menu(i) && i.kind === "control" && i.action === "back") deps.back();
        return;
      }
      // Menus. A blur or hide in a menu has nothing to pause.
      if (i.kind === "control" && i.action === "pause") return;
      if (deps.menu(i)) return;
      if (i.kind === "control" && i.action === "back") deps.back();
    },
  };
}
