/**
 * "New badge" toasts (task M3-10). The shell queues each badge as it is earned; this shows them
 * one at a time, each for {@link BADGE_TOAST_MS}, and only while `open` is true. The app keeps it
 * closed while a lesson is on (playing or paused), so a toast never comes up mid-word: it waits
 * for Results or the next screen. The kit Toast reads each one out through the page's live region, outside
 * `#app`. Its pop-in follows the shared motion flag (`--motion-ok`), so reduced motion shows it at
 * once.
 */
import { useEffect } from "preact/hooks";
import { achievementById } from "@/content/achievements";
import { t } from "@/i18n";
import { Toast } from "@/ui/kit/Toast";
import type { AchievementId } from "@/types/core";
import { BadgeIcon } from "./BadgeIcon";
import styles from "./Badge.module.css";

export const BADGE_TOAST_MS = 3500;

export interface AchievementToastProps {
  /** Badges waiting to be shown, oldest first. */
  queue: readonly AchievementId[];
  /** False while a child is typing. */
  open: boolean;
  /** The first badge has been shown long enough. */
  onShown: () => void;
}

export function AchievementToast({ queue, open, onShown }: AchievementToastProps) {
  const id = queue[0];
  const def = id === undefined ? null : achievementById(id);
  const showing = open && id !== undefined;

  useEffect(() => {
    if (!showing) return undefined;
    // An id with no definition (an older or newer build's badge) is skipped at once.
    const timer = setTimeout(onShown, def === null ? 0 : BADGE_TOAST_MS);
    return () => clearTimeout(timer);
    // `queue` changes identity on every push; restart only when the shown badge changes.
  }, [showing, id, def, onShown]);

  if (!showing || def === null) return null;
  return (
    <div class={styles.toastWrap} data-testid="badge-toast">
      <Toast key={def.id} tone="cheer">
        <span class={styles.toastBody}>
          <BadgeIcon icon={def.icon} />
          <span>{t("achievements.toast", { name: t(def.nameKey) })}</span>
        </span>
      </Toast>
    </div>
  );
}
