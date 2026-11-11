/**
 * Sound-effect recipes (task M2-06). Each effect is plain data: a few layers, each an oscillator
 * or a noise buffer, an optional filter and a gain envelope. `engine.ts` turns a recipe into Web
 * Audio nodes, and `preview.ts` renders the same recipe offline, so tests can measure the peak of
 * every sound without a browser.
 *
 * This file uses no DOM and no clock. Randomness (a little detune) comes in as `vary`.
 *
 * All sounds are original designs built from sine/triangle tones and filtered noise.
 */
import type { Material, SfxName } from "./types";

export type Wave = "sine" | "triangle";
export type NoiseColor = "white" | "brown";

export interface Envelope {
  /** Start, seconds after the effect starts. */
  at: number;
  /** Linear rise from 0 to `peak`, seconds. */
  attack: number;
  /** Time held at `peak` after the attack, seconds. */
  hold?: number;
  /** Exponential fall from `peak` to silence (−80 dB), seconds. */
  decay: number;
  /** Peak gain of the layer, before the voice, bus and master gains. */
  peak: number;
}

export interface FilterSpec {
  type: "lowpass" | "highpass" | "bandpass";
  /** Cutoff or center, Hz. */
  freq: number;
  /** Exponential sweep target, Hz, reached at the end of the layer. */
  freqEnd?: number;
  /** Web Audio `Q`: resonance in dB for lowpass/highpass, quality factor for bandpass. */
  q: number;
}

export interface ToneLayer {
  kind: "tone";
  wave: Wave;
  freq: number;
  /** Exponential glide target, Hz, reached `glide` seconds after the layer starts. */
  freqEnd?: number;
  glide?: number;
  filter?: FilterSpec;
  env: Envelope;
}

export interface NoiseLayer {
  kind: "noise";
  color: NoiseColor;
  filter: FilterSpec;
  env: Envelope;
}

export type Layer = ToneLayer | NoiseLayer;

export interface Recipe {
  layers: Layer[];
}

export interface SfxOpts {
  pitchStep?: number;
  material?: Material;
  gain?: number;
}

/** The silence floor exponential decays fall to (−80 dB). */
export const SILENCE = 0.0001;

/** Seconds from the start of the effect to the end of a layer. */
export function layerEnd(layer: Layer): number {
  const e = layer.env;
  return e.at + e.attack + (e.hold ?? 0) + e.decay;
}

/** Seconds from the start of the effect to the end of its last layer. */
export function recipeDuration(recipe: Recipe): number {
  return recipe.layers.reduce((max, l) => Math.max(max, layerEnd(l)), 0);
}

// ---------------------------------------------------------------------------------------------
// Builders

function env(attack: number, decay: number, peak: number, at = 0, hold = 0): Envelope {
  return hold > 0 ? { at, attack, hold, decay, peak } : { at, attack, decay, peak };
}

function tone(
  wave: Wave,
  freq: number,
  envelope: Envelope,
  extra: { freqEnd?: number; glide?: number; filter?: FilterSpec } = {},
): ToneLayer {
  return { kind: "tone", wave, freq, ...extra, env: envelope };
}

function noise(color: NoiseColor, filter: FilterSpec, envelope: Envelope): NoiseLayer {
  return { kind: "noise", color, filter, env: envelope };
}

const lp = (freq: number, q = 0, freqEnd?: number): FilterSpec =>
  freqEnd === undefined ? { type: "lowpass", freq, q } : { type: "lowpass", freq, q, freqEnd };
const hp = (freq: number, q = 0): FilterSpec => ({ type: "highpass", freq, q });
const bp = (freq: number, q: number, freqEnd?: number): FilterSpec =>
  freqEnd === undefined ? { type: "bandpass", freq, q } : { type: "bandpass", freq, q, freqEnd };

// ---------------------------------------------------------------------------------------------
// Chime ladder (contracts.md §12)

/** C D E G A, as semitones above C. */
const PENTATONIC = [0, 2, 4, 7, 9] as const;
/** C5. */
export const CHIME_BASE_HZ = 523.2511;
/** Two octaves of the ladder: step 10 is C7, and higher steps stay there. */
export const MAX_CHIME_STEP = 10;

