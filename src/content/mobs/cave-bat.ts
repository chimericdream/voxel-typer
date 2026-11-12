/** Cave Bat: a round grey fluff ball with three rose wings, two at the sides and a tail fan (task M4-03). */
import model from "./cave-bat.model.json";
import type { MobDef } from "./types";

export const caveBat: MobDef = {
  id: "cave-bat",
  nameKey: "mobs.caveBat",
  aboutKey: "mobs.caveBatAbout",
  home: "mines",
  speedClass: "fast",
  flavor: "theme=mines",
  model,
};
