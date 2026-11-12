/**
 * Placement test strings (task M3-05, PLAN.md §3.2.8). Every band sees them, so they use words a
 * 6-year-old can read: warm, short and concrete. No score is ever shown, only where to start.
 */
export default {
  // The lesson title of the test (the play host's lesson record).
  title: "Find your level",
  intro: "Break blocks for a little while, and we will find the best place for you to start.",
  howTo: "Type the letter or word on each block. The blocks get harder as you go. That is fine!",
  start: "Let's dig!",
  skip: "Skip",
  skipHint: "Skip starts you at Meadow Home.",
  // After the test.
  doneTitle: "All done!",
  startAt: "You start at {name}!",
  meadow: "It is a great place to begin.",
  ahead: "You are ready for {ahead}! Its lessons are coming soon, so you start at {name}.",
  testedOut:
    "You already know the lessons before it, so they each have a star. You can play them any time.",
  toMap: "Go to the map",
} as const;
