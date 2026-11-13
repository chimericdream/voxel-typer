/**
 * Blueprint names (task M4-08). A name shows when a stamp is built ("You built a Stone Owl!"), so
 * each one reads after "a". Short, in words a 6-year-old can read. What the child types is the
 * blueprint's `typedName` (`src/content/blueprints/builds.ts`), one lowercase word.
 */
export default {
  well: "Well",
  lanternPost: "Lamp Post",
  garden: "Garden",
  house: "House",
  farm: "Farm",
  bridge: "Bridge",
  tower: "Tower",
  boat: "Boat",
  statue: "Stone Owl",
  castleGate: "Castle Gate",
} as const;
