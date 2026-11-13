/**
 * Remedial practice strings (task M3-06, PLAN.md §4.3). Every band sees them, so they use words a
 * 6-year-old can read. They name a finger kindly and never say a key was "bad" or "wrong".
 */
export default {
  /** The practice lesson's title, by the finger of its weakest key. */
  title: {
    L5: "Your left pinky wants practice!",
    L4: "Your left ring finger wants practice!",
    L3: "Your left middle finger wants practice!",
    L2: "Your left pointer finger wants practice!",
    R2: "Your right pointer finger wants practice!",
    R3: "Your right middle finger wants practice!",
    R4: "Your right ring finger wants practice!",
    R5: "Your right pinky wants practice!",
    T: "Your thumbs want practice!",
    any: "Some keys want practice!",
  },
  /** The practice camp on the lesson path, for screen readers: "Practice camp. Your left …". */
  camp: "Practice camp. {title} {count, plural, one {Practice key: {keys}.} other {Practice keys: {keys}.}}",
  /** The short word shown under the practice camp's tent. */
  campTag: "Practice",
  /** LessonIntro's heading over a practice lesson's keys (they are not new). */
  practiceKeys: "Practice keys",
  /** Two keys in a row: "F and J". */
  two: "{a} and {b}",
  /** Spoken key names, where the glyph alone is unclear. */
  key: {
    semicolon: "semicolon",
    space: "space",
  },
} as const;
