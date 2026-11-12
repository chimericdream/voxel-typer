/** Slimeling: a berry-pink jelly dollop in three tiers with a leaf on top (task M4-03). */
import model from "./slimeling.model.json";
import type { MobDef } from "./types";

export const slimeling: MobDef = {
  id: "slimeling",
  nameKey: "mobs.slimeling",
  aboutKey: "mobs.slimelingAbout",
  home: "meadow",
  speedClass: "slow",
  flavor: "theme=food",
  model,
};
