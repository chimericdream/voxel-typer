/**
 * Save data schema (docs/impl/contracts.md §15). Pure.
 *
 * Everything stays on the device. A profile holds a nickname and an age band; no real names, no
 * email, no birth date. Orchestrator-owned after M1-09.
 */
import type { SessionSummary, KeyStat } from "@/engine/stats";
import type { VoxelGrid } from "@/render/mesher/voxel-grid";
import type { AchievementId, AgeBand, BiomeId, BlockId, EpochMs, LessonId } from "@/types/core";
import { BIOME_ORDER } from "@/types/core";
import type { Settings } from "./settings";

/** One learner's saved state. At most 8 profiles per device. */
export interface Profile {
  /** From `newId()` (`./id`), not `crypto.randomUUID()` directly; see the note there. */
  id: string;
  /** A nickname, 1–16 chars, validated by the word-list blocklist. */
  name: string;
  ageBand: AgeBand;
  avatar: { skin: string; hat?: string; pickaxe?: string; cape?: string; pet?: string };
  createdAt: EpochMs;
  settings: Settings;
  progress: {
    lessons: Record<
      LessonId,
      {
        bestStars: 0 | 1 | 2 | 3;
        bestNetWpm: number;
        bestAccuracy: number;
        plays: number;
        lastPlayed: EpochMs;
      }
    >;
    /** Nothing ever re-locks (contracts §6). */
    unlockedBiomes: BiomeId[];
    placement?: { doneAt: EpochMs; startBiome: BiomeId };
  };
  /** Counts finished sessions. Spaced repetition is scheduled in sessions, not days. */
  sessionCounter: number;
  keyStats: Record<string, KeyStat>;
  bigramStats: Record<string, KeyStat>;
  inventory: Record<BlockId, number>;
  island: {
    grid: ReturnType<VoxelGrid["toJSON"]>;
    expansions: number;
    lastEdited: EpochMs;
  } | null;
  cosmetics: { unlocked: string[] };
  /** Achievement id → unlock time. */
  achievements: Record<AchievementId, EpochMs>;
  /** Dates are `"YYYY-MM-DD"`, local. */
  daily: { lastDone?: string; streakDates: string[] };
  /** Newest last. Capped at 500; the oldest are then compacted into `weekly`. */
  history: StoredSummary[];
  weekly: {
    weekStart: string;
    minutes: number;
    sessions: number;
    avgNetWpm: number;
    avgAccuracy: number;
  }[];
  schemaVersion: number;
}

/** A session summary as kept in `Profile.history`: without the per-key detail, plus when it ended. */
export type StoredSummary = Omit<SessionSummary, "perKey" | "bigrams"> & { at: EpochMs };

/** The schema version this build writes. Bump it together with a new entry in `./migrations`. */
export const SCHEMA_VERSION = 1;

/** Longest nickname, in characters (code points). */
export const NAME_MAX = 16;

// -------------------------------------------------------------------------------------------------
// Structural validator. Hand-written, no dependency (task M1-09). Each check returns the first
// problem it finds as `"<path>: <what>"`, or null when the value has the right shape. Extra keys
// are allowed; missing or mistyped ones are not. Numbers must be finite: JSON turns NaN and
// Infinity into null, so a non-finite number would not survive a round trip anyway.
// -------------------------------------------------------------------------------------------------

type Check = (v: unknown, path: string) => string | null;

