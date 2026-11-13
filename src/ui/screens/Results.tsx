/**
 * Results (task M2-11): stars that fill in one by one, each with the `star` sound, the blocks
 * found filling their slots, a personal-best badge, a warm message (never negative) and Again /
 * Next / Map. Miner and Builder also see "Great aim: 94%"; Sprout sees stars only.
 *
 * Under reduced motion the stars and slots appear at once and one `star` sound plays. The setting is
 * read live: if the OS switches to reduced motion while Results is up, the stars and slots stop
 * moving at once (M3-07 review N7).
 *
 * The screen comes up while a child may still be typing. For a short moment the buttons ignore
 * presses, so a stray Space or Enter can't skip past the stars.
 *
 * Badge toasts (M3-FIX-12): the page holds them back (`data-toast-hold`) until the stars, and a
 * personal-best plate, have filled in; with reduced motion there is nothing to wait for. A dock
 * under the buttons (`data-toast-dock`) is where they show, so they never cover the card.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ScreenProps } from "@/app/types";
import { blocks } from "@/content/blocks";
import { createRng } from "@/engine/rng";
import { t } from "@/i18n";
import { BASE_PALETTE } from "@/render/atlas/palettes";
import { TILE_SIZE } from "@/render/atlas/painters";
import { paintTile } from "@/render/atlas/recipes";
import { Button } from "@/ui/kit/Button";
import { Slot } from "@/ui/kit/Slot";
import { Stars } from "@/ui/kit/Stars";
import { focusOnControl, useReducedMotion, useScreenInput } from "./nav";
import {
  aimLine,
  isPersonalBest,
  lootRows,
  messageText,
  nextLesson,
  resultLines,
} from "./results-logic";
import screen from "./screen.module.css";
import styles from "./Results.module.css";

/** Matches the kit Stars stagger (350 ms per star) and lands each sound as its star fills. */
export const STAR_STEP_MS = 350;
export const STAR_LAND_MS = 300;
/** Presses are ignored this long after the screen appears. */
export const ARM_MS = 700;
/** The personal-best plate pops in after the stars (`.best` in Results.module.css). */
export const BEST_DELAY_MS = 1050;
/** The kit Stars' fill and the plate's pop each take `--t-slow`. */
export const FILL_MS = 450;

/**
 * How long the stars (and the personal-best plate) take to fill in, from the screen's arrival:
 * badge toasts wait this long (M3-FIX-12). 0 with reduced motion, since then nothing moves.
 */
export function fillInMs(stars: number, best: boolean, reduced: boolean): number {
  if (reduced) return 0;
  const lastStar = stars > 0 ? (stars - 1) * STAR_STEP_MS + FILL_MS : 0;
  return Math.max(lastStar, best ? BEST_DELAY_MS + FILL_MS : 0);
}

/**
 * Lays Results out side by side (`data-layout="side"`) only when the one-column layout doesn't fit
 * the window (M3-FIX-13): at text scale 2, or on a very short window. Measured in one column first,
 * in a layout effect, so the child never sees the switch; again when the window resizes and when
 * fonts finish loading. The CSS uses it on a wide window only (Results.module.css).
 */
export function chooseLayout(page: HTMLElement): void {
  const box = page.parentElement;
  page.dataset["layout"] = "stack";
  if (!box) return;
  const over = box.scrollHeight > box.clientHeight + 1;
  page.dataset["layout"] = over ? "side" : "stack";
}

function useLayoutChoice(page: { current: HTMLElement | null }): void {
  useLayoutEffect(() => {
    const el = page.current;
    if (!el) return undefined;
    const fit = (): void => chooseLayout(el);
    fit();
    const view = el.ownerDocument.defaultView;
    view?.addEventListener("resize", fit);
    const fonts = "fonts" in el.ownerDocument ? el.ownerDocument.fonts : null;
    fonts?.addEventListener("loadingdone", fit);
    return () => {
      view?.removeEventListener("resize", fit);
      fonts?.removeEventListener("loadingdone", fit);
    };
  }, [page]);
}

const icons = new Map<string, string>();

/** A 16×16 icon of the block's side face, as a data URI ("" without a 2D canvas). */
function blockIcon(id: string): string {
  const cached = icons.get(id);
  if (cached !== undefined) return cached;
  const def = blocks.find((b) => b.id === id);
  let uri = "";
  const canvas = document.createElement("canvas");
  const ctx = def ? canvas.getContext("2d") : null;
  if (def && ctx) {
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const px = paintTile(def.faces.side, BASE_PALETTE, createRng(def.num));
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px), TILE_SIZE, TILE_SIZE), 0, 0);
    uri = canvas.toDataURL("image/png");
  }
  icons.set(id, uri);
  return uri;
}

function blockName(id: string): string {
  const def = blocks.find((b) => b.id === id);
  return def ? t(def.nameKey) : id;
}

