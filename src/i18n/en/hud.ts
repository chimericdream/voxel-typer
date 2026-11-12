/**
 * In-play HUD (task M2-14). Sprout-readable: a 6-year-old sees the Caps Lock hint. The rest is
 * spoken by screen readers.
 */
export default {
  /** The word display's spoken name. */
  word: "Type: {word}",
  /** The word display's spoken name when a space comes after the word. */
  wordSpace: "Type: {word}, then space",
  /** The hotbar combo meter. */
  combo: "Streak: {count} of 9",
  progress: "Lesson progress",
  /** Read before the time on the timer. */
  timeLeft: "Time left",
  capsLock: "Caps Lock is on! Tap it to turn it off.",
} as const;
