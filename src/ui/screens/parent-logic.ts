/**
 * What the Parent Dashboard shows (task M3-11, PLAN.md §4.4), worked out from a profile. No DOM
 * here, so the numbers are easy to test; `Parent.tsx` draws them and `sessionsCsv` exports them.
 *
 * Rules that are easy to break:
 * - **Tested-out lessons** (`isTestedOut`, decision 92) hold a zero WPM and accuracy that are not
 *   scores. They show as "Tested out" in curriculum progress and never feed a trend. Trends read
 *   `history` only, which never holds them, and curriculum rows go through `isTestedOut`.
 * - **Remedial practice** (M3-06) is in `history` with a `remedial-…` lesson id. It counts in
 *   minutes and trends, is labelled "Practice", and is never a curriculum lesson.
 * - Every number the page shows is rounded here, once, by the same helpers the CSV uses, so the
 *   file holds exactly the numbers on screen.
 */
import { isTestedOut } from "@/app/progress";
import type { CsvCell } from "@/app/csv";
import type { LayoutDef } from "@/content/layouts/types";
import type { Lesson } from "@/content/lessons/types";
import { t } from "@/i18n";
import type { Profile, StoredSummary } from "@/save/schema";
import { localWeekStart } from "@/save/compact";
import { BIOME_ORDER } from "@/types/core";
import type { BiomeId, EpochMs } from "@/types/core";

/** Sessions in the "last sessions" trend. */
export const TREND_SESSIONS = 30;
/** Weeks in the "by week" trend. */
export const TREND_WEEKS = 12;
/** Days in the minutes-per-day chart. */
export const MINUTE_DAYS = 28;
/** Sessions listed under "Recent sessions" (the CSV has them all). */
export const RECENT_SESSIONS = 10;
/** Presses before a key gets a color on the heat map: fewer is too little to tell. */
export const MIN_KEY_ATTEMPTS = 20;
/** Tries before a letter pair can be a "pair to practice". */
export const MIN_BIGRAM_ATTEMPTS = 10;
/** How many weak keys and letter pairs are listed. */
export const TOP_WEAK = 5;
/**
 * Remedial practice lesson ids (M3-06's `REMEDIAL_PREFIX` in `src/engine/remedial.ts`). Kept here
 * until that module lands on main; the two must match.
 */
export const REMEDIAL_PREFIX = "remedial-";
/** Sessions shorter than this have no rates (contracts §3.5), so they stay out of trends. */
const MIN_RATED_MS = 1000;

// ---------------------------------------------------------------------------------------------
// Rounding (shared by the page and the CSV)
// ---------------------------------------------------------------------------------------------

/** Minutes, to one decimal place. */
export const roundMinutes = (ms: number): number => Math.round(ms / 6000) / 10;
/** Net WPM, whole. */
export const roundWpm = (wpm: number): number => Math.round(wpm);
/** Accuracy 0–1 as a whole percent. */
export const roundPct = (fraction: number): number => Math.round(fraction * 100);

/** `"YYYY-MM-DD"` in local time. */
export function localDate(at: EpochMs): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `"HH:MM"` (24-hour) in local time. */
export function localTime(at: EpochMs): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const pad = (n: number): string => String(n).padStart(2, "0");

const SHORT_DATE = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

