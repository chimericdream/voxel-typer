/**
 * Audio engine (docs/impl/contracts.md §12, task M2-06), driven through a hand-rolled fake
 * `AudioContext` that records the node graph and every automation call.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  BiquadLike,
  BufferLike,
  BufferSourceLike,
  CompressorLike,
  CtxLike,
  GainLike,
  NodeLike,
  OscLike,
  ParamLike,
} from "../../../src/audio/graph";
import {
  createAudio,
  DEFAULT_AUDIO_SEED,
  MAX_VOICES,
  volumeToGain,
} from "../../../src/audio/engine";
import type { AudioEngine } from "../../../src/audio/engine";
import { makeNoise, peakOf, renderRecipe } from "../../../src/audio/preview";
import {
  chimeFrequency,
  MATERIAL_LIST,
  MAX_CRACK_STAGE,
  recipeDuration,
  recipeFor,
} from "../../../src/audio/recipes";
import type { Recipe } from "../../../src/audio/recipes";
import { pickVoice, SPEECH_RATE } from "../../../src/audio/speech";
import type { SpeechDeps, UtteranceLike, VoiceLike } from "../../../src/audio/speech";
import type { SfxName } from "../../../src/audio/types";
import { createRng } from "../../../src/engine/rng";

// ---------------------------------------------------------------------------------------------
// Fake Web Audio

type ParamEvent =
  | { kind: "set" | "linear" | "exp"; value: number; time: number }
  | { kind: "target"; value: number; time: number; tc: number }
  | { kind: "cancel"; time: number };

class FakeParam implements ParamLike {
  events: ParamEvent[] = [];
  constructor(public value: number) {}
  setValueAtTime(value: number, time: number): void {
    this.events.push({ kind: "set", value, time });
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.events.push({ kind: "linear", value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number): void {
    if (value <= 0) throw new RangeError("exponential ramp to a non-positive value");
    this.events.push({ kind: "exp", value, time });
  }
  setTargetAtTime(value: number, time: number, tc: number): void {
    this.events.push({ kind: "target", value, time, tc });
  }
  cancelScheduledValues(time: number): void {
    this.events.push({ kind: "cancel", time });
  }
}

class FakeNode implements NodeLike {
  outputs: FakeNode[] = [];
  disconnected = false;
  constructor(public readonly kind: string) {}
  connect(destination: NodeLike): void {
    if (!(destination instanceof FakeNode)) throw new TypeError("not a fake node");
    this.outputs.push(destination);
  }
  disconnect(): void {
    this.outputs = [];
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode implements GainLike {
  readonly gain = new FakeParam(1);
  constructor() {
    super("gain");
  }
}

class FakeSource extends FakeNode {
  starts: { when: number; offset: number | undefined }[] = [];
  stops: number[] = [];
  start(when = 0, offset?: number): void {
    this.starts.push({ when, offset });
  }
  stop(when = 0): void {
    this.stops.push(when);
  }
}

class FakeOsc extends FakeSource implements OscLike {
  type: OscillatorType = "sine";
  readonly frequency = new FakeParam(440);
  constructor() {
    super("osc");
  }
}

class FakeBufferSource extends FakeSource implements BufferSourceLike {
  buffer: BufferLike | null = null;
  constructor() {
    super("noise");
  }
}

class FakeBiquad extends FakeNode implements BiquadLike {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  constructor() {
    super("filter");
  }
}

class FakeCompressor extends FakeNode implements CompressorLike {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
  constructor() {
    super("compressor");
  }
}

class FakeBuffer implements BufferLike {
  readonly data: Float32Array;
  constructor(
    length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  get duration(): number {
    return this.data.length / this.sampleRate;
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

class FakeCtx implements CtxLike {
  currentTime = 0;
  readonly sampleRate = 8000;
  state = "suspended";
  readonly destination = new FakeNode("destination");
  resumeCalls = 0;
  nodes: FakeNode[] = [];
  buffers: FakeBuffer[] = [];
  /** Resolves `resume()`; tests can hold it to check concurrent `unlock()` calls. */
  resumeGate: Promise<void> = Promise.resolve();

  /** Makes `resume()` wait until the returned function is called. */
  holdResume(): () => void {
    const opener: { open?: () => void } = {};
    this.resumeGate = new Promise<void>((r) => {
      opener.open = r;
    });
    return () => opener.open?.();
  }

  async resume(): Promise<void> {
    this.resumeCalls++;
    await this.resumeGate;
    this.state = "running";
  }
  private track<T extends FakeNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  createGain(): FakeGain {
    return this.track(new FakeGain());
  }
  createOscillator(): FakeOsc {
    return this.track(new FakeOsc());
  }
  createBiquadFilter(): FakeBiquad {
    return this.track(new FakeBiquad());
  }
  createBufferSource(): FakeBufferSource {
    return this.track(new FakeBufferSource());
  }
  createDynamicsCompressor(): FakeCompressor {
    return this.track(new FakeCompressor());
  }
  createBuffer(_channels: number, length: number, sampleRate: number): FakeBuffer {
    const b = new FakeBuffer(length, sampleRate);
    this.buffers.push(b);
    return b;
  }
  sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }
}

