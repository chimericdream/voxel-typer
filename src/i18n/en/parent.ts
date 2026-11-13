/**
 * Parent Dashboard strings (task M3-11, PLAN.md §4.4). Grown-ups read these, behind the parent
 * gate. Plain language, kind, and no claims we can't source (no "most kids grow…"). Weak spots are
 * "keys to practice", never mistakes to worry about.
 */
export default {
  title: "{name}'s progress",
  intro: "For grown-ups. Everything here stays on this device.",
  back: "Back",
  download: "Download CSV",
  downloaded: "Saved {file} to this device.",
  downloadNone: "The CSV file will have sessions once {name} plays.",
  noProfile: "Pick a player first, then come back here to see their progress.",
  totals:
    "{sessions, plural, one {# session} other {# sessions}} and {minutes, plural, one {# minute} other {# minutes}} of practice in all.",
  showNumbers: "Show the numbers",
  weekOf: "Week of {date}",
  activity: {
    practice: "Practice",
    placement: "Placement test",
    daily: "Daily challenge",
  },
  chart: {
    point: "{label}: {value}",
  },
  trend: {
    title: "Speed and accuracy",
    span: "Time span",
    recent: "Last {count} sessions",
    weekly: "By week",
    empty: "Charts show up here after {name} finishes a lesson.",
    colSession: "Session",
    colWeek: "Week",
    colSessions: "Sessions",
  },
  speed: {
    title: "Speed",
    caption: "Words per minute, counting only correct typing. Higher is better.",
    summary:
      "Speed in words per minute, {count, plural, one {# point} other {# points}}. First {first}, latest {last}, best {best}.",
    col: "Speed (WPM)",
  },
  accuracy: {
    title: "Accuracy",
    caption: "How many key presses were right. Higher is better.",
    summary:
      "Accuracy, {count, plural, one {# point} other {# points}}. First {first}%, latest {last}%, best {best}%.",
    col: "Accuracy",
  },
  minutes: {
    title: "Minutes practiced per day",
    caption: "The last {days} days, ending today. Every session counts, practice included.",
    summary:
      "Minutes practiced on each of the last {days} days: {total} minutes in all, on {active, plural, one {# day} other {# days}}.",
    empty: "No practice in the last {days} days yet.",
    colDay: "Day",
    colMinutes: "Minutes",
  },
  keys: {
    title: "Keys to practice",
    caption:
      "Recent mistakes for each key, out of every 100 presses. The steps above show what each color means.",
    summary: "Keyboard map of recent mistakes. Keys to practice most: {list}.",
    summaryNone: "Keyboard map of recent mistakes. No key stands out.",
    top: "Keys to practice most",
    topNone: "No key stands out. Mistakes are spread evenly across the keys.",
    item: "{key}: {pct}% mistakes",
    empty: "Keys show up here after a little more practice.",
    tip: "{key}: {pct}% recent mistakes",
    tipFew: "{key}: not enough presses yet",
    under: "under {pct}%",
    range: "{lo}–{hi}%",
    over: "{pct}% or more",
    few: "not enough presses yet",
    legend: "Color steps",
    space: "Space",
    colKey: "Key",
    colMistakes: "Recent mistakes",
    colPresses: "Presses",
  },
  pairs: {
    title: "Letter pairs to practice",
    caption: "Two letters typed one after the other, with the most recent mistakes.",
    empty: "No letter pair stands out yet.",
    item: "{pair}: {pct}% mistakes",
    space: "space",
  },
  lessons: {
    title: "Lessons",
    caption:
      "Stars earned in each part of the world. Tested-out lessons were skipped by the placement test.",
    stars: "{stars} of {max} stars",
    played: "{done} of {total} lessons played",
    testedOutCount: "{count, plural, one {# lesson} other {# lessons}} tested out",
    testedOut: "Tested out",
    notYet: "Not yet",
    showAll: "Show every lesson",
    colLesson: "Lesson",
    colStars: "Stars",
    colSpeed: "Best speed (WPM)",
    colAccuracy: "Best accuracy",
  },
  sessions: {
    title: "Recent sessions",
    caption: "The newest {count} sessions. The CSV file has every one.",
    empty: "No sessions yet. They show up here after a lesson.",
    colDate: "Date",
    colActivity: "Activity",
    colMinutes: "Minutes",
    colSpeed: "Speed (WPM)",
    colAccuracy: "Accuracy",
  },
  csv: {
    player: "Player",
    date: "Date",
    time: "Time",
    activity: "Activity",
    minutes: "Minutes",
    wpm: "Speed (WPM)",
    accuracy: "Accuracy (%)",
  },
} as const;
