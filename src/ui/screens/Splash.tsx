/**
 * Splash (task M2-11): the voxel-letter logo, "Press any key to start" and a small privacy link.
 * The footer disclaimer is drawn by the app shell on this route.
 *
 * Nothing plays here. The first key press or click unlocks audio (the shell does it on every real
 * gesture; this screen asks too) and moves on: to the Profiles screen, or straight to the
 * new-player screen when the device has no players yet.
 */
import type { JSX } from "preact";
import type { ScreenProps } from "@/app/types";
import { t } from "@/i18n";
import { Button } from "@/ui/kit/Button";
import { focusOnControl, useScreenInput } from "./nav";
import screen from "./screen.module.css";
import styles from "./Splash.module.css";

/** 5×5 pixel letters for the logo. Original shapes. The heading's text names it for readers. */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  V: ["#...#", "#...#", "#...#", ".#.#.", "..#.."],
  O: [".###.", "#...#", "#...#", "#...#", ".###."],
  X: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  E: ["#####", "#....", "####.", "#....", "#####"],
  L: ["#....", "#....", "#....", "#....", "#####"],
  T: ["#####", "..#..", "..#..", "..#..", "..#.."],
  Y: ["#...#", ".#.#.", "..#..", "..#..", "..#.."],
  P: ["####.", "#...#", "####.", "#....", "#...."],
  R: ["####.", "#...#", "####.", "#..#.", "#...#"],
};

const WORDS = ["VOXEL", "TYPER"] as const;
const GAP = 1;
const WIDTH = 5 * 5 + 4 * GAP;
const LINE = 7;

/** The cells of one word, as voxel cubes: a shadow block behind each face. */
function wordCubes(word: string, top: number, tone: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  word.split("").forEach((ch, li) => {
    const rows = GLYPHS[ch] ?? [];
    rows.forEach((row, y) => {
      row.split("").forEach((c, x) => {
        if (c !== "#") return;
        const px = li * (5 + GAP) + x;
        const py = top + y;
        out.push(
          <g key={`${li}-${x}-${y}`} class={styles.cube} data-tone={tone}>
            <rect class={styles.side} x={px + 0.22} y={py + 0.22} width={1} height={1} />
            <rect class={styles.face} x={px} y={py} width={1} height={1} />
            <rect class={styles.shine} x={px} y={py} width={1} height={0.22} />
          </g>,
        );
      });
    });
  });
  return out;
}

export function Logo() {
  return (
    <svg
      class={styles.logo}
      viewBox={`-0.5 -0.5 ${WIDTH + 1.5} ${LINE * 2 + 0.5}`}
      aria-hidden="true"
      shape-rendering="crispEdges"
    >
      {wordCubes(WORDS[0], 0, "primary")}
      {wordCubes(WORDS[1], LINE, "accent")}
    </svg>
  );
}

export default function Splash({ app }: ScreenProps) {
  const start = (): void => {
    // A second press before the list loads just finds the route already changed.
    void app.audio.unlock();
    const going = app.store.listProfiles().then((list) => {
      if (app.route().id !== "splash") return;
      app.navigate({ id: list.length === 0 ? "profileCreate" : "profiles" });
    });
    app.whenReady(going);
  };

  useScreenInput(app, (i) => {
    if (i.kind === "typed") {
      // Space on a focused button is that button's click (on keyup); leave it to the button.
      if (i.input.key === " " && focusOnControl()) return false;
      start();
      return true;
    }
    if (i.action === "confirm" && !focusOnControl()) {
      start();
      return true;
    }
    return false;
  });

  return (
    <div class={`${screen.screen} ${styles.splash}`}>
      <h1 class={styles.heading}>
        <Logo />
        <span class={styles.name}>{t("common.appName")}</span>
      </h1>
      <Button variant="primary" size="lg" onClick={start} class={styles.press ?? ""}>
        {t("screens.splash.press")}
      </Button>
      <Button onClick={() => app.navigate({ id: "privacy" })} class={styles.privacy ?? ""}>
        {t("screens.splash.privacy")}
      </Button>
    </div>
  );
}
