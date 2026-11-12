/**
 * Coming soon (task M2-11): the friendly panel for every route that has no screen yet, and for a
 * lesson whose mode doesn't exist yet. The app shell shows it (`App.tsx`).
 */
import { useEffect, useRef } from "preact/hooks";
import { t } from "@/i18n";
import { Button } from "@/ui/kit/Button";
import { Panel } from "@/ui/kit/Panel";
import screen from "./screen.module.css";

export interface ComingSoonProps {
  /** Shown when there is somewhere to go back to. */
  onBack: (() => void) | null;
  /** Shown when the map is a sensible place to go (not on the map itself). */
  onMap: (() => void) | null;
  /** Back to the splash screen, when there is nowhere else to go. */
  onStart?: (() => void) | null;
}

export function ComingSoon({ onBack, onMap, onStart = null }: ComingSoonProps) {
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    actions.current?.querySelector("button")?.focus();
  }, []);
  return (
    <div class={screen.screen}>
      <Panel heading={t("screens.comingSoon.title")}>
        <p class={screen.text}>{t("screens.comingSoon.body")}</p>
        <div class={screen.actions} ref={actions}>
          {onBack ? (
            <Button variant="primary" onClick={onBack}>
              {t("screens.comingSoon.back")}
            </Button>
          ) : null}
          {onMap ? (
            <Button variant={onBack ? "secondary" : "primary"} onClick={onMap}>
              {t("screens.comingSoon.map")}
            </Button>
          ) : null}
          {onStart ? (
            <Button variant={onBack || onMap ? "secondary" : "primary"} onClick={onStart}>
              {t("screens.comingSoon.start")}
            </Button>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

export default ComingSoon;
