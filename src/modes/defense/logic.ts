/**
 * Night Defense's rules, without the DOM, three.js or a clock (task M4-04, PLAN.md §3.2.2).
 *
 * Everything here is a pure function of its arguments: how long a night is, where a mob is on its
 * lane, the shield, the wave's score for the director, the word plates' layout, and the camera
 * framing. `defense.ts` wires these to the scene, the HUD and the sound.
 *
 * **Nothing is ever lost.** The shield is the only thing that goes down, it only goes down to
 * zero, and it comes back at dawn. No function here returns less loot, fewer stars or less
 * progress than it was given.
 */
import type { Lesson } from "@/content/lessons/types";
import { BASELINE_MODES, BASELINE_MIN_SUMMARIES, BASELINE_WINDOW } from "@/engine/stars";
import { median } from "@/engine/stats";
import type { TargetView } from "@/engine/types";
import type { AgeBand, GameModeId, Ms } from "@/types/core";
import type { WaveFeedback, WaveSpec } from "./director";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------------------------
// The night's phases
// ---------------------------------------------------------------------------------------------

/**
 * `day`: the camp in daylight, "Night is coming!". `dusk`: the first wave is announced.
 * `night`: waves. `dawn`: the sun rises, the shield grows back, then Results.
 */
export type Phase = "loading" | "day" | "dusk" | "night" | "dawn" | "done";

/** The day phase (card: 10 s). A key press shortens what is left to {@link DAY_SKIP_MS}. */
export const DAY_MS: Ms = 10_000;
/** Keys are ignored for this long at the start of the day, so a held key can't skip it unseen. */
export const DAY_HOLD_MS: Ms = 1500;
export const DAY_SKIP_MS: Ms = 500;
/**
 * Dusk: the first wave's announcement stays up this long, then the sky turns to night. The first
 * wave starts with dusk, so its first mob sets out while the announcement is still up (M4-FIX-2).
 */
export const DUSK_MS: Ms = 4000;
/**
 * The longest pause between two waves, and how long the next wave's announcement stays up. The
 * pause is shorter in practice: it ends so that the next mob sets out the director's `maxIdleMs`
 * after the field emptied (M4-FIX-2).
 */
export const INTERMISSION_MS: Ms = 3000;
/** Dawn: the sky brightens, the shield fills, the loot lands. Then Results. */
export const DAWN_MS: Ms = 4500;
export const DAWN_REDUCED_MS: Ms = 2500;

/**
 * The most night a child plays (dusk and night, game time), per band (M4-FIX-3 review). A slow
 * learner's waves are long, so a 5-wave lesson could take most of a sitting. Once a wave ends past
 * this, dawn comes next, whatever the wave count says. Stars count the visitors sent home, not the
 * waves, so an early dawn costs the child nothing.
 */
export const NIGHT_CAP_MS: Readonly<Record<AgeBand, Ms>> = {
  sprout: 240_000,
  miner: 300_000,
  builder: 300_000,
};

/**
 * Whether the night is over once a wave ends: every wave was played, or the band's
 * {@link NIGHT_CAP_MS} has passed (the wave that was on still finishes first).
 */
export function nightOver(wavesDone: number, waves: number, nightMs: Ms, band: AgeBand): boolean {
  return wavesDone >= waves || nightMs >= NIGHT_CAP_MS[band];
}

/**
 * The walk anim's playback rate for a mob that walks its lane at `speed` (lane lengths a second).
 * The clips are paced for a lane walked in {@link WALK_REF_MS}; a slower mob plays them slower, so
 * a slow learner's mobs don't slide their feet (M4-FIX-3 review). Never faster than authored, and
 * never under 0.4, where the cycle would read as frozen.
 */
export function walkRate(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return WALK_RATE_MIN;
  return clamp((speed * WALK_REF_MS) / 1000, WALK_RATE_MIN, 1);
}
/** A lane walked in this long plays the walk clip at its own pace. */
export const WALK_REF_MS: Ms = 20_000;
const WALK_RATE_MIN = 0.4;