/** Kinds of the nodes from `node` to the end of its first-output chain. */
function chain(node: FakeNode): FakeNode[] {
  const out: FakeNode[] = [];
  let cur: FakeNode | undefined = node;
  while (cur && out.length < 20) {
    out.push(cur);
    expect(cur.outputs.length).toBeLessThanOrEqual(1);
    cur = cur.outputs[0];
  }
  return out;
}

async function setup(
  opts: { speech?: SpeechDeps | null; seed?: number } = {},
): Promise<{ audio: AudioEngine; ctx: FakeCtx }> {
  const ctx = new FakeCtx();
  const audio = createAudio({ createContext: () => ctx, speech: opts.speech ?? null, ...opts });
  await audio.unlock();
  return { audio, ctx };
}

function bus(audio: AudioEngine, name: "master" | "music" | "sfx" | "voice"): FakeGain {
  const node = audio.busNode(name);
  if (!(node instanceof FakeGain)) throw new Error(`no ${name} bus`);
  return node;
}

const lastEvent = (b: FakeGain): ParamEvent | undefined => b.gain.events.at(-1);
const ratio = (step: number): number => chimeFrequency(step) / chimeFrequency(0);
const semis = (step: number): number => Math.round(12 * Math.log2(ratio(step)));

function fakeSpeech(voices: VoiceLike[]) {
  const spoken: (UtteranceLike & { text: string })[] = [];
  const made: (UtteranceLike & { text: string })[] = [];
  const cancel = vi.fn();
  const deps: SpeechDeps = {
    synth: {
      getVoices: () => voices,
      speak: (u) => {
        const found = made.find((m) => m === u);
        if (found) spoken.push(found);
      },
      cancel,
    },
    utterance: (text) => {
      const u = { text, rate: 1, volume: 1, lang: "", voice: null };
      made.push(u);
      return u;
    },
  };
  return { deps, spoken, cancel };
}
const ALL_SFX: readonly SfxName[] = [
  "break",
  "chip",
  "chime",
  "thud",
  "pop",
  "click",
  "whoosh",
  "levelUp",
  "star",
  "shield",
  "cart",
  "place",
  "undo",
];

// ---------------------------------------------------------------------------------------------

