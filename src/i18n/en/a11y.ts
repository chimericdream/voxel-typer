/**
 * Accessibility strings (task M3-07): what a screen reader hears when the screen changes, and the
 * "hear it again" hint a Sprout child sees in play. Sprout-readable words.
 */
export default {
  screen: {
    island: "Home Island",
    inventory: "Your blocks",
    achievements: "Badges",
    settings: "Settings",
    parent: "For grown-ups",
  },
  /** Read when the lesson intro opens. */
  lessonIntro: "Next lesson: {title}",
  /** Read when Results opens: the stars, then the warm message. */
  results: "Lesson done! {stars}. {message}",
  /** The HUD hint beside the key that reads the word again. */
  hearAgain: "Hear it again",
} as const;
