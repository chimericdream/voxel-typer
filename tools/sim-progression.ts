/**
 * Progression study (task M3-13, PLAN.md §8 Phase 3 acceptance, §9.3).
 *
 *   npm run tool -- sim-progression --runs 40 --seed 1 [--max 300] [--camps take|skip|both]
 *
 * Plays synthetic learners (`tools/sim/learner.ts`: a power-law learning curve per key) through
 * the whole shipped curriculum, one session at a time, the way the game would:
 *
 * 1. `recommendNext` (src/app/recommend.ts) picks the session: a due remedial camp, else the next
 *    curriculum lesson. Its unlock rules, the optional "No Peeking!" challenge and the remedial
 *    rate limit are the game's. With `--camps skip` the learner passes every camp by and plays
 *    `nextCurriculumLesson` instead (the rate limit still counts the offer).
 * 2. The session is built as Mine's `plan()` builds it: `allowedKeys`, `lengthPlan`, `keyWeights`
 *    with {@link focusKeys}, `poolsFor`, `generateTargets`, `blockTargets`, `policyFor`,
 *    `caseSensitiveFor` (src/modes/mine/). The learner plays it on the real typing engine.
 * 3. `computeStars` with the band (decision 80) and the profile's baseline.
 * 4. `applyResult` (src/app/progress.ts) folds it into the profile: stats, best stars, unlocks.
 *
 * Defense nights (`birch-08`, `shore-05`, `frosty-06`) are played as Mine sessions of the same
 * words, with Mine's stars: the Defense director and its visitor rule (`nightStars`) are not
 * modelled. They never gate a biome (any play opens the next lesson). Boss lessons run as Mine,
 * as they do in the game until M5.
 *
 * Learners start at the Meadow (Skip on the placement offer). A biome is "finished" in the session
 * its mastery lesson earns 2 stars, which opens the next island. A learner stops after finishing
 * the last biome that has lessons, or after `--max` sessions.
 *
 * Output is a pure function of the arguments: two runs print byte-identical text.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isContentDataFile } from "../src/content/collect";
import { lessonsFromModules } from "../src/content/lessons/load";
import type { Lesson } from "../src/content/lessons/types";
import { poolFromText } from "../src/content/wordlists/loader";
import { keyWeights } from "../src/engine/adaptive";
import { generateTargets } from "../src/engine/generator";
import type { WordPool } from "../src/engine/generator";
import { isRemedialId } from "../src/engine/remedial";
import { createRng, hashString } from "../src/engine/rng";
import { baselineNetWpm, computeStars } from "../src/engine/stars";
import type { StarCount } from "../src/engine/stars";
import { median } from "../src/engine/stats";
import {
  EST_WPM,
  TARGET_LATENCY,
  allowedKeys,
  blockTargets,
  caseSensitiveFor,
  lengthPlan,
  policyFor,
  poolsFor,
} from "../src/modes/mine/logic";
import { applyResult, settleAtMeadow } from "../src/app/progress";
import {
  anchorLesson,
  nextCurriculumLesson,
  openLessons,
  recommendNext,
  resetRemedials,
} from "../src/app/recommend";
import { SCHEMA_VERSION } from "../src/save/schema";
import type { Profile } from "../src/save/schema";
import { defaultSettings } from "../src/save/settings";
import { BIOME_ORDER } from "../src/types/core";
import type { AgeBand, BiomeId, EpochMs } from "../src/types/core";
import { LEARNER_PROFILES, PACES, createLearner, errorChance, playLearner } from "./sim/learner";
import type { Learner, LearnerProfile, Pace } from "./sim/learner";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];
const DAY = 86_400_000;
/** A run of this many sessions with nothing new opened counts as "stuck". */
export const STUCK_RUN = 5;

/** Every shipped lesson, loaded as `tools/sim.ts` does (tsx has no `import.meta.glob`). */
export async function loadLessons(): Promise<Lesson[]> {
  const dir = join(REPO_ROOT, "src/content/lessons");
  const modules: Record<string, unknown> = {};
  for (const name of readdirSync(dir).filter(isContentDataFile)) {
    modules[`./${name}`] = await import(pathToFileURL(join(dir, name)).href);
  }
  return lessonsFromModules(modules);
}

/**
 * Every shipped pool, as `src/content/wordlists/pools.ts` globs them: the word lists and the
 * sentence lists, not the blocklist.
 */
