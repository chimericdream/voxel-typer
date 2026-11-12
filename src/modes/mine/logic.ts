/**
 * Mine mode's rules, without the DOM, three.js or a clock (task M2-13, PLAN.md §3.2.1, §3.4).
 *
 * Everything here is a pure function of its arguments: the crack stage of a block, the ore-vein
 * schedule, the loot fly queue, the wrong-key cue gate, which block a target shows, and how a
 * lesson turns into a session. `mine.ts` wires these to the scene, the HUD and the sound.
 */
import type { BlockDef, Rarity } from "@/content/blocks/types";
import type { Lesson } from "@/content/lessons/types";
import type { LootTable } from "@/content/loot/types";
import type { GenerateParams, WordPool } from "@/engine/generator";
import { LOOT_THRESHOLDS } from "@/engine/loot";
import type { LootDrop } from "@/engine/loot";
import type { Rng } from "@/engine/rng";
import type { SessionConfig, TargetView, WrongKeyPolicy } from "@/engine/types";
import { BIOME_ORDER } from "@/types/core";
import type { AgeBand, BiomeId, BlockId, Ms } from "@/types/core";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------------------------
// Crack stages
// ---------------------------------------------------------------------------------------------

/** The last crack overlay (stages run 0–9, as painted by the atlas). */
export const MAX_CRACK_STAGE = 9;

/**
 * The crack stage of a block after `typed` of `len` chars: `floor(9 × typed / len)`, kept inside
 * 0–9. A trailing space is not part of `len`, so a word whose letters are all typed sits at stage
 * 9 until its space breaks it.
 */
export function crackStage(typed: number, len: number): number {
  if (!(len > 0) || !(typed > 0)) return 0;
  return clamp(Math.floor((MAX_CRACK_STAGE * typed) / len), 0, MAX_CRACK_STAGE);
}

/**
 * The crack overlay to draw, or null for none. A fresh block is whole: stage 0 (a hairline) only
 * shows once the first key has landed.
 */
export function crackOverlay(typed: number, len: number): number | null {
  return typed > 0 ? crackStage(typed, len) : null;
}

/** Particles in the break burst: more for a longer word, inside 8–30 (M2-05's note). */
export function burstCount(len: number): number {
  return clamp(8 + 2 * Math.max(0, Math.floor(len)), 8, 30);
}

/**
 * The chime's step on the pentatonic ladder. In a word it climbs with each letter. Single-letter
 * blocks break on every key, so there the ladder climbs with the streak instead and starts over
 * every {@link CHIME_WRAP} keys, so it never climbs out of a comfortable range.
 */
export const CHIME_WRAP = 10;
export function chimeStep(indexInWord: number, len: number, streak: number): number {
  if (len > 1) return clamp(Math.floor(indexInWord), 0, CHIME_WRAP - 1);
  return (Math.max(1, Math.floor(streak)) - 1) % CHIME_WRAP;
}

// ---------------------------------------------------------------------------------------------
// Ore veins
// ---------------------------------------------------------------------------------------------

/** A bonus ore block is earned every this many correct keys in a row (card: 15, Sprout 10). */
export const ORE_VEIN_INTERVAL: Readonly<Record<AgeBand, number>> = {
  sprout: 10,
  miner: 15,
  builder: 15,
};

/**
 * The ore-vein schedule. `nextAt` is the streak that earns the next vein; `ready` means a vein was
 * earned and the next block to appear is the ore block.
 */
export interface VeinSchedule {
  readonly interval: number;
  readonly nextAt: number;
  readonly ready: boolean;
}

export function createVeinSchedule(band: AgeBand): VeinSchedule {
  const interval = ORE_VEIN_INTERVAL[band];
  return { interval, nextAt: interval, ready: false };
}

/** After a correct key: reaching `nextAt` earns a vein and moves the mark one interval on. */
export function veinOnStreak(s: VeinSchedule, streak: number): VeinSchedule {
  if (streak < s.nextAt) return s;
  const steps = Math.floor((streak - s.nextAt) / s.interval) + 1;
  return { interval: s.interval, nextAt: s.nextAt + steps * s.interval, ready: true };
}

/**
 * After a wrong key: counting starts again from zero. A vein already earned is kept, so a slip
 * never takes a reward away.
 */
export function veinOnBreak(s: VeinSchedule): VeinSchedule {
  return s.nextAt === s.interval ? s : { interval: s.interval, nextAt: s.interval, ready: s.ready };
}

