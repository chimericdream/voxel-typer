/**
 * The audio engine (contracts.md §12, task M2-06).
 *
 * Graph, built once on `unlock()`:
 *
 *   voice gain ─┐
 *   voice gain ─┼─▶ sfx bus ──┐
 *       …      ─┘             ├─▶ compressor ─▶ master gain ─▶ destination
 *   (M6-01)    ───▶ music bus ┤
 *   (unused)   ───▶ voice bus ┘
 *
 * Every `sfx()` call is one voice: its own gain node fed by the recipe's layers
 * (source → optional filter → envelope gain). At most `maxVoices` (12) play at once; a new one
 * fades out the oldest in 20 ms. Speech goes through the Web Speech API, which Web Audio can't
 * route, so the `voice` bus volume is applied to each utterance instead.
 */
import { createRng } from "@/engine/rng";
import type { CtxLike, GainLike, NodeLike, SourceLike } from "./graph";
import { defaultContextFactory } from "./graph";
import { NOISE_SECONDS, makeNoise } from "./preview";
import type { Layer, NoiseColor } from "./recipes";
import { SILENCE, layerEnd, recipeDuration, recipeFor } from "./recipes";
import type { SpeechDeps } from "./speech";
import { defaultSpeech, speakWith } from "./speech";
import type { AudioApi, Bus, Material, SfxName } from "./types";

export interface AudioOptions {
  /** Makes the one `AudioContext`. Called once, on the first `unlock()`. */
  createContext?: () => CtxLike | null;
  /** Speech synthesis; null turns `speak` off. Defaults to the browser's. */
  speech?: SpeechDeps | null;
  /** Seed for the noise buffers and the small detune. */
  seed?: number;
  /** Voice cap (default 12). */
  maxVoices?: number;
}

/** `AudioApi` plus the few extras the app shell and the audio lab need. */
export interface AudioEngine extends AudioApi {
  /** Mirrors `Settings.tts`. While off, `speak` does nothing. */
  setSpeechEnabled(on: boolean): void;
  /** The gain node of a bus, for M6-01 to connect music into; null before `unlock()`. */
  busNode(bus: Bus): GainLike | null;
  /** Voices still sounding (not counting ones fading out after being stolen). */
  activeVoices(): number;
}

export const MAX_VOICES = 12;
/** Seed for the noise buffers and detune when none is given. */
export const DEFAULT_AUDIO_SEED = 0x766f78;
/** Fade applied to a stolen voice, seconds. */
const STEAL_FADE = 0.02;
/** Sources stop this long after their envelope ends, seconds. */
const TAIL = 0.02;

/** Matches the defaults in `src/save/settings.ts`; the app sets the profile's values on load. */
const DEFAULT_VOLUME: Record<Bus, number> = { master: 0.8, music: 0.5, sfx: 0.8, voice: 1 };
const BUSES: readonly Bus[] = ["master", "music", "sfx", "voice"];

/** Slider value (0–1) to gain. Squaring makes the slider feel even across its range. */
export function volumeToGain(v01: number): number {
  return v01 * v01;
}

