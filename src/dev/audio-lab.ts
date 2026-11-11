// Audio lab (M2-06), served as /audio-lab.html by `npm run dev` only (never in `dist/`).
// A button per sound effect and per material for listening, volume sliders, a chime ladder, the
// voice cap, speech, and an inspector that shows each recipe's layers, its offline-rendered
// waveform and its peak in dBFS.
//
// Developer page: the text here is not kid-facing and doesn't go through t().
import { createAudio, DEFAULT_AUDIO_SEED } from "@/audio/engine";
import { makeNoise, renderRecipe, toDb, worstPeak } from "@/audio/preview";
import type { Recipe, SfxOpts } from "@/audio/recipes";
import { MATERIAL_LIST, MAX_CHIME_STEP, MAX_CRACK_STAGE, recipeFor } from "@/audio/recipes";
import type { Bus, SfxName } from "@/audio/types";
import { createRng } from "@/engine/rng";

const RATE = 48000;
const audio = createAudio();
const noiseRng = createRng(DEFAULT_AUDIO_SEED).fork("audio:noise");
const noise = makeNoise(() => noiseRng.next(), RATE);

type Child = Node | string;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<"className" | "textContent" | "title", string>> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

const root = document.querySelector("#lab");
if (!root) throw new Error("audio-lab.html has no #lab");

const status = el("p", { textContent: "Audio is locked. Press any key or click a button." });
const recipeOut = el("pre");
const peakOut = el("p");
const wave = el("canvas");
wave.width = 720;
wave.height = 140;
wave.id = "wave";

function peakDb(recipe: Recipe): string {
  return `${toDb(worstPeak(recipe, [noise], RATE)).toFixed(1)} dBFS`;
}