/** When the next block appears: is it the ore block? Uses the earned vein up. */
export function veinTake(s: VeinSchedule): { schedule: VeinSchedule; vein: boolean } {
  if (!s.ready) return { schedule: s, vein: false };
  return { schedule: { interval: s.interval, nextAt: s.nextAt, ready: false }, vein: true };
}

// ---------------------------------------------------------------------------------------------
// Which block a target shows
// ---------------------------------------------------------------------------------------------

/**
 * The block an ordinary target shows: a `common` entry of the biome's loot table, by weight, so
 * the stage shows the blocks the biome is made of.
 */
export function pickTargetBlock(table: LootTable, rng: Rng): BlockId {
  const common = table.entries.filter((e) => e.rarity === "common");
  if (common.length === 0) throw new Error(`mine: the ${table.biome} table has no common entries`);
  return rng.weightedPick(
    common,
    common.map((e) => e.weight),
  ).block;
}

/**
 * The block an ore-vein target shows: the best `ore`-tagged entry of the table that the streak
 * has unlocked (the loot thresholds of M2-04), so a longer streak shows a finer ore.
 */
export function pickVeinBlock(
  table: LootTable,
  blocks: readonly BlockDef[],
  band: AgeBand,
  streak: number,
): BlockId | null {
  const t = LOOT_THRESHOLDS[band];
  const best: Rarity = streak >= t.epic ? "epic" : streak >= t.rare ? "rare" : "uncommon";
  const order: readonly Rarity[] = ["epic", "rare", "uncommon", "common"];
  const ores = new Set(blocks.filter((b) => b.tags.includes("ore")).map((b) => b.id));
  for (const rarity of order.slice(order.indexOf(best))) {
    const hit = table.entries.find((e) => e.rarity === rarity && ores.has(e.block));
    if (hit) return hit.block;
  }
  return table.entries.find((e) => ores.has(e.block))?.block ?? null;
}

/**
 * Ties the loot to the block on the stage: a `common` drop is the block the child just mined
 * (mine dirt, get dirt). Better drops are finds from inside it and stay as rolled. The shown
 * block was picked from the same weighted `common` entries, so the odds don't change.
 */