/** Waves in a night with no lesson (free play). */
export const DEFAULT_WAVES = 3;
/** A night is never shorter or longer than this many waves. */
export const WAVES_MIN = 2;
export const WAVES_MAX = 5;
/** About how long one wave lasts end to end, for turning a `seconds` lesson into waves. */
const WAVE_SECONDS: Readonly<Record<AgeBand, number>> = { sprout: 30, miner: 35, builder: 40 };
/** About how many chars one wave holds, for turning a `chars` lesson into waves. */
const WAVE_CHARS: Readonly<Record<AgeBand, number>> = { sprout: 16, miner: 27, builder: 36 };
/** About how many mobs one wave holds, for turning a `targets` lesson into waves. */
const WAVE_TARGETS = 8;
/** Length multiplier per band when the lesson has none (contracts §6). */
const BAND_SCALE: Readonly<Record<AgeBand, number>> = { sprout: 0.6, miner: 1, builder: 1.3 };

/**
 * How many waves a night has. The director sizes each wave by time (20–30 s of spawns), so the
 * lesson's length picks the number of waves: about one wave per 30–40 s, per 16–36 chars or per
 * 8 targets, inside {@link WAVES_MIN}–{@link WAVES_MAX}.
 */
export function nightWaves(
  lesson: Pick<Lesson, "length" | "bandScale"> | null,
  band: AgeBand,
): number {
  if (lesson === null) return DEFAULT_WAVES;
  const len = lesson.length;
  // A `seconds` lesson is already an amount of time: the band scale isn't applied twice.
  const scale = lesson.bandScale?.[band] ?? ("seconds" in len ? 1 : BAND_SCALE[band]);
  const raw =
    "seconds" in len
      ? (len.seconds * scale) / WAVE_SECONDS[band]
      : "chars" in len
        ? (len.chars * scale) / WAVE_CHARS[band]
        : (len.targets * scale) / WAVE_TARGETS;
  return clamp(Math.round(Number.isFinite(raw) ? raw : DEFAULT_WAVES), WAVES_MIN, WAVES_MAX);
}

/** Lesson progress, 0–1: waves done, plus the share of the current wave's mobs that are gone. */
export function nightProgress(
  wavesDone: number,
  waves: number,
  gone: number,
  total: number,
): number {
  if (!(waves > 0)) return 0;
  const part = total > 0 ? clamp(gone / total, 0, 1) : 0;
  return clamp((Math.max(0, wavesDone) + part) / waves, 0, 1);
}

// ---------------------------------------------------------------------------------------------
// Lanes and mobs
// ---------------------------------------------------------------------------------------------

/** The arena is built with this many lanes for a band: the most its waves ever use. */
export const BAND_LANES: Readonly<Record<AgeBand, number>> = { sprout: 3, miner: 4, builder: 5 };

const whole = (v: number): number => (Number.isFinite(v) ? Math.floor(v) : 0);

/**
 * Which of the arena's `built` lanes a wave's lane `lane` (of `used`) walks on. A wave that uses
 * fewer lanes than the arena has spreads over them, outer lanes first: 2 of 3 are the left and
 * the right one.
 */
export function laneSlot(lane: number, used: number, built: number): number {
  const n = Math.max(1, whole(built));
  const k = clamp(whole(used), 1, n);
  const i = clamp(whole(lane), 0, k - 1);
  if (k === 1) return Math.floor((n - 1) / 2);
  return Math.round((i * (n - 1)) / (k - 1));
}

/**
 * - `walking`: on its way to the base.
 * - `waiting`: calm mode, standing at the waiting line (or behind the mob that is).
 * - `popping`: its word was typed; the `defeat` anim plays, then it is gone.
 * - `bonking`: it reached the base; it hops back, poofs, and is gone.
 */
export type MobState = "walking" | "waiting" | "popping" | "bonking";

/** One mob on the field. `p` is how far along its lane it is: 0 at the far end, 1 at the base. */
export interface FieldMob {
  readonly id: string;
  readonly mobId: string;
  /** The arena lane it walks on (a slot, see {@link laneSlot}). */
  readonly slot: number;
  readonly word: string;
  /** Lane lengths per second. */
  readonly speed: number;
  p: number;
  state: MobState;
}

/**
 * True while no mob on the field still needs typing: every one is popping or bonking, or there are
 * none. That is the "empty field" the director's `maxIdleMs` limits (M4-FIX-2).
 */
export function fieldEmpty(mobs: readonly Pick<FieldMob, "state">[]): boolean {
  return !mobs.some((m) => m.state === "walking" || m.state === "waiting");
}

/** Calm mode: mobs in one lane wait this far apart, as a share of the lane. */
export const QUEUE_GAP = 0.2;

