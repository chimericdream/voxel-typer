/** App shell strings (task M2-10): loading, pause, stretch break, save notices. */
export default {
  play: {
    loading: "Getting your world ready…",
  },
  pause: {
    title: "Paused",
    body: "Take your time. Your blocks will wait for you.",
    resume: "Keep playing",
    quit: "Back to the map",
  },
  break: {
    title: "Stretch break!",
    body: "Great typing! Stand up, wiggle your fingers and stretch your arms up high.",
    resume: "I'm ready!",
  },
  save: {
    restoredPrev: "We brought back your last save.",
    unreadable: "We could not open one of the profiles. A grown-up can help in Settings.",
    newerVersion:
      "This profile was saved by a newer version of the game. Ask a grown-up to update the game. Your progress is safe.",
    storageError: "We could not save just now. Keep playing! We will try again later.",
    dismiss: "OK",
  },
} as const;
