/**
 * Runs voxel models from the render loop (task M4-01) without keeping an idle scene awake.
 *
 * The driver is one loop *system* (`RenderLoop.addSystem`). Each frame it updates the models that
 * are animating and reports busy only while one still is, so:
 *
 * - a playing anim (or a crossfade) keeps the loop drawing;
 * - a stopped model, a finished one-shot anim and, under reduced motion, a looping anim let the
 *   loop go idle;
 * - `play`, `stop` and `setTint` on an added model call `loop.wake()`, so an idle loop restarts.
 *
 * Systems get the real frame time, so models keep moving during a hit-stop. A mode that wants its
 * mobs to freeze on hit-stop can skip the driver and call `update(dt)` from its own `onFrame`.
 */
import type { Ms } from "@/types/core";
import type { RenderLoop } from "../loop";
import type { Animatable } from "./build";

export interface ModelDriver {
  /** Starts driving `model`. Returns a function that stops (and unbinds it). */
  add(model: Animatable): () => void;
  /** Number of models driven. */
  readonly size: number;
  /** Removes the system and unbinds every model. Doesn't dispose the models. */
  dispose(): void;
}

export function createModelDriver(loop: Pick<RenderLoop, "addSystem" | "wake">): ModelDriver {
  const models = new Set<Animatable>();
  const wake = (): void => loop.wake();
  const system = (dtMs: Ms): boolean => {
    let busy = false;
    for (const model of models) {
      if (!model.animating) continue;
      model.update(dtMs);
      if (model.animating) busy = true;
    }
    return busy;
  };
  const removeSystem = loop.addSystem(system);
  const remove = (model: Animatable): void => {
    if (models.delete(model)) model.bindWake(null);
  };
  return {
    add(model) {
      models.add(model);
      model.bindWake(wake);
      if (model.animating) loop.wake();
      return () => remove(model);
    },
    get size() {
      return models.size;
    },
    dispose() {
      removeSystem();
      for (const model of models) remove(model);
    },
  };
}
