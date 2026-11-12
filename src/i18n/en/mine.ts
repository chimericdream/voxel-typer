/**
 * Mine mode strings (task M2-13). Short and warm, in words a 6-year-old can read. No pressure
 * words: a slip is "Almost!", never "Wrong".
 */
export default {
  // Shown when a lesson starts, until the first key lands.
  startLetter: "Type the letter on the block!",
  startWord: "Type the word to break the block!",
  // A wrong key. At most once every 5 seconds.
  almost: "Almost! Try that key again",
  // A glowing bonus block arrived.
  oreVein: "Wow! A shiny block!",
  // Floats up from a broken block: "+2 Oak Log".
  got: "+{count} {name}",
} as const;
