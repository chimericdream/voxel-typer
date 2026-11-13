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
 *
 * Pointer: a click or tap anywhere on an island's model does what its label does (M3-FIX-4, owner
 * playtest: a child kept clicking the island itself). The 3D view finds the island under the
 * pointer (`pick`); the island under a mouse is drawn a little brighter and its label lights up.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { AppApi, ScreenProps } from "@/app/types";
import type { Lesson } from "@/content/lessons/types";
import { t } from "@/i18n";
import type { WorldMapView } from "@/render/map/view";
import type { Profile } from "@/save/schema";
import type { BiomeId } from "@/types/core";
import { NEXT_ANNOUNCE_MS } from "@/ui/kit/announce";
import { Button } from "@/ui/kit/Button";
import { Panel } from "@/ui/kit/Panel";
import { BiomePath, MiniStars } from "./BiomePath";
import {
  LABEL_LAYOUT,
  islandInfos,
  islandLabel,
  layoutLabels,
  lessonNodes,
  notYetLine,
  practiceCamp,
  startIsland,
} from "./map-logic";
import type { IslandInfo, KeepOut, LabelBox } from "./map-logic";
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

/** Test builds mark each island's middle on screen, so the e2e can click the model itself. */
const MARK_CENTERS = import.meta.env.MODE !== "production";

/** How long the "not yet" line stays after clicking an island in the clouds. */
const NOTE_MS = 4000;

/** A short sideways shake, like a gentle "not yet". Skipped under reduced motion. */
const WOBBLE: Keyframe[] = [
  { translate: "0 0" },
  { translate: "-5px 0" },
  { translate: "5px 0" },
  { translate: "-3px 0" },
  { translate: "0 0" },
];
const WOBBLE_MS = 380;

/** `el`'s box in the pixels of `within` (a rect from `getBoundingClientRect`). */
function boxIn(el: Element, within: DOMRect): KeepOut {
  const r = el.getBoundingClientRect();
  return {
    left: r.left - within.left,
    top: r.top - within.top,
    right: r.right - within.left,
    bottom: r.bottom - within.top,
  };
}

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
  hovered,
  onEnter,
  onSelect,
  onLocked,
}: {
  info: IslandInfo;
  /** The pointer is over this island's model: the label lights up as if hovered. */
  hovered: boolean;
  onEnter: () => void;
  onSelect: () => void;
  /** A click on an island that is still in the clouds. */
  onLocked: (button: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      class={styles.island}
      data-nav={info.unlocked ? "" : undefined}
      data-locked={info.unlocked ? undefined : "1"}
      data-next={info.unlocked && info.next ? "1" : undefined}
      data-hover={hovered ? "1" : undefined}
      aria-disabled={info.unlocked ? undefined : "true"}
      tabIndex={info.unlocked ? 0 : -1}
      onClick={(e) => {
        if (info.unlocked) onEnter();
        else onLocked(e.currentTarget);
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
        <span class={styles.nextTag} aria-hidden="true" data-tag="">
          {t("map.island.next")}
        </span>
      ) : null}
      <span class={styles.islandName} aria-hidden="true">
        {info.unlocked ? null : <CloudIcon />}
        {info.name}
      </span>
      {info.unlocked ? (
        <span class={styles.islandMeta} aria-hidden="true">
          {info.total === 0 ? (
            t("map.island.soon")
          ) : (
            <>
              {/* Words first ("0 of 6 done"); the star count shows only once there are stars. */}
              <span>{t("map.island.count", { done: info.done, total: info.total })}</span>
              {info.stars > 0 ? (
                <span class={styles.islandStars}>
                  <MiniStars value={1} count={1} />
                  {info.stars}
                </span>
              ) : null}
            </>
          )}
        </span>
      ) : null}
    </button>
  );
}

/** Corner pictures, as blocks on a 16×16 grid: `[x, y, width, height]`. */
const CORNER_ICONS = {
  // Two players.
  players: [
    [3, 2, 4, 4],
    [2, 7, 6, 7],
    [10, 4, 3, 3],
    [9, 8, 5, 6],
  ],
  // A star.
  badges: [
    [7, 1, 2, 3],
    [2, 4, 12, 3],
    [4, 7, 8, 3],
    [3, 10, 4, 4],
    [9, 10, 4, 4],
  ],
  // A floating island with a tree.
  island: [
    [6, 1, 6, 4],
    [8, 5, 2, 3],
    [1, 8, 14, 3],
    [3, 11, 10, 2],
    [5, 13, 6, 2],
  ],
  // Two sliders, each with its knob.
  settings: [
    [1, 3, 14, 2],
    [4, 1, 3, 6],
    [1, 11, 14, 2],
    [9, 9, 3, 6],
  ],
} as const;