export function loadPools(): WordPool[] {
  const out: WordPool[] = [];
  for (const sub of ["src/content/wordlists", "src/content/sentences"]) {
    const dir = join(REPO_ROOT, sub);
    for (const f of readdirSync(dir).toSorted()) {
      if (!f.endsWith(".txt") || f === "blocklist.txt") continue;
      out.push(poolFromText(f.slice(0, -4), readFileSync(join(dir, f), "utf8")));
    }
  }
  return out;
}

/**
 * Mine's `focusKeys` (src/modes/mine/mine.ts), copied because mine.ts loads the Vite-only content
 * aggregators. `tests/unit/sim/progression.test.ts` checks the copy against the real one for every
 * lesson.
 */
export function focusKeys(
  lesson: Pick<Lesson, "newKeys" | "reviewKeys">,
  allowed: readonly string[],
): string[] {
  const allowedSet = new Set(allowed);
  const review = lesson.reviewKeys.filter((k) => allowedSet.has(k));
  const partial = new Set(review).size < allowedSet.size;
  return partial ? [...lesson.newKeys, ...review] : [...lesson.newKeys];
}

/** A new profile, as ProfileCreate's `newProfile` makes it, settled at the Meadow. */
export function freshProfile(band: AgeBand, id: string): Profile {
  const profile: Profile = {
    id,
    name: "Sim",
    ageBand: band,
    avatar: { skin: "s1" },
    createdAt: 0,
    settings: defaultSettings(band),
    progress: { lessons: {}, unlockedBiomes: ["meadow"] },
    sessionCounter: 0,
    keyStats: {},
    bigramStats: {},
    inventory: {},
    found: {},
    island: null,
    cosmetics: { unlocked: [] },
    achievements: {},
    daily: { streakDates: [] },
    history: [],
    weekly: [],
    schemaVersion: SCHEMA_VERSION,
  };
  return settleAtMeadow(profile, 0);
}

/** One session as the game would build and score it. */
export interface PlayedSession {
  lesson: Lesson;
  stars: StarCount;
  accuracy: number;
  netWpm: number;
  profile: Profile;
}

/** Builds, plays and folds one session of `lesson` (steps 2–4 of the module comment). */
export function playSession(
  profile: Profile,
  lesson: Lesson,
  learner: Learner,
  ctx: {
    lessons: readonly Lesson[];
    pools: readonly WordPool[];
    rng: ReturnType<typeof createRng>;
  },
): PlayedSession {
  const band = profile.ageBand;
  const allowed = allowedKeys(ctx.lessons, lesson);
  const estWpm = baselineNetWpm(profile.history) ?? EST_WPM[band];
  const size = lengthPlan(lesson, band, { calm: profile.settings.calmMode, estWpm });
  const targets = generateTargets(
    {
      kind: lesson.kind,
      allowed,
      weights: keyWeights({
        allowed,
        focus: focusKeys(lesson, allowed),
        stats: profile.keyStats,
        sessionIndex: profile.sessionCounter,
        targetLatencyMs: TARGET_LATENCY[band],
      }),
      pools: poolsFor(lesson, band, ctx.pools),
      length: size.length,
      capitalize: "none",
    },
    ctx.rng.fork("targets"),
  );
  const run = playLearner({
    config: {
      policy: policyFor(lesson, band),
      targeting: "sequential",
      caseSensitive: caseSensitiveFor(lesson, band),
      end: size.timeLimitMs === null ? { kind: "targets" } : { kind: "time", ms: size.timeLimitMs },
      mode: lesson.mode === "defense" ? "defense" : "mine",
      seed: ctx.rng.seed,
      lessonId: lesson.id,
    },
    targets: blockTargets(targets),
    learner,
    rng: ctx.rng.fork("learner"),
    ctx: {
      noPeek:
        lesson.tags?.includes("challenge-hide-keyboard") === true && profile.settings.showKeyboard,
    },
  });
  const { summary } = run;
  const stars = computeStars({
    completed: true,
    accuracy: summary.accuracy,
    netWpm: summary.netWpm,
    targets: lesson.targets,
    baseline: baselineNetWpm(profile.history),
    band,
  });
  const at: EpochMs = (profile.sessionCounter + 1) * DAY;
  const next = applyResult(profile, lesson, { summary, loot: {}, stars }, at);
  return { lesson, stars, accuracy: summary.accuracy, netWpm: summary.netWpm, profile: next };
}

/** Biomes that have lessons, in order. */
export const biomesWithLessons = (lessons: readonly Lesson[]): BiomeId[] =>
  BIOME_ORDER.filter((b) => lessons.some((l) => l.biome === b));

