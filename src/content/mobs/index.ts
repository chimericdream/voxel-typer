/**
 * The mob roster (task M4-03). Pure data; plain imports, so tools can load it under tsx too.
 *
 * To add a mob: write `<id>.model.json` and `<id>.ts` in this folder, add the id to `MobId` in
 * `./types`, and append ONE import and ONE entry to `MOBS` here.
 */
import { BIOME_ORDER } from "@/types/core";
import type { BiomeId } from "@/types/core";
import { slimeling } from "./slimeling";
import { mossGolem } from "./moss-golem";
import { caveBat } from "./cave-bat";
import { frostPup } from "./frost-pup";
import { cactusCat } from "./cactus-cat";
import { lanternFish } from "./lantern-fish";
import { crystalCrab } from "./crystal-crab";
import { sandstormImp } from "./sandstorm-imp";
import type { MobDef } from "./types";

export { ambientChicken } from "./ambient-chicken";
export type { AmbientDef, MobDef, MobId } from "./types";

/** Every mob, in the order their home biomes come up. */
export const MOBS: readonly MobDef[] = [
  slimeling,
  mossGolem,
  cactusCat,
  sandstormImp,
  frostPup,
  caveBat,
  lanternFish,
  crystalCrab,
];

/** The mob with this id, or `undefined`. */
export function mobById(id: string): MobDef | undefined {
  return MOBS.find((m) => m.id === id);
}

/** The mobs that live in `biome`. Empty for a biome with no mob of its own yet. */
export function mobsOf(biome: BiomeId): MobDef[] {
  return MOBS.filter((m) => m.home === biome);
}

/**
 * The mobs a night in `biome` may send: the ones that live there, plus every mob from the biomes
 * before it (friends the learner has already met). Never empty, because the Meadow has a mob.
 */
export function rosterFor(biome: BiomeId): MobDef[] {
  const upTo = BIOME_ORDER.indexOf(biome);
  return MOBS.filter((m) => BIOME_ORDER.indexOf(m.home) <= upTo);
}