function clamp01(v: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

interface Voice {
  out: GainLike;
  nodes: NodeLike[];
  sources: SourceLike[];
  /** Context time after which it is silent. */
  end: number;
}

interface Graph {
  ctx: CtxLike;
  buses: Record<Bus, GainLike>;
  noise: Record<NoiseColor, { buffer: ReturnType<CtxLike["createBuffer"]>; seconds: number }>;
}

function buildGraph(ctx: CtxLike, seed: number, volume: Record<Bus, number>): Graph {
  const comp = ctx.createDynamicsCompressor();
  // Gentle glue that also catches pile-ups of many voices.
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  const gain = (bus: Bus): GainLike => {
    const g = ctx.createGain();
    g.gain.value = volumeToGain(volume[bus]);
    return g;
  };
  const buses: Record<Bus, GainLike> = {
    master: gain("master"),
    music: gain("music"),
    sfx: gain("sfx"),
    voice: gain("voice"),
  };
  buses.music.connect(comp);
  buses.sfx.connect(comp);
  buses.voice.connect(comp);
  comp.connect(buses.master);
  buses.master.connect(ctx.destination);

  const length = Math.round(ctx.sampleRate * NOISE_SECONDS);
  const rng = createRng(seed).fork("audio:noise");
  const data = makeNoise(() => rng.next(), length);
  const buffer = (color: NoiseColor) => {
    const b = ctx.createBuffer(1, length, ctx.sampleRate);
    b.getChannelData(0).set(data[color]);
    return { buffer: b, seconds: NOISE_SECONDS };
  };
  return { ctx, buses, noise: { white: buffer("white"), brown: buffer("brown") } };
}

export function createAudio(options: AudioOptions = {}): AudioEngine {
  const makeContext = options.createContext ?? defaultContextFactory;
  const speech = options.speech === undefined ? defaultSpeech() : options.speech;
  const seed = options.seed ?? DEFAULT_AUDIO_SEED;
  const maxVoices = Math.max(1, options.maxVoices ?? MAX_VOICES);
  const vary = createRng(seed).fork("audio:vary");
  const volume: Record<Bus, number> = { ...DEFAULT_VOLUME };

  let graph: Graph | null = null;
  let triedContext = false;
  let resuming: Promise<void> | null = null;
  let speechOn = true;
  let voices: Voice[] = [];
  let dying: Voice[] = [];

  const release = (v: Voice): void => {
    for (const n of v.nodes) n.disconnect();
  };

  /** Drops finished voices and disconnects their nodes. */
  const prune = (now: number): void => {
    const keep = (v: Voice): boolean => {
      if (v.end > now) return true;
      release(v);
      return false;
    };
    voices = voices.filter(keep);
    dying = dying.filter(keep);
  };

  const steal = (v: Voice, now: number): void => {
    const g = v.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + STEAL_FADE);
    for (const s of v.sources) s.stop(now + STEAL_FADE + 0.01);
    v.end = now + STEAL_FADE + 0.02;
    dying.push(v);
  };

  const playLayer = (g: Graph, voice: Voice, layer: Layer, t0: number): void => {
    const { ctx } = g;
    const start = t0 + layer.env.at;
    const end = t0 + layerEnd(layer);
    let source: SourceLike;
    let head: NodeLike;
    if (layer.kind === "tone") {
      const osc = ctx.createOscillator();
      osc.type = layer.wave;
      osc.frequency.setValueAtTime(layer.freq, start);
      if (layer.freqEnd !== undefined && layer.glide !== undefined && layer.glide > 0) {
        osc.frequency.exponentialRampToValueAtTime(layer.freqEnd, start + layer.glide);
      }
      source = osc;
      head = osc;
    } else {
      const src = ctx.createBufferSource();
      const noise = g.noise[layer.color];
      src.buffer = noise.buffer;
      source = src;
      head = src;
    }
    const filterSpec = layer.filter;
    if (filterSpec) {
      const f = ctx.createBiquadFilter();
      f.type = filterSpec.type;
      f.Q.value = filterSpec.q;
      f.frequency.setValueAtTime(filterSpec.freq, start);
      if (filterSpec.freqEnd !== undefined) {
        f.frequency.exponentialRampToValueAtTime(filterSpec.freqEnd, end);
      }
      head.connect(f);
      voice.nodes.push(f);
      head = f;
    }
    const lg = ctx.createGain();
    const { attack, peak } = layer.env;
    const hold = layer.env.hold ?? 0;
    lg.gain.value = 0;
    lg.gain.setValueAtTime(0, start);
    lg.gain.linearRampToValueAtTime(peak, start + attack);
    if (hold > 0) lg.gain.setValueAtTime(peak, start + attack + hold);
    lg.gain.exponentialRampToValueAtTime(SILENCE, end);
    head.connect(lg);
    lg.connect(voice.out);
    voice.nodes.push(source, lg);
    voice.sources.push(source);
    if (layer.kind === "noise") {
      // A different slice of the noise each time, so repeats don't sound identical.
      const room = Math.max(0, g.noise[layer.color].seconds - (end - start) - TAIL);
      source.start(start, vary.next() * room);
    } else {
      source.start(start);
    }
    source.stop(end + TAIL);
  };

  const sfx: AudioApi["sfx"] = (
    name: SfxName,
    opts: { pitchStep?: number; material?: Material; gain?: number } = {},
  ) => {
    const g = graph;
    if (!g) return; // Not unlocked yet: stay silent rather than make a context early.
    const gain = clamp01(opts.gain ?? 1, 1);
    if (gain === 0 || volume.master === 0 || volume.sfx === 0) return;
    const recipe = recipeFor(name, opts, () => vary.next());
    const now = g.ctx.currentTime;
    prune(now);
    while (voices.length >= maxVoices) {
      const oldest = voices.shift();
      if (oldest) steal(oldest, now);
    }
    const out = g.ctx.createGain();
    out.gain.value = gain;
    out.connect(g.buses.sfx);
    const voice: Voice = {
      out,
      nodes: [out],
      sources: [],
      end: now + recipeDuration(recipe) + TAIL,
    };
    for (const layer of recipe.layers) playLayer(g, voice, layer, now);
    voices.push(voice);
  };

  return {
    unlock(): Promise<void> {
      if (resuming) return resuming;
      if (!triedContext) {
        triedContext = true;
        let ctx: CtxLike | null = null;
        try {
          ctx = makeContext();
        } catch {
          ctx = null; // No Web Audio: the game plays silently.
        }
        if (ctx) graph = buildGraph(ctx, seed, volume);
      }
      const ctx = graph?.ctx;
      if (!ctx || ctx.state === "running") return Promise.resolve();
      const p = ctx
        .resume()
        .catch(() => undefined)
        .finally(() => {
          resuming = null;
        });
      resuming = p;
      return p;
    },
    sfx,
    music: {
      // M6-01 (procedural music) fills these in, under src/audio/music/.
      setScene: () => undefined,
      setIntensity: () => undefined,
      stop: () => undefined,
    },
    speak(text: string): void {
      if (!speech || !speechOn) return;
      const v = volumeToGain(volume.master) * volumeToGain(volume.voice);
      if (v === 0) return;
      speakWith(speech, text, v);
    },
    setVolume(bus: Bus, v01: number): void {
      if (!BUSES.includes(bus)) return;
      volume[bus] = clamp01(v01, volume[bus]);
      if (graph) {
        const param = graph.buses[bus].gain;
        const now = graph.ctx.currentTime;
        param.cancelScheduledValues(now);
        param.setTargetAtTime(volumeToGain(volume[bus]), now, 0.015);
      }
    },
    setSpeechEnabled(on: boolean): void {
      speechOn = on;
      if (!on) speech?.synth.cancel();
    },
    busNode(bus: Bus): GainLike | null {
      return graph ? graph.buses[bus] : null;
    },
    activeVoices(): number {
      if (graph) prune(graph.ctx.currentTime);
      return voices.length;
    },
  };
}
