/**
 * The ten blueprints (task M4-08, PLAN.md §3.2.4). Pure data; see `types.ts` for how the layers
 * read. Every shape here is our own: no build copies a famous blocky look (CLAUDE.md IP rule). The
 * cottage has clay walls and a plank roof rather than plank walls on log corners, the farm grows
 * wool cabbages in dirt beds with a clay row, and the statue is a stone owl of our own.
 *
 * Rules a test checks for every blueprint:
 * - it fits in the starter plot (24 × 32 × 24) and uses only placeable blocks that the game hands
 *   out (Mine loot or starter terrain);
 * - its cost holds at least one block that only Mine loot gives (decision 99), so a stamp can't be
 *   paid for by digging up starter terrain alone;
 * - `cost` matches its layers;
 * - its name is a short real word that clashes with no Builder word, leaves every Sprout block
 *   code as it was, and sounds safe read aloud (decision 100).
 */
import type { BlueprintDef } from "./types";

/** One letter per block, shared by every blueprint. */
const KEY = {
  c: "cobble",
  s: "stone",
  m: "mossy-cobble",
  p: "oak-planks",
  l: "oak-log",
  e: "oak-leaves",
  d: "dirt",
  k: "clay",
  v: "gravel",
  b: "brick",
  g: "glass",
  L: "lantern",
  o: "copper-ore",
  h: "char-ore",
  r: "red-wool",
  y: "yellow-wool",
  n: "green-wool",
  "1": "red-blooms",
  "2": "sunny-flowers",
  "3": "bluebells",
  "4": "purple-puffs",
} as const;

