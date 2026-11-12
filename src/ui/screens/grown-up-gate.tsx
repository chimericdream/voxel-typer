/**
 * The grown-up check for profile changes (task M3-09). PLACEHOLDER: the real parent gate is M3-08.
 *
 * Every gated action asks through {@link useGrownUpGate}'s `requireGrownUp(action)`, which
 * resolves true when a grown-up said yes. While it waits, the hook's `view` is the question; the
 * caller shows it in place of its own content (inside its dialog, so focus stays trapped there).
 *
 * For now the question is a plain "Is a grown-up here?" with two buttons. M3-08 replaces the body
 * of this file with its real gate and keeps the same hook shape, so callers don't change.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { t } from "@/i18n";
import { Button } from "@/ui/kit/Button";
import styles from "./Profiles.module.css";

/** What needs a grown-up. M3-08 may add more. */
export type GrownUpAction = "renameProfile" | "changeBand" | "deleteProfile";

export interface GrownUpGate {
  /** Asks for a grown-up. Resolves true on yes, false on no or if the asker goes away. */
  requireGrownUp(action: GrownUpAction): Promise<boolean>;
  /** The question while one is open, else null. Render it in place of your content. */
  view: ComponentChildren;
  /** True while a question is open. */
  asking: boolean;
  /** Closes an open question as a "no". */
  cancel(): void;
}

/** Holds the open question's resolver; methods, so no hook value is reassigned in render. */
function createPending() {
  let resolve: ((ok: boolean) => void) | null = null;
  return {
    /** Answers the open question, if any. */
    answer(ok: boolean): void {
      const r = resolve;
      resolve = null;
      r?.(ok);
    },
    /** Opens a question, answering an earlier one "no". */
    open(): Promise<boolean> {
      this.answer(false);
      return new Promise<boolean>((r) => {
        resolve = r;
      });
    },
  };
}

export function useGrownUpGate(): GrownUpGate {
  const [action, setAction] = useState<GrownUpAction | null>(null);
  const [pending] = useState(createPending);

  const settle = (ok: boolean): void => {
    setAction(null);
    pending.answer(ok);
  };

  // Going away counts as "no", so nobody waits forever.
  useEffect(() => () => pending.answer(false), [pending]);

  const requireGrownUp = (a: GrownUpAction): Promise<boolean> => {
    const asked = pending.open();
    setAction(a);
    return asked;
  };

  const view =
    action === null ? null : (
      <div class={styles.step} data-gate={action}>
        <p class={styles.stepText}>{t("profiles.gate.ask")}</p>
        <div class={styles.stepActions}>
          <span data-autofocus="">
            <Button variant="primary" onClick={() => settle(true)}>
              {t("profiles.gate.yes")}
            </Button>
          </span>
          <Button onClick={() => settle(false)}>{t("profiles.gate.no")}</Button>
        </div>
      </div>
    );

  return { requireGrownUp, view, asking: action !== null, cancel: () => settle(false) };
}
