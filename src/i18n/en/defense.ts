/**
 * Night Defense strings (task M4-04). Short and warm, in words a 6-year-old can read. The visitors
 * are friends, not enemies: typing a word sends its friend home in a puff of sparkles. No pressure
 * words, no countdowns, and nothing here ever says the child lost something.
 */
export default {
  // The day phase: the camp in daylight, before anything needs typing.
  nightComing: "Night is coming!",
  // The wave announcement, one line per visitor ("3 slimelings are on the way!").
  onTheWay: {
    slimeling: "{count, plural, one {# slimeling is} other {# slimelings are}} on the way!",
    "moss-golem": "{count, plural, one {# moss golem is} other {# moss golems are}} on the way!",
    "cave-bat": "{count, plural, one {# cave bat is} other {# cave bats are}} on the way!",
    "frost-pup": "{count, plural, one {# frost pup is} other {# frost pups are}} on the way!",
    "cactus-cat": "{count, plural, one {# cactus cat is} other {# cactus cats are}} on the way!",
    "lantern-fish": "{count} lantern fish are on the way!",
    "crystal-crab":
      "{count, plural, one {# crystal crab is} other {# crystal crabs are}} on the way!",
    "sandstorm-imp":
      "{count, plural, one {# sandstorm imp is} other {# sandstorm imps are}} on the way!",
  },
  // A wave with more than one kind of visitor.
  onTheWayMixed: "{count, plural, one {# friend is} other {# friends are}} on the way!",
  // Shown when the first visitor of the night sets out, until the first right key.
  start: "Type a word to send its friend home!",
  // A wrong key. At most once every 5 seconds.
  almost: "Almost! Try that key again",
  // The shield is at zero. Visitors bounce off until dawn; nothing is lost.
  shieldRest: "The shield needs a rest! Keep going!",
  // Dawn: the night is over and the shield is whole again.
  dawn: "The sun is up! The camp is safe!",
  // The shield bar's label, and its spoken name ("Shield: 3 of 5").
  shield: "Shield",
  shieldLabel: "Shield: {count} of {max}",
  // A word plate's spoken name.
  plate: "Type: {word}",
  // Floats up from a visitor that went home: "+2". The block itself flies to the hotbar.
  got: "+{count}",
  // The name of a filled hotbar slot, for screen readers: "Oak Log, 3".
  slot: "{name}, {count}",
  // Results: two extra lines for a night.
  resultsPopped: "{count, plural, one {# friend} other {# friends}} sent home",
  resultsStreak: "Best streak: {count} keys in a row",
} as const;