/**
 * Moves the walking mobs by `dtMs`. Returns the mobs that reached the base in this step (state
 * still `walking`: the caller turns them into `bonking`).
 *
 * In calm mode nobody reaches the base: the first mob of each lane stops at `waitP` and the ones
 * behind it stop {@link QUEUE_GAP} apart. When the mob in front is typed away, the rest walk up.
 */
export function stepMobs(
  mobs: readonly FieldMob[],
  dtMs: Ms,
  opts: { calm: boolean; waitP: number },
): FieldMob[] {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const arrived: FieldMob[] = [];
  if (!opts.calm) {
    for (const m of mobs) {
      if (m.state !== "walking") continue;
      m.p = Math.min(1, m.p + (m.speed * dt) / 1000);
      if (m.p >= 1) arrived.push(m);
    }
    return arrived;
  }
  // Calm: per lane, front to back. A popping mob still holds its place until it is gone.
  const bySlot = new Map<number, FieldMob[]>();
  for (const m of mobs) {
    const list = bySlot.get(m.slot);
    if (list) list.push(m);
    else bySlot.set(m.slot, [m]);
  }
  for (const lane of bySlot.values()) {
    lane.sort((a, b) => b.p - a.p);
    let limit = opts.waitP;
    for (const m of lane) {
      if (m.state === "walking" || m.state === "waiting") {
        const next = Math.min(limit, m.p + (m.speed * dt) / 1000);
        m.p = Math.max(m.p, next);
        m.state = m.p >= limit - 1e-9 ? "waiting" : "walking";
      }
      limit = Math.min(limit, m.p) - QUEUE_GAP;
    }
  }
  return arrived;
}

/**
 * The key the on-screen keyboard should light: the next char of the locked word, else the first
 * char of the mob nearest the base (a hint for where to start), else nothing.
 */
export function nextKeyFor(active: TargetView | null, mobs: readonly FieldMob[]): string | null {
  if (active !== null && !active.complete) return Array.from(active.text)[active.typed] ?? null;
  let best: FieldMob | null = null;
  for (const m of mobs) {
    if (m.state !== "walking" && m.state !== "waiting") continue;
    if (best === null || m.p > best.p) best = m;
  }
  return best === null ? null : (Array.from(best.word)[0] ?? null);
}

// ---------------------------------------------------------------------------------------------
// The shield
// ---------------------------------------------------------------------------------------------

/** Segments of the shield bar. A mob at the base takes one; dawn brings them all back. */
export const SHIELD_SEGMENTS = 5;

/**
 * The shield after a bonk. It never goes under zero, and at zero nothing else happens: mobs bounce
 * off until dawn. `emptied` is true only for the bonk that took the last segment (the moment the
 * "needs a rest" banner shows).
 */
export function bonkShield(shield: number): { shield: number; emptied: boolean } {
  const before = clamp(Math.floor(shield), 0, SHIELD_SEGMENTS);
  const after = Math.max(0, before - 1);
  return { shield: after, emptied: before > 0 && after === 0 };
}

// ---------------------------------------------------------------------------------------------
// Scoring a wave for the director
// ---------------------------------------------------------------------------------------------

/** What happened in one wave, counted from the engine's events. */
export interface WaveTally {
  keystrokes: number;
  correct: number;
  wordsDone: number;
  reachedBase: number;
  /** Frame time while the wave was live (paused time never reaches `frame`). */
  activeMs: Ms;
  /** How far an empty field moved the wave's spawn clock forward (`idlePullMs`), in all. */
  pulledMs: Ms;
}

export const emptyTally = (): WaveTally => ({
  keystrokes: 0,
  correct: 0,
  wordsDone: 0,
  reachedBase: 0,
  activeMs: 0,
  pulledMs: 0,
});

/**
 * The director's feedback for a wave. `reachedBase` counts every mob that got to the base, also
 * while the shield was at zero: it still got through.
 */
export function waveFeedback(t: Readonly<WaveTally>): WaveFeedback {
  return {
    accuracy: t.keystrokes > 0 ? clamp(t.correct / t.keystrokes, 0, 1) : 1,
    reachedBase: t.reachedBase,
    wordsDone: t.wordsDone,
    activeMs: t.activeMs,
    pulledMs: t.pulledMs,
  };
}

/**
 * The learner's unhurried accuracy for the director: the median accuracy of their last 10 Mine,
 * practice and Minecart sessions (the same sessions as the WPM baseline, contracts §6), or null
 * with fewer than 3.
 */