export function settleDrops(drops: readonly LootDrop[], mined: BlockId, vein: boolean): LootDrop[] {
  const out: LootDrop[] = [];
  for (const d of drops) {
    const block = !vein && d.rarity === "common" ? mined : d.block;
    const same = out.find((o) => o.block === block);
    if (same) same.count += d.count;
    else out.push({ block, count: d.count, rarity: d.rarity });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Loot fly queue
// ---------------------------------------------------------------------------------------------

/** Hotbar slots (the kit's `HOTBAR_SLOTS`). */
export const FLY_SLOTS = 9;
/** How long one item flies. */
export const FLY_MS: Ms = 520;
/** The gap between two items leaving the same block. */
export const FLY_STAGGER_MS: Ms = 90;
/** The most items in the air at once. More than this land at once, without a flight. */
export const FLY_MAX = 6;

/** One item on its way to the hotbar. */
export interface Flight {
  readonly id: number;
  readonly block: BlockId;
  readonly count: number;
  readonly rarity: Rarity;
  /** Hotbar slot it lands in, 0–8. */
  readonly slot: number;
  readonly startMs: Ms;
  readonly durationMs: Ms;
}

export interface FlyQueue {
  readonly flights: readonly Flight[];
  readonly nextId: number;
  /** Blocks in the order they were first found. A block's slot is its index here, mod 9. */
  readonly seen: readonly BlockId[];
}

export const emptyFlyQueue = (): FlyQueue => ({ flights: [], nextId: 1, seen: [] });

/** The hotbar slot of a block: the order it was first found in, wrapping after 9. */
export function slotOf(seen: readonly BlockId[], block: BlockId): number {
  const i = seen.indexOf(block);
  return (i === -1 ? seen.length : i) % FLY_SLOTS;
}

/**
 * Adds the drops of one broken block at `nowMs`. Each drop leaves a little after the one before.
 * Drops that would put more than {@link FLY_MAX} items in the air, and every drop when `instant`
 * (reduced motion), come back in `landed` right away instead of flying.
 */
export function enqueueDrops(
  q: FlyQueue,
  drops: readonly LootDrop[],
  nowMs: Ms,
  instant = false,
): { queue: FlyQueue; landed: Flight[] } {
  const flights = [...q.flights];
  const seen = [...q.seen];
  const landed: Flight[] = [];
  let nextId = q.nextId;
  let leaving = 0;
  for (const d of drops) {
    if (!(d.count > 0)) continue;
    if (!seen.includes(d.block)) seen.push(d.block);
    const flight: Flight = {
      id: nextId++,
      block: d.block,
      count: d.count,
      rarity: d.rarity,
      slot: slotOf(seen, d.block),
      startMs: nowMs + leaving * FLY_STAGGER_MS,
      durationMs: FLY_MS,
    };
    if (instant || flights.length >= FLY_MAX) {
      landed.push(flight);
    } else {
      flights.push(flight);
      leaving++;
    }
  }
  return { queue: { flights, nextId, seen }, landed };
}

/** Moves the queue to `nowMs`: flights whose time is up come back in `landed`, in order. */
export function stepFlights(q: FlyQueue, nowMs: Ms): { queue: FlyQueue; landed: Flight[] } {
  if (q.flights.length === 0) return { queue: q, landed: [] };
  const landed = q.flights.filter((f) => nowMs >= f.startMs + f.durationMs);
  if (landed.length === 0) return { queue: q, landed };
  return {
    queue: { ...q, flights: q.flights.filter((f) => nowMs < f.startMs + f.durationMs) },
    landed,
  };
}

/** Lands everything at once (the lesson is over, or the mode is leaving). */
export function flushFlights(q: FlyQueue): { queue: FlyQueue; landed: Flight[] } {
  return { queue: { ...q, flights: [] }, landed: [...q.flights] };
}

/** Height of the hop at the top of a flight, as a share of the straight-line distance. */
export const FLY_ARC = 0.22;

/**
 * Where a flight is at `nowMs`: `k` is how far along the straight line from the block to the
 * slot (0–1, eased so it leaves quickly and settles), `lift` is the hop above that line (as a
 * share of the distance), and `scale` shrinks the item into its slot. `visible` is false before
 * the flight's own start.
 */
export function flightPose(
  f: Flight,
  nowMs: Ms,
): { k: number; lift: number; scale: number; visible: boolean } {
  const u = clamp((nowMs - f.startMs) / f.durationMs, 0, 1);
  const k = 1 - (1 - u) * (1 - u);
  return {
    k,
    lift: FLY_ARC * 4 * u * (1 - u),
    scale: 1 - 0.35 * u,
    visible: nowMs >= f.startMs,
  };
}

// ---------------------------------------------------------------------------------------------
// Wrong keys
// ---------------------------------------------------------------------------------------------

/** The same wrong key again inside this long is one press held down, not a new slip. */
export const WRONG_QUIET_MS: Ms = 400;
/** The least time between two wrong-key cues (thud and wobble): under 3 a second (PLAN §4.6). */
export const WRONG_GAP_MS: Ms = 350;
/** The "Almost!" banner shows at most once in this long (card). */
export const BANNER_GAP_MS: Ms = 5000;
/** How long the banner stays up. */
export const BANNER_SHOW_MS: Ms = 2600;

export interface WrongGate {
  readonly lastKey: string | null;
  readonly lastAt: Ms;
  readonly cueAt: Ms;
  readonly bannerAt: Ms;
}

export const emptyWrongGate = (): WrongGate => ({
  lastKey: null,
  lastAt: Number.NEGATIVE_INFINITY,
  cueAt: Number.NEGATIVE_INFINITY,
  bannerAt: Number.NEGATIVE_INFINITY,
});

/**
 * Feeds one wrong key at `now`. `cue` says whether to play the soft thud and wobble the block;
 * `banner` says whether to show "Almost! Try that key again". A held key that repeats gives one
 * cue for the whole hold, and the banner comes at most once every {@link BANNER_GAP_MS}.
 */
export function feedWrong(
  gate: WrongGate,
  key: string,
  now: Ms,
): { gate: WrongGate; cue: boolean; banner: boolean } {
  const held = key === gate.lastKey && now - gate.lastAt < WRONG_QUIET_MS;
  const cue = !held && now - gate.cueAt >= WRONG_GAP_MS;
  const banner = cue && now - gate.bannerAt >= BANNER_GAP_MS;
  return {
    gate: {
      lastKey: key,
      lastAt: now,
      cueAt: cue ? now : gate.cueAt,
      bannerAt: banner ? now : gate.bannerAt,
    },
    cue,
    banner,
  };
}

// ---------------------------------------------------------------------------------------------
// HUD values
// ---------------------------------------------------------------------------------------------

/** Lit hotbar slots for a streak (contracts §10): `min(9, floor(streak / 3))`. */
export const comboOf = (streak: number): number =>
  clamp(Math.floor(Math.max(0, streak) / 3), 0, FLY_SLOTS);

/**
 * The key the on-screen keyboard should light: the next char of the active target, a space when
 * its text is typed and only the trailing space is left, or null when there is nothing to type.
 */
export function nextKeyOf(active: TargetView | null): string | null {
  if (active === null || active.complete) return null;
  const chars = Array.from(active.text);
  if (active.typed < chars.length) return chars[active.typed] ?? null;
  // Under `backspace` a fully typed target with a wrong char waits for Backspace, not a space.
  if (active.marks.includes("wrong")) return null;
  return active.marks.length > chars.length ? " " : null;
}

/**
 * Lesson progress, 0–1: blocks broken so far, plus the share of the current block that is typed,
 * over all the blocks of the lesson.
 */
export function progressOf(
  doneTargets: number,
  active: Pick<TargetView, "typed" | "marks"> | null,
  totalTargets: number,
): number {
  if (!(totalTargets > 0)) return 0;
  const part = active && active.marks.length > 0 ? active.typed / active.marks.length : 0;
  return clamp((doneTargets + clamp(part, 0, 1)) / totalTargets, 0, 1);
}

// ---------------------------------------------------------------------------------------------
// From a lesson to a session
// ---------------------------------------------------------------------------------------------

/** Length multiplier per band when the lesson has none (contracts §6). */
export const DEFAULT_BAND_SCALE: Readonly<Record<AgeBand, number>> = {
  sprout: 0.6,
  miner: 1,
  builder: 1.3,
};
/** Latency a band aims for, for the key weights (contracts §4). */
export const TARGET_LATENCY: Readonly<Record<AgeBand, Ms>> = {
  sprout: 900,
  miner: 500,
  builder: 300,
};
/** A gentle guess at a band's speed, used only to size a timed lesson before a baseline exists. */
export const EST_WPM: Readonly<Record<AgeBand, number>> = { sprout: 6, miner: 14, builder: 24 };

/** The wrong-key policy of a lesson for a band (contracts §6). */
export function policyFor(lesson: Pick<Lesson, "policy" | "kind">, band: AgeBand): WrongKeyPolicy {
  const own = lesson.policy?.[band];
  if (own !== undefined) return own;
  if (lesson.kind === "sentences") return "backspace";
  return band === "builder" ? "skip" : "stay";
}

/** Does `A` count for `a`? Default: for Sprout, in lessons before the Deep Mines (contracts §6). */
export function caseSensitiveFor(
  lesson: Pick<Lesson, "caseInsensitiveFor" | "biome">,
  band: AgeBand,
): boolean {
  const early = BIOME_ORDER.indexOf(lesson.biome) < BIOME_ORDER.indexOf("mines");
  const relaxed = lesson.caseInsensitiveFor ?? (early ? ["sprout"] : []);
  return !relaxed.includes(band);
}

/** Curriculum position of a lesson: biome order first, then order in the biome. */
const rank = (l: Pick<Lesson, "biome" | "order">): number =>
  BIOME_ORDER.indexOf(l.biome) * 1000 + l.order;

/**
 * The keys a lesson may ask for: the `newKeys` of every lesson before it in curriculum order, plus
 * its own. Sparkstone is a side branch (README §8.5), so its keys count only inside Sparkstone.
 *
 * `allowedKeysFor` (contracts §6) is still a stub; this is the same rule, and Mine should call the
 * real one once the curriculum task lands.
 */
export function allowedKeys(lessons: readonly Lesson[], lesson: Lesson): string[] {
  const upTo = rank(lesson);
  const keys: string[] = [];
  const add = (l: Lesson): void => {
    for (const k of l.newKeys) if (!keys.includes(k)) keys.push(k);
  };
  for (const l of lessons.toSorted((a, b) => rank(a) - rank(b))) {
    if (l.id === lesson.id || rank(l) > upTo) continue;
    if (l.biome === "sparkstone" && lesson.biome !== "sparkstone") continue;
    add(l);
  }
  add(lesson);
  return keys;
}

/** The lesson's word pools for a band: the ones it names, else the ones tagged with its biome. */
export function poolsFor(
  lesson: Pick<Lesson, "pools" | "biome">,
  band: AgeBand,
  pools: readonly WordPool[],
): WordPool[] {
  const ids = lesson.pools;
  const picked =
    ids === undefined
      ? pools.filter((p) => p.tags.includes(`biome=${lesson.biome}`))
      : pools.filter((p) => ids.includes(p.id));
  return picked.filter((p) => p.band === band || p.band === "all");
}

export interface LengthPlan {
  length: GenerateParams["length"];
  end: SessionConfig["end"];
  /** The time limit, when the lesson has one and timers are allowed. */
  timeLimitMs: Ms | null;
}

/**
 * How much to generate and how the session ends. A `seconds` lesson is timed, except in calm mode
 * (no timers anywhere, contracts §15): there it becomes the number of chars the learner would
 * type in that time, with no clock.
 */
export function lengthPlan(
  lesson: Pick<Lesson, "length" | "bandScale">,
  band: AgeBand,
  opts: { calm: boolean; estWpm: number },
): LengthPlan {
  const scale = lesson.bandScale?.[band] ?? DEFAULT_BAND_SCALE[band];
  const len = lesson.length;
  if ("chars" in len) {
    return {
      length: { chars: Math.max(1, Math.ceil(len.chars * scale)) },
      end: { kind: "targets" },
      timeLimitMs: null,
    };
  }
  if ("targets" in len) {
    return {
      length: { targets: Math.max(1, Math.ceil(len.targets * scale)) },
      end: { kind: "targets" },
      timeLimitMs: null,
    };
  }
  const seconds = Math.max(1, len.seconds * scale);
  if (opts.calm) {
    const chars = Math.max(1, Math.ceil((seconds / 60) * opts.estWpm * 5));
    return { length: { chars }, end: { kind: "targets" }, timeLimitMs: null };
  }
  const ms = Math.round(seconds * 1000);
  return {
    length: { seconds, estWpm: opts.estWpm },
    end: { kind: "time", ms },
    timeLimitMs: ms,
  };
}

/** The biome whose blocks and loot a lesson uses. */
export const biomeOf = (lesson: Pick<Lesson, "biome"> | null): BiomeId => lesson?.biome ?? "meadow";

// ---------------------------------------------------------------------------------------------
// Where the block goes on the screen
// ---------------------------------------------------------------------------------------------

/** A rectangle on the page, in CSS pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The biggest the block is drawn, in CSS pixels. */
export const BLOCK_PX_MAX = 220;
/** Below this the block is too small to enjoy; the layout then picks another place. */
export const BLOCK_PX_MIN = 96;
/** Room kept at the top of the open stage for the banner. */
const BANNER_ROOM = 76;

/**
 * Where the target block goes and how big it is, given what the HUD leaves free (M2-14: the word
 * on top, the keyboard and hands at the bottom, an open `stage` between them).
 *
 * 1. With no keyboard, or a stage tall enough for the banner and a good-sized block, the block
 *    sits in the middle of the stage, under the word.
 * 2. Otherwise it goes in the column to the right of the keyboard, in its upper part, above the
 *    arm with the pickaxe. That column is free whatever the length of the word.
 * 3. If that column is too narrow as well, it takes the stage anyway, as big as fits.
 *
 * `null` when the HUD isn't on the page (no stage): the plain camera view is used.
 */
export function stageFrame(
  view: { width: number; height: number },
  stage: Box | null,
  keyboard: Box | null,
): { x: number; y: number; size: number } | null {
  if (stage === null || !(view.width > 0) || !(view.height > 0)) return null;
  const centered = (room: number): { x: number; y: number; size: number } => {
    const size = clamp(room * 0.8, 40, BLOCK_PX_MAX);
    return {
      x: stage.left + stage.width / 2,
      y: stage.top + BANNER_ROOM + Math.max(room, size) / 2,
      size,
    };
  };
  const bottom = keyboard === null ? view.height : Math.min(view.height, keyboard.top);
  const room = bottom - stage.top - BANNER_ROOM;
  if (keyboard === null || room * 0.8 >= BLOCK_PX_MIN * 1.6) return centered(room);
  const left = keyboard.left + keyboard.width;
  const width = view.width - left;
  const height = view.height - stage.top;
  const size = clamp(Math.min(width * 0.72, height * 0.42), 0, BLOCK_PX_MAX);
  if (size < BLOCK_PX_MIN) return centered(Math.max(room, 50));
  return { x: left + width / 2, y: stage.top + size * 0.7, size };
}
