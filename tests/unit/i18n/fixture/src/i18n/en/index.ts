/** Fixture tables for tests/unit/i18n/keys.test.ts. Each key's name says what the scan must find. */
export default {
  menu: {
    play: "Play",
    quit: "Quit",
    neverUsed: "Nobody asks for this",
    biome: { meadow: "Meadow", shore: "Sandy Shore" },
  },
  lesson: {
    title: "First steps",
    alsoNeverUsed: "Nor this",
  },
} as const;