describe("bus routing", () => {
  it("routes the buses through one compressor into the master gain and the destination", async () => {
    const { audio, ctx } = await setup();
    const master = bus(audio, "master");
    const comp = ctx.nodes.filter((n) => n instanceof FakeCompressor);
    expect(comp).toHaveLength(1);
    for (const name of ["music", "sfx", "voice"] as const) {
      expect(chain(bus(audio, name))).toEqual([bus(audio, name), comp[0], master, ctx.destination]);
    }
  });

  it("sends every source of every effect through its voice gain to the sfx bus", async () => {
    const { audio, ctx } = await setup();
    const sfxBus = bus(audio, "sfx");
    const cases: { name: SfxName; material?: (typeof MATERIAL_LIST)[number] }[] = [
      ...ALL_SFX.map((name) => ({ name })),
      ...MATERIAL_LIST.flatMap((material) =>
        (["break", "chip", "place"] as const).map((name) => ({ name, material })),
      ),
    ];
    for (const c of cases) {
      const before = ctx.sources().length;
      audio.sfx(c.name, c.material ? { material: c.material } : {});
      const sources = ctx.sources().slice(before);
      expect(sources.length, c.name).toBeGreaterThan(0);
      const voiceGains = new Set<FakeNode>();
      for (const s of sources) {
        const path = chain(s);
        const i = path.indexOf(sfxBus);
        expect(i, `${c.name} ${c.material ?? ""}`).toBeGreaterThan(0);
        expect(path.at(-1)).toBe(ctx.destination);
        const voice = path[i - 1];
        if (voice) voiceGains.add(voice);
        expect(path.slice(1, i - 1).every((n) => n.kind === "filter" || n.kind === "gain")).toBe(
          true,
        );
      }
      // One voice (one gain node) per sfx() call.
      expect(voiceGains.size).toBe(1);
      ctx.currentTime += 5;
    }
  });

  it("applies setVolume as gain = value² on the named bus, with a short glide", async () => {
    const { audio } = await setup();
    audio.setVolume("sfx", 0.5);
    audio.setVolume("music", 2);
    audio.setVolume("voice", -1);
    expect(lastEvent(bus(audio, "sfx"))).toMatchObject({ kind: "target", value: 0.25 });
    expect(lastEvent(bus(audio, "music"))).toMatchObject({ kind: "target", value: 1 });
    expect(lastEvent(bus(audio, "voice"))).toMatchObject({ kind: "target", value: 0 });
    expect(bus(audio, "master").gain.events).toEqual([]);
  });

  it("keeps volumes set before unlock and starts the buses at them", async () => {
    const ctx = new FakeCtx();
    const audio = createAudio({ createContext: () => ctx, speech: null });
    audio.setVolume("master", 0.6);
    audio.setVolume("sfx", 0.3);
    await audio.unlock();
    expect(bus(audio, "master").gain.value).toBeCloseTo(volumeToGain(0.6));
    expect(bus(audio, "sfx").gain.value).toBeCloseTo(0.09);
    expect(bus(audio, "music").gain.value).toBeCloseTo(0.25); // settings default 0.5
  });

  it("makes no nodes while the sfx or master bus is muted, or for gain 0", async () => {
    const { audio, ctx } = await setup();
    const count = ctx.nodes.length;
    audio.setVolume("sfx", 0);
    audio.sfx("break");
    audio.setVolume("sfx", 1);
    audio.setVolume("master", 0);
    audio.sfx("chime");
    audio.setVolume("master", 1);
    audio.sfx("pop", { gain: 0 });
    expect(ctx.nodes.length).toBe(count);
    audio.sfx("pop", { gain: 0.5 });
    expect(ctx.nodes.length).toBeGreaterThan(count);
  });

  it("uses opts.gain as the voice gain, clamped to 0–1", async () => {
    const { audio, ctx } = await setup();
    const voiceGain = () => {
      const src = ctx.sources().at(-1);
      if (!src) throw new Error("no source");
      const path = chain(src);
      return path[path.indexOf(bus(audio, "sfx")) - 1];
    };
    audio.sfx("pop", { gain: 0.4 });
    expect(voiceGain()).toMatchObject({ gain: { value: 0.4 } });
    audio.sfx("pop", { gain: 3 });
    expect(voiceGain()).toMatchObject({ gain: { value: 1 } });
  });
});

