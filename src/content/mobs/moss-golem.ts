/** Moss Golem: a squat mossy boulder with a grass cap, stubby arms and a flower (task M4-03). */
import model from "./moss-golem.model.json";
import type { MobDef } from "./types";

export const mossGolem: MobDef = {
  id: "moss-golem",
  nameKey: "mobs.mossGolem",
  aboutKey: "mobs.mossGolemAbout",
  home: "birch",
  speedClass: "slow",
  flavor: "theme=forest",
  model,
};
