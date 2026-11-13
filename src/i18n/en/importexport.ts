/**
 * Save file: export and import (task M3-12). This talks to grown-ups, plainly and kindly
 * (docs/impl/README.md §4.4). The file never leaves the device unless the grown-up moves it.
 */
export default {
  export: {
    intro:
      "Save every player to a file, to keep a copy or to move to another device. The file goes to this device's downloads. Nothing is sent anywhere.",
    button: "Download a save file",
    busy: "Making the file…",
    done: "{count, plural, one {Saved one player} other {Saved # players}} to {file}.",
    none: "There are no players to save yet.",
    leftOutLost:
      "{count, plural, one {One damaged player was} other {# damaged players were}} left out, because {count, plural, one {it} other {they}} can't be read.",
    leftOutNewer:
      "{count, plural, one {One player was} other {# players were}} left out, because a newer version of the game saved {count, plural, one {it} other {them}}. Use the newer game to make a save file with {count, plural, one {it} other {them}}.",
    failed: "We couldn't make the file. Nothing on this device changed. Please try again.",
  },
  import: {
    intro: "Load players from a Voxel Typer save file. You can check what will happen first.",
    button: "Load a save file",
    pick: "Choose a save file",
    reading: "Reading the file…",
    problem: {
      tooBig: "This file is bigger than 5 MB, so it isn't a Voxel Typer save file.",
      notJson: "This file isn't a Voxel Typer save file.",
      notSave: "This file isn't a Voxel Typer save file.",
      wrongApp: "This file is from another app, not Voxel Typer.",
      noVersion: "This save file is missing its version number, so it can't be loaded.",
      newerFile:
        "A newer version of Voxel Typer made this file. Update the game on this device, then try again.",
      noList: "This save file has no players in it.",
      unreadable: "We couldn't read this file. Please try again.",
    },
    nothingChanged: "Nothing on this device changed.",
    empty: "This save file has no players in it.",
    reviewTitle: "Check before loading",
    reviewIntro: "Here is what will happen. Nothing changes until you press Load players.",
    fileName: "File: {file}",
    rowAdd: "{name} will be added.",
    rowAddCopy: "{name} will be added as {copy}.",
    rowFull: "{name} won't fit: a device holds 8 players.",
    rowBadInvalid: "Player {n} in the file is damaged and can't be loaded.",
    rowBadNewer:
      "Player {n} in the file was saved by a newer version of the game and can't be loaded here.",
    conflict: "{name} is already on this device.",
    conflictLost: "{name} is in the file. This device has a damaged copy of that player.",
    conflictNewer:
      "{name} is in the file. This device has a copy saved by a newer version of the game, so it can't be replaced.",
    sideDevice:
      "On this device: {count, plural, one {one lesson} other {# lessons}} done, last played {date}.",
    sideFile:
      "In the file: {count, plural, one {one lesson} other {# lessons}} done, last played {date}.",
    newerTag: "(newer)",
    hasIsland: "Has an island.",
    noIsland: "No island yet.",
    islandGone:
      "The file's copy of {name} has no island. If you use the file's copy, the island on this device goes away.",
    choiceLegend: "What to do with {name}",
    choice: {
      keepDevice: "Keep this device's",
      useFile: "Use the file's copy",
      keepBoth: "Keep both",
    },
    wins: {
      keepDevice: "{name} on this device stays as it is. The file's copy isn't loaded.",
      useFile:
        "The file's copy of {name} replaces the one on this device. {name}'s progress on this device can't be brought back after that.",
      useFileLost: "The file's copy of {name} replaces the damaged one.",
      keepBoth: "Both stay. The file's copy is added as {copy}.",
      keepBothFull: "There's no room for a copy: a device holds 8 players.",
    },
    islandBad:
      "The island in the file's copy can't be opened, so the file's copy can't replace {name} on this device. You can keep this device's copy, or keep both.",
    backupNote:
      "Replacing a player can't be undone. To keep a copy of this device's players, download a save file first.",
    backup: "Download a save file first",
    go: "Load players",
    cancel: "Not now",
    busy: "Loading players…",
    result: {
      title: "Done",
      counts: "Added {added}, updated {updated}, not loaded {skipped}.",
      added: "Added {name}.",
      addedCopy: "Added {name}, a copy of {from}.",
      updated: "Updated {name} from the file.",
      skip: {
        keptDevice: "Kept {name} on this device as it was.",
        full: "{name} wasn't loaded: a device holds 8 players. Delete a player to make room, then load the file again.",
        newer: "Player {n} wasn't loaded: a newer version of the game saved it.",
        invalid: "Player {n} wasn't loaded: it is damaged in the file.",
        notAllowed: "Kept {name} on this device as it was.",
        deviceNewer: "{name} wasn't loaded: a newer version of the game saved this device's copy.",
        failed: "{name} couldn't be saved. Nothing about that player changed. Please try again.",
      },
    },
  },
  fromSplash: "Grown-ups: load a save file",
  noPlayerIntro: "No players yet. A grown-up can load players from a save file.",
} as const;
