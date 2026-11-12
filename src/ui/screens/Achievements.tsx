/**
 * My Badges (task M3-10, PLAN.md §3.3): every badge, earned ones bright with "Got it!", the rest
 * soft with "Not yet". A surprise badge keeps its name to itself until it is earned. No dates,
 * no ranks, nothing about speed.
 *
 * Keys: the Back button has focus; Escape goes back (the shell's default). The list is a focusable
 * scroll area so a keyboard can scroll it.
 */
import { useEffect, useRef } from "preact/hooks";
import type { ScreenProps } from "@/app/types";
import { achievements } from "@/content/achievements";
import type { AchievementDef } from "@/engine/achievements";
import { t } from "@/i18n";
import type { AgeBand } from "@/types/core";
import { BadgeIcon } from "@/ui/components/BadgeIcon";
import { Button } from "@/ui/kit/Button";
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

export default function Achievements({ app }: ScreenProps) {
  const actions = useRef<HTMLDivElement>(null);
  const profile = app.profile();
  const unlocked = profile?.achievements ?? {};
  const band = profile?.ageBand ?? "miner";
  const got = achievements.filter((a) => unlocked[a.id] !== undefined).length;

  useEffect(() => {
    actions.current?.querySelector("button")?.focus();
  }, []);

  return (
    <div class={`${screen.screen} ${styles.page}`}>
      <h1 class={screen.title}>{t("achievements.title")}</h1>
      <p class={screen.text}>{t("achievements.count", { got, total: achievements.length })}</p>
      {/* A scroll area a keyboard can reach and scroll (axe: scrollable-region-focusable). */}
      <section
        class={styles.scroll}
        aria-label={t("achievements.listLabel")}
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
      <div class={screen.actions} ref={actions}>
        <Button variant="primary" onClick={() => app.back()}>
          {t("achievements.back")}
        </Button>
      </div>
    </div>
  );
}
