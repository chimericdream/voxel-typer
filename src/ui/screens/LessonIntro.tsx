/**
 * Lesson intro (task M2-11): the lesson title, its new keys as big `KeyCap`s with finger hints,
 * one goal line and Start.
 *
 * Lessons have no goal-line field (M2-12's note), so the goal is built from the new keys
 * ({@link goalLine}). Pressing one of the new keys here pushes its cap down, so a child can find
 * it before the lesson starts. Enter (with nothing else focused) starts; Escape goes back.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { ScreenProps } from "@/app/types";
import { EN_US, fingerFor, layoutById } from "@/content/layouts";
import type { Lesson } from "@/content/lessons/types";
import { t } from "@/i18n";
import { Button } from "@/ui/kit/Button";
import { KeyCap } from "@/ui/kit/KeyCap";
import { focusOnControl, useScreenInput } from "./nav";
import screen from "./screen.module.css";
import styles from "./LessonIntro.module.css";

/** How a key is printed on its cap: letters in capitals, as on a real keyboard. */
export const capGlyph = (key: string): string => (/^[a-z]$/.test(key) ? key.toUpperCase() : key);

/** The spoken name of a key whose glyph alone is unclear, or undefined. */
export function keyName(key: string): string | undefined {
  if (key === ";" || key === " ") return t(`screens.keyNames.${key}`);
  return undefined;
}

/** The goal line for a lesson's new keys. F and J together get the "bumps" line. */
export function goalLine(newKeys: readonly string[]): string {
  const names = newKeys.map((k) => keyName(k) ?? capGlyph(k));
  const [a, b] = names;
  if (a === undefined) return t("screens.lessonIntro.goalReview");
  if (b === undefined) return t("screens.lessonIntro.goalOne", { key: a });
  if (names.length > 2) return t("screens.lessonIntro.goalMany");
  const bumps = newKeys.includes("f") && newKeys.includes("j");
  return t(bumps ? "screens.lessonIntro.goalBumps" : "screens.lessonIntro.goalTwo", {
    key1: a,
    key2: b,
  });
}

const PRESS_MS = 220;

function Intro({ app, lesson }: { app: ScreenProps["app"]; lesson: Lesson }) {
  const start = useRef<HTMLDivElement>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const layout = layoutById(app.profile()?.settings.layout ?? "en-US") ?? EN_US;

  useEffect(() => {
    start.current?.querySelector("button")?.focus();
  }, []);

  // Each press pushes the cap down for a moment; a newer press restarts the moment.
  useEffect(() => {
    if (pressed === null) return undefined;
    const id = setTimeout(() => setPressed(null), PRESS_MS);
    return () => clearTimeout(id);
  }, [pressed]);

  const go = (): void => app.navigate({ id: "play", lesson: lesson.id });

  useScreenInput(app, (i) => {
    if (i.kind === "typed") {
      const key = i.input.key.toLowerCase();
      if (!lesson.newKeys.includes(key)) return false;
      setPressed(key);
      return true;
    }
    if (i.action === "confirm" && !focusOnControl()) {
      go();
      return true;
    }
    return false;
  });

  return (
    <div class={screen.screen}>
      <h1 class={screen.title}>{t(lesson.titleKey)}</h1>
      {lesson.newKeys.length > 0 ? (
        <section class={styles.keys} aria-labelledby="lesson-intro-keys">
          <h2 id="lesson-intro-keys" class={styles.keysHeading}>
            {t("screens.lessonIntro.newKeys")}
          </h2>
          <ul class={styles.keyList}>
            {lesson.newKeys.map((k) => {
              const finger = fingerFor(layout, k);
              const name = keyName(k);
              return (
                <li key={k} class={styles.key}>
                  <KeyCap
                    glyph={capGlyph(k)}
                    size="lg"
                    bump={k === "f" || k === "j"}
                    pressed={pressed === k}
                    {...(name === undefined ? {} : { label: name })}
                  />
                  {finger ? (
                    <span class={styles.finger}>{t(`screens.fingers.${finger}`)}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <p class={styles.goal}>{goalLine(lesson.newKeys)}</p>
      <div class={screen.actions} ref={start}>
        <Button variant="primary" size="lg" onClick={go}>
          {t("screens.lessonIntro.start")}
        </Button>
        <Button onClick={() => app.navigate({ id: "map" })}>{t("screens.lessonIntro.back")}</Button>
      </div>
    </div>
  );
}

function Missing({ app }: { app: ScreenProps["app"] }) {
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    actions.current?.querySelector("button")?.focus();
  }, []);
  return (
    <div class={screen.screen}>
      <p class={styles.goal}>{t("screens.lessonIntro.missing")}</p>
      <div class={screen.actions} ref={actions}>
        <Button variant="primary" onClick={() => app.navigate({ id: "map" })}>
          {t("screens.lessonIntro.back")}
        </Button>
      </div>
    </div>
  );
}

export default function LessonIntro({ app, route }: ScreenProps) {
  const lesson = route.lesson === undefined ? null : app.lesson(route.lesson);
  if (lesson === null) return <Missing app={app} />;
  return <Intro app={app} lesson={lesson} />;
}