export function baselineAccuracy(
  history: readonly { mode: GameModeId; accuracy: number }[],
): number | null {
  const recent = history
    .filter((h) => BASELINE_MODES.includes(h.mode) && Number.isFinite(h.accuracy))
    .slice(-BASELINE_WINDOW);
  if (recent.length < BASELINE_MIN_SUMMARIES) return null;
  return median(recent.map((h) => h.accuracy));
}

/**
 * Typing speed while a word was locked, in WPM: a night's own net WPM also counts the time spent
 * waiting for mobs to arrive, which says nothing about the typist. Used only for Builder's speed
 * star. Each word gives `length − 1` key gaps over the time from its first key to its last.
 */
export function lockedWpm(words: readonly { chars: number; durationMs: Ms }[]): number {
  let gaps = 0;
  let ms = 0;
  for (const w of words) {
    if (!(w.chars > 1) || !(w.durationMs > 0)) continue;
    gaps += w.chars - 1;
    ms += w.durationMs;
  }
  return ms > 0 ? gaps / 5 / (ms / 60_000) : 0;
}

/** A night's 2nd star needs this share of the visitors sent home, and its 3rd this share. */
export const STAR_SHARE = { second: 0.5, third: 0.8 } as const;

/**
 * A night's stars. Accuracy alone would give three stars to a child who typed one word well and
 * let every other visitor walk in, or who typed nothing at all, so the accuracy stars also ask
 * that most visitors were sent home. The first star is for seeing the night through, always.
 * Stars are only ever earned: a lesson keeps its best (contracts §6).
 */
export function nightStars(stars: 0 | 1 | 2 | 3, popped: number, reached: number): 0 | 1 | 2 | 3 {
  const total = Math.max(0, popped) + Math.max(0, reached);
  const share = total > 0 ? Math.max(0, popped) / total : 0;
  if (stars <= 1 || share >= STAR_SHARE.third) return stars;
  return share >= STAR_SHARE.second ? 2 : 1;
}

// ---------------------------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------------------------

/**
 * What the wave announcement says: the mob it names and how many are coming. A wave of one kind
 * names it ("3 slimelings are on the way!"); a mixed wave says "friends".
 */
export function waveAnnouncement(wave: Pick<WaveSpec, "mobs">): {
  mobId: string | null;
  count: number;
} {
  const kinds = new Set(wave.mobs.map((m) => m.mobId));
  const only = kinds.size === 1 ? (wave.mobs[0]?.mobId ?? null) : null;
  return { mobId: only, count: wave.mobs.length };
}

// ---------------------------------------------------------------------------------------------
// Word plates
// ---------------------------------------------------------------------------------------------

/** A plate that wants to sit with its bottom middle at (`x`, `y`), in CSS pixels. */
export interface PlateWish {
  readonly id: string;
  /** Middle of the plate. */
  readonly x: number;
  /** Bottom edge of the plate: just above the mob's head. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Lower is placed first and so moves least: the locked mob, then the ones nearest the base. */
  readonly order: number;
  /**
   * The mob's head on the page ({@link mobHead}). Other plates keep off it (M4-FIX-7): a plate
   * over another mob's head hides that mob, and a child reads it as gone. Optional.
   */
  readonly head?: PlateBounds;
  /**
   * The side this plate slid to last frame, if it did (`PlatePlace.side`). While that side still
   * fits it is kept, so a plate doesn't jump from one side of a head to the other as mobs walk.
   */
  readonly side?: -1 | 1;
}

/** Where a plate went: its top-left corner. */
export interface PlatePlace {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /**
   * True when no free spot was found and the plate covers another mob's head. The plate layer
   * marks it (`data-covers`) and leaves it fully opaque: it is a word to read.
   */
  readonly covers: boolean;
  /** Slid sideways past a head: left (−1) or right (1); 0 when it wasn't. */
  readonly side: -1 | 0 | 1;
}

export interface PlateBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The plates' bounds with their top moved down below `banner` (the HUD's message over the stage),
 * so a banner never covers a word: the night's first mob sets out while the dusk announcement is
 * still up (M4-FIX-2). The layout keeps room for a one-line banner already; this covers a taller
 * one (a large text scale, a narrow screen). With no banner the bounds are unchanged.
 */
