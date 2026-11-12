/** Sandstorm Imp: a little whirl of sand with a big friendly head and floating mitts (task M4-03). */
import model from "./sandstorm-imp.model.json";
import type { MobDef } from "./types";

export const sandstormImp: MobDef = {
  id: "sandstorm-imp",
  nameKey: "mobs.sandstormImp",
  aboutKey: "mobs.sandstormImpAbout",
  home: "shore",
  speedClass: "fast",
  flavor: "theme=nature",
  model,
};
