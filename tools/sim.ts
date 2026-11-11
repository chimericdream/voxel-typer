/**
 * Typist simulator (docs/impl/tasks-m0-m1.md M1-07, PLAN.md §8 Phase 1 and §9.3).
 *
 *   npm run tool -- sim --lesson <id|adhoc> --typist slow|avg|fast|pinkyweak --runs 50 --seed 1
 *
 * Each run is one simulated learner who plays the lesson `--sessions` times in a row. Between
 * sessions the learner's key and bigram stats are folded exactly as the game will fold them, and
 * the next session's content is generated from the adaptive weights. The tool prints a table: the
 * stars distribution, median accuracy and net WPM per session, the most common top-2 weak keys
 * after each session, and the adaptive weights after the last one. See docs/sim.md.
 *
 * Output is a pure function of the arguments (no clock, no `Math.random()`), so two runs with the
 * same arguments print byte-identical text.
 */
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isContentDataFile } from "../src/content/collect";
import { lessonsFromModules } from "../src/content/lessons/load";
import type { Lesson } from "../src/content/lessons/types";
import { ADAPTIVE_CONSTANTS, keyWeights, weakKeys } from "../src/engine/adaptive";
import type { AdaptiveParams } from "../src/engine/adaptive";
import { generateTargets } from "../src/engine/generator";
import type { ContentKind, GenerateParams } from "../src/engine/generator";
import { createRng, hashString } from "../src/engine/rng";
import { baselineNetWpm, computeStars } from "../src/engine/stars";
import type { StarCount } from "../src/engine/stars";
import { foldSummaryIntoBigramStats, foldSummaryIntoKeyStats, median } from "../src/engine/stats";
import type { KeyStat, SessionSummary } from "../src/engine/stats";
import type { SessionConfig, TargetingMode, WrongKeyPolicy } from "../src/engine/types";
import { BIOME_ORDER } from "../src/types/core";
import type { AgeBand, GameModeId, Ms } from "../src/types/core";
import { runTypist, TYPIST_PROFILES } from "./sim/typist";
import type { TypistName, TypistProfile } from "./sim/typist";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Target latency per band (contracts §4). */
export const TARGET_LATENCY_MS: Readonly<Record<AgeBand, Ms>> = {
  sprout: 900,
  miner: 500,
  builder: 300,
};

/** Length multiplier per band when a lesson sets none (contracts §6). */
const DEFAULT_BAND_SCALE: Readonly<Record<AgeBand, number>> = {
  sprout: 0.6,
  miner: 1,
  builder: 1.3,
};

/** Meadow's keys: the home row plus the `g h` stretch (docs/impl/README.md §8.4). */
export const ADHOC_KEYS: readonly string[] = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"];

/** Command-line options. */
export interface SimOptions {
  lesson: string;
  typist: TypistName;
  runs: number;
  sessions: number;
  seed: number;
  band: AgeBand;
  /** `adhoc` only. */
  kind: ContentKind;
  /** `adhoc` only: chars per session. */
  chars: number;
}

export const DEFAULT_OPTIONS: SimOptions = {
  lesson: "adhoc",
  typist: "avg",
  runs: 50,
  sessions: 5,
  seed: 1,
  band: "miner",
  kind: "syllables",
  chars: 150,
};

/** Everything the simulator needs to play a lesson, already resolved for one band. */
export interface SimLesson {
  id: string;
  kind: ContentKind;
  /** Without space: the adaptive engine ranks these. The generator adds space by itself. */
  allowed: readonly string[];
  focus: readonly string[];
  length: { chars: number } | { targets: number } | { seconds: number };
  policy: WrongKeyPolicy;
  targeting: TargetingMode;
  caseSensitive: boolean;
  mode: GameModeId;
  goals: Lesson["targets"];
}

const KINDS: readonly ContentKind[] = ["letters", "syllables", "words", "phrases", "sentences"];
const BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];

function isTypistName(s: string): s is TypistName {
  return Object.hasOwn(TYPIST_PROFILES, s);
}