export function clearOfBanner(
  bounds: PlateBounds,
  banner: Pick<PlateBounds, "bottom"> | null,
  gap: number = PLATE_GAP,
): PlateBounds {
  if (banner === null || !Number.isFinite(banner.bottom)) return bounds;
  const top = Math.min(Math.max(bounds.top, banner.bottom + gap), bounds.bottom);
  return { ...bounds, top };
}

/** Plates keep at least this many pixels between them. */
export const PLATE_GAP = 4;

/** A mob's head box, as shares of its height on the page (top of the model to its feet). */
export const HEAD_SHARE = 0.4;
export const HEAD_WIDTH_SHARE = 0.7;

/**
 * A mob's head on the page: the top {@link HEAD_SHARE} of its height, {@link HEAD_WIDTH_SHARE} of
 * it wide, centred on `x`. `top` is the model's top and `feet` its feet, CSS px. Null when the mob
 * has no height on the page.
 */
export function mobHead(x: number, top: number, feet: number): PlateBounds | null {
  const h = feet - top;
  if (!(h > 0) || !Number.isFinite(h) || !Number.isFinite(x)) return null;
  const half = (h * HEAD_WIDTH_SHARE) / 2;
  return { left: x - half, top, right: x + half, bottom: top + h * HEAD_SHARE };
}

/** Slack for rounding: plates exactly `gap` apart must not count as touching. */
const EPS = 1e-6;

const overlaps = (a: PlatePlace, b: PlatePlace, gap: number): boolean =>
  a.left < b.left + b.width + gap - EPS &&
  b.left < a.left + a.width + gap - EPS &&
  a.top < b.top + b.height + gap - EPS &&
  b.top < a.top + a.height + gap - EPS;

/**
 * Lays the word plates out so that no two overlap (card: "plates never overlap: a small layout
 * pass nudges them vertically"), and so that no plate covers another mob's head (M4-FIX-7).
 *
 * Plates are placed in `order`. Each one starts above its mob, slid sideways just enough to stay
 * inside `bounds`. While it touches a plate already placed, or another mob's head, it moves
 * straight up to sit on top of whatever is in the way. When only heads are in the way it may
 * slide sideways instead, if that is nearer, but never so far that it stops spanning its own
 * mob's middle. If that takes it past the top of `bounds` it goes down from its mob instead. If
 * there is no room either way, heads are let go: it is placed clear of the plates alone, as before
 * M4-FIX-7, and marked `covers` when it lies on a head. If even that has no room it stacks above
 * the bounds rather than cover another word. So the result never has two overlapping plates,
 * whatever the input.
 */
