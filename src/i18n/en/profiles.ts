/**
 * "Who is playing?" strings (task M3-09; moved here from `screens.profiles`). Kids read this
 * screen before a band is picked, so every line uses words a 6-year-old can read. Warm, short and
 * concrete (docs/impl/README.md §4.4). Grown-up lines stay plain too.
 */
export default {
  title: "Who is playing?",
  manageTitle: "Pick a player to change",
  newPlayer: "New player",
  manage: "Change a player",
  manageDone: "Done",
  empty: "No players yet. Let's make one!",
  full: "This game is full! A grown-up can make room.",
  loadFailed: "We could not open that player. A grown-up can help.",
  readOnly: "Saved by a newer game. You can play, but new stars will not be saved.",
  readOnlyHidden:
    "{count, plural, one {One player was} other {# players were}} saved by a newer game. Ask a grown-up to get the new game. Your stars are safe.",
  lostName: "A lost player",
  lostNote: "We could not open this one.",
  back: "Back",
  close: "Close",
  menu: {
    rename: "New name",
    band: "Change group",
    remove: "Delete player",
    readOnly: "A newer game saved this player. Get the new game to change it.",
    lost: "We could not open this player. A grown-up can delete it to make room.",
  },
  rename: {
    label: "Type a new name",
    hint: "Make up a fun name, not a real one.",
    save: "Save name",
    empty: "Type a name first.",
    tooLong: "That name is a bit long. Try 16 letters or less.",
    notAllowed: "Let's pick a different name. Try another one!",
  },
  band: {
    label: "Pick a group",
    save: "Save group",
  },
  remove: {
    warn: "This takes away all of {name}'s stars and blocks. It can not come back.",
    label: "To be sure, type the name: {name}",
    confirm: "Delete {name}",
    mismatch: "Type the name just like this: {name}",
    lostWarn: "This takes away the lost player and makes room for a new one.",
    lostConfirm: "Delete it",
  },
  cancel: "Go back",
  saveFailed: "We could not save that. Try again in a moment.",
  done: {
    rename: "Now this player is {name}.",
    band: "{name} is in the {band} group now.",
    remove: "That player is gone. There is room for a new one.",
  },
} as const;
