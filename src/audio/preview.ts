/**
 * Offline rendering of SFX recipes in plain TypeScript, with no Web Audio. It follows the same
 * signal path as `engine.ts` (source → filter → envelope gain → voice gain) and uses the Web Audio
 * spec's biquad formulas, so its peak matches what the browser plays closely enough to check
 * loudness in unit tests and to draw waveforms in the audio lab. No DOM, no clock.
 */
import type { FilterSpec, Layer, NoiseColor, Recipe } from "./recipes";
import { SILENCE, layerEnd, recipeDuration } from "./recipes";

/** Seconds of noise in each buffer. */
export const NOISE_SECONDS = 1;

/**
 * White and brown noise, both peaking at 1. `next` returns numbers in [0, 1) (a seeded
 * `Rng.next`), so the buffers are the same on every run.
 */
export function makeNoise(next: () => number, length: number): Record<NoiseColor, Float32Array> {
  const white = new Float32Array(length);
  const brown = new Float32Array(length);
  let b = 0;
  let maxB = 0;
  for (let i = 0; i < length; i++) {
    const w = next() * 2 - 1;
    white[i] = w;
    b = (b + 0.02 * w) / 1.02;
    brown[i] = b;
    maxB = Math.max(maxB, Math.abs(b));
  }
  if (maxB > 0) for (let i = 0; i < length; i++) brown[i] = (brown[i] ?? 0) / maxB;
  return { white, brown };
}

/** Envelope gain of a layer at `t` seconds after the effect starts. */
export function envelopeAt(layer: Layer, t: number): number {
  const { at, attack, decay, peak } = layer.env;
  const hold = layer.env.hold ?? 0;
  const u = t - at;
  if (u < 0 || t >= layerEnd(layer)) return 0;
  if (u < attack) return (peak * u) / attack;
  if (u < attack + hold) return peak;
  const k = (u - attack - hold) / decay;
  return peak * (SILENCE / peak) ** k;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Normalized biquad coefficients, per the Web Audio spec (`BiquadFilterNode`). */
function coefficients(type: FilterSpec["type"], f0: number, q: number, rate: number): Biquad {
  const w0 = (2 * Math.PI * Math.min(f0, rate / 2 - 1)) / rate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  let b0: number;
  let b1: number;
  let b2: number;
  let alpha: number;
  if (type === "bandpass") {
    alpha = sin / (2 * q);
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  } else {
    alpha = sin / (2 * 10 ** (q / 20));
    const s = type === "lowpass" ? 1 - cos : 1 + cos;
    b0 = s / 2;
    b1 = type === "lowpass" ? s : -s;
    b2 = s / 2;
  }
  const a0 = 1 + alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

function renderLayer(
  layer: Layer,
  out: Float32Array,
  rate: number,
  noise: Record<NoiseColor, Float32Array>,
): void {
  const start = Math.floor(layer.env.at * rate);
  const end = Math.min(out.length, Math.ceil(layerEnd(layer) * rate));
  const span = layerEnd(layer) - layer.env.at;
  const filter: FilterSpec | undefined = layer.filter;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  let phase = 0;
  for (let i = start; i < end; i++) {
    const t = i / rate;
    const tau = t - layer.env.at;
    let x: number;
    if (layer.kind === "tone") {
      const glide = layer.glide ?? 0;
      const f =
        layer.freqEnd !== undefined && glide > 0
          ? layer.freq * (layer.freqEnd / layer.freq) ** Math.min(1, tau / glide)
          : layer.freq;
      x = layer.wave === "sine" ? Math.sin(2 * Math.PI * phase) : 4 * Math.abs(phase - 0.5) - 1;
      phase = (phase + f / rate) % 1;
    } else {
      const buf = noise[layer.color];
      x = buf[(i - start) % buf.length] ?? 0;
    }
    let y = x;
    if (filter) {
      const f =
        filter.freqEnd === undefined
          ? filter.freq
          : filter.freq * (filter.freqEnd / filter.freq) ** Math.min(1, tau / span);
      const c = coefficients(filter.type, f, filter.q, rate);
      y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
    }
    out[i] = (out[i] ?? 0) + y * envelopeAt(layer, t);
  }
}

/** Renders a recipe at `gain` (the voice gain), before bus, master and compressor. */
export function renderRecipe(
  recipe: Recipe,
  noise: Record<NoiseColor, Float32Array>,
  rate = 48000,
  gain = 1,
): Float32Array {
  const out = new Float32Array(Math.ceil(recipeDuration(recipe) * rate) + 1);
  for (const layer of recipe.layers) renderLayer(layer, out, rate, noise);
  if (gain !== 1) for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * gain;
  return out;
}

/** Largest absolute sample. */
export function peakOf(samples: Float32Array): number {
  let p = 0;
  for (const s of samples) p = Math.max(p, Math.abs(s));
  return p;
}

/** Gain as dBFS (−∞ for silence). */
export function toDb(gain: number): number {
  return 20 * Math.log10(gain);
}
