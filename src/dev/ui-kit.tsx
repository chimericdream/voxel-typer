// UI kit preview (M2-07), served as /ui-kit.html in dev and test builds only (never in `dist/`).
// Shows every kit component in every theme.
//
//   ?theme=day|night|contrast   one theme only (default: all three, stacked)
//   ?scale=<1–2>                --text-scale (default 1.5, the Sprout letter size)
//   ?motion=reduced|full        override prefers-reduced-motion
//   ?dialog=1                   open the dialog in the first theme shown
//
// Developer page: the sample text here is not kid-facing and doesn't go through t(). Screens pass
// t() output to the same props.
import "@/ui/theme/tokens.css";
import { render } from "preact";
import { useState } from "preact/hooks";
import { createRng } from "@/engine/rng";
import { BASE_PALETTE } from "@/render/atlas/palettes";
import { TILE_SIZE } from "@/render/atlas/painters";
import { paintTile } from "@/render/atlas/recipes";
import type { TextureRecipe } from "@/render/atlas/recipes";
import { Button } from "@/ui/kit/Button";
import { Dialog } from "@/ui/kit/Dialog";
import { Hotbar } from "@/ui/kit/Hotbar";
import { KeyCap } from "@/ui/kit/KeyCap";
import { Panel } from "@/ui/kit/Panel";
import { ProgressBar } from "@/ui/kit/ProgressBar";
import { Slider } from "@/ui/kit/Slider";
import { Slot } from "@/ui/kit/Slot";
import type { SlotProps } from "@/ui/kit/Slot";
import { Stars } from "@/ui/kit/Stars";
import { Tabs } from "@/ui/kit/Tabs";
import { Toast } from "@/ui/kit/Toast";
import { Toggle } from "@/ui/kit/Toggle";
import { THEME_IDS, applyMotion, applyTextScale, applyTheme } from "@/ui/theme/themes";
import type { ThemeId } from "@/ui/theme/themes";

const params = new URLSearchParams(window.location.search);
const themeParam = params.get("theme");
const themes: readonly ThemeId[] = THEME_IDS.filter((id) => !themeParam || id === themeParam);
const scale = Number(params.get("scale") ?? "1.5");
const motion = params.get("motion");
const openDialog = params.get("dialog") === "1";

const THEME_NAMES: Record<ThemeId, string> = {
  day: "Day theme",
  night: "Night theme",
  contrast: "High-contrast theme",
};

/** A 16×16 item icon painted with the atlas painters, as a data URI. */
function icon(recipe: TextureRecipe, seed: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const px = paintTile(recipe, BASE_PALETTE, createRng(seed));
  ctx.putImageData(new ImageData(new Uint8ClampedArray(px), TILE_SIZE, TILE_SIZE), 0, 0);
  return canvas.toDataURL("image/png");
}

const ICONS = {
  oak: icon({ kind: "planks", ramp: "oak", boards: 4 }, 1),
  stone: icon({ kind: "noise", ramp: "stone", scale: 4, contrast: 1 }, 2),
  gem: icon(
    {
      kind: "ore",
      base: { kind: "noise", ramp: "stone", scale: 4, contrast: 1 },
      ore: "ore-gem",
      density: 0.5,
    },
    3,
  ),
  wool: icon({ kind: "custom", paint: "knit:wool-red" }, 4),
  brick: icon({ kind: "bricks", ramp: "brick", mortar: "mortar" }, 5),
};

const img = (src: string) => <img src={src} alt="" width={16} height={16} />;

const HOTBAR: SlotProps[] = [
  { label: "Oak planks, 12", icon: img(ICONS.oak), count: 12 },
  { label: "Stone, 30", icon: img(ICONS.stone), count: 30 },
  { label: "Gem ore, 2", icon: img(ICONS.gem), count: 2 },
  { label: "Red wool", icon: img(ICONS.wool), count: 1 },
  { label: "Bricks, 64", icon: img(ICONS.brick), count: 64 },
];

