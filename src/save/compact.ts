/**
 * History compaction (docs/impl/contracts.md §15, task M1-09). `Profile.history` keeps the newest
 * {@link HISTORY_CAP} sessions; older ones are folded into `Profile.weekly`, one row per week.
 *
 * Not a pure zone: the default week function reads the device's local time zone. The fold itself
 * takes the week function as a parameter, so tests pin it.
 */
import type { EpochMs } from "@/types/core";
import type { Profile, StoredSummary } from "./schema";

/** Most sessions kept in `Profile.history`. */
export const HISTORY_CAP = 500;

type Weekly = Profile["weekly"][number];

/** The local Monday that starts the week holding `at`, as `"YYYY-MM-DD"`. */
export function localWeekStart(at: EpochMs): string {
  const d = new Date(at);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  const mm = String(monday.getMonth() + 1).padStart(2, "0");
  const dd = String(monday.getDate()).padStart(2, "0");
  return `${monday.getFullYear()}-${mm}-${dd}`;
}

/** Adds sessions to a weekly row. Averages are weighted by session count. */
function fold(row: Weekly, sessions: readonly StoredSummary[]): Weekly {
  const n = row.sessions + sessions.length;
  let minutes = row.minutes;
  let wpm = row.avgNetWpm * row.sessions;
  let acc = row.avgAccuracy * row.sessions;
  for (const s of sessions) {
    minutes += s.activeMs / 60000;
    wpm += s.netWpm;
    acc += s.accuracy;
  }
  return {
    weekStart: row.weekStart,
    minutes,
    sessions: n,
    avgNetWpm: n === 0 ? 0 : wpm / n,
    // Rounding can push a weighted mean of values ≤ 1 a hair above 1.
    avgAccuracy: n === 0 ? 0 : Math.min(1, acc / n),
  };
}

function mergeRows(a: Weekly, b: Weekly): Weekly {
  const n = a.sessions + b.sessions;
  return {
    weekStart: a.weekStart,
    minutes: a.minutes + b.minutes,
    sessions: n,
    avgNetWpm: n === 0 ? 0 : (a.avgNetWpm * a.sessions + b.avgNetWpm * b.sessions) / n,
    avgAccuracy:
      n === 0 ? 0 : Math.min(1, (a.avgAccuracy * a.sessions + b.avgAccuracy * b.sessions) / n),
  };
}

/**
 * Returns `p` with at most `cap` history entries. The oldest extra entries are folded into
 * `weekly` (merged into an existing row for the same week, else a new row; rows sorted by week).
 * Totals are kept: history sessions + weekly sessions, and history minutes + weekly minutes, are
 * the same before and after. Returns `p` itself when there is nothing to do; never mutates it.
 */
export function compactHistory(
  p: Profile,
  cap: number = HISTORY_CAP,
  weekStartOf: (at: EpochMs) => string = localWeekStart,
): Profile {
  const extra = p.history.length - cap;
  if (extra <= 0) return p;
  const old = p.history.slice(0, extra);
  const byWeek = new Map<string, StoredSummary[]>();
  for (const s of old) {
    const week = weekStartOf(s.at);
    const list = byWeek.get(week);
    if (list === undefined) byWeek.set(week, [s]);
    else list.push(s);
  }
  const rows = new Map<string, Weekly>();
  for (const w of p.weekly) {
    // Two rows for one week (an edited import, say) merge, so no minutes go missing.
    const seen = rows.get(w.weekStart);
    rows.set(w.weekStart, seen === undefined ? w : mergeRows(seen, w));
  }
  for (const [week, sessions] of byWeek) {
    const row = rows.get(week) ?? {
      weekStart: week,
      minutes: 0,
      sessions: 0,
      avgNetWpm: 0,
      avgAccuracy: 0,
    };
    rows.set(week, fold(row, sessions));
  }
  const weekly = [...rows.values()].toSorted((a, b) =>
    a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0,
  );
  return { ...p, history: p.history.slice(extra), weekly };
}
