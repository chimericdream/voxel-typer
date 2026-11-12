/** Frost Pup: a chubby ice-blue puppy with a white muzzle and a snowball tail (task M4-03). */
import model from "./frost-pup.model.json";
import type { MobDef } from "./types";

export const frostPup: MobDef = {
  id: "frost-pup",
  nameKey: "mobs.frostPup",
  aboutKey: "mobs.frostPupAbout",
  home: "frosty",
  speedClass: "medium",
  flavor: "theme=snow",
  model,
};
