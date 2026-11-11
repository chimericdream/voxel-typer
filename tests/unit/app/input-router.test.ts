/**
 * Acceptance (M2-10): input routing sends `typed` to the mode only in `play`, and controls to menus
 * otherwise.
 */
import { describe, expect, it, vi } from "vitest";
import { createInputRouter } from "../../../src/app/input-router";
import type { InputRouterDeps } from "../../../src/app/input-router";
import type { PlayStatus } from "../../../src/app/play-host";
import type { ControlInput, TypedInput } from "../../../src/input/keyboard";
import type { GameModeId } from "../../../src/types/core";
import { key } from "./helpers";

const typed = (k: string): TypedInput => ({ kind: "typed", input: key(k) });
const control = (action: ControlInput["action"], t = 5): ControlInput => ({
  kind: "control",
  action,
  t,
});

function setup(opts: { onPlay: boolean; status: PlayStatus; mode?: GameModeId; focus?: boolean }) {
  const state = { ...opts };
  const play = {
    status: () => state.status,
    modeId: () => state.mode ?? "mine",
    input: vi.fn(),
    pause: vi.fn(() => {
      state.status = "paused";
    }),
    resume: vi.fn(() => {
      state.status = "running";
    }),
    hearAgain: vi.fn(),
  };
  const menu = vi.fn((_i: TypedInput | ControlInput) => false);
  const back = vi.fn();
  const deps: InputRouterDeps = {
    onPlayRoute: () => state.onPlay,
    play,
    menu,
    back,
    focusOnControl: () => state.focus === true,
    band: () => "sprout",
  };
  return { router: createInputRouter(deps), play, menu, back, state };
}

describe("input routing", () => {
  it("typed keys reach the mode during live play, and never a menu", () => {
    const s = setup({ onPlay: true, status: "running" });
    s.router.handle(typed("f"));
    expect(s.play.input).toHaveBeenCalledWith(key("f"));
    expect(s.menu).not.toHaveBeenCalled();
  });

  it("typed keys in a menu go to the screen, never to the mode", () => {
    const s = setup({ onPlay: false, status: "running" });
    s.router.handle(typed("f"));
    expect(s.menu).toHaveBeenCalledWith(typed("f"));
    expect(s.play.input).not.toHaveBeenCalled();
  });

  it.each(["confirm", "next", "prev", "up", "down", "left", "right"] as const)(
    "control %s goes to the menu outside play",
    (action) => {
      const s = setup({ onPlay: false, status: "idle" });
      s.router.handle(control(action));
      expect(s.menu).toHaveBeenCalledWith(control(action));
      expect(s.back).not.toHaveBeenCalled();
    },
  );

  it("an unhandled back in a menu goes back; a handled one doesn't", () => {
    const s = setup({ onPlay: false, status: "idle" });
    s.router.handle(control("back"));
    expect(s.back).toHaveBeenCalledTimes(1);
    s.menu.mockReturnValueOnce(true);
    s.router.handle(control("back"));
    expect(s.back).toHaveBeenCalledTimes(1);
  });

  it("a blur or hide in a menu pauses nothing", () => {
    const s = setup({ onPlay: false, status: "idle" });
    s.router.handle(control("pause"));
    expect(s.play.pause).not.toHaveBeenCalled();
    expect(s.menu).not.toHaveBeenCalled();
  });

  it("pause is idempotent: repeated blur/hide events pause once", () => {
    const s = setup({ onPlay: true, status: "running" });
    s.router.handle(control("pause", 1));
    s.router.handle(control("pause", 2));
    s.router.handle(control("pause", 3));
    expect(s.play.pause).toHaveBeenCalledTimes(1);
    expect(s.play.resume).not.toHaveBeenCalled();
  });

  it("while paused, typed keys are dropped and Escape (back) resumes", () => {
    const s = setup({ onPlay: true, status: "paused" });
    s.router.handle(typed("f"));
    expect(s.play.input).not.toHaveBeenCalled();
    s.router.handle(control("back", 9));
    expect(s.play.resume).toHaveBeenCalledWith(9);
    expect(s.back).not.toHaveBeenCalled();
  });

  it("while paused, Enter resumes, unless a focused button will take it", () => {
    const s = setup({ onPlay: true, status: "paused", focus: true });
    s.router.handle(control("confirm"));
    expect(s.play.resume).not.toHaveBeenCalled();
    s.state.focus = false;
    s.router.handle(control("confirm"));
    expect(s.play.resume).toHaveBeenCalledTimes(1);
  });

  it("the break overlay resumes the same way", () => {
    const s = setup({ onPlay: true, status: "break" });
    s.router.handle(control("back"));
    expect(s.play.resume).toHaveBeenCalledTimes(1);
  });

  it("hearAgain during play goes to the play host", () => {
    const s = setup({ onPlay: true, status: "running" });
    s.router.handle(control("hearAgain", 4));
    expect(s.play.hearAgain).toHaveBeenCalledWith(4);
  });

  it("while the lesson loads, keys don't reach the mode and back leaves", () => {
    const s = setup({ onPlay: true, status: "loading" });
    s.router.handle(typed("f"));
    s.router.handle(control("pause"));
    expect(s.play.input).not.toHaveBeenCalled();
    expect(s.play.pause).not.toHaveBeenCalled();
    s.router.handle(control("back"));
    expect(s.back).toHaveBeenCalledTimes(1);
  });

  describe("ctx", () => {
    it("is in play only during live play", () => {
      expect(setup({ onPlay: true, status: "running" }).router.ctx().inPlay).toBe(true);
      expect(setup({ onPlay: true, status: "paused" }).router.ctx().inPlay).toBe(false);
      expect(setup({ onPlay: false, status: "running" }).router.ctx().inPlay).toBe(false);
    });

    it("passes the band, and undo only while Builder runs", () => {
      expect(setup({ onPlay: true, status: "running" }).router.ctx()).toEqual({
        inPlay: true,
        band: "sprout",
      });
      expect(
        setup({ onPlay: true, status: "running", mode: "builder" }).router.ctx(),
      ).toMatchObject({ undo: true });
      expect(
        setup({ onPlay: false, status: "idle", mode: "builder" }).router.ctx().undo,
      ).toBeUndefined();
    });
  });
});
