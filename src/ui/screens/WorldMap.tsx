/**
 * World map (task M3-04, PLAN.md §3.1, §5.3): nine floating islands, one per biome, and each
 * island's lesson path.
 *
 * The islands are drawn in the app's one shared 3D scene (`src/render/map/`); everything a child
 * reads or presses is DOM on top of it: one button per island, placed under the island on screen,
 * and the lesson path (`BiomePath`). So the map is fully usable from the keyboard and by a screen
 * reader, and when there is no 3D (no WebGL, tests, lite mode later) the same buttons are simply
 * laid out flat.
 *
 * Keyboard: the arrow keys (or Tab) move between the open islands, Enter goes in, the arrows then
 * move along the lesson path, Enter plays, and Escape comes back out.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { AppApi, ScreenProps } from "@/app/types";
import type { Lesson } from "@/content/lessons/types";
import { t } from "@/i18n";
import type { WorldMapView } from "@/render/map/view";
import type { Profile } from "@/save/schema";
import type { BiomeId } from "@/types/core";
import { Button } from "@/ui/kit/Button";
import { Panel } from "@/ui/kit/Panel";
import { BiomePath, MiniStars } from "./BiomePath";
import { islandInfos, islandLabel, lessonNodes, practiceCamp, startIsland } from "./map-logic";
import type { IslandInfo } from "./map-logic";
import { arrowStep, focusOnControl, moveFocus, prefersReducedMotion, useScreenInput } from "./nav";
import screen from "./screen.module.css";
import styles from "./WorldMap.module.css";

/**
 * The island whose path the player left to play a lesson. The next visit to the map opens on it
 * once, so "back to the map" lands where they were, with the new stars in view.
 */
let returnTo: { profileId: string; biome: BiomeId; unlocked: number } | null = null;

/** Forgets where the player was (tests). */
export function resetMapMemory(): void {
  returnTo = null;
}

function takeReturn(profile: Profile): BiomeId | null {
  const was = returnTo;
  returnTo = null;
  if (was === null || was.profileId !== profile.id) return null;
  // A new island just opened: show the whole map, so the player sees it come out of the clouds.
  if (was.unlocked !== profile.progress.unlockedBiomes.length) return null;
  return profile.progress.unlockedBiomes.includes(was.biome) ? was.biome : null;
}

type Mode = "loading" | "3d" | "flat";

