/**
 * Placement test simulator (task M3-05, PLAN.md §3.2.8, §9.3).
 *
 *   npm run tool -- sim-placement --runs 200 --seed 1
 *
 * Plays the 90-second placement test with M1-07's synthetic typists (`tools/sim/typist.ts`) for
 * every band, through the same pure driver the game uses (`createPlacementDriver`) and the real
 * typing engine, then runs `estimatePlacement` on each result. It prints, per band and typist,
 * where the learners start, the rung they reached, and their median net WPM and accuracy.
 *
 * The typists are M1-07's, with one change for this test (M3-FIX-3 N2): digits and Shift are
 * slower and slip more than letters ({@link HARD_KEYS}), as they do for children. The report also
 * shows how many learners would start lower if every gate were judged on the whole test (the
 * M3-05 rule), and how well each letter rung shows its new keys (N1).
 *
 * Output is a pure function of the arguments, so two runs with the same arguments print
 * byte-identical text. The game's own rules decide everything; this file only types.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { poolFromText } from "../src/content/wordlists/loader";
import type { WordPool } from "../src/engine/generator";
import {
  PLACEMENT_MS,
  PLACEMENT_TIERS,
  estimatePlacement,
  testsNewKey,
} from "../src/engine/placement";
import { createPlacementDriver } from "../src/engine/placement-driver";
import { createRng, hashString } from "../src/engine/rng";
import { createSession } from "../src/engine/session";
import { median } from "../src/engine/stats";
import type { SessionSummary } from "../src/engine/stats";
import type { EngineEvent, TargetView } from "../src/engine/types";
import { BIOME_ORDER } from "../src/types/core";
import type { AgeBand, BiomeId, Ms } from "../src/types/core";
import {
  TYPIST_PROFILES,
  errorProbability,
  neighborsOf,
  sampleLatency,
  sampleNoticeDelay,
} from "./sim/typist";
import type { TypistName, TypistProfile } from "./sim/typist";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];
/**
 * An average-speed child who knows only the home row (M3-FIX-3 N1): every top- and bottom-row
 * letter goes wrong 6 times as often (about 1 in 3). The ladder, not the speed gates, should hold
 * this child at the Meadow or Birch.
 */
export const HOME_ROW_ONLY: TypistProfile = {
  ...TYPIST_PROFILES.avg,
  perKeyErrorMult: Object.fromEntries(Array.from("qwertyuiopzxcvbnm").map((k) => [k, 6])),
};

type SimTypist = TypistName | "homeonly";
const TYPISTS: readonly SimTypist[] = ["slow", "avg", "fast", "pinkyweak", "homeonly"];
const profileOf = (name: SimTypist): TypistProfile =>
  name === "homeonly" ? HOME_ROW_ONLY : TYPIST_PROFILES[name];
/** Target latency per band (contracts §4). */
const TARGET_LATENCY: Readonly<Record<AgeBand, Ms>> = { sprout: 900, miner: 500, builder: 300 };

/**
 * How much slower (latency ×) and more slip-prone (errors ×) a child is on a digit or a Shifted
 * capital than on a home-area letter. Digits sit a long reach from the home row and are rarely
 * practised; a capital is a two-key chord. M1-07's typists treat every key alike, which hid the
 * digits rung's pull on the score (M3-05 review N2). These are deliberately rough: about twice as
 * slow on digits, 1.6× on capitals.
 */
export const HARD_KEYS = {
  digit: { latency: 2, errors: 2 },
  shift: { latency: 1.6, errors: 1.5 },
} as const;

const hardness = (char: string): { latency: number; errors: number } => {
  if (/^[0-9]$/.test(char)) return HARD_KEYS.digit;
  if (char !== char.toLowerCase()) return HARD_KEYS.shift;
  return { latency: 1, errors: 1 };
};

export interface PlacementSimOptions {
  runs: number;
  seed: number;
}

/** The pools the ladder's word rungs name, read from `src/content/wordlists/`. */
export function loadPlacementPools(): WordPool[] {
  const ids = new Set<string>();
  for (const tier of PLACEMENT_TIERS)
    for (const b of BANDS) for (const id of tier.pools(b)) ids.add(id);
  return [...ids].toSorted().map((id) => {
    const text = readFileSync(join(REPO_ROOT, "src/content/wordlists", `${id}.txt`), "utf8");
    return poolFromText(id, text);
  });
}

/** One simulated test. */
export interface PlacementRun {
  summary: SessionSummary;
  tierReached: number;
  blocks: number;
  startBiome: BiomeId;
  /** The start the M3-05 rule gave: every gate judged on the whole test. */
  wholeTestStart: BiomeId;
  /** The blocks shown on each rung, in order. */
  shown: string[][];
}

