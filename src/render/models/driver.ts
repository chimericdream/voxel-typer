/**
 * Runs voxel models from the render loop (task M4-01) without keeping an idle scene awake.
 *
 * The driver is one loop *system* (`RenderLoop.addSystem`). Each frame it updates the models that
 * are animating and reports busy only while one still is, so:
 *
 * - a playing anim (or a crossfade) keeps the loop drawing;
 * - a stopped model, a finished one-shot anim and, under reduced motion, a looping anim let the
 *   loop go idle;
 * - `play`, `stop` and `setTint` on an added model call `loop.wake()`, so an idle loop restarts;
 * - a model drops out of the driver as soon as it is disposed, so per-wave mobs don't pile up.
 *
 * Systems get the real frame time, so models keep moving during a hit-stop. A mode that wants its
 * mobs to freeze on hit-stop can skip the driver and call `update(dt)` from its own `onFrame`.
 */
import type { Ms } from "@/types/core";
import type { RenderLoop } from "../loop";
import type { Animatable, DriverLink } from "./build";

export interface ModelDriver {
  /** Starts driving `model`. Returns a function that stops (and unbinds it). */
  add(model: Animatable): () => void;
  /** Number of models driven. */
  readonly size: number;
  /** Removes the system and unbinds every model. Doesn't dispose the models. */
  dispose(): void;
}

export function createModelDriver(loop: Pick<RenderLoop, "addSystem" | "wake">): ModelDriver {
  const models = new Map<Animatable, DriverLink>();
  const system = (dtMs: Ms): boolean => {
    let busy = false;
    for (const model of models.keys()) {
      if (!model.animating) continue;
      model.update(dtMs);
      if (model.animating) busy = true;
    }
    return busy;
  };
  const removeSystem = loop.addSystem(system);
  const remove = (model: Animatable): void => {
    if (models.delete(model)) model.bindDriver(null);
  };
  return {
    add(model) {
      if (!models.has(model)) {
        const link: DriverLink = {
          wake: () => loop.wake(),
          disposed: () => {
            models.delete(model);
          },
        };
        models.set(model, link);
        model.bindDriver(link);
      }
      if (model.animating) loop.wake();
      return () => remove(model);
    },
    get size() {
      return models.size;
    },
    dispose() {
      removeSystem();
      for (const model of models.keys()) remove(model);
    },
  };
}