function drawWave(samples: Float32Array): void {
  const g = wave.getContext("2d");
  if (!g) return;
  const { width: w, height: h } = wave;
  g.fillStyle = "#121317";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#2f3238";
  for (const db of [-6, -12, -20]) {
    const y = (h / 2) * (1 - 10 ** (db / 20));
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.moveTo(0, h - y);
    g.lineTo(w, h - y);
    g.stroke();
  }
  g.fillStyle = "#9fc46a";
  // One second across the canvas, so lengths compare between sounds.
  const perPx = RATE / w;
  for (let x = 0; x < w; x++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(samples.length, (x + 1) * perPx);
    for (let i = Math.floor(x * perPx); i < end; i++) {
      const s = samples[i] ?? 0;
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    g.fillRect(x, (h / 2) * (1 - hi), 1, Math.max(1, (h / 2) * (hi - lo)));
  }
}

async function play(name: SfxName, opts: SfxOpts = {}): Promise<void> {
  await unlock();
  audio.sfx(name, opts);
  const recipe = recipeFor(name, opts);
  const samples = renderRecipe(recipe, noise, { rate: RATE });
  drawWave(samples);
  const label = [name, opts.material, opts.pitchStep].filter((v) => v !== undefined).join(" ");
  peakOut.textContent = `${label}: peak ${toDb(worstPeak(recipe, [noise], RATE)).toFixed(1)} dBFS (worst noise slice) before buses, ${(samples.length / RATE).toFixed(2)} s, ${recipe.layers.length} layers`;
  recipeOut.textContent = JSON.stringify(recipe.layers, null, 1);
}

async function unlock(): Promise<void> {
  await audio.unlock();
  status.textContent = audio.busNode("master")
    ? "Audio is running."
    : "Web Audio is not available in this browser.";
}

function button(text: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = el("button", title ? { textContent: text, title } : { textContent: text });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

const section = (title: string, ...children: Child[]): HTMLElement =>
  el("section", {}, [el("h2", { textContent: title }), ...children]);

// Volumes (squared to gain, as in the engine). Defaults match src/save/settings.ts.
const volumes: [Bus, number][] = [
  ["master", 0.8],
  ["music", 0.5],
  ["sfx", 0.8],
  ["voice", 1],
];
const sliders = el(
  "div",
  { className: "row" },
  volumes.map(([bus, v]) => {
    const input = el("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.05";
    input.value = String(v);
    const out = el("code", { textContent: String(v) });
    input.addEventListener("input", () => {
      audio.setVolume(bus, Number(input.value));
      out.textContent = input.value;
    });
    return el("label", {}, [bus, input, out]);
  }),
);

const effects: SfxName[] = [
  "thud",
  "pop",
  "click",
  "whoosh",
  "levelUp",
  "star",
  "shield",
  "cart",
  "undo",
];
const effectsRow = el(
  "div",
  { className: "row" },
  effects.map((name) => button(name, () => void play(name))),
);

const thudRow = el("div", { className: "row" }, [
  button("thud", () => void play("thud")),
  button("chip, chip, thud, chip (a slip mid-word)", () => {
    const steps: [SfxName, SfxOpts][] = [
      ["chip", { pitchStep: 1 }],
      ["chip", { pitchStep: 2 }],
      ["thud", {}],
      ["chip", { pitchStep: 3 }],
    ];
    steps.forEach(([n, o], i) => setTimeout(() => void play(n, o), i * 260));
  }),
  button("thud × 4 (a hard word)", () => {
    for (let i = 0; i < 4; i++) setTimeout(() => void play("thud"), i * 450);
  }),
]);

const head = el("tr", {}, [
  el("th", { textContent: "material" }),
  el("th", { textContent: "break" }),
  el("th", { textContent: "chip by crack stage" }),
  el("th", { textContent: "place" }),
  el("th", { textContent: "mine a word" }),
]);
const materialRows = MATERIAL_LIST.map((m) =>
  el("tr", {}, [
    el("td", {}, [el("code", { textContent: m })]),
    el("td", {}, [
      button(
        "break",
        () => void play("break", { material: m }),
        peakDb(recipeFor("break", { material: m })),
      ),
    ]),
    el(
      "td",
      {},
      Array.from({ length: MAX_CRACK_STAGE + 1 }, (_, s) =>
        button(String(s), () => void play("chip", { material: m, pitchStep: s })),
      ),
    ),
    el("td", {}, [button("place", () => void play("place", { material: m }))]),
    el("td", {}, [
      button("5 letters", () => {
        // Chips (stage floor(9 × typed / 5)) with the chime ladder, then the break.
        for (let i = 1; i <= 5; i++) {
          setTimeout(() => {
            void play("chip", { material: m, pitchStep: Math.floor((9 * i) / 5) });
            audio.sfx("chime", { pitchStep: i - 1, gain: 0.7 });
          }, i * 220);
        }
        setTimeout(() => void play("break", { material: m }), 6 * 220);
      }),
    ]),
  ]),
);
const materialTable = el("table", {}, [el("thead", {}, [head]), el("tbody", {}, materialRows)]);

const chimeRow = el("div", { className: "row" }, [
  ...Array.from({ length: MAX_CHIME_STEP + 3 }, (_, s) =>
    button(String(s), () => void play("chime", { pitchStep: s })),
  ),
  button("ladder 0→12", () => {
    for (let s = 0; s <= MAX_CHIME_STEP + 2; s++) {
      setTimeout(() => void play("chime", { pitchStep: s }), s * 160);
    }
  }),
]);

const voiceRow = el("div", { className: "row" }, [
  button("20 chimes at once", () => {
    void unlock().then(() => {
      for (let s = 0; s < 20; s++) audio.sfx("chime", { pitchStep: s % 11, gain: 0.5 });
      status.textContent = `Voices playing: ${audio.activeVoices()} (cap 12).`;
    });
  }),
]);

const speakInput = el("input");
speakInput.value = "sun";
speakInput.size = 20;
const speakRow = el("div", { className: "row" }, [
  speakInput,
  button("speak", () => audio.speak(speakInput.value)),
]);

const peakRows: [string, SfxName, SfxOpts][] = [
  ...MATERIAL_LIST.map((m): [string, SfxName, SfxOpts] => [`break ${m}`, "break", { material: m }]),
  ...effects.concat(["chime"]).map((n): [string, SfxName, SfxOpts] => [n, n, {}]),
];
const peakTable = el("table", {}, [
  el("thead", {}, [
    el("tr", {}, [el("th", { textContent: "sound" }), el("th", { textContent: "peak" })]),
  ]),
  el(
    "tbody",
    {},
    peakRows.map(([label, n, o]) =>
      el("tr", {}, [
        el("td", { textContent: label }),
        el("td", { textContent: peakDb(recipeFor(n, o)) }),
      ]),
    ),
  ),
]);

root.append(
  el("header", {}, [
    el("h1", { textContent: "Audio lab" }),
    el("p", {
      textContent:
        "Every sound is synthesized at runtime from oscillators and seeded noise. Peaks are measured offline, per voice, before the bus, master and compressor gains.",
    }),
    status,
  ]),
  section("Volume", sliders),
  section("Error thud (must feel soft and kind)", thudRow),
  section("Effects", effectsRow),
  section("Materials", materialTable),
  section("Chime ladder (pentatonic, capped at two octaves)", chimeRow),
  section("Voice cap", voiceRow),
  section("Speech (rate 0.85, first English voice)", speakRow),
);
const inspect = el("div", {}, [el("div", {}, [wave, peakTable]), recipeOut]);
inspect.id = "inspect";
root.append(section("Inspector (click any sound)", peakOut, inspect));

window.addEventListener("keydown", () => void unlock(), { once: true });