/** The chime pitch for a ladder step: C5 D5 E5 G5 A5 C6 … C7, then capped. */
export function chimeFrequency(pitchStep: number): number {
  const step = Number.isFinite(pitchStep)
    ? Math.min(MAX_CHIME_STEP, Math.max(0, Math.floor(pitchStep)))
    : 0;
  const octave = Math.floor(step / PENTATONIC.length);
  const semis = 12 * octave + (PENTATONIC[step % PENTATONIC.length] ?? 0);
  return CHIME_BASE_HZ * 2 ** (semis / 12);
}

// ---------------------------------------------------------------------------------------------
// Materials

/** Highest crack stage `chip` expects (`floor(9 × typed / len)`, M2-13). */
export const MAX_CRACK_STAGE = 9;

interface MaterialSound {
  /** Layers for `break`. `d` is a detune factor near 1. */
  break(d: number): Layer[];
  /** Center of the `chip` tick, Hz. */
  chipHz: number;
  /** Bandpass Q of the tick: higher is more tonal. */
  chipQ: number;
  /** Peak of the tick's noise layer; wide bands get less so every material ticks at about the same level. */
  chipPeak: number;
}

const MATERIALS: Record<Material, MaterialSound> = {
  // Soft, lowpassed crunch.
  dirt: {
    break: (d) => [
      noise("white", lp(900 * d, 0, 380), env(0.004, 0.16, 0.42)),
      noise("brown", lp(320, 0), env(0.006, 0.14, 0.3)),
      tone("sine", 95 * d, env(0.006, 0.12, 0.12), { freqEnd: 60, glide: 0.1 }),
    ],
    chipHz: 900,
    chipQ: 3,
    chipPeak: 0.36,
  },
  // Short noise burst through a bandpass near 1.2 kHz, over a low thump.
  stone: {
    break: (d) => [
      noise("white", bp(1200 * d, 1.2), env(0.002, 0.15, 0.36)),
      tone("sine", 120 * d, env(0.004, 0.14, 0.2), { freqEnd: 55, glide: 0.12 }),
      noise("brown", lp(600, 0), env(0.004, 0.12, 0.24, 0.02)),
    ],
    chipHz: 1800,
    chipQ: 3,
    chipPeak: 0.33,
  },
  // Resonant knock: a narrow band of noise plus a short hollow tone.
  wood: {
    break: (d) => [
      noise("white", bp(520 * d, 10), env(0.001, 0.1, 1)),
      tone("triangle", 196 * d, env(0.003, 0.15, 0.16), {
        freqEnd: 160 * d,
        glide: 0.08,
        filter: lp(1000),
      }),
      tone("sine", 392 * d, env(0.002, 0.06, 0.05)),
    ],
    chipHz: 1100,
    chipQ: 8,
    chipPeak: 0.5,
  },
  // High sine pings, kept quiet so they sparkle instead of stinging.
  glass: {
    break: (d) => [
      noise("white", hp(4000), env(0.001, 0.04, 0.1)),
      tone("sine", 1568 * d, env(0.002, 0.3, 0.07)),
      tone("sine", 2093 * d, env(0.002, 0.28, 0.06, 0.045)),
      tone("sine", 2637 * d, env(0.002, 0.3, 0.05, 0.09)),
    ],
    chipHz: 3200,
    chipQ: 5,
    chipPeak: 0.31,
  },
  // Muffled poof.
  wool: {
    break: (d) => [
      noise("brown", lp(500 * d, 0), env(0.012, 0.15, 0.45)),
      noise("white", lp(1200, 0), env(0.01, 0.08, 0.08)),
    ],
    chipHz: 700,
    chipQ: 2,
    chipPeak: 0.4,
  },
  // A short "shhh" that slides down, like sand pouring.
  sand: {
    break: (d) => [
      noise("white", bp(2400 * d, 0.8, 1500), env(0.015, 0.22, 0.32)),
      noise("brown", lp(400, 0), env(0.01, 0.1, 0.2)),
    ],
    chipHz: 2600,
    chipQ: 2,
    chipPeak: 0.21,
  },
  // Soft crunch with a bright top.
  snow: {
    break: (d) => [
      noise("white", bp(3200 * d, 1), env(0.008, 0.16, 0.26, 0, 0.02)),
      noise("brown", lp(350, 0), env(0.01, 0.12, 0.24)),
    ],
    chipHz: 3000,
    chipQ: 3,
    chipPeak: 0.26,
  },
  // Bell-like pentatonic pings (E6 G6 C7) over a soft low note.
  crystal: {
    break: (d) => [
      tone("triangle", 659.26 * d, env(0.003, 0.35, 0.06), { filter: lp(2500) }),
      tone("sine", 1318.5 * d, env(0.002, 0.5, 0.08)),
      tone("sine", 1568 * d, env(0.002, 0.5, 0.07, 0.035)),
      tone("sine", 2093 * d, env(0.002, 0.45, 0.05, 0.07)),
    ],
    chipHz: 2800,
    chipQ: 6,
    chipPeak: 0.34,
  },
  // A gentle clang: three inharmonic partials and a tiny tick.
  metal: {
    break: (d) => [
      noise("white", bp(2500, 2), env(0.001, 0.04, 0.25)),
      tone("sine", 440 * d, env(0.002, 0.45, 0.08)),
      tone("sine", 440 * 2.76 * d, env(0.002, 0.3, 0.05)),
      tone("sine", 440 * 5.4 * d, env(0.002, 0.18, 0.025)),
    ],
    chipHz: 2400,
    chipQ: 6,
    chipPeak: 0.36,
  },
  // Three quick rustles.
  leaf: {
    break: (d) => [
      noise("white", bp(3600 * d, 1.1), env(0.004, 0.06, 0.38)),
      noise("white", bp(3200 * d, 1.1), env(0.004, 0.07, 0.3, 0.05)),
      noise("white", bp(3800 * d, 1.1), env(0.004, 0.07, 0.2, 0.1)),
    ],
    chipHz: 3400,
    chipQ: 2,
    chipPeak: 0.2,
  },
};

