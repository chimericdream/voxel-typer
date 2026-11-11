/**
 * The slice of the Web Audio API the engine uses. A real `AudioContext` satisfies these types
 * structurally, and tests pass a hand-rolled fake instead (`tests/unit/dom/audio.test.ts`).
 */

export interface ParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(target: number, time: number, timeConstant: number): unknown;
  cancelScheduledValues(time: number): unknown;
}

export interface NodeLike {
  connect(destination: NodeLike): unknown;
  disconnect(): void;
}

export interface GainLike extends NodeLike {
  readonly gain: ParamLike;
}

export interface SourceLike extends NodeLike {
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

export interface OscLike extends SourceLike {
  type: OscillatorType;
  readonly frequency: ParamLike;
}

export interface BiquadLike extends NodeLike {
  type: BiquadFilterType;
  readonly frequency: ParamLike;
  readonly Q: ParamLike;
}

export interface BufferLike {
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceLike extends SourceLike {
  buffer: BufferLike | null;
}

export interface CompressorLike extends NodeLike {
  readonly threshold: ParamLike;
  readonly knee: ParamLike;
  readonly ratio: ParamLike;
  readonly attack: ParamLike;
  readonly release: ParamLike;
}

export interface CtxLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: NodeLike;
  resume(): Promise<void>;
  createGain(): GainLike;
  createOscillator(): OscLike;
  createBiquadFilter(): BiquadLike;
  createBufferSource(): BufferSourceLike;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createDynamicsCompressor(): CompressorLike;
}

/** Makes the one `AudioContext`, or returns null where Web Audio is missing. */
export function defaultContextFactory(): CtxLike | null {
  if (typeof AudioContext === "undefined") return null;
  return new AudioContext({ latencyHint: "interactive" });
}
