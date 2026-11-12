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
 * Output is a pure function of the arguments, so two runs with the same arguments print
 * byte-identical text. The game's own rules decide everything; this file only types.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { poolFromText } from "../src/content/wordlists/loader";
import type { WordPool } from "../src/engine/generator";
import { PLACEMENT_MS, PLACEMENT_TIERS, estimatePlacement } from "../src/engine/placement";
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
const TYPISTS: readonly TypistName[] = ["slow", "avg", "fast", "pinkyweak"];
/** Target latency per band (contracts §4). */
const TARGET_LATENCY: Readonly<Record<AgeBand, Ms>> = { sprout: 900, miner: 500, builder: 300 };

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
    { band, pools, stats: {}, sessionIndex: 0, targetLatencyMs: TARGET_LATENCY[band] },
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
  const latencyRng = rng.fork("latency");
  const errorRng = rng.fork("errors");
  const wrongRng = rng.fork("wrongKey");
  const noticeRng = rng.fork("notice");
  let t: Ms = 0;
  let justErred = false;
  let summary: SessionSummary | null = null;

  const absorb = (events: readonly EngineEvent[]): void => {
    for (const e of events) {
      if (e.type === "targetComplete") session.addTargets([driver.next(e.errors)]);
      if (e.type === "sessionEnd") summary = e.summary;
    }
  };

  for (let guard = 0; !session.view().ended && guard < 20_000; guard++) {
    const active: TargetView | null = session.view().active;
    if (active === null) {
      absorb(session.end(t));
      break;
    }
    const expected = Array.from(active.text)[active.typed] ?? " ";
    const slip = errorRng.next() < errorProbability(profile, expected.toLowerCase());
    const key = slip ? wrongRng.pick(neighborsOf(expected)) : expected;
    t += sampleLatency(profile, latencyRng);
    if (justErred) t += sampleNoticeDelay(noticeRng);
    justErred = slip;
    absorb(session.feed({ key, t, shift: key !== key.toLowerCase() }));
  }
  if (summary === null) absorb(session.end(t));
  const final: SessionSummary | null = summary;
  if (final === null) throw new Error("sim-placement: the session produced no summary");
  const estimate = estimatePlacement(final, {
    band,
    tierReached: driver.tierReached(),
    sessionIndex: 1,
  });
  return {
    summary: final,
    tierReached: driver.tierReached(),
    blocks: driver.blocks(),
    startBiome: estimate.startBiome,
  };
}

export interface PlacementRow {
  band: AgeBand;
  typist: TypistName;
  /** Learners per start biome. */
  starts: Partial<Record<BiomeId, number>>;
  /** Learners per highest rung reached. */
  tiers: number[];
  netWpm: number;
  accuracy: number;
  blocks: number;
}

export function simulatePlacement(opts: PlacementSimOptions): PlacementRow[] {
  const pools = loadPlacementPools();
  const rows: PlacementRow[] = [];
  for (const band of BANDS) {
    for (const typist of TYPISTS) {
      const starts: Partial<Record<BiomeId, number>> = {};
      const tiers = PLACEMENT_TIERS.map(() => 0);
      const wpm: number[] = [];
      const acc: number[] = [];
      const blocks: number[] = [];
      for (let run = 0; run < opts.runs; run++) {
        const seed = hashString(`${opts.seed}:${band}:${typist}:${run}`);
        const r = playPlacement(band, TYPIST_PROFILES[typist], pools, seed);
        starts[r.startBiome] = (starts[r.startBiome] ?? 0) + 1;
        tiers[r.tierReached] = (tiers[r.tierReached] ?? 0) + 1;
        wpm.push(r.summary.netWpm);
        acc.push(r.summary.accuracy);
        blocks.push(r.blocks);
      }
      rows.push({
        band,
        typist,
        starts,
        tiers,
        netWpm: median(wpm) ?? 0,
        accuracy: median(acc) ?? 0,
        blocks: median(blocks) ?? 0,
      });
    }
  }
  return rows;
}

const pct = (n: number, of: number): string => `${Math.round((100 * n) / of)}%`;

export function formatPlacement(rows: readonly PlacementRow[], opts: PlacementSimOptions): string {
  const shown = BIOME_ORDER.slice(0, PLACEMENT_TIERS.length);
  const out: string[] = [
    `Placement sim: ${opts.runs} learners per row, seed ${opts.seed}, ${PLACEMENT_MS / 1000} s test`,
    "",
    `| Band | Typist | Net WPM | Accuracy | Blocks | ${shown.join(" | ")} | Rungs reached (${PLACEMENT_TIERS.map((t) => t.id).join("/")}) |`,
    `|---|---|---:|---:|---:|${shown.map(() => "---:").join("|")}|---|`,
  ];
  for (const r of rows) {
    const cells = shown.map((b) => {
      const n = r.starts[b] ?? 0;
      return n === 0 ? "·" : pct(n, opts.runs);
    });
    out.push(
      `| ${r.band} | ${r.typist} | ${r.netWpm.toFixed(1)} | ${(100 * r.accuracy).toFixed(1)}% | ${r.blocks} | ${cells.join(" | ")} | ${r.tiers.join("/")} |`,
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