describe("voices", () => {
  it(`plays at most ${MAX_VOICES} at once and steals the oldest`, async () => {
    const { audio, ctx } = await setup();
    ctx.currentTime = 1;
    const perCall: FakeSource[][] = [];
    for (let i = 0; i < 20; i++) {
      const before = ctx.sources().length;
      audio.sfx("chime", { pitchStep: i });
      perCall.push(ctx.sources().slice(before));
      expect(audio.activeVoices()).toBe(Math.min(i + 1, MAX_VOICES));
    }
    // The first 8 were stolen: their sources stop 30 ms from now, the rest at their natural end.
    for (const [i, sources] of perCall.entries()) {
      for (const s of sources) {
        if (i < 8) expect(Math.min(...s.stops)).toBeCloseTo(1.03, 5);
        else expect(s.stops).toHaveLength(1);
      }
    }
  });

  it("fades a stolen voice out instead of cutting it", async () => {
    const ctx = new FakeCtx();
    const audio = createAudio({ createContext: () => ctx, speech: null, maxVoices: 1 });
    await audio.unlock();
    audio.sfx("levelUp");
    const first = ctx.sources().at(-1);
    if (!first) throw new Error("no source");
    const sfxBus = bus(audio, "sfx");
    const voice = chain(first).find((_, i, arr) => arr[i + 1] === sfxBus);
    if (!(voice instanceof FakeGain)) throw new Error("no voice gain");
    ctx.currentTime = 0.1;
    audio.sfx("pop");
    expect(voice.gain.events).toEqual([
      { kind: "cancel", time: 0.1 },
      { kind: "set", value: voice.gain.value, time: 0.1 },
      { kind: "linear", value: 0, time: expect.closeTo(0.12, 5) },
    ]);
    expect(audio.activeVoices()).toBe(1);
  });

  it("frees finished voices and disconnects their nodes", async () => {
    const { audio, ctx } = await setup();
    const busCount = ctx.nodes.length;
    for (let i = 0; i < 5; i++) audio.sfx("break", { material: "stone" });
    expect(audio.activeVoices()).toBe(5);
    const voiceNodes = ctx.nodes.slice(busCount);
    ctx.currentTime = 2;
    expect(audio.activeVoices()).toBe(0);
    expect(voiceNodes.every((n) => n.disconnected)).toBe(true);
  });

  it("schedules every envelope as attack, optional hold, then an exponential fall", async () => {
    const { audio, ctx } = await setup();
    audio.sfx("shield"); // layer 0 holds, layer 1 does not
    const kinds = ctx.sources().map((src) => {
      const env = chain(src).find((n) => n instanceof FakeGain);
      if (!(env instanceof FakeGain)) throw new Error("no envelope gain");
      return env.gain.events.map((e) => e.kind);
    });
    expect(kinds).toEqual([
      ["set", "linear", "set", "exp"],
      ["set", "linear", "exp"],
    ]);
  });
});

describe("unlock", () => {
  it("creates one context and one graph, however many times it is called", async () => {
    const ctx = new FakeCtx();
    const factory = vi.fn(() => ctx);
    const audio = createAudio({ createContext: factory, speech: null });
    await audio.unlock();
    const nodes = ctx.nodes.length;
    const bufs = ctx.buffers.length;
    await audio.unlock();
    await audio.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.nodes.length).toBe(nodes);
    expect(ctx.buffers.length).toBe(bufs);
  });

  it("shares one resume between calls made while it is pending", async () => {
    const ctx = new FakeCtx();
    const open = ctx.holdResume();
    const audio = createAudio({ createContext: () => ctx, speech: null });
    const a = audio.unlock();
    const b = audio.unlock();
    expect(b).toBe(a);
    open();
    await Promise.all([a, b]);
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe("running");
  });

  it("resumes again if the browser suspended the context later", async () => {
    const { audio, ctx } = await setup();
    ctx.state = "suspended";
    await audio.unlock();
    expect(ctx.resumeCalls).toBe(2);
  });

  it("stays silent before unlock and makes no context", () => {
    const factory = vi.fn(() => new FakeCtx());
    const audio = createAudio({ createContext: factory, speech: null });
    audio.sfx("break");
    audio.setVolume("sfx", 0.5);
    expect(factory).not.toHaveBeenCalled();
    expect(audio.busNode("sfx")).toBeNull();
    expect(audio.activeVoices()).toBe(0);
  });

  it("resolves and stays silent without Web Audio", async () => {
    const none = createAudio({ createContext: () => null, speech: null });
    await expect(none.unlock()).resolves.toBeUndefined();
    none.sfx("pop");
    const throws = createAudio({
      createContext: () => {
        throw new Error("blocked");
      },
      speech: null,
    });
    await expect(throws.unlock()).resolves.toBeUndefined();
    expect(throws.busNode("master")).toBeNull();
  });

  it("swallows a rejected resume", async () => {
    const ctx = new FakeCtx();
    ctx.resumeGate = Promise.reject(new Error("no gesture"));
    const audio = createAudio({ createContext: () => ctx, speech: null });
    await expect(audio.unlock()).resolves.toBeUndefined();
  });

  it("fills the noise buffers from the seed", async () => {
    const a = await setup({ seed: 7 });
    const b = await setup({ seed: 7 });
    const c = await setup({ seed: 8 });
    expect(a.ctx.buffers).toHaveLength(2);
    expect(a.ctx.buffers[0]?.data).toEqual(b.ctx.buffers[0]?.data);
    expect(a.ctx.buffers[0]?.data).not.toEqual(c.ctx.buffers[0]?.data);
    expect(peakOf(a.ctx.buffers[1]?.data ?? new Float32Array())).toBeCloseTo(1, 5);
  });
});