const AGE_BANDS: readonly string[] = ["sprout", "miner", "builder"];
const BIOMES: readonly string[] = BIOME_ORDER;
const MODES: readonly string[] = [
  "mine",
  "defense",
  "minecart",
  "builder",
  "boss",
  "daily",
  "practice",
  "placement",
];
const FONTS: readonly string[] = ["pixel", "clean", "dyslexic"];
const QUALITIES: readonly string[] = ["low", "medium", "high", "auto"];
const BUSES: readonly string[] = ["master", "music", "sfx", "voice"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function rangeText(min: number, max: number): string {
  const noMax = max === Infinity || max === Number.MAX_SAFE_INTEGER;
  if (min === -Infinity && noMax) return "";
  if (noMax) return ` ≥ ${min}`;
  if (min === -Infinity) return ` ≤ ${max}`;
  return ` from ${min} to ${max}`;
}

const num =
  (min = -Infinity, max = Infinity): Check =>
  (v, path) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
      ? null
      : `${path}: expected a number${rangeText(min, max)}`;

const int =
  (min = 0, max = Number.MAX_SAFE_INTEGER): Check =>
  (v, path) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max
      ? null
      : `${path}: expected a whole number${rangeText(min, max)}`;

const bool: Check = (v, path) => (typeof v === "boolean" ? null : `${path}: expected true/false`);

const str =
  (minLen = 0, maxLen = Infinity): Check =>
  (v, path) => {
    if (typeof v !== "string") return `${path}: expected text`;
    const len = Array.from(v).length;
    if (len >= minLen && len <= maxLen) return null;
    return maxLen === Infinity
      ? `${path}: expected at least ${minLen} characters`
      : `${path}: expected ${minLen} to ${maxLen} characters`;
  };

const oneOf =
  (allowed: readonly string[]): Check =>
  (v, path) =>
    typeof v === "string" && allowed.includes(v)
      ? null
      : `${path}: expected one of ${allowed.join(", ")}`;

const date: Check = (v, path) =>
  typeof v === "string" && DATE_RE.test(v) ? null : `${path}: expected a YYYY-MM-DD date`;

const nullable =
  (inner: Check): Check =>
  (v, path) =>
    v === null ? null : inner(v, path);

const either =
  (a: Check, b: Check): Check =>
  (v, path) =>
    a(v, path) === null ? null : b(v, path);

const arrayOf =
  (item: Check): Check =>
  (v, path) => {
    if (!Array.isArray(v)) return `${path}: expected a list`;
    for (const [i, x] of v.entries()) {
      const p = item(x, `${path}[${i}]`);
      if (p !== null) return p;
    }
    return null;
  };

const recordOf =
  (value: Check): Check =>
  (v, path) => {
    if (!isRecord(v)) return `${path}: expected an object`;
    for (const [k, x] of Object.entries(v)) {
      const p = value(x, `${path}[${JSON.stringify(k)}]`);
      if (p !== null) return p;
    }
    return null;
  };

/** `required` keys must be present; `optional` keys may be absent but not mistyped. */
const shape =
  (required: Record<string, Check>, optional: Record<string, Check> = {}): Check =>
  (v, path) => {
    if (!isRecord(v)) return `${path}: expected an object`;
    for (const [k, check] of Object.entries(required)) {
      if (!Object.hasOwn(v, k)) return `${path}.${k}: missing`;
      const p = check(v[k], `${path}.${k}`);
      if (p !== null) return p;
    }
    for (const [k, check] of Object.entries(optional)) {
      if (!Object.hasOwn(v, k)) continue;
      const p = check(v[k], `${path}.${k}`);
      if (p !== null) return p;
    }
    return null;
  };

const settingsCheck: Check = shape({
  textScale: num(1, 2),
  showKeyboard: bool,
  showHands: bool,
  calmMode: bool,
  reducedMotion: either(bool, oneOf(["system"])),
  highContrast: bool,
  font: oneOf(FONTS),
  tts: bool,
  volume: shape(Object.fromEntries(BUSES.map((b) => [b, num(0, 1)]))),
  quality: oneOf(QUALITIES),
  breakReminderMin: num(0),
  layout: str(1, 32),
});

const keyStatCheck: Check = shape({
  attempts: int(),
  errors: int(),
  recentErrRate: num(0, 1),
  latencyMedian: nullable(num(0)),
  recentLatencies: arrayOf(num(0)),
  lastSeenSession: int(),
  srs: shape({ intervalSessions: num(0), dueSession: num(0) }),
});

const storedSummaryCheck: Check = shape(
  {
    mode: oneOf(MODES),
    seed: num(),
    startedAtT: num(),
    activeMs: num(0),
    keystrokes: int(),
    correct: int(),
    errors: int(),
    uncorrected: int(),
    grossWpm: num(0),
    netWpm: num(0),
    accuracy: num(0, 1),
    consistency: num(0, 1),
    longestStreak: int(),
    targetsCompleted: int(),
    at: num(0),
  },
  { lessonId: str(1) },
);

const weeklyCheck: Check = shape({
  weekStart: date,
  minutes: num(0),
  sessions: int(),
  avgNetWpm: num(0),
  avgAccuracy: num(0, 1),
});

const profileCheck: Check = shape({
  id: str(1, 64),
  name: str(1, NAME_MAX),
  ageBand: oneOf(AGE_BANDS),
  avatar: shape({ skin: str(1, 64) }, { hat: str(), pickaxe: str(), cape: str(), pet: str() }),
  createdAt: num(0),
  settings: settingsCheck,
  progress: shape(
    {
      lessons: recordOf(
        shape({
          bestStars: int(0, 3),
          bestNetWpm: num(0),
          bestAccuracy: num(0, 1),
          plays: int(),
          lastPlayed: num(0),
        }),
      ),
      unlockedBiomes: arrayOf(oneOf(BIOMES)),
    },
    { placement: shape({ doneAt: num(0), startBiome: oneOf(BIOMES) }) },
  ),
  sessionCounter: int(),
  keyStats: recordOf(keyStatCheck),
  bigramStats: recordOf(keyStatCheck),
  inventory: recordOf(int()),
  island: nullable(
    shape({
      grid: shape({ sx: int(1), sy: int(1), sz: int(1), rle: arrayOf(int()) }),
      expansions: int(),
      lastEdited: num(0),
    }),
  ),
  cosmetics: shape({ unlocked: arrayOf(str()) }),
  achievements: recordOf(num(0)),
  daily: shape({ streakDates: arrayOf(date) }, { lastDone: date }),
  history: arrayOf(storedSummaryCheck),
  weekly: arrayOf(weeklyCheck),
  schemaVersion: int(1),
});

/**
 * Why `v` is not a valid current-version {@link Profile}, as `"<path>: <what>"`, or null when it
 * is. Checks structure only: the nickname blocklist is the profile screen's job (M1-10's list).
 */
export function profileProblem(v: unknown): string | null {
  const p = profileCheck(v, "profile");
  if (p !== null) return p;
  if (isRecord(v) && v["schemaVersion"] !== SCHEMA_VERSION) {
    return `profile.schemaVersion: expected ${SCHEMA_VERSION}`;
  }
  return null;
}

/** True when `v` is a valid current-version {@link Profile}. */
export function isProfile(v: unknown): v is Profile {
  return profileProblem(v) === null;
}
