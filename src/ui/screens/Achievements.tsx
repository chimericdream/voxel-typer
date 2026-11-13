/**
 * My Badges (task M3-10, PLAN.md §3.3): every badge, earned ones bright with "Got it!", the rest
 * soft with "Not yet". A surprise badge keeps its name to itself until it is earned. No dates,
 * no ranks, nothing about speed.
 *
 * Keys: the Back button has focus; Escape goes back (the shell's default). The list is a focusable
 * scroll area so a keyboard can scroll it.
 *
 * The list fills the room the screen has left and scrolls inside it. While badges are out of
 * sight below, its bottom edge fades and a "More badges below ↓" cue shows under it (M3-FIX-8:
 * a player read "16 of 24 badges" with 15 cards showing as a bug). Clicking the cue scrolls the
 * list down. Badges out of sight above fade the top edge.
 */
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ScreenProps } from "@/app/types";
import { achievements } from "@/content/achievements";
import type { AchievementDef } from "@/engine/achievements";
import { t } from "@/i18n";
import type { AgeBand } from "@/types/core";
import { BadgeIcon } from "@/ui/components/BadgeIcon";
import { Button } from "@/ui/kit/Button";
import { prefersReducedMotion } from "./nav";
import screen from "./screen.module.css";
import styles from "./Achievements.module.css";

/** What one badge card shows. */
export function badgeView(
  def: AchievementDef,
  earned: boolean,
  band: AgeBand,
): { name: string; desc: string; state: string } {
  const secret = def.hidden === true && !earned;
  return {
    name: t(secret ? "achievements.hiddenName" : def.nameKey),
    desc: secret ? t("achievements.hiddenDesc") : t(def.descKey, def.descParams?.(band)),
    state: t(earned ? "achievements.got" : "achievements.notYet"),
  };
}

/** What is out of sight in a scroll area. */
export interface Hidden {
  above: boolean;
  below: boolean;
}

/** Slack for subpixel scroll positions at zoom and text scale. */
const EDGE_PX = 2;

/** What a scroll area at these measurements hides. */
export function hiddenParts(scrollTop: number, clientHeight: number, scrollHeight: number): Hidden {
  return {
    above: scrollTop > EDGE_PX,
    below: scrollTop + clientHeight < scrollHeight - EDGE_PX,
  };
}

/** Watches a scroll area: on scroll, when it or its content changes size, and on resize. */
function useHidden(ref: RefObject<HTMLElement | null>): Hidden {
  const [hidden, setHidden] = useState<Hidden>({ above: false, below: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = (): void => {
      const next = hiddenParts(el.scrollTop, el.clientHeight, el.scrollHeight);
      setHidden((was) => (was.above === next.above && was.below === next.below ? was : next));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const view = el.ownerDocument.defaultView;
    view?.addEventListener("resize", measure);
    // Fonts arriving and text scale changes resize the cards, not the window.
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    sizes?.observe(el);
    if (el.firstElementChild) sizes?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", measure);
      view?.removeEventListener("resize", measure);
      sizes?.disconnect();
    };
  }, [ref]);
  return hidden;
}

export default function Achievements({ app }: ScreenProps) {
  const actions = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const hidden = useHidden(list);
  const profile = app.profile();
  const unlocked = profile?.achievements ?? {};
  const band = profile?.ageBand ?? "miner";
  const got = achievements.filter((a) => unlocked[a.id] !== undefined).length;

  useEffect(() => {
    actions.current?.querySelector("button")?.focus();
  }, []);

  // Most of a screenful down, so the last row seen stays in sight as the top row.
  const showMore = (): void => {
    const el = list.current;
    if (!el) return;
    const reduce = prefersReducedMotion(app.profile()?.settings.reducedMotion);
    el.scrollBy({ top: el.clientHeight * 0.8, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div class={`${screen.screen} ${styles.page}`}>
      <h1 class={screen.title}>{t("achievements.title")}</h1>
      <p class={screen.text}>{t("achievements.count", { got, total: achievements.length })}</p>
      <div class={styles.frame}>
        {/* A scroll area a keyboard can reach and scroll (axe: scrollable-region-focusable). */}
        <section
          ref={list}
          class={styles.scroll}
          aria-label={t("achievements.listLabel")}
          data-above={hidden.above ? "1" : undefined}
          data-below={hidden.below ? "1" : undefined}
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- reason: a scroll area must take focus to scroll by keyboard
          tabIndex={0}
        >
          <ul class={styles.grid}>
            {achievements.map((def) => {
              const earned = unlocked[def.id] !== undefined;
              const view = badgeView(def, earned, band);
              return (
                <li
                  key={def.id}
                  class={styles.card}
                  data-earned={earned ? "1" : undefined}
                  data-badge={def.id}
                >
                  <BadgeIcon
                    icon={def.hidden === true && !earned ? { cosmetic: "" } : def.icon}
                    dim={!earned}
                  />
                  <span class={styles.words}>
                    <span class={styles.name}>{view.name}</span>
                    <span class={styles.desc}>{view.desc}</span>
                    <span class={styles.state}>{view.state}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      {/*
        Shown while badges are hidden below. Space is kept for it once the list scrolls at all, so
        the list doesn't jump at its end. Keyboard users scroll the list itself (it is in the Tab
        order), so the cue stays out of the Tab order; a pointer or a screen reader can press it.
      */}
      {hidden.above || hidden.below ? (
        <button
          type="button"
          class={styles.more}
          data-testid="badges-more"
          data-show={hidden.below ? "1" : undefined}
          tabIndex={-1}
          onClick={showMore}
        >
          {t("achievements.moreBelow")}
          <span class={styles.arrow} aria-hidden="true" />
        </button>
      ) : null}
      <div class={screen.actions} ref={actions}>
        <Button variant="primary" onClick={() => app.back()}>
          {t("achievements.back")}
        </Button>
      </div>
    </div>
  );
}