function Sample({ theme, first }: { theme: ThemeId; first: boolean }) {
  const [dialog, setDialog] = useState(first && openDialog);
  const [music, setMusic] = useState(true);
  const [calm, setCalm] = useState(false);
  const [volume, setVolume] = useState(80);
  const [picked, setPicked] = useState(1);
  const [presses, setPresses] = useState(0);

  return (
    <section
      class="theme"
      aria-label={THEME_NAMES[theme]}
      ref={(el) => {
        if (!el || el.dataset["theme"]) return;
        applyTheme(el, theme);
        applyTextScale(el, scale);
        if (motion === "reduced" || motion === "full") applyMotion(el, motion === "reduced");
      }}
    >
      <h1 class="theme-title">{THEME_NAMES[theme]}</h1>

      <div class="scene" data-testid="scene">
        <Panel tone="plate">
          <p class="big">Find the F and J bumps!</p>
        </Panel>
        <Hotbar label="Hotbar, combo 4" slots={HOTBAR} lit={4} selected={2} />
      </div>

      <div class="grid">
        <Panel heading="Buttons">
          <div class="row">
            <Button variant="primary" onClick={() => setPresses(presses + 1)}>
              Start
            </Button>
            <Button onClick={() => setDialog(true)}>Help</Button>
            <Button disabled>Locked</Button>
          </div>
          <p>Pressed {presses} times. Hold Enter or Space on a button to see it press in.</p>
        </Panel>

        <Panel heading="Keys">
          <div class="row">
            <KeyCap glyph="F" bump size="lg" />
            <KeyCap glyph="J" bump size="lg" pressed />
            <KeyCap glyph=";" label="semicolon" />
            <KeyCap glyph="Space" wide />
          </div>
        </Panel>

        <Panel heading="Stars">
          <div class="row">
            <Stars value={1} label="1 of 3 stars" />
            <Stars value={2} label="2 of 3 stars" />
            <Stars value={3} label="3 of 3 stars" size="lg" />
          </div>
        </Panel>

        <Panel heading="Inventory">
          <div class="row">
            {HOTBAR.slice(0, 4).map((slot, i) => (
              <Slot key={i} {...slot} selected={picked === i} onClick={() => setPicked(i)} />
            ))}
            <Slot />
          </div>
          <ProgressBar value01={0.6} label="Lesson progress" valueText="6 of 10 words" />
        </Panel>

        <Panel heading="Settings">
          <Toggle checked={music} onChange={setMusic} label="Music" />
          <Toggle checked={calm} onChange={setCalm} label="Calm mode" />
          <Slider
            value={volume}
            min={0}
            max={100}
            step={10}
            onChange={setVolume}
            label="Sound"
            valueText={(v) => `${v}%`}
          />
        </Panel>

        <Panel heading="Messages">
          <Toast>Caps Lock is on! Tap it to turn it off.</Toast>
          <Toast tone="cheer">New best! You found 12 gems.</Toast>
        </Panel>
      </div>

      <Tabs
        label="Inventory pages"
        tabs={[
          { id: "blocks", label: "Blocks", content: <p>Your blocks live here.</p> },
          { id: "tools", label: "Tools", content: <p>Pickaxes and shovels.</p> },
          { id: "skins", label: "Skins", content: <p>Pick a look for your miner.</p> },
        ]}
      />

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Need a hand?"
        closeLabel="Close"
      >
        <p>Put your pointer fingers on F and J. Feel the bumps?</p>
        <div class="row">
          <Button variant="primary" onClick={() => setDialog(false)}>
            Got it
          </Button>
          <Button onClick={() => setDialog(false)}>Later</Button>
        </div>
      </Dialog>
    </section>
  );
}

function App() {
  return (
    <main>
      {themes.map((theme, i) => (
        <Sample key={theme} theme={theme} first={i === 0} />
      ))}
    </main>
  );
}

const root = document.querySelector<HTMLElement>("#ui-kit");
if (root) {
  render(<App />, root);
  root.dataset["themes"] = String(themes.length);
  root.dataset["ready"] = "1";
}
