import { describe, expect, it, vi } from "vitest";
import { fingerLabelsOn, hearAgainKey, hearAgainShown } from "../../../src/a11y/options";
import { watchLocalVoice } from "../../../src/a11y/voice";
import type { VoiceSource } from "../../../src/a11y/voice";
import type { VoiceLike } from "../../../src/audio/speech";
import { defaultSettings } from "../../../src/save/settings";

describe("finger labels", () => {
  it("default to on for Sprout only (M2-14)", () => {
    expect(fingerLabelsOn(defaultSettings("sprout"), "sprout")).toBe(true);
    expect(fingerLabelsOn(defaultSettings("miner"), "miner")).toBe(false);
    expect(fingerLabelsOn(defaultSettings("builder"), "builder")).toBe(false);
  });

  it("an explicit setting works for every band", () => {
    for (const band of ["sprout", "miner", "builder"] as const) {
      expect(fingerLabelsOn({ ...defaultSettings(band), fingerLabels: true }, band)).toBe(true);
      expect(fingerLabelsOn({ ...defaultSettings(band), fingerLabels: false }, band)).toBe(false);
    }
  });
});

describe("hear it again", () => {
  it("uses ` for Sprout and F1 for the others (src/input/keyboard.ts)", () => {
    expect(hearAgainKey("sprout")).toBe("`");
    expect(hearAgainKey("miner")).toBe("F1");
    expect(hearAgainKey("builder")).toBe("F1");
  });

  it("shows only with read-aloud on and a voice on the device (decision 69)", () => {
    expect(hearAgainShown({ tts: true }, true)).toBe(true);
    expect(hearAgainShown({ tts: true }, false)).toBe(false);
    expect(hearAgainShown({ tts: false }, true)).toBe(false);
  });
});

function fakeVoices(start: VoiceLike[]): VoiceSource & { set(v: VoiceLike[]): void } {
  let voices = start;
  const listeners = new Set<() => void>();
  return {
    getVoices: () => voices,
    addEventListener: (_t, fn) => listeners.add(fn),
    removeEventListener: (_t, fn) => listeners.delete(fn),
    set(v) {
      voices = v;
      for (const fn of listeners) fn();
    },
  };
}

const LOCAL_EN: VoiceLike = { name: "Local", lang: "en-US", localService: true };
const CLOUD_EN: VoiceLike = { name: "Cloud", lang: "en-US", localService: false };

describe("local voice watch", () => {
  it("is false with only cloud voices, and turns true when a local English voice loads", () => {
    const src = fakeVoices([CLOUD_EN]);
    const watch = watchLocalVoice(src);
    expect(watch.available.value).toBe(false);
    src.set([CLOUD_EN, LOCAL_EN]);
    expect(watch.available.value).toBe(true);
    const spy = vi.fn();
    const off = watch.available.subscribe(spy);
    watch.dispose();
    src.set([]);
    expect(watch.available.value).toBe(true);
    off();
  });

  it("is false without speech synthesis", () => {
    expect(watchLocalVoice(null).available.value).toBe(false);
  });
});
