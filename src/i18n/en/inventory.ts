/**
 * My Blocks, the inventory screen (task M4-09, PLAN.md §3.3). Every band sees it, so each line
 * uses words a 6-year-old can read: warm, short and concrete, and nothing about speed or losing
 * (docs/impl/README.md §4.4). A block that is all on the island is never "gone" or "lost".
 */
export default {
  title: "My Blocks",
  // "12 of 28 blocks found". The total counts only blocks a lesson can give.
  count: "{found} of {total, plural, one {# block} other {# blocks}} found",
  listLabel: "Your blocks",
  moreBelow: "More blocks below",
  back: "Back",
  filter: {
    biome: "Island",
    kind: "Kind",
    allBiomes: "All islands",
    allKinds: "All kinds",
    // Read out after a filter changes.
    showing: "{count, plural, one {# block} other {# blocks}} here",
    empty: "No blocks here yet. Try another island or kind!",
  },
  kind: {
    ground: "Ground",
    wood: "Wood",
    stone: "Stone and glass",
    ore: "Shiny rocks",
    flower: "Flowers",
    wool: "Wool",
    light: "Lights",
  },
  rarity: {
    common: "Easy to find",
    uncommon: "Fun to find",
    rare: "Rare find",
    epic: "Super rare find",
  },
  // A slot's name for screen readers.
  cell: {
    owned: "{name}, {count}",
    placed: "{name}, 0. All on your island",
    unknown: "Not found yet",
  },
  detail: {
    label: "About this block",
    unknownName: "Not found yet",
    have: "You have {count}.",
    placed: "You have 0 here. They are all on your island!",
    unknownHave: "You have not found this one yet.",
    where: "Found in {places}.",
    whereUnknown: "Look for it in {places}.",
    whereNone: "No lesson gives this one yet.",
    // Joins two or more island names: "Meadow Home and Birch Forest".
    and: "{first} and {last}",
  },
} as const;
