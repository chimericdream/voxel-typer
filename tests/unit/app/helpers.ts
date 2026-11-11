/** Fakes for the app shell tests: a scene with a manual frame pump, a scripted mode, fixtures. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppScene } from "../../../src/app/scene-host";
import type { Lesson } from "../../../src/content/lessons/types";
import type { SessionSummary } from "../../../src/engine/stats";
import type { KeyInput } from "../../../src/engine/types";
import type { ModeContext, ModeInstance, ModeModule, ModeResult } from "../../../src/modes/types";
import { isProfile } from "../../../src/save/schema";
import type { Profile } from "../../../src/save/schema";
import type { Ms } from "../../../src/types/core";

export function fixture(name: string): Profile {
  const raw: unknown = JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../../fixtures/profiles/${name}.json`), "utf8"),
  );
  if (!isProfile(raw)) throw new Error(`fixture ${name} is not a profile`);
  return raw;
}

export function summary(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    lessonId: "meadow-01",
    mode: "mine",
    seed: 1,
    startedAtT: 0,
    activeMs: 60_000,
    keystrokes: 20,
    correct: 19,
    errors: 1,
    uncorrected: 0,
    grossWpm: 12,
    netWpm: 12,
    accuracy: 0.95,
    consistency: 0.5,
    perKey: { f: { attempts: 10, errors: 1, latencies: [400, 500] } },
    bigrams: { fj: { attempts: 4, errors: 0, latencies: [450] } },
    longestStreak: 12,
    targetsCompleted: 10,
    ...over,
  };
}

export function result(over: Partial<ModeResult> = {}): ModeResult {
  return { summary: summary(), loot: { dirt: 2 }, stars: 2, ...over };
}

export function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: "meadow-01",
    biome: "meadow",
    order: 1,
    titleKey: "lessonsMeadow.l01.title",
    newKeys: ["f", "j"],
    reviewKeys: [],
    kind: "letters",
    length: { chars: 30 },
    mode: "mine",
    targets: { accuracy: 0.85 },
    ...over,
  };
}

export interface FakeScene extends AppScene {
  /** Runs one frame for every subscriber. */
  tick(dtMs: Ms, t: Ms): void;
  subscribers(): number;
  drift: boolean;
  disposed: number;
}

export function fakeScene(): FakeScene {
  const subs = new Set<(dt: Ms, t: Ms) => void>();
  const scene: FakeScene = {
    three: null,
    lite: null,
    drift: false,
    disposed: 0,
    setEnvironment: () => undefined,
    loadDiorama: () => Promise.resolve(),
    clearDiorama: () => undefined,
    camera: {
      preset: () => undefined,
      orbit: () => undefined,
      shake: () => undefined,
      setDrift(on) {
        scene.drift = on;
      },
    },
    fx: { burst: () => undefined, hitStop: () => undefined, floatText: () => undefined },
    requestRender: () => undefined,
    setQuality: () => undefined,
    onFrame(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    renderStats: () => ({ calls: 7 }),
    dispose() {
      scene.disposed += 1;
    },
    tick(dt, t) {
      for (const fn of new Set(subs)) fn(dt, t);
    },
    subscribers: () => subs.size,
  };
  return scene;
}

/** A mode that records every call and hands its context out. */
export interface FakeMode {
  module: ModeModule;
  ctx(): ModeContext;
  calls: string[];
  inputs: KeyInput[];
}

export function fakeMode(): FakeMode {
  let ctx: ModeContext | null = null;
  const calls: string[] = [];
  const inputs: KeyInput[] = [];
  const instance: ModeInstance = {
    start: () => calls.push("start"),
    input(k) {
      inputs.push(k);
    },
    frame: () => calls.push("frame"),
    pause: () => calls.push("pause"),
    resume: () => calls.push("resume"),
    dispose: () => calls.push("dispose"),
  };
  return {
    module: {
      id: "mine",
      load: () =>
        Promise.resolve({
          create(c: ModeContext) {
            ctx = c;
            return instance;
          },
        }),
    },
    ctx() {
      if (ctx === null) throw new Error("mode not created yet");
      return ctx;
    },
    calls,
    inputs,
  };
}

export const key = (k: string, t = 0): KeyInput => ({ key: k, t, shift: false });

/** Lets queued promise callbacks and microtasks run. */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