/**
 * Plays one test as `profile` would type it. Mine's `stay` policy: after a slip the typist waits
 * its notice delay and types the right key. Each broken block asks the driver for the next one,
 * as Mine's `onBlock` hook does in the game.
 */
export function playPlacement(
  band: AgeBand,
  profile: TypistProfile,
  pools: readonly WordPool[],
  seed: number,
): PlacementRun {
  const rng = createRng(seed);
  const driver = createPlacementDriver(
    { band, pools, stats: {}, sessionIndex: 1, targetLatencyMs: TARGET_LATENCY[band] },
    rng.fork("placement"),
  );
  const session = createSession(
    {
      policy: "stay",
      targeting: "sequential",
      caseSensitive: band !== "sprout",
      end: { kind: "time", ms: PLACEMENT_MS },
      mode: "placement",
      seed,
    },
    [driver.first()],
  );
  const shown: string[][] = PLACEMENT_TIERS.map(() => []);
  const show = (text: string): void => {
    shown[driver.ladder().tier]?.push(text);
  };
  show(session.view().active?.text ?? "");
  const latencyRng = rng.fork("latency");
  const errorRng = rng.fork("errors");
  const wrongRng = rng.fork("wrongKey");
  const noticeRng = rng.fork("notice");
  let t: Ms = 0;
  let justErred = false;
  const ended: { summary: SessionSummary | null } = { summary: null };

  const absorb = (events: readonly EngineEvent[]): void => {
    for (const e of events) {
      if (e.type === "targetComplete") {
        const next = driver.next(e.errors, e.t);
        show(next.text);
        session.addTargets([next]);
      }
      if (e.type === "sessionEnd") ended.summary = e.summary;
    }
  };

  for (let guard = 0; !session.view().ended && guard < 20_000; guard++) {
    const active: TargetView | null = session.view().active;
    if (active === null) {
      absorb(session.end(t));
      break;
    }
    const expected = Array.from(active.text)[active.typed] ?? " ";
    const hard = hardness(expected);
    const slip =
      errorRng.next() <
      Math.min(0.9, errorProbability(profile, expected.toLowerCase()) * hard.errors);
    const key = slip ? wrongRng.pick(neighborsOf(expected)) : expected;
    t += sampleLatency(profile, latencyRng) * hard.latency;
    if (justErred) t += sampleNoticeDelay(noticeRng);
    justErred = slip;
    absorb(session.feed({ key, t, shift: key !== key.toLowerCase() }));
  }
  if (ended.summary === null) absorb(session.end(t));
  const final: SessionSummary | null = ended.summary;
  if (final === null) throw new Error("sim-placement: the session produced no summary");
  const progression = { band, tierReached: driver.tierReached(), sessionIndex: 1 };
  const estimate = estimatePlacement(final, {
    ...progression,
    rungs: driver.rungScores(final.startedAtT),
  });
  return {
    summary: final,
    tierReached: driver.tierReached(),
    blocks: driver.blocks(),
    startBiome: estimate.startBiome,
    wholeTestStart: estimatePlacement(final, progression).startBiome,
    shown,
  };
}

export interface PlacementRow {
  band: AgeBand;
  typist: SimTypist;
  /** Learners per start biome. */
  starts: Partial<Record<BiomeId, number>>;
  /** Learners per highest rung reached. */
  tiers: number[];
  netWpm: number;
  accuracy: number;
  blocks: number;
  /** Learners the whole-test rule (M3-05) would start in an earlier biome. */
  lowerOnWholeTest: number;
}

/** How a letter rung showed its new keys, over every learner who left it (N1). */
export interface CoverageRow {
  tier: string;
  /** Learners who left the rung. */
  learners: number;
  /** Share of the rung's first 8 blocks that use one of its new keys. */
  firstEight: number;
  /** Mean share of the rung's new keys shown before the next rung opened. */
  keysShown: number;
}

export interface PlacementReport {
  rows: PlacementRow[];
  coverage: CoverageRow[];
}

const before = (a: BiomeId, b: BiomeId): boolean => BIOME_ORDER.indexOf(a) < BIOME_ORDER.indexOf(b);