function NoPlayer({ app }: { app: AppApi }) {
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    actions.current?.querySelector("button")?.focus();
  }, []);
  return (
    <div class={screen.screen}>
      <Panel heading={t("map.title")}>
        <p class={screen.text}>{t("map.noPlayer.body")}</p>
        <div class={screen.actions} ref={actions}>
          <Button variant="primary" size="lg" onClick={() => app.navigate({ id: "profiles" })}>
            {t("map.noPlayer.go")}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function IslandButton({
  info,
  onEnter,
  onSelect,
}: {
  info: IslandInfo;
  onEnter: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      class={styles.island}
      data-nav={info.unlocked ? "" : undefined}
      data-locked={info.unlocked ? undefined : "1"}
      data-next={info.unlocked && info.next ? "1" : undefined}
      aria-disabled={info.unlocked ? undefined : "true"}
      tabIndex={info.unlocked ? 0 : -1}
      onClick={() => {
        if (info.unlocked) onEnter();
      }}
      onFocus={onSelect}
      onKeyDown={(e) => {
        // A held Enter repeats; only the first press goes in (PLAN §4.6).
        if (e.repeat && e.key === "Enter") e.preventDefault();
      }}
    >
      {/* The button's name is the hidden sentence; what shows is the short form of it. */}
      <span class={styles.srOnly} data-label="">
        {islandLabel(info)}
      </span>
      {info.unlocked && info.next ? (
        <span class={styles.nextTag} aria-hidden="true">
          {t("map.island.next")}
        </span>
      ) : null}
      <span class={styles.islandName} aria-hidden="true">
        {info.name}
      </span>
      {info.unlocked ? (
        <span class={styles.islandMeta} aria-hidden="true">
          {info.total === 0 ? (
            t("map.island.soon")
          ) : (
            <>
              <span class={styles.islandStars}>
                <MiniStars value={info.stars > 0 ? 1 : 0} count={1} />
                {info.stars}
              </span>
              <span>{t("map.island.count", { done: info.done, total: info.total })}</span>
            </>
          )}
        </span>
      ) : null}
    </button>
  );
}

function MapScreen({ app, profile }: { app: AppApi; profile: Profile }) {
  const infos = useMemo(() => islandInfos(profile, app.lessons), [profile, app.lessons]);
  const [open, setOpen] = useState<BiomeId | null>(() => takeReturn(profile));
  const [mode, setMode] = useState<Mode>("loading");
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const view = useRef<WorldMapView | null>(null);
  const selectedRef = useRef<BiomeId | null>(open ?? startIsland(infos));
  const openAtStart = useRef(open);
  const path = useRef<HTMLDivElement>(null);

  // The 3D islands. Without a scene (no WebGL, or in tests) the buttons are laid out flat.
  useEffect(() => {
    let live = true;
    let made: WorldMapView | null = null;
    const place = (): void => {
      const ul = list.current;
      if (made === null || ul === null) return;
      for (const [biome, at] of made.anchors()) {
        const spot = ul.querySelector<HTMLElement>(`[data-spot="${biome}"]`);
        if (!spot) continue;
        spot.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
        spot.dataset["placed"] = "1";
      }
    };
    const loading = Promise.all([app.scene(), import("@/render/map/view")])
      .then(([scene, map]) => {
        const three = scene.three;
        if (!live) return;
        if (three === null) {
          setMode("flat");
          return;
        }
        const canvas = three.renderer.domElement;
        made = map.createWorldMapView(
          {
            three,
            camera: scene.camera,
            lights: scene.lights,
            setEnvironment: (env) => scene.setEnvironment(env),
            requestRender: () => scene.requestRender(),
            onFrame: (fn) => scene.onFrame(fn),
          },
          {
            unlocked: new Set(profile.progress.unlockedBiomes),
            viewport: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
            reducedMotion: () => prefersReducedMotion(profile.settings.reducedMotion),
            start: openAtStart.current,
          },
        );
        view.current = made;
        made.onMove(place);
        made.select(selectedRef.current);
        setMode("3d");
      })
      .catch(() => {
        if (live) setMode("flat");
      });
    app.whenReady(loading);
    const onResize = (): void => made?.refresh();
    window.addEventListener("resize", onResize);
    return () => {
      live = false;
      window.removeEventListener("resize", onResize);
      view.current = null;
      made?.dispose();
    };
    // Built once per visit: the screen remounts on every route change, with the profile as it
    // is then.
  }, [app, profile]);

  const focusIsland = (biome: BiomeId | null): void => {
    const el = list.current;
    const target =
      (biome === null
        ? null
        : el?.querySelector<HTMLElement>(`[data-spot="${biome}"] button[data-nav]`)) ??
      el?.querySelector<HTMLElement>("button[data-nav]") ??
      root.current?.querySelector<HTMLElement>("[data-nav] button");
    target?.focus();
  };

  // Focus: on the picked island once the islands show, and again after leaving a path.
  useEffect(() => {
    if (mode !== "loading" && open === null) focusIsland(selectedRef.current);
  }, [mode, open]);

  const select = (biome: BiomeId): void => {
    selectedRef.current = biome;
    view.current?.select(biome);
  };

  const enter = (biome: BiomeId): void => {
    select(biome);
    setOpen(biome);
    view.current?.show(biome);
    app.audio.sfx("whoosh");
  };

  const leave = (): void => {
    setOpen(null);
    view.current?.show(null);
    app.audio.sfx("whoosh");
  };

  const pick = (lesson: Lesson): void => {
    returnTo = {
      profileId: profile.id,
      biome: lesson.biome,
      unlocked: profile.progress.unlockedBiomes.length,
    };
    app.navigate({ id: "lessonIntro", lesson: lesson.id });
  };

  useScreenInput(app, (i) => {
    if (i.kind !== "control") return false;
    if (i.action === "back") {
      // Out of a path first; from the whole map, back to "Who is playing?". The app's own history
      // would lead to the lesson just played, which is not where a child expects Escape to go.
      if (open !== null) leave();
      else app.navigate({ id: "profiles" });
      return true;
    }
    // The islands' buttons stay in the page (hidden) while a path is open, so move within the
    // part that shows.
    const within = open === null ? root.current : path.current;
    const step = arrowStep(i.action);
    if (step !== null) return moveFocus(within, step);
    // Enter on a button is the browser's click; with nothing focused it finds the first control.
    if (i.action === "confirm" && !focusOnControl()) return moveFocus(within, 1);
    return false;
  });

  const openInfo = open === null ? null : (infos.find((i) => i.biome === open) ?? null);

  return (
    <div class={styles.map} ref={root} data-mode={mode} data-open={open ?? undefined}>
      <header class={styles.top}>
        <h1 class={styles.title}>{t("map.title")}</h1>
        {open === null ? <p class={styles.hint}>{t("map.hint")}</p> : null}
      </header>
      <ul
        class={styles.islands}
        ref={list}
        aria-label={t("map.island.list")}
        hidden={open !== null}
      >
        {infos.map((info) => (
          <li key={info.biome} class={styles.spot} data-spot={info.biome}>
            <IslandButton
              info={info}
              onEnter={() => enter(info.biome)}
              onSelect={() => select(info.biome)}
            />
          </li>
        ))}
      </ul>
      {openInfo === null ? (
        <div class={styles.corner}>
          <span data-nav="">
            <Button onClick={() => app.navigate({ id: "profiles" })}>{t("map.players")}</Button>
          </span>
        </div>
      ) : (
        <div class={styles.pathWrap} ref={path}>
          <BiomePath
            key={openInfo.biome}
            info={openInfo}
            nodes={lessonNodes(profile, app.lessons, openInfo.biome)}
            camp={practiceCamp(profile, openInfo.biome)}
            onPick={pick}
            onBack={leave}
          />
        </div>
      )}
    </div>
  );
}

export default function WorldMap({ app }: ScreenProps) {
  const profile = app.profile();
  if (profile === null) return <NoPlayer app={app} />;
  return <MapScreen app={app} profile={profile} />;
}
