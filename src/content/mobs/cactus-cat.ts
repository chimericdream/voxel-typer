/** Cactus Cat: a green cat sitting like a loaf, with a prickle ridge and a flowering tail (task M4-03). */
import model from "./cactus-cat.model.json";
import type { MobDef } from "./types";

export const cactusCat: MobDef = {
  id: "cactus-cat",
  nameKey: "mobs.cactusCat",
  aboutKey: "mobs.cactusCatAbout",
  home: "shore",
  speedClass: "medium",
  flavor: "theme=shore",
  model,
};
