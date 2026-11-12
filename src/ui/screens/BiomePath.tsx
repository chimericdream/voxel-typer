/**
 * An island's lesson path (task M3-04): one stepping stone per lesson, in order, drawn in DOM over
 * the island the camera has moved close to.
 *
 * Each stone is a button showing the lesson's number and its 0–3 stars. The recommended lesson
 * pulses and wears a "Next" tag, so it stands out without motion or color too. A lesson that
 * isn't open yet is hatched, says what to finish first, and is skipped by the arrow keys.
 *
 * Keyboard: the arrow keys move along the open stones (the world map's key handler does that
 * through `[data-nav]`), Enter plays, Escape goes back to the map.
 */
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { Lesson } from "@/content/lessons/types";
import { t } from "@/i18n";
import { Button } from "@/ui/kit/Button";
import type { IslandInfo, LessonNode, PracticeCamp } from "./map-logic";
import { nodeLabel } from "./map-logic";
import styles from "./WorldMap.module.css";

export interface BiomePathProps {
  info: IslandInfo;
  nodes: readonly LessonNode[];
  /** A remedial practice camp to show before the stones (M3-06), or null. */
  camp: PracticeCamp | null;
  onPick: (lesson: Lesson) => void;
  onBack: () => void;
}

/** A small blocky star, in art pixels. Original shape, drawn for this game. */
const STAR = ["...#...", "..###..", "#######", ".#####.", ".#####.", ".##.##.", "##...##"] as const;
const STAR_PATH = STAR.map((row, y) =>
  Array.from(row, (c, x) => (c === "#" ? `M${x} ${y}h1v1h-1z` : "")).join(""),
).join("");

/**
 * Small stars, `value` of `count` filled. Decoration: the words beside it or the button's name
 * say the number.
 */
export function MiniStars({ value, count = 3 }: { value: number; count?: number }) {
  return (
    <span class={styles.miniStars} aria-hidden="true" data-value={value}>
      {Array.from({ length: count }, (_, i) => (
        <svg
          key={i}
          class={styles.miniStar}
          viewBox="-1 -1 9 9"
          shape-rendering="crispEdges"
          data-earned={i < value ? "1" : undefined}
        >
          <path d={STAR_PATH} />
        </svg>
      ))}
    </span>
  );
}

/** A small tent, for the practice camp. Original shape. */
const TENT = ["....#....", "...###...", "..##.##..", ".##...##.", "###...###"] as const;
const TENT_PATH = TENT.map((row, y) =>
  Array.from(row, (c, x) => (c === "#" ? `M${x} ${y}h1v1h-1z` : "")).join(""),
).join("");

const ignoreHeldEnter = (e: KeyboardEvent): void => {
  // A held Enter repeats; only the first press acts (PLAN §4.6).
  if (e.repeat && e.key === "Enter") e.preventDefault();
};

export function BiomePath({ info, nodes, camp, onPick, onBack }: BiomePathProps) {
  const headingId = useId();
  const root = useRef<HTMLElement>(null);
  const start = nodes.find((n) => n.next) ?? nodes.find((n) => n.open && !n.played) ?? null;
  const [shown, setShown] = useState<LessonNode | null>(start);

  useEffect(() => {
    const el = root.current;
    const first =
      el?.querySelector<HTMLElement>("[data-start]") ??
      el?.querySelector<HTMLElement>("button[data-nav]") ??
      el?.querySelector<HTMLElement>("[data-nav] button");
    first?.focus();
  }, []);

  return (
    <section class={styles.path} ref={root} aria-labelledby={headingId} data-biome={info.biome}>
      <h2 id={headingId} class={styles.pathTitle}>
        {info.name}
      </h2>
      {nodes.length === 0 ? (
        <p class={styles.pathText}>{t("map.path.empty")}</p>
      ) : (
        <>
          <p class={styles.pathProgress}>
            <span>{t("map.path.progress", { done: info.done, total: info.total })}</span>
            <span class={styles.pathStars}>
              <MiniStars value={info.stars > 0 ? 1 : 0} count={1} />
              {t("map.path.stars", { stars: info.stars })}
            </span>
          </p>
          <ol class={styles.trail} aria-label={t("map.path.list")}>
            {camp ? (
              <li class={styles.step}>
                <button
                  type="button"
                  class={styles.node}
                  data-state="camp"
                  data-nav=""
                  aria-label={camp.label}
                  onClick={() => camp.open()}
                  onKeyDown={ignoreHeldEnter}
                >
                  <svg
                    class={styles.tent}
                    viewBox="0 0 9 5"
                    shape-rendering="crispEdges"
                    aria-hidden="true"
                  >
                    <path d={TENT_PATH} />
                  </svg>
                </button>
              </li>
            ) : null}
            {nodes.map((node) => {
              const state = !node.open
                ? "locked"
                : node.next
                  ? "next"
                  : node.played
                    ? "done"
                    : "new";
              return (
                <li key={node.lesson.id} class={styles.step}>
                  <button
                    type="button"
                    class={styles.node}
                    data-state={state}
                    data-lesson={node.lesson.id}
                    data-nav={node.open ? "" : undefined}
                    data-start={node === start ? "" : undefined}
                    aria-disabled={node.open ? undefined : "true"}
                    tabIndex={node.open ? 0 : -1}
                    onClick={() => {
                      if (node.open) onPick(node.lesson);
                    }}
                    onFocus={() => setShown(node)}
                    onMouseEnter={() => setShown(node)}
                    onKeyDown={ignoreHeldEnter}
                  >
                    {/* The button's name is the hidden sentence; what shows is decoration. */}
                    <span class={styles.srOnly} data-label="">
                      {nodeLabel(node)}
                    </span>
                    {node.next ? (
                      <span class={styles.nextTag} aria-hidden="true">
                        {t("map.path.next")}
                      </span>
                    ) : null}
                    <span class={styles.nodeNumber} aria-hidden="true">
                      {node.n}
                    </span>
                    <MiniStars value={node.stars} />
                  </button>
                </li>
              );
            })}
          </ol>
          {/* The focused stone's title, for sighted readers; its label already says it. */}
          <p class={styles.pathShown} aria-hidden="true">
            {shown ? (
              <>
                <span class={styles.pathShownTitle}>{shown.title}</span>
                {shown.played ? (
                  <span>{t("map.path.nodeStars", { stars: shown.stars })}</span>
                ) : null}
              </>
            ) : (
              t("map.path.hint")
            )}
          </p>
        </>
      )}
      <div class={styles.pathActions}>
        <span data-nav="">
          <Button onClick={onBack}>{t("map.path.back")}</Button>
        </span>
      </div>
    </section>
  );
}
