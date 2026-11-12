/**
 * Settings and the parent gate (task M3-08). The Play, Look and Sound tabs are for kids: short,
 * warm words a 6-year-old can read. The gate and the Grown-ups tab talk to grown-ups, plainly and
 * kindly (docs/impl/README.md §4.4).
 */
export default {
  title: "Settings",
  tabsLabel: "Settings pages",
  tab: {
    play: "Play",
    look: "Look",
    sound: "Sound",
    grownUps: "Grown-ups",
  },
  back: "Back",
  readOnly: "A newer game saved this player. Get the new game to change these.",
  noPlayer: "Pick a player first. Then come back here.",
  players: "Players",
  play: {
    keyboard: "Show the keyboard",
    hands: "Show the hands",
    fingerLabels: "Finger names on the keys",
    calm: "Calm mode: no clocks",
    calmHint: "No timers anywhere. Take all the time you need.",
    breaks: "Break time",
    breakEvery: "Every {min} minutes",
    breakOff: "Off",
    layout: "Keyboard type",
    layoutName: {
      "en-US": "US keyboard",
      "en-GB": "UK keyboard",
    },
  },
  look: {
    size: "Letter size",
    sizeValue: "{pct}%",
    preview: "Look! This is how big the words are.",
    font: "Letters",
    fontName: {
      pixel: "Blocky",
      clean: "Clear",
      dyslexic: "Easy read",
    },
    contrast: "Strong colors",
    motion: "Moving things",
    motionName: {
      full: "Move",
      reduced: "Keep still",
      system: "Like this device",
    },
    quality: "Picture",
    qualityName: {
      auto: "Auto",
      low: "Fast",
      medium: "Good",
      high: "Best",
    },
  },
  sound: {
    volume: {
      master: "All sound",
      music: "Music",
      sfx: "Sounds",
      voice: "Voice",
    },
    volumeValue: "{pct}%",
    tts: "Read words out loud",
    ttsHint: "Speech uses this device's own voices only.",
    test: "Try a sound",
  },
  grown: {
    intro: "Changes for {name}. These need a grown-up.",
    bandTitle: "Group",
    bandNow: "{name} is in the {band} group.",
    bandConfirm:
      "Move {name} to the {band} group? Letter size, keyboard help and timers change to fit, unless you changed them yourself.",
    bandYes: "Yes, move",
    dataTitle: "Save file",
    dataSoon: "Saving to a file and loading it back is coming soon.",
    insecure:
      "This page is not using a secure (https) address, so it can't work offline or be installed. Everything else works.",
    damaged:
      "{count, plural, one {One save could} other {# saves could}} not be opened. You can delete {count, plural, one {it} other {them}} on the Players screen to free a slot.",
    damagedGo: "Go to Players",
    dangerTitle: "Danger zone",
    remove: "Delete {name}",
    removeConfirm: "Delete {name} and all their progress on this device? This can't be undone.",
    removeYes: "Yes, delete",
    removeFailed: "We could not delete that player. Please try again.",
    keep: "Keep it",
  },
  gate: {
    title: "Grown-ups only",
    ask: "Grown-ups: type this word to continue:",
    why: {
      grownUps: "This opens the grown-up settings.",
      renameProfile: "This changes a player's name.",
      changeBand: "This changes a player's group.",
      deleteProfile: "This deletes a player.",
    },
    label: "Type the word",
    go: "Continue",
    cancel: "Not now",
    miss: "That's not quite it. {count, plural, one {One more try.} other {# more tries.}}",
    rest: "Let's take a short break. Try again in {seconds} seconds.",
  },
} as const;
