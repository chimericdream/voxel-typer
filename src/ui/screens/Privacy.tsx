/**
 * Privacy (task M2-11, PLAN.md §6.7): what the game keeps and what it never does, in words a
 * child can read. The footer disclaimer is drawn by the app shell on this route.
 */
import { useEffect, useRef } from "preact/hooks";
import type { ScreenProps } from "@/app/types";
import { t } from "@/i18n";
import { Button } from "@/ui/kit/Button";
import screen from "./screen.module.css";
import styles from "./Privacy.module.css";

/** In reading order. Each is one short sentence. */
export const PRIVACY_POINTS = [
  "nickname",
  "device",
  "noInternet",
  "noAccounts",
  "noLinks",
  "grownUps",
] as const;

export default function Privacy({ app }: ScreenProps) {
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    actions.current?.querySelector("button")?.focus();
  }, []);
  return (
    <div class={screen.screen}>
      <h1 class={screen.title}>{t("screens.privacy.title")}</h1>
      <ul class={styles.points}>
        {PRIVACY_POINTS.map((p) => (
          <li key={p} class={styles.point}>
            {t(`screens.privacy.points.${p}`)}
          </li>
        ))}
      </ul>
      <div class={screen.actions} ref={actions}>
        <Button variant="primary" onClick={() => app.back()}>
          {t("screens.privacy.back")}
        </Button>
      </div>
    </div>
  );
}
