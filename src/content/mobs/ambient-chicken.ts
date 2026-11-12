/**
 * Meadow Hen: a plump russet hen with a cream head and a bluebell crest (task M4-03). It only
 * decorates the Meadow: it carries no word and nothing happens to it. Anims: `idle`, `walk`, `peck`.
 */
import model from "./ambient-chicken.model.json";
import type { AmbientDef } from "./types";

export const ambientChicken: AmbientDef = {
  id: "ambient-chicken",
  nameKey: "mobs.meadowHen",
  home: "meadow",
  model,
};
