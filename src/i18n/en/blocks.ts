/**
 * Block display names (docs/impl/contracts.md §11, §17). M2-04 owns this namespace.
 *
 * Short, and readable by a 6-year-old. Every name is original (CLAUDE.md, IP rule).
 */
export default {
  // terrain
  grass: "Grass",
  dirt: "Dirt",
  coarseDirt: "Rocky Dirt",
  sand: "Sand",
  gravel: "Gravel",
  clay: "Clay",
  water: "Water",
  // wood
  oakLog: "Oak Log",
  oakPlanks: "Oak Planks",
  oakLeaves: "Oak Leaves",
  birchLog: "Birch Log",
  // stone and building
  stone: "Stone",
  cobble: "Cobble",
  mossyCobble: "Mossy Cobble",
  brick: "Brick",
  glass: "Glass",
  // ores and light
  copperOre: "Copper Rock",
  charOre: "Char Rock",
  meadowstone: "Meadowstone",
  lantern: "Lantern",
  // flowers
  redBlooms: "Red Blooms",
  sunnyFlowers: "Sunny Flowers",
  bluebells: "Bluebells",
  purplePuffs: "Purple Puffs",
  // wool
  redWool: "Red Wool",
  yellowWool: "Yellow Wool",
  greenWool: "Green Wool",
  blueWool: "Blue Wool",
} as const;