/** One remedial camp the learner played. */
export interface CampRecord {
  session: number;
  keys: string[];
  /** The learner's true slip chance on the camp's keys (mean), just before and just after. */
  errBefore: number;
  errAfter: number;
  /** Share of the camp's keys among the learner's 3 truly weakest allowed keys. */
  hits: number;
}

/** What one learner did. */
export interface LearnerOutcome {
  band: AgeBand;
  pace: Pace;
  run: number;
  sessions: number;
  /** Sessions played when each biome was finished (its mastery reached 2 stars). */
  finishedAt: Partial<Record<BiomeId, number>>;
  /** Stars of every curriculum play, 1–3 (index = stars). */
  stars: [number, number, number, number];
  /** Stars of each lesson's first play. */
  firstStars: [number, number, number, number];
  /** Plays of each biome's mastery lesson until it was passed (or the end). */
  masteryPlays: Partial<Record<BiomeId, number>>;
  camps: CampRecord[];
  /** Camps offered (`recommendNext` gave one), taken or not. */
  offers: number;
  /** Longest run of sessions with nothing new opened. */
  longestNoUnlock: number;
  /** Runs of ≥ {@link STUCK_RUN} sessions with nothing new opened. */
  stuckRuns: number;
  /** Longest run of curriculum plays in a row with 1 star. */
  longestOneStar: number;
  /** Replays of a lesson already played, not counting the mastery lesson. */
  replays: number;
  /** Mean true slip chance of the 2 weakest learned keys, at the end. */
  weakErrEnd: number;
}

export interface ProgressionOptions {
  runs: number;
  seed: number;
  max: number;
  camps: "take" | "skip";
  /**
   * `game`: `recommendNext` as shipped. `mastery-first`: a what-if for the handoff note, not the
   * game. When the game would send the learner back to replay an old lesson while their biome's
   * mastery lesson is played but under 2 stars, they replay the mastery lesson instead.
   */
  policy: "game" | "mastery-first";
  bands?: readonly AgeBand[];
  paces?: readonly Pace[];
}

const meanOf = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** The learner's true slip chance on each key it may type now, weakest first. */
function trueWeakest(learner: Learner, keys: readonly string[]): { key: string; err: number }[] {
  return keys
    .map((key) => ({ key, err: errorChance(learner, key) }))
    .toSorted((a, b) => b.err - a.err || (a.key < b.key ? -1 : 1));
}

/**
 * The `mastery-first` what-if (see {@link ProgressionOptions.policy}): a replay of an old lesson
 * becomes a replay of the current biome's mastery lesson when that one is played and under 2
 * stars.
 */
export function masteryFirst(
  profile: Profile,
  lesson: Lesson,
  lessons: readonly Lesson[],
  mastery: ReadonlyMap<BiomeId, string>,
): Lesson {
  if (profile.progress.lessons[lesson.id] === undefined) return lesson;
  const id = mastery.get(lesson.biome);
  const rec = id === undefined ? undefined : profile.progress.lessons[id];
  if (id === lesson.id || rec === undefined || rec.bestStars >= 2) return lesson;
  return lessons.find((l) => l.id === id) ?? lesson;
}

