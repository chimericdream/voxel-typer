/**
 * On-screen keyboard and hand overlay (task M2-09). Sprout-readable: a 6-year-old reads these.
 */
export default {
  /** The keyboard's spoken name when there is no next key. */
  label: "Keyboard",
  /** Spoken name while a key is lit: "Next key: F. Use your left pointer finger." */
  next: "Next key: {key}. Use your {finger}.",
  /** Spoken name when Shift is needed too. */
  nextShift: "Next key: {key}. Use your {finger}. Hold shift with your {shiftFinger}.",
  /** The caption under the hands. */
  useFinger: "Use your {finger}.",
  holdShift: "Hold shift with your {finger}.",
  /** Finger names, for captions. */
  finger: {
    L5: "left pinky",
    L4: "left ring finger",
    L3: "left middle finger",
    L2: "left pointer finger",
    R2: "right pointer finger",
    R3: "right middle finger",
    R4: "right ring finger",
    R5: "right pinky",
    T: "thumb",
  },
  /** The tiny label on each key, by finger zone. */
  zone: {
    pinky: "pinky",
    ring: "ring",
    middle: "middle",
    index: "pointer",
    thumb: "thumb",
  },
  /** Keys that type no letter. */
  key: {
    space: "space",
    shift: "shift",
    tab: "tab",
    caps: "caps lock",
    enter: "enter",
    backspace: "backspace",
  },
} as const;
