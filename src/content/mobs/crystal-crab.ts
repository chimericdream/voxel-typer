/** Crystal Crab: a clay-coloured crab with purple crystals growing on its shell (task M4-03). */
import model from "./crystal-crab.model.json";
import type { MobDef } from "./types";

export const crystalCrab: MobDef = {
  id: "crystal-crab",
  nameKey: "mobs.crystalCrab",
  aboutKey: "mobs.crystalCrabAbout",
  home: "caverns",
  speedClass: "slow",
  flavor: "theme=caverns",
  model,
};
