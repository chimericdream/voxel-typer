/**
 * URL debug params (docs/impl/contracts.md §13).
 *
 * Production builds read only `lite` and `quality`; every other param is ignored there. The
 * parser takes `production` as a parameter so tests can check both builds; `main.ts` passes
 * `import.meta.env.MODE === "production"`, which Vite replaces with a constant.
 */
import type { QualityLevel } from "@/types/core";
import { isRouteId } from "./routes";
import type { RouteId } from "./routes";

export interface DebugParams {
  /** `?seed=<n>`: overrides every top-level seed. */
  seed: number | null;
  /** `?freeze=1`: fixed-step clock for visuals, no ambient motion, day/night held at t01 = 0.3. */
  freeze: boolean;
  /** `?profile=<fixture>`: a fixture from `tests/fixtures/profiles/`, in a throwaway memory store. */
  profile: string | null;
  /** `?screen=<id>`: deep link. */
  screen: RouteId | null;
  /** `?lesson=<id>`: the lesson for a deep-linked screen. */
  lesson: string | null;
  /** `?record=1`: keep the keystroke log of each lesson for download at Results. */
  record: boolean;
  /** `?quality=low|medium|high` (also in production). */
  quality: QualityLevel | null;
  /** `?lite=1`: 2D mode (also in production). */
  lite: boolean;
  /** `?nosave=1`: in-memory persistence only. */
  nosave: boolean;
}

/** The day/night position used under `?freeze`. */
export const FROZEN_T01 = 0.3;

const QUALITIES: readonly QualityLevel[] = ["low", "medium", "high"];
const FIXTURE_NAME = /^[a-z0-9-]{1,40}$/;
const LESSON_NAME = /^[a-z0-9-]{1,40}$/;

const flag = (q: URLSearchParams, name: string): boolean => {
  const v = q.get(name);
  return v !== null && v !== "0" && v !== "false";
};

export function parseDebugParams(search: string, production: boolean): DebugParams {
  const q = new URLSearchParams(search);
  const quality = q.get("quality");
  const out: DebugParams = {
    seed: null,
    freeze: false,
    profile: null,
    screen: null,
    lesson: null,
    record: false,
    quality: QUALITIES.find((x) => x === quality) ?? null,
    lite: flag(q, "lite"),
    nosave: false,
  };
  if (production) return out;

  const seed = q.get("seed");
  if (seed !== null && /^-?\d{1,10}$/.test(seed)) out.seed = Number(seed) >>> 0;
  out.freeze = flag(q, "freeze");
  const profile = q.get("profile");
  if (profile !== null && FIXTURE_NAME.test(profile)) out.profile = profile;
  const screen = q.get("screen");
  if (isRouteId(screen)) out.screen = screen;
  const lesson = q.get("lesson");
  if (lesson !== null && LESSON_NAME.test(lesson)) out.lesson = lesson;
  out.record = flag(q, "record");
  out.nosave = flag(q, "nosave");
  return out;
}
