/** Lantern Fish: a plum fish that swims through the air and carries a glowing lantern (task M4-03). */
import model from "./lantern-fish.model.json";
import type { MobDef } from "./types";

export const lanternFish: MobDef = {
  id: "lantern-fish",
  nameKey: "mobs.lanternFish",
  aboutKey: "mobs.lanternFishAbout",
  home: "marsh",
  speedClass: "medium",
  flavor: "theme=marsh",
  model,
};
