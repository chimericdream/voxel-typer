/**
 * Coming soon (task M2-11): the friendly panel for every route that has no screen yet, and for a
 * lesson whose mode doesn't exist yet. The app shell shows it (`App.tsx`).
 */
import { useEffect, useRef } from "preact/hooks";
import type { Lesson } from "@/content/lessons/types";
import { t } from "@/i18n";
import type { Profile } from "@/save/schema";
import { BIOME_ORDER } from "@/types/core";
import { Button } from "@/ui/kit/Button";
import { Panel } from "@/ui/kit/Panel";
import screen from "./screen.module.css";

/**
 * The lesson to offer while the world map is still coming (M3-04): the first lesson in an
 * unlocked biome that hasn't been played, else the last lesson of those biomes. Null without
 * lessons.
 */
export function nextLessonFor(profile: Profile, lessons: readonly Lesson[]): Lesson | null {
  const open = new Set(profile.progress.unlockedBiomes);
  const ordered = lessons
    .filter((l) => open.has(l.biome))
    .toSorted(
      (a, b) => BIOME_ORDER.indexOf(a.biome) - BIOME_ORDER.indexOf(b.biome) || a.order - b.order,
    );
  return (
    ordered.find((l) => profile.progress.lessons[l.id] === undefined) ?? ordered.at(-1) ?? null
  );
}

export interface ComingSoonProps {
  /** Shown when there is somewhere to go back to. */
  onBack: (() => void) | null;
  /** Shown when the map is a sensible place to go (not on the map itself). */
  onMap: (() => void) | null;
  /** Back to the splash screen, when there is nowhere else to go. */
  onStart?: (() => void) | null;
  /** On the map route: the next lesson to play, since the map itself isn't built yet. */
  next?: { lesson: Lesson; go: () => void } | null;
}

export function ComingSoon({ onBack, onMap, onStart = null, next = null }: ComingSoonProps) {
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    actions.current?.querySelector("button")?.focus();
  }, []);
  return (
    <div class={screen.screen}>
      <Panel heading={t("screens.comingSoon.title")}>
        <p class={screen.text}>
          {t(next ? "screens.comingSoon.mapBody" : "screens.comingSoon.body")}
        </p>
        <div class={screen.actions} ref={actions}>
          {next ? (
            <Button variant="primary" size="lg" onClick={next.go}>
              {t("screens.comingSoon.next", { title: t(next.lesson.titleKey) })}
            </Button>
          ) : null}
          {onBack ? (
            <Button variant={next ? "secondary" : "primary"} onClick={onBack}>
              {t("screens.comingSoon.back")}
            </Button>
          ) : null}
          {onMap ? (
            <Button variant={onBack || next ? "secondary" : "primary"} onClick={onMap}>
              {t("screens.comingSoon.map")}
            </Button>
          ) : null}
          {onStart ? (
            <Button variant={onBack || onMap || next ? "secondary" : "primary"} onClick={onStart}>
              {t("screens.comingSoon.start")}
            </Button>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

export default ComingSoon;
