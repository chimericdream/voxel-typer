// On-screen keyboard preview (M2-09), served as /keyboard.html in dev and test builds only (never in
// `dist/`).
//
//   ?theme=day|night|contrast   theme (default day)
//   ?layout=en-US|en-GB         layout (default en-US)
//   ?scale=<1–2>                --text-scale (default 1.5, the Sprout letter size)
//   ?next=<char>                the next key (default F); `?next=` lights nothing
//   ?labels=1                   finger labels on every key
//   ?hands=0                    hide the hand overlay
//   ?motion=reduced|full        override prefers-reduced-motion
//
// Typing a wrong key wobbles it, as in play; typing the right key does nothing.
//
// Developer page: nothing here is kid-facing text.
import "@/ui/theme/tokens.css";
import "@/ui/theme/fonts.css";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { EN_US, layoutById } from "@/content/layouts";
import { OnScreenKeyboard } from "@/ui/keyboard/OnScreenKeyboard";
import type { WrongKey } from "@/ui/keyboard/OnScreenKeyboard";
import { THEME_IDS, applyMotion, applyTextScale, applyTheme } from "@/ui/theme/themes";

const params = new URLSearchParams(window.location.search);
const theme = THEME_IDS.find((id) => id === params.get("theme")) ?? "day";
const layout = layoutById(params.get("layout") ?? "en-US") ?? EN_US;
const scale = Number(params.get("scale") ?? "1.5");
const nextParam = params.get("next");
const next = nextParam === null ? "F" : nextParam === "" ? null : nextParam;
const motion = params.get("motion");

function Preview() {
  const [wrong, setWrong] = useState<WrongKey | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length !== 1 || e.key === next) return;
      e.preventDefault();
      // Repeats are passed on on purpose: the keyboard's own gate must hold them back.
      setWrong((w) => ({ got: e.key, seq: (w?.seq ?? 0) + 1 }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <h1 class="title">Keyboard preview</h1>
      {next === null ? null : <p class="target">{next === " " ? "␣" : next}</p>}
      <OnScreenKeyboard
        layout={layout}
        nextKey={next}
        hands={params.get("hands") !== "0"}
        labels={params.get("labels") === "1"}
        wrong={wrong}
      />
    </>
  );
}

const root = document.getElementById("keyboard");
if (root) {
  applyTheme(document.documentElement, theme);
  applyTextScale(document.documentElement, scale);
  if (motion === "reduced" || motion === "full") {
    applyMotion(document.documentElement, motion === "reduced");
  }
  render(<Preview />, root);
  void document.fonts.ready.then(() => {
    root.dataset["ready"] = "1";
  });
}
