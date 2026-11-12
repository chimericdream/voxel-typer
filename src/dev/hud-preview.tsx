// HUD preview (M2-14), served as /hud.html in dev and test builds only (never in `dist/`).
//
//   ?theme=day|night|contrast   theme (default day)
//   ?sky=day|night              the stand-in scene behind the HUD (default: night for the night theme)
//   ?scale=<1–2>                --text-scale (default 1.5, the Sprout letter size)
//   ?band=sprout|miner|builder  age band (default sprout); its keyboard, hands and timer defaults
//   ?words=a,b,c                the words to type (default "fj,jaf,salad,f")
//   ?marks=<p|o|f|w…>           freeze the first word with these marks (pending/ok/fixed/wrong)
//   ?caps=1                     show the Caps Lock hint
//   ?banner=1                   show a banner
//   ?motion=reduced|full        override prefers-reduced-motion
//
// Without `?marks`, typing plays a tiny "stay" session: the right key advances, a wrong key marks
// the char and wobbles its key, Space moves to the next word.
//
// Developer page: nothing here is kid-facing text.
import "@/ui/theme/tokens.css";
import "@/ui/theme/fonts.css";
import { render } from "preact";
import { EN_US, layoutById } from "@/content/layouts";
import type { TargetView } from "@/engine/types";
import { defaultSettings } from "@/save/settings";
import type { AgeBand } from "@/types/core";
import { createHudStore, reportWrongKey } from "@/ui/hud/bridge";
import { Hud } from "@/ui/hud/Hud";
import { THEME_IDS, applyMotion, applyTextScale, applyTheme } from "@/ui/theme/themes";

type Mark = TargetView["marks"][number];

const params = new URLSearchParams(window.location.search);
const theme = THEME_IDS.find((id) => id === params.get("theme")) ?? "day";
const sky = params.get("sky") ?? (theme === "night" ? "night" : "day");
const scale = Number(params.get("scale") ?? "1.5");
const bands: readonly AgeBand[] = ["sprout", "miner", "builder"];
const band = bands.find((b) => b === params.get("band")) ?? "sprout";
const words = (params.get("words") ?? "fj,jaf,salad,f").split(",").filter((w) => w.length > 0);
const marksParam = params.get("marks");
const motion = params.get("motion");
const settings = defaultSettings(band);
const layout = layoutById(settings.layout) ?? EN_US;

const MARK_OF: Record<string, Mark> = { p: "pending", o: "ok", f: "fixed", w: "wrong" };

const hud = createHudStore();
let wordIndex = 0;
let typed = 0;
let streak = 0;
let marks: Mark[] = [];
let erred: boolean[] = [];

function current(): string {
  return words[wordIndex % words.length] ?? "f";
}

function show(): void {
  const text = current();
  const withSpace = typed >= text.length;
  hud.set({
    word: { text, marks: [...marks], typed },
    nextKey: withSpace ? " " : (text[typed] ?? null),
    combo: Math.min(9, Math.floor(streak / 3)),
    progress01: Math.min(1, wordIndex / words.length),
  });
}

function startWord(): void {
  const text = current();
  typed = 0;
  marks = [...Array.from(text, (): Mark => "pending"), "pending"];
  erred = marks.map(() => false);
  show();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "CapsLock" || e.ctrlKey || e.metaKey || e.altKey) return;
  hud.set({ capsLock: e.getModifierState("CapsLock") });
  if (e.key.length !== 1) return;
  e.preventDefault();
  const text = current();
  const expected = typed < text.length ? text[typed] : " ";
  if (e.key === expected) {
    marks[typed] = erred[typed] === true ? "fixed" : "ok";
    typed += 1;
    streak += 1;
    if (typed > text.length) {
      wordIndex += 1;
      startWord();
      return;
    }
    show();
    return;
  }
  // A held key repeats here on purpose: the keyboard's own gate must hold the wobble back.
  streak = 0;
  marks[typed] = "wrong";
  erred[typed] = true;
  show();
  reportWrongKey(hud, e.key);
}

function frozenWord(spec: string): void {
  const text = current();
  const m = Array.from(spec, (c): Mark => MARK_OF[c] ?? "pending");
  const next = m.findIndex((x) => x === "pending" || x === "wrong");
  const at = next === -1 ? m.length : next;
  hud.set({
    word: { text, marks: m, typed: at },
    nextKey: text[at] ?? " ",
    combo: 4,
    progress01: 0.4,
  });
}

const root = document.getElementById("hud");
const scene = document.getElementById("scene");
if (root && scene) {
  scene.dataset["sky"] = sky;
  applyTheme(document.documentElement, theme);
  applyTextScale(document.documentElement, scale);
  if (motion === "reduced" || motion === "full") {
    applyMotion(document.documentElement, motion === "reduced");
  }
  if (marksParam === null) {
    startWord();
    window.addEventListener("keydown", onKey);
  } else {
    frozenWord(marksParam);
  }
  hud.set({
    capsLock: params.get("caps") === "1",
    banner: params.get("banner") === "1" ? { key: "app.pause.title", tone: "cheer" } : null,
    timer: { remainingMs: 42_000 },
  });
  render(
    <>
      <h1 class="title">HUD preview</h1>
      <Hud fields={hud.fields} settings={settings} band={band} layout={layout} />
    </>,
    root,
  );
  void document.fonts.ready.then(() => {
    root.dataset["ready"] = "1";
  });
}