/** `"Nov 9"` for a `"YYYY-MM-DD"` local date. */
export function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return SHORT_DATE.format(new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

export type ActivityKind = "lesson" | "practice" | "placement" | "daily";

export const isRemedialId = (id: string | undefined): boolean =>
  id?.startsWith(REMEDIAL_PREFIX) === true;

/** The curriculum lessons by id. Remedial lessons are never curriculum lessons. */
export function curriculum(lessons: readonly Lesson[]): Map<string, Lesson> {
  return new Map(lessons.filter((l) => !isRemedialId(l.id)).map((l) => [l.id, l]));
}

/** What kind of session this was. */
export function activityOf(s: StoredSummary, byId: ReadonlyMap<string, Lesson>): ActivityKind {
  if (s.mode === "placement") return "placement";
  if (isRemedialId(s.lessonId)) return "practice";
  if (s.lessonId !== undefined && byId.has(s.lessonId)) return "lesson";
  if (s.mode === "daily") return "daily";
  return "practice";
}

/** The activity's name: the lesson's title, or "Practice", "Placement test", "Daily challenge". */
export function activityName(s: StoredSummary, byId: ReadonlyMap<string, Lesson>): string {
  const kind = activityOf(s, byId);
  const lesson = s.lessonId === undefined ? undefined : byId.get(s.lessonId);
  if (kind === "lesson" && lesson !== undefined) return t(lesson.titleKey);
  return t(`parent.activity.${kind}`);
}

/** One session as the page and the CSV show it. */
export interface SessionRow {
  at: EpochMs;
  date: string;
  time: string;
  kind: ActivityKind;
  activity: string;
  minutes: number;
  netWpm: number;
  accuracyPct: number;
}

export function sessionRow(s: StoredSummary, byId: ReadonlyMap<string, Lesson>): SessionRow {
  return {
    at: s.at,
    date: localDate(s.at),
    time: localTime(s.at),
    kind: activityOf(s, byId),
    activity: activityName(s, byId),
    minutes: roundMinutes(s.activeMs),
    netWpm: roundWpm(s.netWpm),
    accuracyPct: roundPct(s.accuracy),
  };
}

/** Every session, oldest first. */
export function sessionRows(profile: Profile, lessons: readonly Lesson[]): SessionRow[] {
  const byId = curriculum(lessons);
  return profile.history.map((s) => sessionRow(s, byId));
}

/** The CSV of every session: a header row, then one row per session, oldest first. */
export function sessionsCsv(profile: Profile, lessons: readonly Lesson[]): CsvCell[][] {
  const head: CsvCell[] = [
    t("parent.csv.player"),
    t("parent.csv.date"),
    t("parent.csv.time"),
    t("parent.csv.activity"),
    t("parent.csv.minutes"),
    t("parent.csv.wpm"),
    t("parent.csv.accuracy"),
  ];
  const rows = sessionRows(profile, lessons).map((r): CsvCell[] => [
    profile.name,
    r.date,
    r.time,
    r.activity,
    r.minutes,
    r.netWpm,
    r.accuracyPct,
  ]);
  return [head, ...rows];
}

// ---------------------------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------------------------

/** One point of a speed and accuracy trend. */
export interface TrendPoint {
  /** Axis and table label: a short date, or "Week of …". */
  label: string;
  netWpm: number;
  accuracyPct: number;
  /** Sessions behind the point (1 for a session). */
  sessions: number;
}

const rated = (s: StoredSummary): boolean => s.activeMs >= MIN_RATED_MS && s.keystrokes > 0;

/** The last {@link TREND_SESSIONS} sessions with rates, oldest first. */
export function sessionTrend(profile: Profile): TrendPoint[] {
  return profile.history
    .filter(rated)
    .slice(-TREND_SESSIONS)
    .map((s) => ({
      label: shortDate(localDate(s.at)),
      netWpm: roundWpm(s.netWpm),
      accuracyPct: roundPct(s.accuracy),
      sessions: 1,
    }));
}

/**
 * Weekly averages, oldest first, the last {@link TREND_WEEKS} weeks that had sessions. Older weeks
 * folded into `profile.weekly` (history compaction) join the weeks still in `history`.
 */
export function weeklyTrend(
  profile: Profile,
  weekStartOf: (at: EpochMs) => string = localWeekStart,
): TrendPoint[] {
  const weeks = new Map<string, { n: number; wpm: number; acc: number }>();
  const add = (week: string, n: number, wpm: number, acc: number): void => {
    const w = weeks.get(week) ?? { n: 0, wpm: 0, acc: 0 };
    weeks.set(week, { n: w.n + n, wpm: w.wpm + wpm, acc: w.acc + acc });
  };
  for (const w of profile.weekly) {
    if (w.sessions > 0)
      add(w.weekStart, w.sessions, w.avgNetWpm * w.sessions, w.avgAccuracy * w.sessions);
  }
  for (const s of profile.history) if (rated(s)) add(weekStartOf(s.at), 1, s.netWpm, s.accuracy);
  return [...weeks.entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(-TREND_WEEKS)
    .map(([week, w]) => ({
      label: t("parent.weekOf", { date: shortDate(week) }),
      netWpm: roundWpm(w.wpm / w.n),
      accuracyPct: roundPct(Math.min(1, w.acc / w.n)),
      sessions: w.n,
    }));
}

// ---------------------------------------------------------------------------------------------
// Minutes per day
// ---------------------------------------------------------------------------------------------

export interface DayMinutes {
  date: string;
  label: string;
  minutes: number;
}

/**
 * Minutes practised on each of the last {@link MINUTE_DAYS} local days, ending on `today`'s day,
 * oldest first. Every session counts, remedial practice and the placement test included.
 */
export function minutesPerDay(
  profile: Profile,
  today: EpochMs,
  days: number = MINUTE_DAYS,
): DayMinutes[] {
  const ms = new Map<string, number>();
  for (const s of profile.history) {
    const day = localDate(s.at);
    ms.set(day, (ms.get(day) ?? 0) + s.activeMs);
  }
  const end = new Date(today);
  const out: DayMinutes[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    // Calendar steps, not 24 h steps, so a daylight-saving change never skips or repeats a day.
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    const date = localDate(d.getTime());
    out.push({ date, label: shortDate(date), minutes: roundMinutes(ms.get(date) ?? 0) });
  }
  return out;
}

/** True when `minutesPerDay` would be all zeros (nothing in the window). */
export const noMinutes = (days: readonly DayMinutes[]): boolean =>
  days.every((d) => d.minutes === 0);

// ---------------------------------------------------------------------------------------------
// Keys and letter pairs
// ---------------------------------------------------------------------------------------------

/** One key of the heat map. */
export interface HeatKey {
  code: string;
  /** What the key types (lowercase), `" "` for Space. */
  char: string;
  row: number;
  x: number;
  w: number;
  attempts: number;
  /** Recent mistakes per press, 0–1, or null with fewer than {@link MIN_KEY_ATTEMPTS} presses. */
  rate: number | null;
}

/**
 * Every key of `layout` with its recent mistake rate. A key's plain and Shift chars are one key
 * (`a` and `A`), weighted by presses.
 */
export function keyHeat(profile: Profile, layout: LayoutDef): HeatKey[] {
  const out: HeatKey[] = [];
  layout.rows.forEach((row, r) => {
    for (const key of row.keys) {
      const chars = new Set([key.base, key.base.toUpperCase(), ...(key.shift ? [key.shift] : [])]);
      let attempts = 0;
      let weighted = 0;
      for (const c of chars) {
        const stat = profile.keyStats[c];
        if (stat === undefined || stat.attempts <= 0) continue;
        attempts += stat.attempts;
        weighted += stat.recentErrRate * stat.attempts;
      }
      out.push({
        code: key.code,
        char: key.base,
        row: r,
        x: key.x,
        w: key.w ?? 1,
        attempts,
        rate: attempts >= MIN_KEY_ATTEMPTS ? weighted / attempts : null,
      });
    }
  });
  return out;
}

/** The keys to practice: highest recent mistake rate first, at most {@link TOP_WEAK}. */
export function weakKeys(heat: readonly HeatKey[]): HeatKey[] {
  return heat
    .filter((k): k is HeatKey & { rate: number } => k.rate !== null && roundPct(k.rate) > 0)
    .toSorted((a, b) => b.rate - a.rate || b.attempts - a.attempts)
    .slice(0, TOP_WEAK);
}

export interface WeakPair {
  pair: string;
  ratePct: number;
  attempts: number;
}

/** The letter pairs to practice (Builder band): highest recent mistake rate first. */
export function weakBigrams(profile: Profile): WeakPair[] {
  return Object.entries(profile.bigramStats)
    .filter(([, s]) => s.attempts >= MIN_BIGRAM_ATTEMPTS && roundPct(s.recentErrRate) > 0)
    .toSorted(
      ([a, x], [b, y]) =>
        y.recentErrRate - x.recentErrRate || y.attempts - x.attempts || (a < b ? -1 : 1),
    )
    .slice(0, TOP_WEAK)
    .map(([pair, s]) => ({ pair, ratePct: roundPct(s.recentErrRate), attempts: s.attempts }));
}

/** Heat map bins by recent mistake rate: upper bounds of bins 0–3; bin 4 is everything above. */
export const HEAT_BINS = [0.02, 0.05, 0.1, 0.2] as const;
export type HeatBin = 0 | 1 | 2 | 3 | 4;

export function heatBin(rate: number): HeatBin {
  if (rate < HEAT_BINS[0]) return 0;
  if (rate < HEAT_BINS[1]) return 1;
  if (rate < HEAT_BINS[2]) return 2;
  if (rate < HEAT_BINS[3]) return 3;
  return 4;
}

// ---------------------------------------------------------------------------------------------
// Curriculum
// ---------------------------------------------------------------------------------------------

/** One lesson's line in curriculum progress. */
export interface LessonLine {
  id: string;
  title: string;
  state: "notYet" | "testedOut" | "played";
  stars: number;
  bestWpm: number | null;
  bestPct: number | null;
}

export interface BiomeLine {
  biome: BiomeId;
  name: string;
  lessons: LessonLine[];
  stars: number;
  maxStars: number;
  played: number;
  testedOut: number;
}

/**
 * Stars per biome, in curriculum order, for biomes that have lessons. Stars are the same the map
 * shows (a tested-out lesson keeps its one star). A tested-out lesson's WPM and accuracy are not
 * scores, so its line has none (`isTestedOut`).
 */
export function curriculumProgress(profile: Profile, lessons: readonly Lesson[]): BiomeLine[] {
  const list = [...curriculum(lessons).values()];
  const out: BiomeLine[] = [];
  for (const biome of BIOME_ORDER) {
    const own = list.filter((l) => l.biome === biome).toSorted((a, b) => a.order - b.order);
    if (own.length === 0) continue;
    const lines = own.map((l): LessonLine => {
      const rec = profile.progress.lessons[l.id];
      const title = t(l.titleKey);
      if (rec === undefined) {
        return { id: l.id, title, state: "notYet", stars: 0, bestWpm: null, bestPct: null };
      }
      if (isTestedOut(rec)) {
        return {
          id: l.id,
          title,
          state: "testedOut",
          stars: rec.bestStars,
          bestWpm: null,
          bestPct: null,
        };
      }
      return {
        id: l.id,
        title,
        state: "played",
        stars: rec.bestStars,
        bestWpm: roundWpm(rec.bestNetWpm),
        bestPct: roundPct(rec.bestAccuracy),
      };
    });
    out.push({
      biome,
      name: t(`map.biome.${biome}`),
      lessons: lines,
      stars: lines.reduce((n, l) => n + l.stars, 0),
      maxStars: lines.length * 3,
      played: lines.filter((l) => l.state === "played").length,
      testedOut: lines.filter((l) => l.state === "testedOut").length,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------------------------

export interface Totals {
  sessions: number;
  minutes: number;
}

/** Every session ever, including weeks folded out of `history`. */
export function totals(profile: Profile): Totals {
  let sessions = profile.history.length;
  let ms = profile.history.reduce((n, s) => n + s.activeMs, 0);
  for (const w of profile.weekly) {
    sessions += w.sessions;
    ms += w.minutes * 60000;
  }
  return { sessions, minutes: Math.round(ms / 60000) };
}