export function simulatePlacement(opts: PlacementSimOptions): PlacementReport {
  const pools = loadPlacementPools();
  const rows: PlacementRow[] = [];
  const letterTiers = PLACEMENT_TIERS.flatMap((t, i) =>
    t.kind === "letters" && t.keepEarlier ? [i] : [],
  );
  const cover = letterTiers.map(() => ({ learners: 0, newInEight: 0, eight: 0, keys: 0 }));
  for (const band of BANDS) {
    for (const typist of TYPISTS) {
      const starts: Partial<Record<BiomeId, number>> = {};
      const tiers = PLACEMENT_TIERS.map(() => 0);
      const wpm: number[] = [];
      const acc: number[] = [];
      const blocks: number[] = [];
      let lower = 0;
      for (let run = 0; run < opts.runs; run++) {
        const seed = hashString(`${opts.seed}:${band}:${typist}:${run}`);
        const r = playPlacement(band, profileOf(typist), pools, seed);
        starts[r.startBiome] = (starts[r.startBiome] ?? 0) + 1;
        tiers[r.tierReached] = (tiers[r.tierReached] ?? 0) + 1;
        wpm.push(r.summary.netWpm);
        acc.push(r.summary.accuracy);
        blocks.push(r.blocks);
        if (before(r.wholeTestStart, r.startBiome)) lower++;
        letterTiers.forEach((tier, i) => {
          const c = cover[i];
          const own = PLACEMENT_TIERS[tier];
          // Only rungs the learner left: the last rung's blocks run until the clock stops.
          if (c === undefined || own === undefined || tier >= r.tierReached) return;
          const shownHere = r.shown[tier] ?? [];
          const eight = shownHere.slice(0, 8);
          c.learners++;
          c.eight += eight.length;
          c.newInEight += eight.filter((text) => testsNewKey(tier, text)).length;
          const seen = own.newKeys.filter((k) => shownHere.some((text) => text.includes(k)));
          c.keys += seen.length / own.newKeys.length;
        });
      }
      rows.push({
        band,
        typist,
        starts,
        tiers,
        netWpm: median(wpm) ?? 0,
        accuracy: median(acc) ?? 0,
        blocks: median(blocks) ?? 0,
        lowerOnWholeTest: lower,
      });
    }
  }
  const coverage = letterTiers.map((tier, i) => {
    const c = cover[i] ?? { learners: 0, newInEight: 0, eight: 0, keys: 0 };
    return {
      tier: PLACEMENT_TIERS[tier]?.id ?? String(tier),
      learners: c.learners,
      firstEight: c.eight === 0 ? 0 : c.newInEight / c.eight,
      keysShown: c.learners === 0 ? 0 : c.keys / c.learners,
    };
  });
  return { rows, coverage };
}

const pct = (n: number, of: number): string => `${Math.round((100 * n) / of)}%`;

export function formatPlacement(report: PlacementReport, opts: PlacementSimOptions): string {
  const shown = BIOME_ORDER.slice(0, PLACEMENT_TIERS.length);
  const out: string[] = [
    `Placement sim: ${opts.runs} learners per row, seed ${opts.seed}, ${PLACEMENT_MS / 1000} s test`,
    `Digits: ${HARD_KEYS.digit.latency}× slower, ${HARD_KEYS.digit.errors}× the slips. Capitals: ${HARD_KEYS.shift.latency}× slower, ${HARD_KEYS.shift.errors}× the slips.`,
    "",
    `| Band | Typist | Net WPM | Accuracy | Blocks | ${shown.join(" | ")} | Lower on whole test | Rungs reached (${PLACEMENT_TIERS.map((t) => t.id).join("/")}) |`,
    `|---|---|---:|---:|---:|${shown.map(() => "---:").join("|")}|---:|---|`,
  ];
  for (const r of report.rows) {
    const cells = shown.map((b) => {
      const n = r.starts[b] ?? 0;
      return n === 0 ? "·" : pct(n, opts.runs);
    });
    const lower = r.lowerOnWholeTest === 0 ? "·" : pct(r.lowerOnWholeTest, opts.runs);
    out.push(
      `| ${r.band} | ${r.typist} | ${r.netWpm.toFixed(1)} | ${(100 * r.accuracy).toFixed(1)}% | ${r.blocks} | ${cells.join(" | ")} | ${lower} | ${r.tiers.join("/")} |`,
    );
  }
  out.push(
    "",
    "| Letter rung | Learners who left it | First 8 blocks with a new key | New keys shown before it opened |",
    "|---|---:|---:|---:|",
  );
  for (const c of report.coverage) {
    out.push(
      `| ${c.tier} | ${c.learners} | ${(100 * c.firstEight).toFixed(0)}% | ${(100 * c.keysShown).toFixed(0)}% |`,
    );
  }
  return `${out.join("\n")}\n`;
}

export function parsePlacementArgs(args: readonly string[]): PlacementSimOptions {
  const opts: PlacementSimOptions = { runs: 200, seed: 1 };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = Number(args[i + 1]);
    if (!Number.isInteger(value) || value < 0)
      throw new Error(`${flag ?? ""} needs a whole number`);
    if (flag === "--runs") opts.runs = Math.max(1, value);
    else if (flag === "--seed") opts.seed = value;
    else throw new Error(`unknown flag ${flag ?? ""}`);
  }
  return opts;
}

if (resolve(argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const opts = parsePlacementArgs(argv.slice(2));
  process.stdout.write(formatPlacement(simulatePlacement(opts), opts));
}