/** Every `Material`, in a fixed order (for the audio lab and tests). */
export const MATERIAL_LIST: readonly Material[] = [
  "dirt",
  "stone",
  "wood",
  "glass",
  "wool",
  "sand",
  "snow",
  "crystal",
  "metal",
  "leaf",
];

// ---------------------------------------------------------------------------------------------
// Recipes

/**
 * The error sound. A low, rounded bump: two soft tones that slide down a little, a slow-ish
 * attack (no click), no noise and nothing above a few hundred Hz. It should feel like bumping a
 * pillow, never like a buzzer.
 */
function thud(): Layer[] {
  return [
    tone("sine", 165, env(0.012, 0.2, 0.11), { freqEnd: 110, glide: 0.16 }),
    tone("triangle", 220, env(0.015, 0.14, 0.04), {
      freqEnd: 165,
      glide: 0.16,
      filter: lp(500),
    }),
  ];
}

function chip(material: Material, pitchStep: number, d: number): Layer[] {
  const m = MATERIALS[material];
  const stage = Math.min(MAX_CRACK_STAGE, Math.max(0, Math.floor(pitchStep)));
  // Rises 1.5 semitones per crack stage, so the last tick is just over an octave up.
  const f = m.chipHz * 2 ** ((stage * 1.5) / 12) * d;
  return [
    noise("white", bp(f, m.chipQ), env(0.001, 0.035, m.chipPeak)),
    tone("sine", f / 2, env(0.002, 0.03, 0.04)),
  ];
}

function place(material: Material, d: number): Layer[] {
  const m = MATERIALS[material];
  return [
    noise("brown", lp(400, 0), env(0.002, 0.07, 0.25)),
    tone("sine", 150 * d, env(0.003, 0.09, 0.1), { freqEnd: 100, glide: 0.05 }),
    noise("white", bp(m.chipHz * 0.7 * d, 2), env(0.001, 0.03, 0.18)),
  ];
}

