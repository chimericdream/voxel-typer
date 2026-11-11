/**
 * Pause and stretch-break overlays (task M2-10). Shown over the paused scene.
 *
 * The kit `Dialog` traps focus and handles Escape (→ resume). Focus starts on the resume button, so
 * Enter resumes too. The break overlay has no "leave" button: it is a short rest, not a stop.
 */
import { t } from "@/i18n";
import { Button } from "@/ui/kit/Button";
import { Dialog } from "@/ui/kit/Dialog";
import styles from "./Pause.module.css";

export interface PauseProps {
  kind: "pause" | "break";
  onResume: () => void;
  /** Leave the lesson (pause only). */
  onQuit: () => void;
}

export function Pause({ kind, onResume, onQuit }: PauseProps) {
  const isBreak = kind === "break";
  return (
    <Dialog
      open
      onClose={onResume}
      title={t(isBreak ? "app.break.title" : "app.pause.title")}
      closeLabel={t(isBreak ? "app.break.resume" : "app.pause.resume")}
    >
      <p class={styles.body}>{t(isBreak ? "app.break.body" : "app.pause.body")}</p>
      {isBreak ? null : (
        <div class={styles.actions}>
          <Button variant="secondary" onClick={onQuit}>
            {t("app.pause.quit")}
          </Button>
        </div>
      )}
    </Dialog>
  );
}

export default Pause;
