/**
 * Builder mode strings (task M4-07). Short and warm, in words a 6-year-old can read. A key that
 * doesn't fit is never "wrong": the line says what would fit. Block names come from `blocks.ts`.
 *
 * The command words themselves (put, dig, undo, north…) are what the child types, so they appear
 * here exactly as typed, in lowercase.
 */
export default {
  title: "My Island",

  line: {
    // The command line's name for screen readers: "You typed: plan".
    label: "You typed: {text}",
    empty: "Type a word to build",
    space: "Space",
  },

  palette: {
    label: "Your blocks",
    // One block in the palette, for screen readers: "Oak Planks, 12. Type planks."
    item: "{name}, {count}. Type {word}.",
    armed: "In your hand: {name}",
    none: "No block in your hand yet",
  },

  where: {
    layer: "Layer {layer}",
    // Which way is the top of the screen. Not "up": `up` is a command that lifts the cursor.
    facing: "{dir} is at the top",
  },

  dir: {
    up: "Up",
    down: "Down",
    north: "North",
    south: "South",
    east: "East",
    west: "West",
  },

  help: {
    put: "put",
    dig: "dig",
    undo: "undo",
    move: "north south east west up down",
    keys: "Arrow keys move. Space puts a block.",
  },

  hint: {
    // Shown at the start, until the first key.
    welcome: "Type {word} to pick a block. Then type put!",
    welcomeEmpty: "Type dig to pick up a block. Then type put!",
    // A key that doesn't fit: say what does.
    keepGoing: "Keep going: {word}",
    oneOf: "Try one of these: {words}",
    pressSpace: "Press Space to use {word}.",
    number: "Type a number from 1 to {max}. Or press Enter.",
    tryWord: "Try a word like put or dig.",
    // Things the island can't do right now.
    pickFirst: "Pick a block first. Type its name.",
    noneYet: "You have no {name} yet. You can find some in the mine!",
    noneLeft: "No {name} left. You can find more in the mine!",
    needMore: "You need {count} more {name}.",
    tooHigh: "That is as high as you can build.",
    needsGround: "Flowers need a block under them.",
    nothingToDig: "There is nothing to dig here.",
    cantMove: "That block has to stay where it is.",
    edge: "That is the edge of your island.",
    top: "That is the top.",
    bottom: "That is the bottom.",
    nothingToUndo: "There is nothing to undo.",
    undone: "Took back your last step.",
    noRoom: "There is no room for that here. Try another spot.",
    alreadyThere: "That is already built here.",
    built: "You built a {name}!",
  },

  // The saved island could not be opened. Calm, and true: nothing was changed.
  damaged: {
    title: "Your island is resting",
    body: "We could not open your island this time. It is safe, just as you left it.",
    help: "Ask a grown-up for help. To leave, press Esc, then pick Back to the map.",
  },
} as const;