export default function Results({ app, route }: ScreenProps) {
  const result = app.lastResult();
  const profile = app.profile();
  const lesson = route.lesson === undefined ? null : app.lesson(route.lesson);
  const actions = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  useLayoutChoice(page);
  const armed = useRef(false);
  const reduced = useReducedMotion(profile?.settings.reducedMotion);
  const stars = result?.stars ?? 0;
  // The star sounds are planned once, on arrival; a later motion change only stops the pictures.
  const reducedAtStart = useRef(reduced);

  useEffect(() => {
    actions.current?.querySelector("button")?.focus();
    const timers = [setTimeout(() => (armed.current = true), ARM_MS)];
    if (stars > 0) {
      if (reducedAtStart.current) app.audio.sfx("star");
      else {
        for (let i = 0; i < stars; i++) {
          timers.push(setTimeout(() => app.audio.sfx("star"), i * STAR_STEP_MS + STAR_LAND_MS));
        }
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [app, stars]);

  // Badge toasts wait while the stars fill in. Planned once, on arrival; a switch to reduced motion
  // stops the pictures at once, so it ends the wait too.
  const best =
    result !== null && lesson !== null && profile !== null
      ? isPersonalBest(profile, lesson.id, result.summary)
      : false;
  const fillAtStart = useRef(fillInMs(stars, best, reduced));
  const [filling, setFilling] = useState(fillAtStart.current > 0);
  useEffect(() => {
    if (!filling) return undefined;
    if (reduced) {
      setFilling(false);
      return undefined;
    }
    const timer = setTimeout(() => setFilling(false), fillAtStart.current);
    return () => clearTimeout(timer);
  }, [filling, reduced]);

  const loot = useMemo(() => lootRows(result?.loot ?? {}), [result]);
  const next = lesson ? nextLesson(app.lessons, lesson) : null;
  const band = profile?.ageBand ?? "miner";

  const act = (fn: () => void) => (): void => {
    if (armed.current) fn();
  };
  const again = act(() => {
    if (lesson) app.navigate({ id: "play", lesson: lesson.id }, { replace: true });
  });
  const goNext = act(() => {
    if (next) app.navigate({ id: "lessonIntro", lesson: next.id }, { replace: true });
  });
  const map = act(() => app.navigate({ id: "map" }, { replace: true }));

  useScreenInput(app, (i) => {
    if (i.kind === "control" && i.action === "confirm" && !focusOnControl()) {
      (next ? goNext : map)();
      return true;
    }
    return false;
  });

  if (result === null || lesson === null) {
    return (
      <div class={screen.screen}>
        <p class={styles.message}>{t("screens.results.none")}</p>
        <div class={`${screen.actions} ${styles.actions}`} ref={actions}>
          <Button variant="primary" onClick={() => app.navigate({ id: "map" }, { replace: true })}>
            {t("screens.results.map")}
          </Button>
          <div class={styles.toastDock} data-toast-dock aria-hidden="true" />
        </div>
      </div>
    );
  }

  const aim = aimLine(result.summary.accuracy, band);

  return (
    <div
      ref={page}
      class={`${screen.screen} ${styles.page}`}
      data-layout="stack"
      data-toast-hold={filling ? "stars" : undefined}
    >
      <h1 class={`${screen.title} ${styles.title}`}>{t("screens.results.title")}</h1>
      <div class={styles.card}>
        <div class={styles.stars}>
          <Stars
            value={stars}
            size="lg"
            animate={!reduced}
            label={t("screens.results.stars", { count: stars })}
          />
        </div>
        {best ? <p class={styles.best}>{t("screens.results.best")}</p> : null}
        <p class={styles.message}>{messageText(stars, band)}</p>
        {aim ? <p class={styles.aim}>{t(aim.key, { pct: aim.pct })}</p> : null}
        {/* Lines a mode adds, such as a night's "12 friends sent home" (M4-04). */}
        {resultLines(result.extra).map((line) => (
          <p key={line.key} class={styles.aim}>
            {t(line.key, line.params)}
          </p>
        ))}
        <section class={styles.loot} aria-labelledby="results-loot">
          <h2 id="results-loot" class={styles.lootHeading}>
            {t("screens.results.loot")}
          </h2>
          {loot.length === 0 ? (
            <p class={styles.aim}>{t("screens.results.noLoot")}</p>
          ) : (
            <ul class={styles.slots} data-animate={reduced ? undefined : "1"}>
              {loot.map(([id, count], i) => {
                const icon = blockIcon(id);
                return (
                  <li key={id} class={styles.slot} style={{ "--i": i + stars }}>
                    <Slot
                      label={t("screens.results.lootItem", { name: blockName(id), count })}
                      count={count}
                      icon={icon === "" ? undefined : <img src={icon} alt="" />}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
      <div class={`${screen.actions} ${styles.actions}`} ref={actions}>
        {next ? (
          <Button variant="primary" size="lg" onClick={goNext}>
            {t("screens.results.next")}
          </Button>
        ) : null}
        <Button variant={next ? "secondary" : "primary"} size="lg" onClick={again}>
          {t("screens.results.again")}
        </Button>
        <Button size="lg" onClick={map}>
          {t("screens.results.map")}
        </Button>
        {/* Badge toasts show here, under the buttons (M3-FIX-12). It takes no room of its own. */}
        <div class={styles.toastDock} data-toast-dock aria-hidden="true" />
      </div>
    </div>
  );
}