export function layoutPlates(
  wishes: readonly PlateWish[],
  bounds: PlateBounds,
  gap: number = PLATE_GAP,
): PlatePlace[] {
  const sorted = wishes
    .filter(
      (w) =>
        w.width > 0 &&
        w.height > 0 &&
        Number.isFinite(w.width) &&
        Number.isFinite(w.height) &&
        Number.isFinite(w.x) &&
        Number.isFinite(w.y),
    )
    .toSorted((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const heads = sorted.flatMap((w) =>
    w.head === undefined ? [] : [{ id: w.id, box: boxOf(w.id, w.head) }],
  );
  const placed: PlatePlace[] = [];
  for (const w of sorted) {
    const maxLeft = Math.max(bounds.left, bounds.right - w.width);
    const wishLeft = clamp(w.x - w.width / 2, bounds.left, maxLeft);
    const wishTop = clamp(
      w.y - w.height,
      bounds.top,
      Math.max(bounds.top, bounds.bottom - w.height),
    );
    const at = (top: number, left = wishLeft): PlatePlace => ({
      id: w.id,
      left,
      top,
      width: w.width,
      height: w.height,
      covers: false,
      side: 0,
    });
    const wish = at(wishTop);
    // The point a sideways plate must still span: the mob's middle, or as near it as the bounds let.
    const middle = clamp(w.x, wishLeft, wishLeft + w.width);
    const others = heads.filter((h) => h.id !== w.id).map((h) => h.box);
    // Its own mob's head is kept clear too, so a plate moved down never lands on it.
    const avoid = heads.map((h) => h.box);
    const onPlates = (p: PlatePlace): PlatePlace[] => placed.filter((q) => overlaps(p, q, gap));
    const onHeads = (p: PlatePlace): PlatePlace[] => others.filter((q) => overlaps(p, q, 0));
    const blockers = (p: PlatePlace, withHeads: boolean): PlatePlace[] =>
      withHeads ? [...onPlates(p), ...avoid.filter((q) => overlaps(p, q, 0))] : onPlates(p);
    // Each step clears everything in the way and moves strictly on, so it ends within one step
    // per obstacle. The guard is for arithmetic that could not move a plate at all.
    const settle = (
      withHeads: boolean,
      step: (hit: PlatePlace[], p: PlatePlace) => PlatePlace | null,
    ): PlatePlace | null => {
      let p: PlatePlace | null = wish;
      const n = placed.length + (withHeads ? avoid.length : 0);
      for (let i = 0; i <= n && p !== null; i++) {
        const hit = blockers(p, withHeads);
        if (hit.length === 0) return p;
        p = step(hit, p);
      }
      return null;
    };
    const up = (hit: PlatePlace[], p: PlatePlace): PlatePlace =>
      at(Math.min(...hit.map((q) => q.top)) - gap - w.height, p.left);
    const down = (hit: PlatePlace[], p: PlatePlace): PlatePlace =>
      at(Math.max(...hit.map((q) => q.top + q.height)) + gap, p.left);
    // Sideways, only past heads: a plate in the way is passed by going up, as it always was.
    const side =
      (dir: -1 | 1) =>
      (hit: PlatePlace[], p: PlatePlace): PlatePlace | null => {
        if (onPlates(p).length > 0) return null;
        const left =
          dir < 0
            ? Math.min(...hit.map((q) => q.left)) - w.width
            : Math.max(...hit.map((q) => q.left + q.width));
        return { ...at(p.top, left), side: dir };
      };
    const fits = (p: PlatePlace | null): p is PlatePlace =>
      p !== null &&
      p.top >= bounds.top - EPS &&
      p.top + p.height <= bounds.bottom + EPS &&
      p.left >= bounds.left - EPS &&
      p.left <= maxLeft + EPS &&
      p.left <= middle + EPS &&
      middle <= p.left + p.width + EPS;
    const moved = (p: PlatePlace): number => Math.hypot(p.left - wish.left, p.top - wish.top);

    const options = [settle(true, up), settle(true, side(-1)), settle(true, side(1))].filter(fits);
    // The side used last frame wins while it still fits; otherwise the nearest spot.
    const near =
      options.find((p) => w.side !== undefined && p.side === w.side) ??
      options.toSorted((a, b) => moved(a) - moved(b))[0];
    const clear = near ?? settle(true, down);
    if (fits(clear)) {
      placed.push(clear);
      continue;
    }

    // No spot clear of the heads: clear of the plates alone, as before M4-FIX-7.
    const loose = (p: PlatePlace): PlatePlace =>
      onHeads(p).length > 0 ? { ...p, covers: true } : p;
    const upOnly = settle(false, up) ?? settleAbove(wish, placed, gap);
    if (upOnly.top >= bounds.top) {
      placed.push(loose(upOnly));
      continue;
    }
    const downOnly = settle(false, down);
    const downOk =
      downOnly !== null &&
      downOnly.top + w.height <= bounds.bottom &&
      onPlates(downOnly).length === 0;
    placed.push(
      loose(
        downOk
          ? downOnly
          : onPlates(upOnly).length === 0
            ? upOnly
            : settleAbove(upOnly, placed, gap),
      ),
    );
  }
  return placed;
}

/** A head box in the shape of a placed plate, so one overlap test covers both. */
function boxOf(id: string, b: PlateBounds): PlatePlace {
  return {
    id,
    left: b.left,
    top: b.top,
    width: b.right - b.left,
    height: b.bottom - b.top,
    covers: false,
    side: 0,
  };
}

/** Last resort: straight above every placed plate. Always free. */
function settleAbove(p: PlatePlace, placed: readonly PlatePlace[], gap: number): PlatePlace {
  const top = Math.min(p.top, ...placed.map((q) => q.top)) - gap - p.height - 1;
  return { ...p, top };
}

// ---------------------------------------------------------------------------------------------
// Framing the field
// ---------------------------------------------------------------------------------------------

/** A rectangle on the page, in CSS pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What the camera needs to know about the field (an `ArenaLayout` fits). */
export interface FieldShape {
  center: { x: number; y: number; z: number };
  width: number;
  farZ: number;
  baseZ: number;
  groundY: number;
}

/** A camera pose looking at the field from the front (yaw 0), plus the picture's shift. */
export interface LaneView {
  target: { x: number; y: number; z: number };
  /** Radians above the horizon. */
  pitch: number;
  distance: number;
  /** Vertical field of view, degrees. */
  fov: number;
  /** How far to slide the picture on the screen, CSS pixels (right and down are positive). */
  shiftX: number;
  shiftY: number;
}

/** Room kept at the top of the stage for the HUD's message, CSS px at its base font (20 px). */
export const BANNER_ROOM = 46;
/**
 * Room kept above the far end of the field for a locked word plate, CSS px at its base font (22 px):
 * the plate's height (line 1.15 em plus 0.32 em of padding, drawn 1.2× when locked), the 6 px gap
 * over the mob's head and a little more (`stageRoom` scales it with the real font).
 */
export const PLATE_ROOM = Math.round(1.8 * 22 + 12);
/**
 * The open field a short screen keeps under the message's and the plate's room, CSS px (M4-FIX-4).
 * The far end's mobs come out about 0.3 of it tall, so this keeps them near 48 px or more.
 */
export const FIELD_MIN_PX = 170;
/** The stage never gets less than this share of the screen (M4-FIX-4: "about 40 %"). */
export const STAGE_MIN_SHARE = 0.4;

/**
 * The word plates' font size, CSS px: `plates.ts`'s `min(22px × text scale, 5.4dvh)`.
 * `viewH` is the viewport's height.
 */
export function plateFontPx(viewH: number, textScale: number): number {
  return Math.min(22 * textScale, 0.054 * viewH);
}

/** The HUD message's font size, CSS px: `Hud.module.css`'s `min(20px × text scale, 3.6dvh)`. */
export function messageFontPx(viewH: number, textScale: number): number {
  return Math.min(20 * textScale, 0.036 * viewH);
}

/**
 * The room kept at the top of the stage: for the HUD's message, and over that for a far mob's
 * locked plate. Both follow their real font sizes, which a short screen caps (dvh), so at text
 * scale 2 on a 600 px screen the room is about 130 px, not 2 × 102.
 */
export function stageRoom(viewH: number, textScale: number): { banner: number; plate: number } {
  return {
    banner: (BANNER_ROOM * messageFontPx(viewH, textScale)) / 20,
    plate: 1.8 * plateFontPx(viewH, textScale) + 12,
  };
}

/**
 * The open stage's least height, CSS px, that Defense asks of the HUD (its `stage` slice): the
 * message's and the plate's room plus {@link FIELD_MIN_PX} of field, and never under
 * {@link STAGE_MIN_SHARE} of the screen. The HUD caps it and shrinks the keyboard to fit.
 */
export function stageFloor(viewH: number, textScale: number): number {
  const room = stageRoom(viewH, textScale);
  return Math.round(Math.max(STAGE_MIN_SHARE * viewH, FIELD_MIN_PX + room.banner + room.plate));
}

/**
 * The floor a mode asks for, held to the room above the keyboard at its smallest (`room`, CSS px;
 * null: unknown). The keys' floor wins over the field's (M4-FIX-4 review: accessibility and
 * learning come first), so a very short screen gets a smaller field, never smaller keys.
 */
export function capStageFloor(want: number, room: number | null): number {
  if (room === null || !Number.isFinite(room)) return want;
  return Math.max(0, Math.min(want, Math.floor(room)));
}

export const LANE_FOV = 38;
/**
 * World units kept in view above the far end of the lanes: a mob's height. Its plate's room is
 * kept in pixels on top of that (`fitLaneView`'s `plateRoom`), because a plate doesn't shrink with
 * distance.
 */
export const FIELD_HEADROOM = 2.6;
/** World units shown in front of the shield line: the fence and its lanterns. */
export const FIELD_FRONT = 1.5;
const PITCH_FLAT = (12 * Math.PI) / 180;
const PITCH_TALL = (36 * Math.PI) / 180;

/**
 * Where a world point lands on a `width` × `height` canvas for a camera at `pitch` and `distance`
 * from `target`, looking toward −z (the rig's yaw 0). The same pinhole math as three.js, so tests
 * can check the framing without a renderer. `z` is the depth along the view (≤ 0: behind).
 */
export function projectLane(
  p: { x: number; y: number; z: number },
  view: Pick<LaneView, "target" | "pitch" | "distance" | "fov">,
  size: { width: number; height: number },
): { x: number; y: number; z: number } {
  const sin = Math.sin(view.pitch);
  const cos = Math.cos(view.pitch);
  const vx = p.x - view.target.x;
  const vy = p.y - (view.target.y + view.distance * sin);
  const vz = p.z - (view.target.z + view.distance * cos);
  // Camera axes: right (1,0,0), up (0,cos,−sin), forward (0,−sin,−cos).
  const depth = -vy * sin - vz * cos;
  const up = vy * cos - vz * sin;
  const k = Math.tan((view.fov * Math.PI) / 360);
  const aspect = size.width / Math.max(1, size.height);
  const safe = Math.max(1e-6, depth);
  return {
    x: (vx / (safe * k * aspect) + 1) * 0.5 * size.width,
    y: (1 - up / (safe * k)) * 0.5 * size.height,
    z: depth,
  };
}

/** The corners that must stay in view: the fence line, and the far end with its headroom. */
function fieldCorners(f: FieldShape): { x: number; y: number; z: number }[] {
  const half = f.width / 2;
  const out: { x: number; y: number; z: number }[] = [];
  for (const side of [-1, 1]) {
    const x = f.center.x + side * half;
    out.push({ x, y: f.groundY, z: f.baseZ + FIELD_FRONT });
    out.push({ x, y: f.groundY + FIELD_HEADROOM * 0.6, z: f.baseZ });
    out.push({ x, y: f.groundY, z: f.farZ });
    out.push({ x, y: f.groundY + FIELD_HEADROOM, z: f.farZ });
  }
  return out;
}

/**
 * Frames the field inside `box`, the part of the canvas the HUD leaves free (M2-14: between the
 * top row and the on-screen keyboard). A flat, wide box gets a low camera, so the lanes fold up
 * toward the horizon and the mobs stay big; a tall box gets a higher one, which spreads the lanes
 * out. The camera comes as close as it can with the whole field in the box, and the picture is
 * then slid so the field sits in the middle of it.
 *
 * `plateRoom` pixels at the top of the box are left for the word plate of a mob at the far end,
 * so a plate never has to slide down over its own mob. With no box (the HUD isn't on the page) the
 * whole canvas is used.
 */
export function fitLaneView(
  field: FieldShape,
  canvas: { width: number; height: number },
  box: Box | null,
  plateRoom = 0,
): LaneView {
  const size = { width: Math.max(1, canvas.width), height: Math.max(1, canvas.height) };
  const open: Box = box ?? { left: 0, top: 0, width: size.width, height: size.height };
  const top = clamp(Number.isFinite(plateRoom) ? plateRoom : 0, 0, open.height * 0.4);
  const room: Box = { ...open, top: open.top + top, height: open.height - top };
  const w = Math.max(40, room.width * 0.94);
  const h = Math.max(40, room.height * 0.92);
  const shape = clamp((room.height / Math.max(1, room.width) - 0.14) / 0.3, 0, 1);
  const pitch = PITCH_FLAT + (PITCH_TALL - PITCH_FLAT) * shape;
  const corners = fieldCorners(field);
  const measure = (
    distance: number,
  ): { x0: number; x1: number; y0: number; y1: number; ok: boolean } => {
    const view = { target: field.center, pitch, distance, fov: LANE_FOV };
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let ok = true;
    for (const c of corners) {
      const s = projectLane(c, view, size);
      if (s.z <= 0.5) ok = false;
      x0 = Math.min(x0, s.x);
      x1 = Math.max(x1, s.x);
      y0 = Math.min(y0, s.y);
      y1 = Math.max(y1, s.y);
    }
    return { x0, x1, y0, y1, ok };
  };
  const fits = (distance: number): boolean => {
    const m = measure(distance);
    return m.ok && m.x1 - m.x0 <= w && m.y1 - m.y0 <= h;
  };
  let near = 4;
  let far = 400;
  for (let i = 0; i < 40; i++) {
    const mid = (near + far) / 2;
    if (fits(mid)) far = mid;
    else near = mid;
  }
  const m = measure(far);
  return {
    target: { ...field.center },
    pitch,
    distance: far,
    fov: LANE_FOV,
    shiftX: Math.round(room.left + room.width / 2 - (m.x0 + m.x1) / 2),
    shiftY: Math.round(room.top + room.height / 2 - (m.y0 + m.y1) / 2),
  };
}