export const builds: readonly BlueprintDef[] = [
  {
    // A stone ring two high, two log posts and a plank beam across: a little well.
    id: "well",
    typedName: "well",
    nameKey: "blueprints.well",
    key: KEY,
    layers: [
      ["ccc", "c.c", "ccc"],
      ["ccc", "c.c", "ccc"],
      ["...", "l.l", "..."],
      ["...", "l.l", "..."],
      ["...", "ppp", "..."],
    ],
    cost: { cobble: 16, "oak-log": 4, "oak-planks": 3 },
    unlock: { kind: "badge", achievement: "first-lesson" },
  },
  {
    // A lantern on a log post, on a small cobble foot.
    id: "lantern-post",
    typedName: "lamp",
    nameKey: "blueprints.lanternPost",
    key: KEY,
    layers: [
      [".c.", "ccc", ".c."],
      ["...", ".l.", "..."],
      ["...", ".l.", "..."],
      ["...", ".l.", "..."],
      ["...", ".L.", "..."],
    ],
    cost: { cobble: 5, "oak-log": 3, lantern: 1 },
    unlock: { kind: "badge", achievement: "lucky-find" },
  },
  {
    // A plank frame round a dirt bed, with one of each flower.
    id: "garden",
    typedName: "garden",
    nameKey: "blueprints.garden",
    key: KEY,
    layers: [
      ["ppppp", "pdddp", "pdddp", "pdddp", "ppppp"],
      [".....", ".1.2.", ".....", ".3.4.", "....."],
    ],
    cost: {
      "oak-planks": 16,
      dirt: 9,
      "red-blooms": 1,
      "sunny-flowers": 1,
      bluebells: 1,
      "purple-puffs": 1,
    },
    unlock: { kind: "badge", achievement: "flower-friend" },
  },
  {
    // A clay cottage on a cobble floor: glass windows, a door to the south, a stepped plank roof.
    id: "house",
    typedName: "house",
    nameKey: "blueprints.house",
    key: KEY,
    layers: [
      ["ccccc", "ccccc", "ccccc", "ccccc"],
      ["kkkkk", "k...k", "k...k", "kk.kk"],
      ["kgkgk", "g...g", "k...k", "kk.kk"],
      ["ppppp", "ppppp", "ppppp", "ppppp"],
      [".....", ".ppp.", ".ppp.", "....."],
    ],
    cost: { cobble: 20, clay: 22, glass: 4, "oak-planks": 26 },
    unlock: { kind: "biome", biome: "meadow" },
  },
  {
    // Two dirt beds of wool cabbages with a clay row between, a gravel path round, log posts.
    id: "farm",
    typedName: "farm",
    nameKey: "blueprints.farm",
    key: KEY,
    layers: [
      ["vvvvvvv", "vdddddv", "vkkkkkv", "vdddddv", "vvvvvvv"],
      ["l.....l", ".n.n.n.", ".......", ".n.n.n.", "l.....l"],
    ],
    cost: { gravel: 20, dirt: 10, clay: 5, "green-wool": 6, "oak-log": 4 },
    unlock: { kind: "badge", achievement: "collector" },
  },
  {
    // A humped plank bridge with log rails along the top. Its middle stands clear of the ground.
    id: "bridge",
    typedName: "arch",
    nameKey: "blueprints.bridge",
    key: KEY,
    layers: [
      ["p.....p", "p.....p", "p.....p"],
      [".p...p.", ".p...p.", ".p...p."],
      ["..ppp..", "..ppp..", "..ppp.."],
      ["..lll..", ".......", "..lll.."],
    ],
    cost: { "oak-planks": 21, "oak-log": 6 },
    unlock: { kind: "badge", achievement: "ten-trips" },
  },
  {
    // A hollow cobble tower with mossy corners at the foot and the top, a door, glass windows and a toothed top.
    id: "tower",
    typedName: "tower",
    nameKey: "blueprints.tower",
    key: KEY,
    layers: [
      ["mcccm", "c...c", "c...c", "c...c", "mc.cm"],
      ["mcccm", "c...c", "c...c", "c...c", "mc.cm"],
      ["ccccc", "c...c", "c...c", "c...c", "ccccc"],
      ["ccgcc", "c...c", "g...g", "c...c", "ccgcc"],
      ["ccccc", "c...c", "c...c", "c...c", "ccccc"],
      ["m.c.m", ".....", "c...c", ".....", "m.c.m"],
    ],
    cost: { cobble: 70, "mossy-cobble": 12, glass: 4 },
    unlock: { kind: "biome", biome: "birch" },
  },
  {
    // A plank boat with a log mast and a yellow sail.
    id: "boat",
    typedName: "boat",
    nameKey: "blueprints.boat",
    key: KEY,
    layers: [
      [".ppppp.", "ppppppp", ".ppppp."],
      [".ppppp.", "p.....p", ".ppppp."],
      [".......", "...lyy.", "......."],
      [".......", "...lyy.", "......."],
      [".......", "...ly..", "......."],
      [".......", "...l...", "......."],
    ],
    cost: { "oak-planks": 29, "oak-log": 4, "yellow-wool": 5 },
    unlock: { kind: "biome", biome: "shore" },
  },
  {
    // A round stone owl with copper eyes and a char beak, on a cobble plinth. It faces south.
    id: "statue",
    typedName: "statue",
    nameKey: "blueprints.statue",
    key: KEY,
    layers: [
      ["ccc", "ccc", "ccc"],
      ["sss", "sss", "sss"],
      ["sss", "sss", "shs"],
      ["sss", "sss", "oso"],
      ["s.s", "...", "..."],
    ],
    cost: { cobble: 9, stone: 26, "char-ore": 1, "copper-ore": 2 },
    unlock: { kind: "biome", biome: "frosty" },
  },
  {
    // Two cobble towers joined by a brick arch, with a toothed top.
    id: "castle-gate",
    typedName: "gate",
    nameKey: "blueprints.castleGate",
    key: KEY,
    layers: [
      ["cc...cc", "cc...cc"],
      ["cc...cc", "cc...cc"],
      ["cc...cc", "cc...cc"],
      ["ccbbbcc", "ccbbbcc"],
      ["bbbbbbb", "bbbbbbb"],
      ["c.c.c.c", "c.c.c.c"],
    ],
    cost: { cobble: 40, brick: 20 },
    unlock: { kind: "badge", achievement: "hundred-blocks" },
  },
];
