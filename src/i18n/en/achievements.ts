/**
 * Badge strings (task M3-10). Every band sees these, so each one uses words a 6-year-old can
 * read: warm, short and concrete, with no pressure words and nothing about speed
 * (docs/impl/README.md §4.4). All names are our own.
 */
export default {
  title: "My Badges",
  count: "{got} of {total} badges",
  back: "Back",
  got: "Got it!",
  notYet: "Not yet",
  listLabel: "All badges",
  hiddenName: "Surprise badge",
  hiddenDesc: "Keep playing to find this one.",
  // The toast after a badge is earned, e.g. "New badge: First Steps!".
  toast: "New badge: {name}!",
  firstLesson: { name: "First Steps", desc: "Finish your first lesson." },
  starCatcher: { name: "Star Catcher", desc: "Get 3 stars on a lesson." },
  practicePal: { name: "Practice Pal", desc: "Play the same lesson 3 times." },
  tenTrips: { name: "Ten Trips", desc: "Play 10 lessons." },
  meadowBadge: { name: "Meadow Badge", desc: "Play every lesson in Meadow Home." },
  birchBadge: { name: "Birch Badge", desc: "Play every lesson in Birch Forest." },
  shoreBadge: { name: "Shore Badge", desc: "Play every lesson in Sandy Shore." },
  frostyBadge: { name: "Frosty Badge", desc: "Play every lesson in Frosty Peaks." },
  threeDays: { name: "Three Good Days", desc: "Play on 3 different days." },
  earlyBird: { name: "Early Bird", desc: "Play in the morning, before 9." },
  firstWord: { name: "Word Maker", desc: "Type a whole word." },
  neatTen: { name: "Neat Ten", desc: "Type 10 words in a row with no slips." },
  steadyHands: { name: "Steady Hands", desc: "Press 25 right keys in a row." },
  hundredHop: { name: "Hundred Hop", desc: "Press 100 right keys in a row." },
  cleanMinute: { name: "Calm Minute", desc: "Type for a whole minute with no slips." },
  notOneSlip: { name: "Not One Slip", desc: "Finish a lesson with every key right." },
  homeRowHero: { name: "Home Row Hero", desc: "Use all 8 home row keys in one lesson." },
  pinkyPower: { name: "Pinky Power", desc: "Press 50 keys with your little fingers." },
  firstOre: { name: "First Ore", desc: "Find your first ore." },
  luckyFind: { name: "Lucky Find", desc: "Find a rare block." },
  gemFinder: { name: "Gem Finder", desc: "Find a shiny meadowstone." },
  flowerFriend: { name: "Flower Friend", desc: "Find all 4 kinds of flowers." },
  collector: { name: "Collector", desc: "Have 5 kinds of blocks." },
  hundredBlocks: { name: "Hundred Blocks", desc: "Have 100 blocks at once." },
} as const;
