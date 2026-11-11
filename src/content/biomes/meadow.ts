/**
 * The Meadow biome. Pure data.
 *
 * Environment part (task M2-02): warm, hazy days and a cool blue night that stays well clear of
 * black, so the HUD's text plates read over it. The day light values are the ones M2-01 tuned.
 */
import type { DioramaRecipe } from "@/content/worldgen/diorama";
import type { BiomeEnv } from "./env";

export const MEADOW_ENV: BiomeEnv = {
  biome: "meadow",
  times: {
    dawn: {
      sky: { zenith: "#7388c6", horizon: "#f3bc93", ground: "#c4b4c4" },
      fogDensity: 0.0042,
      sun: { color: "#ffc79c", intensity: 2.0 },
      hemi: { sky: "#f1d6c8", ground: "#8f7c6a", intensity: 1.0 },
      clouds: { color: "#ffe0cc", opacity: 1 },
      sunDisc: { color: "#ffd27a", opacity: 1 },
      moonDisc: { color: "#e8ecff", opacity: 0.45 },
    },
    day: {
      sky: { zenith: "#4f92d6", horizon: "#b6dbef", ground: "#9cc6e4" },
      fogDensity: 0.0035,
      sun: { color: "#fff4e0", intensity: 2.6 },
      hemi: { sky: "#dcefff", ground: "#b8a888", intensity: 1.0 },
      clouds: { color: "#ffffff", opacity: 1 },
      sunDisc: { color: "#fff1a8", opacity: 1 },
      moonDisc: { color: "#e8ecff", opacity: 0 },
    },
    dusk: {
      sky: { zenith: "#5c5ea2", horizon: "#ef9c70", ground: "#a98a9c" },
      fogDensity: 0.0042,
      sun: { color: "#ffae7a", intensity: 1.8 },
      hemi: { sky: "#dcaaa8", ground: "#7d6662", intensity: 1.0 },
      clouds: { color: "#f7c4b0", opacity: 1 },
      sunDisc: { color: "#ffb35e", opacity: 1 },
      moonDisc: { color: "#e8ecff", opacity: 0.35 },
    },
    night: {
      sky: { zenith: "#22306a", horizon: "#46588f", ground: "#36447a" },
      fogDensity: 0.0045,
      sun: { color: "#a6b8ff", intensity: 1.0 },
      hemi: { sky: "#7487c4", ground: "#3e4466", intensity: 1.15 },
      clouds: { color: "#7480aa", opacity: 1 },
      sunDisc: { color: "#fff1a8", opacity: 0 },
      moonDisc: { color: "#eef1ff", opacity: 1 },
    },
  },
  particle: { kind: "pollen", color: "#fff2a6", density: 3 },
};

// ---------------------------------------------------------------------------------------------
// Worldgen part (task M2-03). The environment part above (MEADOW_ENV) belongs to M2-02.
// ---------------------------------------------------------------------------------------------

/**
 * Gentle rolling grass with a hill rising behind, a shallow pond, oak trees, flower patches,
 * mossy rocks, a short fence and a dirt path leading from the stage into the meadow.
 */
export const MEADOW_WORLDGEN: DioramaRecipe = {
  biome: "meadow",
  blocks: {
    top: "grass",
    sub: "dirt",
    deep: "stone",
    shore: "sand",
    bed: "sand",
    water: "water",
    path: "coarse-dirt",
    log: "oak-log",
    leaves: "oak-leaves",
    post: "oak-log",
    rail: "oak-planks",
    rock: "cobble",
    mossyRock: "mossy-cobble",
    flowers: ["red-blooms", "sunny-flowers", "bluebells", "purple-puffs"],
  },
  terrain: {
    base: 7,
    amplitude: 3,
    scale: 18,
    octaves: 2,
    terraceStep: 2,
    backRise: 4,
    subDepth: 3,
  },
  pond: { rx: [5, 7], rz: [4, 5] },
  scatter: { spacing: 4.5, maxTrees: 11, maxRocks: 7, maxFlowers: 22 },
  fence: { length: [7, 10] },
};