function chime(pitchStep: number): Layer[] {
  const f = chimeFrequency(pitchStep);
  return [tone("sine", f, env(0.006, 0.45, 0.13)), tone("sine", f * 2, env(0.004, 0.2, 0.03))];
}

const RECIPES: Record<Exclude<SfxName, "break" | "chip" | "place" | "chime" | "thud">, Layer[]> = {
  // A cute upward blip.
  pop: [
    tone("sine", 380, env(0.003, 0.08, 0.16), { freqEnd: 880, glide: 0.05 }),
    tone("sine", 760, env(0.002, 0.04, 0.03), { freqEnd: 1760, glide: 0.05 }),
  ],
  // A small, dry UI tick.
  click: [
    tone("triangle", 1300, env(0.001, 0.025, 0.07)),
    noise("white", bp(3000, 2), env(0.001, 0.012, 0.14)),
  ],
  // Air rushing past: noise through a bandpass that sweeps up.
  whoosh: [noise("white", bp(500, 1.4, 2200), env(0.12, 0.25, 0.4))],
  // C5 E5 G5 C6 arpeggio; the last note rings with an octave sparkle.
  levelUp: [
    tone("triangle", 523.25, env(0.005, 0.3, 0.1), { filter: lp(4000) }),
    tone("triangle", 659.26, env(0.005, 0.3, 0.1, 0.09), { filter: lp(4000) }),
    tone("triangle", 783.99, env(0.005, 0.3, 0.1, 0.18), { filter: lp(4000) }),
    tone("triangle", 1046.5, env(0.005, 0.6, 0.1, 0.27), { filter: lp(4000) }),
    tone("sine", 2093, env(0.005, 0.6, 0.04, 0.27)),
  ],
  // Two bright pings, G6 then C7.
  star: [
    tone("sine", 1568, env(0.003, 0.35, 0.09)),
    tone("sine", 2093, env(0.003, 0.45, 0.09, 0.07)),
    tone("sine", 3136, env(0.003, 0.2, 0.025, 0.07)),
  ],
  // A warm rising swell.
  shield: [
    tone("triangle", 262, env(0.03, 0.3, 0.14, 0, 0.05), {
      freqEnd: 392,
      glide: 0.2,
      filter: lp(1200),
    }),
    tone("sine", 524, env(0.03, 0.25, 0.04), { freqEnd: 784, glide: 0.2 }),
  ],
  // Wheels over track joints: three low rattles over a hum.
  cart: [
    noise("brown", lp(700, 0), env(0.005, 0.05, 0.32)),
    noise("brown", lp(700, 0), env(0.005, 0.05, 0.3, 0.07)),
    noise("brown", lp(700, 0), env(0.005, 0.05, 0.28, 0.14)),
    tone("triangle", 110, env(0.02, 0.12, 0.1, 0, 0.1), { filter: lp(400) }),
  ],
  // Two notes stepping down, G5 then D5.
  undo: [
    tone("triangle", 783.99, env(0.004, 0.1, 0.1), { filter: lp(3000) }),
    tone("triangle", 587.33, env(0.004, 0.16, 0.1, 0.08), { filter: lp(3000) }),
  ],
};

/** Detune range for material sounds: ±2%, so repeats don't sound copy-pasted. */
const DETUNE = 0.04;

/**
 * The recipe for one sound. `vary` returns numbers in [0, 1) and adds a little detune to the
 * material sounds; leave it out for the exact, undetuned recipe.
 */
export function recipeFor(name: SfxName, opts: SfxOpts = {}, vary?: () => number): Recipe {
  const material = opts.material ?? "stone";
  const step = opts.pitchStep ?? 0;
  const d = vary ? 1 + (vary() - 0.5) * DETUNE : 1;
  switch (name) {
    case "break":
      return { layers: MATERIALS[material].break(d) };
    case "chip":
      return { layers: chip(material, step, d) };
    case "place":
      return { layers: place(material, d) };
    case "chime":
      return { layers: chime(step) };
    case "thud":
      return { layers: thud() };
    default:
      return { layers: RECIPES[name] };
  }
}