describe("recipes", () => {
  // Noise peaks depend on the samples, so measure against several seeds and keep the worst.
  const noises = [DEFAULT_AUDIO_SEED, 1, 2, 3].map((seed) => {
    const rng = createRng(seed).fork("audio:noise");
    return makeNoise(() => rng.next(), 48000);
  });
  const peak = (r: Recipe) => Math.max(...noises.map((n) => peakOf(renderRecipe(r, n))));

  const every: { label: string; recipe: Recipe }[] = [
    ...ALL_SFX.map((n) => ({ label: n, recipe: recipeFor(n) })),
    ...MATERIAL_LIST.flatMap((m) => [
      { label: `break ${m}`, recipe: recipeFor("break", { material: m }) },
      { label: `place ${m}`, recipe: recipeFor("place", { material: m }) },
      ...Array.from({ length: MAX_CRACK_STAGE + 1 }, (_, s) => ({
        label: `chip ${m} ${s}`,
        recipe: recipeFor("chip", { material: m, pitchStep: s }),
      })),
    ]),
    ...Array.from({ length: 13 }, (_, s) => ({
      label: `chime ${s}`,
      recipe: recipeFor("chime", { pitchStep: s }),
    })),
  ];

  it("keeps every sound's peak at or below −9.6 dBFS before the buses", () => {
    for (const { label, recipe } of every) expect(peak(recipe), label).toBeLessThanOrEqual(0.33);
  });

  it("keeps every sound short and every envelope well-formed", () => {
    for (const { label, recipe } of every) {
      expect(recipeDuration(recipe), label).toBeLessThan(1);
      for (const l of recipe.layers) {
        expect(l.env.attack, label).toBeGreaterThan(0);
        expect(l.env.peak, label).toBeGreaterThan(0);
      }
    }
  });

  it("makes the error thud soft, low and rounded", () => {
    const thud = recipeFor("thud");
    expect(peak(thud)).toBeLessThanOrEqual(0.15);
    expect(thud.layers.every((l) => l.kind === "tone")).toBe(true); // no noise, no crunch
    for (const l of thud.layers) {
      if (l.kind !== "tone") continue;
      expect(l.freq).toBeLessThanOrEqual(250);
      expect(l.freqEnd ?? l.freq).toBeLessThanOrEqual(l.freq); // slides down, never up
      expect(l.env.attack).toBeGreaterThanOrEqual(0.01); // no click at the start
      if (l.wave !== "sine")
        expect(l.filter?.type === "lowpass" && l.filter.freq <= 600).toBe(true);
    }
    expect(recipeDuration(thud)).toBeLessThanOrEqual(0.3);
    // Quieter than a stone break and no louder than a chime.
    expect(peak(thud)).toBeLessThan(peak(recipeFor("break", { material: "stone" })));
    expect(peak(thud)).toBeLessThanOrEqual(peak(recipeFor("chime")) * 1.05);
  });

  it("keeps chip a quiet tick that rises with the crack stage", () => {
    for (const m of MATERIAL_LIST) {
      let last = 0;
      for (let s = 0; s <= MAX_CRACK_STAGE; s++) {
        const r = recipeFor("chip", { material: m, pitchStep: s });
        expect(peak(r), `${m} ${s}`).toBeLessThanOrEqual(0.14);
        const f = r.layers[0]?.filter?.freq ?? 0;
        expect(f).toBeGreaterThan(last);
        last = f;
      }
    }
  });

  it("gives each material its own break sound", () => {
    const keys = MATERIAL_LIST.map((m) => JSON.stringify(recipeFor("break", { material: m })));
    expect(new Set(keys).size).toBe(MATERIAL_LIST.length);
    expect(recipeFor("break")).toEqual(recipeFor("break", { material: "stone" }));
  });

  it("detunes material sounds by at most 2% when given randomness", () => {
    const exact = recipeFor("break", { material: "glass" });
    for (const v of [0, 0.5, 0.999]) {
      const r = recipeFor("break", { material: "glass" }, () => v);
      for (const [i, l] of r.layers.entries()) {
        const base = exact.layers[i];
        const f = l.kind === "tone" ? l.freq : l.filter.freq;
        const f0 = base?.kind === "tone" ? base.freq : (base?.filter.freq ?? 0);
        expect(Math.abs(f / f0 - 1)).toBeLessThanOrEqual(0.0201);
      }
    }
  });
});