/** Plays one learner from a fresh profile (see the module comment). */
export function playLearnerCurriculum(
  band: AgeBand,
  pace: Pace,
  run: number,
  opts: Pick<ProgressionOptions, "seed" | "max" | "camps" | "policy">,
  data: { lessons: readonly Lesson[]; pools: readonly WordPool[] },
  extra: { profile?: LearnerProfile; trace?: string[] } = {},
): LearnerOutcome {
  resetRemedials();
  const seed = hashString(`${opts.seed}:${band}:${pace}:${run}`);
  const rng = createRng(seed);
  const learner = createLearner(extra.profile ?? LEARNER_PROFILES[band][pace], seed);
  const biomes = biomesWithLessons(data.lessons);
  const last = biomes.at(-1);
  const mastery = new Map(
    data.lessons.filter((l) => l.tags?.includes("mastery") === true).map((l) => [l.biome, l.id]),
  );
  let profile = freshProfile(band, `sim-${seed}`);
  const out: LearnerOutcome = {
    band,
    pace,
    run,
    sessions: 0,
    finishedAt: {},
    stars: [0, 0, 0, 0],
    firstStars: [0, 0, 0, 0],
    masteryPlays: {},
    camps: [],
    offers: 0,
    longestNoUnlock: 0,
    stuckRuns: 0,
    longestOneStar: 0,
    replays: 0,
    weakErrEnd: 0,
  };
  const openCount = (p: Profile): number =>
    openLessons(p, data.lessons).length + p.progress.unlockedBiomes.length;
  let opened = openCount(profile);
  let noUnlock = 0;
  let oneStar = 0;

  const allDone = (): boolean => last !== undefined && out.finishedAt[last] !== undefined;
  while (out.sessions < opts.max && !allDone()) {
    const recommended = recommendNext(profile, data.lessons);
    if (recommended === null) break;
    let lesson = recommended;
    const camp = isRemedialId(recommended.id);
    if (camp) {
      out.offers++;
      if (opts.camps === "skip") {
        const next = nextCurriculumLesson(profile, data.lessons);
        if (next === null) break;
        lesson = next;
      }
    }
    if (opts.policy === "mastery-first" && !isRemedialId(lesson.id)) {
      lesson = masteryFirst(profile, lesson, data.lessons, mastery);
    }
    const isCamp = isRemedialId(lesson.id);
    const anchor = anchorLesson(profile, data.lessons);
    const allowed = anchor === null ? [] : allowedKeys(data.lessons, anchor);
    const before = isCamp ? meanOf(lesson.newKeys.map((k) => errorChance(learner, k))) : 0;
    const weakest3 = isCamp ? trueWeakest(learner, allowed).slice(0, 3) : [];
    const firstPlay = !isCamp && profile.progress.lessons[lesson.id] === undefined;

    const played = playSession(profile, lesson, learner, {
      ...data,
      rng: rng.fork(`session:${out.sessions + 1}`),
    });
    profile = played.profile;
    out.sessions++;
    extra.trace?.push(
      `| ${out.sessions} | ${lesson.id.startsWith("remedial-") ? `camp (${lesson.newKeys.join(" ")})` : lesson.id} | ${"★".repeat(played.stars)} | ${(100 * played.accuracy).toFixed(1)}% | ${played.netWpm.toFixed(1)} |`,
    );

    if (isCamp) {
      out.camps.push({
        session: out.sessions,
        keys: [...lesson.newKeys],
        errBefore: before,
        errAfter: meanOf(lesson.newKeys.map((k) => errorChance(learner, k))),
        hits:
          lesson.newKeys.filter((k) => weakest3.some((w) => w.key === k)).length /
          Math.max(1, lesson.newKeys.length),
      });
    } else {
      out.stars[played.stars]++;
      if (firstPlay) out.firstStars[played.stars]++;
      else if (mastery.get(lesson.biome) !== lesson.id) out.replays++;
      oneStar = played.stars === 1 ? oneStar + 1 : 0;
      out.longestOneStar = Math.max(out.longestOneStar, oneStar);
      if (mastery.get(lesson.biome) === lesson.id && out.finishedAt[lesson.biome] === undefined) {
        out.masteryPlays[lesson.biome] = (out.masteryPlays[lesson.biome] ?? 0) + 1;
        if (played.stars >= 2) out.finishedAt[lesson.biome] = out.sessions;
      }
    }

    const now = openCount(profile);
    if (now > opened) {
      if (noUnlock >= STUCK_RUN) out.stuckRuns++;
      noUnlock = 0;
      opened = now;
    } else {
      noUnlock++;
      out.longestNoUnlock = Math.max(out.longestNoUnlock, noUnlock);
    }
  }
  if (noUnlock >= STUCK_RUN) out.stuckRuns++;
  const anchor = anchorLesson(profile, data.lessons);
  const known = anchor === null ? [] : allowedKeys(data.lessons, anchor);
  out.weakErrEnd = meanOf(
    trueWeakest(learner, known)
      .slice(0, 2)
      .map((w) => w.err),
  );
  return out;
}