/** The width at or under which the corner buttons show pictures (`WorldMap.module.css`). */
const NARROW = "(max-width: 1100px)";

const isNarrow = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(NARROW).matches;

/** How long a finger rests on a corner button before its words show instead (narrow layout). */
export const LONG_PRESS_MS = 500;

/**
 * A corner button. In a wide window it shows its words. In a narrow one (1100 px or less) the four
 * buttons would wrap onto a second row at large text and crowd the island labels, so there each
 * shows its picture and keeps its words for screen readers and as a tip. The text size setting is
 * never overridden: the picture grows with it.
 *
 * The tip opens on mouse hover and on keyboard focus (CSS). On touch, one tap always does what the
 * button says, the same as a click, a key or a screen reader's double tap (M3-FIX-4: two taps
 * confused children, and VoiceOver's double tap only opened the tip). A finger that rests on the
 * button for {@link LONG_PRESS_MS} shows the words instead, and lifting it then does nothing, so a
 * child can find out what a picture means without going there. A tap anywhere else closes the
 * tip. A touch that turns into a scroll (`pointercancel`) leaves nothing behind (M3-FIX-4 (b)).
 */
function CornerButton({
  icon,
  label,
  onClick,
}: {
  icon: keyof typeof CORNER_ICONS;
  label: string;
  onClick: () => void;
}) {
  const [tip, setTip] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  /** The long-press timer while a finger rests on the button. */
  const pressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A long press just showed the tip: the click its finger makes on lifting is not a tap. */
  const heldRef = useRef(false);
  const stopPress = (): void => {
    if (pressRef.current !== null) clearTimeout(pressRef.current);
    pressRef.current = null;
  };
  useEffect(() => stopPress, []);
  useEffect(() => {
    if (!tip) return undefined;
    const close = (e: Event): void => {
      if (!(e.target instanceof Node) || wrapRef.current?.contains(e.target) !== true)
        setTip(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [tip]);
  return (
    <span
      data-nav=""
      ref={wrapRef}
      data-tip={tip ? "open" : undefined}
      onPointerDown={(e) => {
        heldRef.current = false;
        stopPress();
        if (e.pointerType !== "touch" || !isNarrow()) return;
        pressRef.current = setTimeout(() => {
          pressRef.current = null;
          heldRef.current = true;
          setTip(true);
        }, LONG_PRESS_MS);
      }}
      onPointerUp={stopPress}
      onPointerLeave={stopPress}
      onPointerCancel={() => {
        // A scroll, or the system took the touch: no tap, no tip, and no flag left set.
        stopPress();
        heldRef.current = false;
      }}
      onContextMenu={(e) => {
        // A long press opens the words, not the browser's menu.
        if (heldRef.current || pressRef.current !== null) e.preventDefault();
      }}
      onClickCapture={(e) => {
        const held = heldRef.current;
        heldRef.current = false;
        // Only the click from the finger that held is swallowed; a key's click has no detail.
        if (!held || e.detail === 0) return;
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <Button onClick={onClick}>
        <svg class={styles.cornerIcon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          {CORNER_ICONS[icon].map(([x, y, w, h]) => (
            <rect key={`${x},${y}`} x={x} y={y} width={w} height={h} />
          ))}
        </svg>
        <span class={styles.cornerText}>{label}</span>
      </Button>
    </span>
  );
}

/** A small blocky cloud, on the label of an island that is still in the clouds. */
function CloudIcon() {
  return (
    <svg class={styles.cloud} viewBox="0 0 12 8" aria-hidden="true" focusable="false">
      <path d="M3 2h2V1h3v1h1v1h1v1h1v3H1V5h1V3h1z" />
    </svg>
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
  // Read when the 3D view is (re)built, so a rebuild starts where the player is now.
  const openRef = useRef(open);
  const profileRef = useRef(profile);
  useLayoutEffect(() => {
    openRef.current = open;
    profileRef.current = profile;
  });
  const path = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLElement>(null);
  const corner = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<string | null>(null);
  /** The island under the pointer, while it is over an open island's model. */
  const [hovered, setHovered] = useState<BiomeId | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The 3D view uses only these from the profile. A new profile object for the same player with
  // the same open islands (a settings save, say) must not rebuild it.
  const unlockedKey = profile.progress.unlockedBiomes.toSorted().join(",");

  // The 3D islands. Without a scene (no WebGL, or in tests) the buttons are laid out flat.
  useEffect(() => {
    let live = true;
    let made: WorldMapView | null = null;
    // Each label hangs under its island, then is nudged so they all stay inside the window and
    // clear of each other and of the heading (`layoutLabels`).
    const place = (): void => {
      const ul = list.current;
      if (made === null || ul === null || ul.hidden) return;
      const width = ul.clientWidth;
      const height = ul.clientHeight;
      if (width === 0 || height === 0) return;
      const { margin, gap } = LABEL_LAYOUT;
      // Three labels side by side always fit: a long name wraps instead.
      ul.style.setProperty("--label-max", `${Math.floor((width - 2 * margin - 2 * gap) / 3)}px`);
      const spots: HTMLElement[] = [];
      const boxes: LabelBox[] = [];
      for (const [biome, at] of made.anchors()) {
        const spot = ul.querySelector<HTMLElement>(`[data-spot="${biome}"]`);
        const button = spot?.querySelector<HTMLElement>("button");
        if (!spot || !button) continue;
        const tag = button.querySelector<HTMLElement>("[data-tag]");
        spots.push(spot);
        boxes.push({
          x: at.x,
          y: at.y,
          w: button.offsetWidth,
          h: button.offsetHeight,
          above: tag ? Math.max(0, -tag.offsetTop) : 0,
        });
      }
      const frame = ul.getBoundingClientRect();
      const keepOut = [top.current, corner.current].flatMap((el) =>
        el === null ? [] : [boxIn(el, frame)],
      );
      layoutLabels(boxes, { width, height }, keepOut).forEach((at, i) => {
        const spot = spots[i];
        if (!spot) return;
        spot.style.transform = `translate(${at.left}px, ${at.top}px)`;
        spot.dataset["placed"] = "1";
      });
      if (MARK_CENTERS) {
        const canvas = canvasRef.current?.getBoundingClientRect();
        for (const [biome, at] of made.centers()) {
          const spot = ul.querySelector<HTMLElement>(`[data-spot="${biome}"]`);
          if (spot && canvas) {
            spot.dataset["center"] =
              `${Math.round(canvas.left + at.x)},${Math.round(canvas.top + at.y)}`;
          }
        }
      }
    };
    // Labels change size when the fonts arrive or the text size changes: place them again.
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(() => place()) : null;
    const loading = Promise.all([app.scene(), import("@/render/map/view")])
      .then(([scene, map]) => {
        const three = scene.three;
        if (!live) return;
        if (three === null) {
          setMode("flat");
          return;
        }
        const canvas = three.renderer.domElement;
        canvasRef.current = canvas;
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
            unlocked: new Set(profileRef.current.progress.unlockedBiomes),
            viewport: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
            reducedMotion: () => prefersReducedMotion(profileRef.current.settings.reducedMotion),
            start: openRef.current,
          },
        );
        view.current = made;
        made.onMove(place);
        made.select(selectedRef.current);
        setMode("3d");
        if (sizes !== null) {
          for (const el of list.current?.querySelectorAll("button") ?? []) sizes.observe(el);
          if (top.current) sizes.observe(top.current);
        }
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
      sizes?.disconnect();
      view.current = null;
      canvasRef.current = null;
      made?.dispose();
    };
    // Built once per visit (the screen remounts on every route change), and again only when the
    // player or their open islands change.
  }, [app, profile.id, unlockedKey]);

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

  // The same line again (a second click on the same island) is taken away and put back a moment
  // later, so its timer starts over and a screen reader hears it again (M3-FIX-1 review N4).
  const againRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (againRef.current !== null) clearTimeout(againRef.current);
    },
    [],
  );

  // A click on an island still in the clouds: a little shake and a kind line, never "locked".
  const nudge = (info: IslandInfo, button: HTMLElement): void => {
    const line = notYetLine(info);
    if (againRef.current !== null) clearTimeout(againRef.current);
    againRef.current = null;
    if (note === line) {
      setNote(null);
      againRef.current = setTimeout(() => {
        againRef.current = null;
        setNote(line);
      }, NEXT_ANNOUNCE_MS);
    } else {
      setNote(line);
    }
    app.audio.sfx("pop", { gain: 0.5 });
    const still = prefersReducedMotion(profile.settings.reducedMotion);
    if (!still && typeof button.animate === "function") {
      button.animate(WOBBLE, { duration: WOBBLE_MS, easing: "ease-in-out" });
    }
  };

  useEffect(() => {
    const id = note === null ? null : setTimeout(() => setNote(null), NOTE_MS);
    return () => {
      if (id !== null) clearTimeout(id);
    };
  }, [note]);

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
    // Any key clears the "not yet" line, typed letters too (M3-FIX-1 review N3).
    setNote(null);
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

  // The heading's plates stop short of the corner buttons (`--corner-w` in the CSS), so at 1024 px
  // the hint wraps under the title instead of covering Change player (M4-FIX-1).
  const cornerShown = openInfo === null;
  useLayoutEffect(() => {
    const el = corner.current;
    const host = root.current;
    if (!cornerShown || el === null || host === null) return undefined;
    const set = (): void => host.style.setProperty("--corner-w", `${el.offsetWidth}px`);
    set();
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(set) : null;
    sizes?.observe(el);
    return () => {
      sizes?.disconnect();
      host.style.removeProperty("--corner-w");
    };
  }, [cornerShown]);

  // Clicks and taps on the islands' models (M3-FIX-4). Only on the whole map, and only where the
  // pointer is on the 3D picture itself: a label, the heading or a corner button handles its own.
  const picking = mode === "3d" && open === null;
  const islandAt = (e: {
    clientX: number;
    clientY: number;
    target: EventTarget | null;
  }): IslandInfo | null => {
    const canvas = canvasRef.current;
    const made = view.current;
    if (!picking || canvas === null || made === null) return null;
    if (
      e.target instanceof Element &&
      e.target.closest("button, a, input, header, [data-nav]") !== null
    ) {
      return null;
    }
    const r = canvas.getBoundingClientRect();
    const biome = made.pick({ x: e.clientX - r.left, y: e.clientY - r.top });
    return biome === null ? null : (infos.find((i) => i.biome === biome) ?? null);
  };
  /** Lights up the open island under the mouse (never a locked one), or none. */
  const hoverOn = (info: IslandInfo | null): void => {
    const biome = info?.unlocked === true ? info.biome : null;
    view.current?.hover(biome);
    setHovered(biome);
  };
  // One pick per frame at most while the mouse moves; nothing runs while it rests.
  const moveFrameRef = useRef<number | null>(null);
  const lastMoveRef = useRef<{
    clientX: number;
    clientY: number;
    target: EventTarget | null;
  } | null>(null);
  useEffect(
    () => () => {
      if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current);
    },
    [],
  );
  useEffect(() => {
    if (picking) return;
    view.current?.hover(null);
    setHovered(null);
  }, [picking]);
  const onPointerMove = (e: PointerEvent): void => {
    if (!picking || e.pointerType !== "mouse") return;
    lastMoveRef.current = { clientX: e.clientX, clientY: e.clientY, target: e.target };
    if (moveFrameRef.current !== null) return;
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null;
      const at = lastMoveRef.current;
      if (at !== null) hoverOn(islandAt(at));
    });
  };
  const onMapClick = (e: MouseEvent): void => {
    const info = islandAt(e);
    if (info === null) return;
    if (info.unlocked) {
      enter(info.biome);
      return;
    }
    const button = list.current?.querySelector<HTMLElement>(`[data-spot="${info.biome}"] button`);
    if (button) nudge(info, button);
  };

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- reason: a click on an island's picture is a pointer shortcut; each island's label is the button for keys and screen readers
    <div
      class={styles.map}
      ref={root}
      data-mode={mode}
      data-open={open ?? undefined}
      data-pointing={hovered === null ? undefined : "island"}
      onPointerMove={onPointerMove}
      onPointerLeave={() => hoverOn(null)}
      onClick={onMapClick}
    >
      <header class={styles.top} ref={top}>
        <h1 class={styles.title}>{t("map.title")}</h1>
        {open === null ? <p class={styles.hint}>{t("map.hint")}</p> : null}
        {/* Always in the page, so a screen reader hears the line when it appears. */}
        <output class={styles.note} data-note="">
          {open === null ? note : null}
        </output>
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
              hovered={hovered === info.biome}
              onEnter={() => enter(info.biome)}
              onSelect={() => select(info.biome)}
              onLocked={(button) => nudge(info, button)}
            />
          </li>
        ))}
      </ul>
      {openInfo === null ? (
        <div class={styles.corner} ref={corner}>
          <CornerButton
            icon="players"
            label={t("map.players")}
            onClick={() => app.navigate({ id: "profiles" })}
          />
          <CornerButton
            icon="badges"
            label={t("achievements.title")}
            onClick={() => app.navigate({ id: "achievements" })}
          />
          <CornerButton
            icon="island"
            label={t("builder.title")}
            onClick={() => app.navigate({ id: "island" })}
          />
          <CornerButton
            icon="settings"
            label={t("settings.title")}
            onClick={() => app.navigate({ id: "settings" })}
          />
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
