/**
 * World map strings (task M3-04). Shown to every band, so each one uses words a 6-year-old can
 * read: warm, short and concrete (docs/impl/README.md §4.4). Biome names are PLAN.md §3.1's.
 */
export default {
  title: "World Map",
  hint: "Pick an island. Press Enter to go in.",
  players: "Change player",
  biome: {
    meadow: "Meadow Home",
    birch: "Birch Forest",
    shore: "Sandy Shore",
    frosty: "Frosty Peaks",
    mines: "Deep Mines",
    marsh: "Mushroom Marsh",
    caverns: "Crystal Caverns",
    sparkstone: "Sparkstone Factory",
    citadel: "Sky Citadel",
  },
  island: {
    // Screen-reader labels, e.g. "Birch Forest, 4 of 15 lessons done, 9 stars".
    label: "{name}, {done} of {total} lessons done, {stars, plural, one {# star} other {# stars}}",
    labelNext:
      "{name}, {done} of {total} lessons done, {stars, plural, one {# star} other {# stars}}. Go here next!",
    labelEmpty: "{name}. New lessons are coming soon.",
    labelLocked: "{name}. In the clouds for now. Finish {need} to get here.",
    labelLockedFirst: "{name}. In the clouds for now.",
    // Shown on the label: "0 of 6 done". The star count shows only once there are stars.
    count: "{done} of {total} done",
    // Said and shown after clicking an island that is still in the clouds. Never "Locked!".
    notYet: "Finish {need} to open this island!",
    notYetFirst: "This island is still in the clouds. Come back soon!",
    soon: "Coming soon",
    next: "Go here next!",
    list: "Islands",
  },
  path: {
    progress: "{done} of {total} lessons done",
    stars: "{stars, plural, one {# star} other {# stars}}",
    back: "Back to the map",
    empty: "We are still building the lessons here. Come back soon!",
    hint: "Pick a lesson. Press Enter to play.",
    list: "Lessons",
    next: "Next",
    lessonNew: "Lesson {n}: {title}. Not played yet.",
    lessonNext: "Lesson {n}: {title}. Play this one next!",
    lessonNextAgain:
      "Lesson {n}: {title}. {stars, plural, one {# star} other {# stars}} out of 3. Try this one again!",
    lessonDone: "Lesson {n}: {title}. {stars, plural, one {# star} other {# stars}} out of 3.",
    lessonLocked: "Lesson {n}. Finish lesson {prev} first.",
    nodeStars: "{stars, plural, one {# star} other {# stars}} out of 3",
  },
  noPlayer: {
    body: "Pick a player first. Then the map is yours!",
    go: "Pick a player",
  },
} as const;