function positiveInt(flag: string, value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${flag} wants a whole number ≥ 1`);
  return n;
}

/** Parses `--flag value` pairs. Throws an `Error` with a readable message on bad input. */
export function parseArgs(args: readonly string[]): SimOptions {
  const opts: SimOptions = { ...DEFAULT_OPTIONS };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i] ?? "";
    const value = args[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    switch (flag) {
      case "--lesson":
        opts.lesson = value;
        break;
      case "--typist":
        if (!isTypistName(value)) {
          throw new Error(`--typist must be one of ${Object.keys(TYPIST_PROFILES).join(", ")}`);
        }
        opts.typist = value;
        break;
      case "--runs":
        opts.runs = positiveInt(flag, value);
        break;
      case "--sessions":
        opts.sessions = positiveInt(flag, value);
        break;
      case "--seed": {
        const n = Number(value);
        if (!Number.isSafeInteger(n)) throw new Error("--seed wants a whole number");
        opts.seed = n;
        break;
      }
      case "--band": {
        const band = BANDS.find((b) => b === value);
        if (band === undefined) throw new Error(`--band must be one of ${BANDS.join(", ")}`);
        opts.band = band;
        break;
      }
      case "--kind": {
        const kind = KINDS.find((k) => k === value);
        if (kind === undefined) throw new Error(`--kind must be one of ${KINDS.join(", ")}`);
        opts.kind = kind;
        break;
      }
      case "--chars":
        opts.chars = positiveInt(flag, value);
        break;
      default:
        throw new Error(`unknown option ${flag}`);
    }
  }
  return opts;
}

/** The built-in lesson: Meadow's ten keys, no focus keys (a review lesson), `stay` policy. */
export function adhocLesson(opts: Pick<SimOptions, "kind" | "chars">): SimLesson {
  return {
    id: "adhoc",
    kind: opts.kind,
    allowed: ADHOC_KEYS,
    focus: [],
    length: { chars: opts.chars },
    policy: opts.kind === "sentences" ? "backspace" : "stay",
    targeting: "sequential",
    caseSensitive: true,
    mode: "practice",
    goals: { accuracy: 0.9 },
  };
}

/** Curriculum order: biome order, then order within the biome. */
function rank(l: Lesson): number {
  return BIOME_ORDER.indexOf(l.biome) * 1000 + l.order;
}

/**
 * Resolves a lesson from the curriculum for one band, by the defaults in contracts §6. `allowed`
 * is every earlier lesson's `newKeys` in `BIOME_ORDER` plus this one's (`allowedKeysFor` is not
 * implemented yet; Sparkstone keys count only for Sparkstone lessons).
 */
export function lessonFromData(all: readonly Lesson[], id: string, band: AgeBand): SimLesson {
  const lesson = all.find((l) => l.id === id);
  if (lesson === undefined) {
    const known = all.map((l) => l.id).join(", ") || "(none yet)";
    throw new Error(`no lesson "${id}". Known lessons: ${known}. Use --lesson adhoc.`);
  }
  const allowed = new Set<string>();
  for (const l of all) {
    if (rank(l) > rank(lesson)) continue;
    if (l.biome === "sparkstone" && lesson.biome !== "sparkstone") continue;
    for (const key of l.newKeys) if (key !== " ") allowed.add(key);
  }
  const scale = lesson.bandScale?.[band] ?? DEFAULT_BAND_SCALE[band];
  const length =
    "seconds" in lesson.length
      ? { seconds: lesson.length.seconds * scale }
      : "chars" in lesson.length
        ? { chars: Math.ceil(lesson.length.chars * scale) }
        : { targets: Math.ceil(lesson.length.targets * scale) };
  const defaultPolicy: WrongKeyPolicy =
    lesson.kind === "sentences" ? "backspace" : band === "builder" ? "skip" : "stay";
  const early = BIOME_ORDER.indexOf(lesson.biome) < BIOME_ORDER.indexOf("mines");
  const insensitive = lesson.caseInsensitiveFor ?? (early ? ["sprout"] : []);
  return {
    id: lesson.id,
    kind: lesson.kind,
    allowed: [...allowed],
    focus: lesson.newKeys,
    length,
    policy: lesson.policy?.[band] ?? defaultPolicy,
    targeting: lesson.mode === "defense" || lesson.mode === "boss" ? "lockOn" : "sequential",
    caseSensitive: !insensitive.includes(band),
    mode: lesson.mode,
    goals: lesson.targets,
  };
}

/** Per-session numbers, over all runs. */
export interface SessionRow {
  session: number;
  stars: [number, number, number, number];
  accuracies: number[];
  netWpms: number[];
  /** Sorted top-2 weak keys after this session, joined by a space → how many runs. */
  topPairs: Map<string, number>;
  /** Bigrams practiced this session (summed over runs). */
  bigrams: number;
  /** …of which had fewer than 5 attempts. */
  thinBigrams: number;
  /** …of which had fewer than 5 attempts and still got a longer SRS interval. */
  thinBigramsPromoted: number;
}

/** Per key, after the last session. */
export interface KeyRow {
  key: string;
  /** Mean adaptive weight going into the next session. */
  weight: number;
  /** Runs in which the key is among the top-2 weak keys. */
  top2: number;
  /** Share of generated chars (spaces excluded) in the last session, over all runs. */
  share: number;
}

export interface SimReport {
  options: SimOptions;
  lesson: SimLesson;
  profile: TypistProfile;
  rows: SessionRow[];
  keys: KeyRow[];
}

/** Plays `opts.runs` learners through `opts.sessions` sessions of `lesson`. Deterministic. */
export function simulate(lesson: SimLesson, opts: SimOptions): SimReport {
  const profile = TYPIST_PROFILES[opts.typist];
  const targetLatencyMs = TARGET_LATENCY_MS[opts.band];
  const rows: SessionRow[] = Array.from({ length: opts.sessions }, (_, i) => ({
    session: i + 1,
    stars: [0, 0, 0, 0],
    accuracies: [],
    netWpms: [],
    topPairs: new Map(),
    bigrams: 0,
    thinBigrams: 0,
    thinBigramsPromoted: 0,
  }));
  const weightSums = new Map<string, number>(lesson.allowed.map((k) => [k, 0]));
  const top2Counts = new Map<string, number>(lesson.allowed.map((k) => [k, 0]));
  const charCounts = new Map<string, number>(lesson.allowed.map((k) => [k, 0]));
  let lastSessionChars = 0;
  const root = createRng(opts.seed);

  for (let run = 0; run < opts.runs; run++) {
    const rng = root.fork(`run:${run}`);
    let keyStats: Record<string, KeyStat> = {};
    let bigramStats: Record<string, KeyStat> = {};
    const history: SessionSummary[] = [];
    let t: Ms = 0;
    const params = (sessionIndex: number): AdaptiveParams => ({
      allowed: lesson.allowed,
      focus: lesson.focus,
      stats: keyStats,
      sessionIndex,
      targetLatencyMs,
    });

    for (const row of rows) {
      const s = row.session;
      const baseline = baselineNetWpm(history);
      const length: GenerateParams["length"] =
        "seconds" in lesson.length
          ? { seconds: lesson.length.seconds, estWpm: baseline ?? profile.wpm }
          : lesson.length;
      const targets = generateTargets(
        {
          kind: lesson.kind,
          allowed: lesson.allowed,
          weights: keyWeights(params(s)),
          pools: [],
          length,
          capitalize: "none",
        },
        rng.fork(`generate:${s}`),
      );
      const config: SessionConfig = {
        policy: lesson.policy,
        targeting: lesson.targeting,
        caseSensitive: lesson.caseSensitive,
        end:
          "seconds" in lesson.length
            ? { kind: "time", ms: lesson.length.seconds * 1000 }
            : { kind: "targets" },
        lessonId: lesson.id,
        mode: lesson.mode,
        seed: hashString(`${opts.seed}:${run}:${s}`),
      };
      const practice = Object.fromEntries(
        Object.entries(keyStats).map(([key, stat]) => [key, stat.attempts]),
      );
      const result = runTypist({
        config,
        targets,
        profile,
        rng: rng.fork(`typist:${s}`),
        startT: t,
        practice,
      });
      const { summary } = result;
      t = summary.startedAtT + summary.activeMs;
      t += 60_000; // a break between sessions; time is per run and never read by stats

      const stars: StarCount = computeStars({
        completed: result.endedNaturally || config.end.kind === "time",
        accuracy: summary.accuracy,
        netWpm: summary.netWpm,
        targets: lesson.goals,
        baseline,
      });
      row.stars[stars]++;
      row.accuracies.push(summary.accuracy);
      row.netWpms.push(summary.netWpm);
      history.push(summary);

      const nextBigrams = foldSummaryIntoBigramStats(bigramStats, summary, s);
      for (const [bigram, agg] of Object.entries(summary.bigrams)) {
        if (agg.attempts <= 0) continue;
        row.bigrams++;
        if (agg.attempts >= 5) continue;
        row.thinBigrams++;
        const before = bigramStats[bigram]?.srs.intervalSessions ?? 1;
        if ((nextBigrams[bigram]?.srs.intervalSessions ?? 1) > before) row.thinBigramsPromoted++;
      }
      bigramStats = nextBigrams;
      keyStats = foldSummaryIntoKeyStats(keyStats, summary, s);

      const pair = weakKeys(params(s + 1), 2)
        .toSorted((a, b) => a.localeCompare(b))
        .join(" ");
      row.topPairs.set(pair, (row.topPairs.get(pair) ?? 0) + 1);

      if (s === opts.sessions) {
        const weights = keyWeights(params(s + 1));
        for (const key of lesson.allowed) {
          weightSums.set(key, (weightSums.get(key) ?? 0) + (weights[key] ?? 0));
        }
        for (const key of weakKeys(params(s + 1), 2)) {
          top2Counts.set(key, (top2Counts.get(key) ?? 0) + 1);
        }
        for (const target of targets) {
          for (const c of target.text) {
            if (c === " ") continue;
            charCounts.set(c, (charCounts.get(c) ?? 0) + 1);
            lastSessionChars++;
          }
        }
      }
    }
  }

  const keys: KeyRow[] = lesson.allowed.map((key) => ({
    key,
    weight: (weightSums.get(key) ?? 0) / opts.runs,
    top2: top2Counts.get(key) ?? 0,
    share: lastSessionChars === 0 ? 0 : (charCounts.get(key) ?? 0) / lastSessionChars,
  }));
  return { options: opts, lesson, profile, rows, keys };
}

const pct = (n: number, of: number): string => (of === 0 ? "-" : `${((100 * n) / of).toFixed(0)}%`);
const fixed = (n: number | null, digits: number): string => (n === null ? "-" : n.toFixed(digits));

function table(header: readonly string[], body: readonly (readonly string[])[]): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => (r[i] ?? "").length)));
  const line = (cells: readonly string[]): string =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join(" | ")
      .trimEnd();
  return [line(header), widths.map((w) => "-".repeat(w)).join("-|-"), ...body.map(line)];
}

/** The text the tool prints. Same report in, same bytes out. */
export function formatReport(report: SimReport): string {
  const { options: o, lesson, profile, rows, keys } = report;
  const runs = o.runs;
  const out: string[] = [];
  out.push(
    `sim: lesson ${lesson.id} (${lesson.kind}, ${lesson.policy}, ${lesson.targeting}), ` +
      `typist ${o.typist}, band ${o.band}, runs ${runs}, sessions ${o.sessions}, seed ${o.seed}`,
  );
  out.push(
    `keys: ${lesson.allowed.join(" ")}${lesson.focus.length ? ` (focus ${lesson.focus.join(" ")})` : ""}`,
  );
  out.push(
    `typist: wpm ${profile.wpm}, errorRate ${profile.errorRate}, jitter ${profile.jitter}, ` +
      `learnRate ${profile.learnRate ?? 0}, perKeyErrorMult ${JSON.stringify(profile.perKeyErrorMult ?? {})}`,
  );
  out.push(
    `adaptive: ${Object.entries(ADAPTIVE_CONSTANTS)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  );
  out.push("");
  out.push("Per session");
  out.push(
    ...table(
      ["session", "stars 0/1/2/3", "median acc", "median net WPM", "top-2 weak keys after (runs)"],
      rows.map((row) => [
        String(row.session),
        row.stars.map((n) => pct(n, runs)).join(" / "),
        `${fixed((median(row.accuracies) ?? 0) * 100, 1)}%`,
        fixed(median(row.netWpms), 1),
        [...row.topPairs]
          .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 3)
          .map(([pair, n]) => `[${pair}] ${pct(n, runs)}`)
          .join(", "),
      ]),
    ),
  );
  out.push("");
  out.push(`Adaptive weights after session ${o.sessions} (mean over runs)`);
  out.push(
    ...table(
      ["key", "weight", "in top-2", `share of chars in session ${o.sessions}`],
      keys.map((k) => [
        k.key,
        fixed(k.weight, 3),
        pct(k.top2, runs),
        `${(k.share * 100).toFixed(1)}%`,
      ]),
    ),
  );
  out.push("");
  out.push("Bigram SRS (attempts per bigram per session)");
  out.push(
    ...table(
      ["session", "bigrams", "< 5 attempts", "< 5 attempts and interval grew"],
      rows.map((row) => [
        String(row.session),
        String(row.bigrams),
        pct(row.thinBigrams, row.bigrams),
        pct(row.thinBigramsPromoted, row.thinBigrams),
      ]),
    ),
  );
  return `${out.join("\n")}\n`;
}

async function loadLessons(): Promise<Lesson[]> {
  const dir = join(REPO_ROOT, "src/content/lessons");
  const modules: Record<string, unknown> = {};
  for (const name of readdirSync(dir).filter(isContentDataFile)) {
    modules[`./${name}`] = await import(pathToFileURL(join(dir, name)).href);
  }
  return lessonsFromModules(modules);
}

async function main(): Promise<void> {
  let opts: SimOptions;
  let lesson: SimLesson;
  try {
    opts = parseArgs(argv.slice(2));
    lesson =
      opts.lesson === "adhoc"
        ? adhocLesson(opts)
        : lessonFromData(await loadLessons(), opts.lesson, opts.band);
  } catch (error) {
    console.error(`sim: ${error instanceof Error ? error.message : String(error)}`);
    console.error(
      "Usage: npm run tool -- sim [--lesson <id|adhoc>] [--typist slow|avg|fast|pinkyweak] " +
        "[--runs 50] [--sessions 5] [--seed 1] [--band miner] [--kind syllables] [--chars 150]",
    );
    process.exit(2);
  }
  process.stdout.write(formatReport(simulate(lesson, opts)));
}

if (resolve(argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
