/**
 * Mine mode strings (task M2-13). Short and warm, in words a 6-year-old can read. No pressure
 * words: a slip is "Almost!", never "Wrong".
 */
export default {
  // Shown when a lesson starts, until the first key lands.
  // "this letter" is the big letter on the plate above; "the block" is the one that breaks. The old
  // "the letter on the block" sent eyes to the plate, which looks like a block (M2-13 review N2).
  startLetter: "Type this letter to break the block!",
  startWord: "Type the word to break the block!",
  // A wrong key. At most once every 5 seconds.
  almost: "Almost! Try that key again",
  // A glowing bonus block arrived.
  oreVein: "Wow! A shiny block!",
  // Floats up from a broken block: "+2". The item itself flies to the hotbar.
  got: "+{count}",
  // The name of a filled hotbar slot, for screen readers: "Oak Log, 3".
  slot: "{name}, {count}",
} as const;