/** Every learner of the study. */
export function simulateProgression(
  opts: ProgressionOptions,
  data: { lessons: readonly Lesson[]; pools: readonly WordPool[] },
): LearnerOutcome[] {
  const out: LearnerOutcome[] = [];
  for (const band of opts.bands ?? BANDS) {
    for (const pace of opts.paces ?? PACES) {
      for (let run = 0; run < opts.runs; run++) {
        out.push(playLearnerCurriculum(band, pace, run, opts, data));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

/** The q-quantile (nearest rank) of finished counts, with unfinished learners as +∞. */
function quantile(xs: readonly number[], q: number): number {
  const s = xs.toSorted((a, b) => a - b);
  if (s.length === 0) return Infinity;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? Infinity;
}

const cellOf = (n: number, max: number): string => (Number.isFinite(n) ? String(n) : `>${max}`);
const pct = (n: number, of: number): string => (of === 0 ? "·" : `${Math.round((100 * n) / of)}%`);

const groups = (
  outcomes: readonly LearnerOutcome[],
): { band: AgeBand; pace: Pace; rows: LearnerOutcome[] }[] => {
  const seen: { band: AgeBand; pace: Pace; rows: LearnerOutcome[] }[] = [];
  for (const o of outcomes) {
    const g = seen.find((x) => x.band === o.band && x.pace === o.pace);
    if (g) g.rows.push(o);
    else seen.push({ band: o.band, pace: o.pace, rows: [o] });
  }
  return seen;
};

/** Sessions until `biome` was finished, or +∞. */
const doneAt = (o: LearnerOutcome, biome: BiomeId): number => o.finishedAt[biome] ?? Infinity;

export function formatProgression(
  outcomes: readonly LearnerOutcome[],
  opts: ProgressionOptions,
  lessons: readonly Lesson[],
): string {
  const biomes = biomesWithLessons(lessons);
  const lines: string[] = [
    `Progression study: ${opts.runs} learners per row, seed ${opts.seed}, at most ${opts.max} sessions, camps ${opts.camps}, policy ${opts.policy}`,
    "",
    "Sessions to finish each biome (cumulative, from the first session): median [10th–90th percentile]",
    "",
    `| Band | Learner | ${biomes.join(" | ")} | Not done |`,
    `|---|---|${biomes.map(() => "---:").join("|")}|---:|`,
  ];
  for (const g of groups(outcomes)) {
    const cells = biomes.map((b) => {
      const xs = g.rows.map((o) => doneAt(o, b));
      return `${cellOf(quantile(xs, 0.5), opts.max)} [${cellOf(quantile(xs, 0.1), opts.max)}–${cellOf(quantile(xs, 0.9), opts.max)}]`;
    });
    const last = biomes.at(-1);
    const notDone =
      last === undefined ? 0 : g.rows.filter((o) => !Number.isFinite(doneAt(o, last))).length;
    lines.push(`| ${g.band} | ${g.pace} | ${cells.join(" | ")} | ${pct(notDone, g.rows.length)} |`);
  }

  lines.push(
    "",
    "Stars of curriculum plays (all plays, then first plays), and plays of each mastery lesson until it gave 2 stars (median)",
    "",
    `| Band | Learner | All: 1★ / 2★ / 3★ | First play: 1★ / 2★ / 3★ | Replays | Longest 1★ run (median / max) | Mastery plays (${biomes.join(" / ")}) |`,
    "|---|---|---|---|---:|---|---|",
  );
  for (const g of groups(outcomes)) {
    const sum = (pick: (o: LearnerOutcome) => readonly number[]): number[] =>
      [1, 2, 3].map((s) => g.rows.reduce((n, o) => n + (pick(o)[s] ?? 0), 0));
    const all = sum((o) => o.stars);
    const first = sum((o) => o.firstStars);
    const share = (xs: number[]): string => {
      const n = xs.reduce((a, b) => a + b, 0);
      return xs.map((x) => pct(x, n)).join(" / ");
    };
    const runs = g.rows.map((o) => o.longestOneStar);
    const mastery = biomes
      .map((b) => {
        const xs = g.rows.flatMap((o) =>
          o.masteryPlays[b] === undefined ? [] : [o.masteryPlays[b]],
        );
        return xs.length === 0 ? "·" : String(median(xs) ?? 0);
      })
      .join(" / ");
    lines.push(
      `| ${g.band} | ${g.pace} | ${share(all)} | ${share(first)} | ${median(g.rows.map((o) => o.replays)) ?? 0} | ${median(runs) ?? 0} / ${Math.max(...runs)} | ${mastery} |`,
    );
  }

  lines.push(
    "",
    `Remedial camps and stuck runs (a stuck run: ${STUCK_RUN}+ sessions in a row with no new lesson or biome opened)`,
    "",
    "| Band | Learner | Camps offered (median) | Share of sessions | Camp keys among 3 truly weakest | Slip chance on camp keys: before → after | Learners with a stuck run | Longest run without an unlock (median / max) | Weakest-2 slip chance at the end |",
    "|---|---|---:|---:|---:|---|---:|---|---:|",
  );
  for (const g of groups(outcomes)) {
    const camps = g.rows.flatMap((o) => o.camps);
    const sessions = g.rows.reduce((n, o) => n + o.sessions, 0);
    const offers = median(g.rows.map((o) => o.offers)) ?? 0;
    const shareCamps = opts.camps === "take" ? pct(camps.length, sessions) : "·";
    const hits = camps.length === 0 ? "·" : pct(meanOf(camps.map((c) => c.hits)) * 100, 100);
    const gain =
      camps.length === 0
        ? "·"
        : `${(100 * meanOf(camps.map((c) => c.errBefore))).toFixed(1)}% → ${(100 * meanOf(camps.map((c) => c.errAfter))).toFixed(1)}%`;
    const stuck = g.rows.filter((o) => o.stuckRuns > 0).length;
    const runs = g.rows.map((o) => o.longestNoUnlock);
    const weak = (100 * meanOf(g.rows.map((o) => o.weakErrEnd))).toFixed(1);
    lines.push(
      `| ${g.band} | ${g.pace} | ${offers} | ${shareCamps} | ${hits} | ${gain} | ${pct(stuck, g.rows.length)} | ${median(runs) ?? 0} / ${Math.max(...runs)} | ${weak}% |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Command-line options: one configuration, the whole study, or one learner's trace. */
export interface ProgressionArgs extends ProgressionOptions {
  /** Print the three configurations of docs/sim.md instead of one. */
  study: boolean;
  /** `band:pace:run`: print that learner's sessions instead. */
  trace: { band: AgeBand; pace: Pace; run: number } | null;
}

export function parseProgressionArgs(args: readonly string[]): ProgressionArgs {
  const opts: ProgressionArgs = {
    runs: 40,
    seed: 1,
    max: 300,
    camps: "take",
    policy: "game",
    study: false,
    trace: null,
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i] ?? "";
    if (flag === "--study") {
      opts.study = true;
      continue;
    }
    const value = args[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--camps") {
      if (value !== "take" && value !== "skip") throw new Error("--camps must be take or skip");
      opts.camps = value;
    } else if (flag === "--policy") {
      if (value !== "game" && value !== "mastery-first") {
        throw new Error("--policy must be game or mastery-first");
      }
      opts.policy = value;
    } else if (flag === "--trace") {
      const [b, p, r] = value.split(":");
      const band = BANDS.find((x) => x === b);
      const pace = PACES.find((x) => x === p);
      const run = Number(r ?? "0");
      if (band === undefined || pace === undefined || !Number.isSafeInteger(run) || run < 0) {
        throw new Error("--trace wants band:pace:run, e.g. sprout:slow:0");
      }
      opts.trace = { band, pace, run };
    } else {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${flag} needs a whole number`);
      if (flag === "--runs") opts.runs = Math.max(1, n);
      else if (flag === "--seed") opts.seed = n;
      else if (flag === "--max") opts.max = Math.max(1, n);
      else throw new Error(`unknown flag ${flag}`);
    }
  }
  return opts;
}

/** The configurations of the study in docs/sim.md: the game, camps passed by, mastery-first. */
export const studyConfigs = (opts: ProgressionOptions): ProgressionOptions[] => [
  { ...opts, camps: "take", policy: "game" },
  { ...opts, camps: "skip", policy: "game" },
  { ...opts, camps: "take", policy: "mastery-first" },
];

/** One learner's sessions as a table. */
export function formatTrace(
  args: ProgressionArgs,
  data: { lessons: readonly Lesson[]; pools: readonly WordPool[] },
): string {
  const t = args.trace;
  if (t === null) return "";
  const trace: string[] = [];
  playLearnerCurriculum(t.band, t.pace, t.run, args, data, { trace });
  return [
    `Trace: ${t.band} ${t.pace} learner ${t.run}, seed ${args.seed}, camps ${args.camps}, policy ${args.policy}`,
    "",
    "| Session | Lesson | Stars | Accuracy | Net WPM |",
    "|---:|---|---|---:|---:|",
    ...trace,
    "",
  ].join("\n");
}

if (resolve(argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const args = parseProgressionArgs(argv.slice(2));
  const lessons = await loadLessons();
  const data = { lessons, pools: loadPools() };
  if (args.trace !== null) {
    process.stdout.write(formatTrace(args, data));
  } else {
    const configs = args.study ? studyConfigs(args) : [args];
    process.stdout.write(
      configs.map((o) => formatProgression(simulateProgression(o, data), o, lessons)).join("\n"),
    );
  }
}