describe("chime ladder", () => {
  it("walks C D E G A, wrapping up octaves", () => {
    expect(chimeFrequency(0)).toBeCloseTo(523.25, 1);
    expect(Array.from({ length: 11 }, (_, s) => semis(s))).toEqual([
      0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24,
    ]);
  });

  it("caps at two octaves and treats odd steps safely", () => {
    expect(chimeFrequency(11)).toBe(chimeFrequency(10));
    expect(chimeFrequency(99)).toBe(chimeFrequency(10));
    expect(chimeFrequency(-3)).toBe(chimeFrequency(0));
    expect(chimeFrequency(2.9)).toBe(chimeFrequency(2));
    expect(chimeFrequency(Number.NaN)).toBe(chimeFrequency(0));
  });

  it("plays the pitchStep's note", async () => {
    const { audio, ctx } = await setup();
    audio.sfx("chime", { pitchStep: 2 });
    const osc = ctx.sources().find((s): s is FakeOsc => s instanceof FakeOsc);
    expect(osc?.frequency.events[0]).toMatchObject({ kind: "set", value: chimeFrequency(2) });
  });
});

describe("speak", () => {
  const DE = { lang: "de-DE", name: "Anna" };
  const GB = { lang: "en-GB", name: "Kate" };
  const US = { lang: "en_US", name: "Alex" };

  it(`speaks at rate ${SPEECH_RATE} with the first English voice`, () => {
    const s = fakeSpeech([DE, GB, US]);
    const audio = createAudio({ createContext: () => null, speech: s.deps });
    audio.speak("  cat ");
    expect(s.cancel).toHaveBeenCalledTimes(1);
    expect(s.spoken).toHaveLength(1);
    expect(s.spoken[0]).toMatchObject({ text: "cat", rate: 0.85, voice: GB, lang: "en-GB" });
    expect(s.spoken[0]?.volume).toBeCloseTo(volumeToGain(0.8)); // master 0.8 × voice 1
  });

  it("asks for en-US when the voice list has not loaded yet", () => {
    const s = fakeSpeech([]);
    createAudio({ speech: s.deps }).speak("sun");
    expect(s.spoken[0]).toMatchObject({ lang: "en-US", voice: null });
  });

  it("is a no-op without an English voice, when disabled, muted, blank or unavailable", () => {
    const de = fakeSpeech([DE]);
    createAudio({ speech: de.deps }).speak("dog");
    expect(de.spoken).toHaveLength(0);

    const s = fakeSpeech([US]);
    const audio = createAudio({ speech: s.deps });
    audio.speak("   ");
    audio.setSpeechEnabled(false);
    audio.speak("dog");
    audio.setSpeechEnabled(true);
    audio.setVolume("voice", 0);
    audio.speak("dog");
    expect(s.spoken).toHaveLength(0);
    audio.setVolume("voice", 1);
    audio.speak("dog");
    expect(s.spoken).toHaveLength(1);

    expect(() => createAudio({ speech: null }).speak("dog")).not.toThrow();
  });

  it("matches en, en-* and en_* only", () => {
    expect(pickVoice([{ lang: "eng", name: "x" }, DE])).toBeNull();
    expect(pickVoice([{ lang: "EN", name: "y" }])).toMatchObject({ name: "y" });
  });
});

describe("music", () => {
  it("is a silent placeholder until M6-01", async () => {
    const { audio, ctx } = await setup();
    const n = ctx.nodes.length;
    audio.music.setScene("meadow", "day");
    audio.music.setIntensity(0.5);
    audio.music.stop();
    expect(ctx.nodes.length).toBe(n);
  });
});
