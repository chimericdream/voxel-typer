/**
 * The in-play HUD (task M2-14, docs/impl/contracts.md §10, PLAN.md §3.4, §4.6).
 *
 * Top row: lesson progress, the hotbar combo meter and the timer (hidden for Sprout and calm mode).
 * Under it the big word display. Then an open stage for the 3D scene, where one message floats
 * (the Caps Lock hint, or else the banner). At the bottom the on-screen keyboard and hands.
 *
 * Every part reads only its own field signals from the bridge, so a mode calling `set` at 60 Hz
 * re-renders only the parts whose field changed (`tests/unit/ui/hud.test.tsx` counts renders). The
 * root reads no signal at all.
 *
 * The HUD takes no pointer input and never takes focus: in play, keys go to the mode.
 */
import { useComputed } from "@preact/signals";
import type { LayoutDef } from "@/content/layouts/types";
import { t } from "@/i18n";
import type { Settings } from "@/save/settings";
import type { AgeBand } from "@/types/core";
import { OnScreenKeyboard } from "@/ui/keyboard/OnScreenKeyboard";
import { Hotbar } from "@/ui/kit/Hotbar";
import { ProgressBar } from "@/ui/kit/ProgressBar";
import { Toast } from "@/ui/kit/Toast";
import { hotbarOf, wrongKeyOf } from "./bridge";
import type { HudFields } from "./bridge";
import { WordDisplay } from "./WordDisplay";
import styles from "./Hud.module.css";

type Fields = { fields: HudFields };

/** `m:ss`, rounded up, so the timer shows 0:00 only when time is really up. */
export function formatTime(remainingMs: number): string {
  const s = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The timer is never shown to Sprout or in calm mode, whatever the mode sends. */
export function timerHidden(band: AgeBand, settings: Pick<Settings, "calmMode">): boolean {
  return band === "sprout" || settings.calmMode;
}

export function HudWord({ fields }: Fields) {
  return <WordDisplay word={fields.word.value} />;
}

export function HudCombo({ fields }: Fields) {
  const lit = Math.max(0, Math.min(9, Math.floor(fields.combo.value)));
  // Items a mode put in the slots (M2-13). The slice keeps its identity until the mode sends a
  // new one, so other `custom` slices don't re-render the hotbar.
  const items = useComputed(() => hotbarOf(fields.custom.value)).value;
  const slots = items?.slots.map((item) =>
    item === null
      ? {}
      : {
          label: item.label,
          count: item.count,
          ...(item.icon !== "" && { icon: <img src={item.icon} alt="" /> }),
        },
  );
  return (
    <div class={styles.combo}>
      <Hotbar label={t("hud.combo", { count: lit })} lit={lit} {...(slots && { slots })} />
    </div>
  );
}

export function HudProgress({ fields }: Fields) {
  return (
    <div class={styles.progress}>
      <ProgressBar value01={fields.progress01.value} label={t("hud.progress")} />
    </div>
  );
}

export function HudTimer({ fields }: Fields) {
  // Only the shown text is a dependency, so a timer sent every frame re-renders once a second.
  const text = useComputed(() => {
    const timer = fields.timer.value;
    return timer === null ? null : formatTime(timer.remainingMs);
  }).value;
  if (text === null) return null;
  return (
    <p class={styles.timer}>
      <span class={styles.sr}>{t("hud.timeLeft")} </span>
      <span class={styles.clock} aria-hidden="true">
        ⏱
      </span>
      {text}
    </p>
  );
}

/**
 * One message at a time over the stage. The Caps Lock hint wins over a banner: while Caps Lock is on
 * the child can't type the word at all. The banner shows again once Caps Lock is off.
 */
export function HudMessage({ fields }: Fields) {
  if (fields.capsLock.value) {
    return (
      <Toast key="caps" tone="info">
        <span class={styles.capsKey} aria-hidden="true">
          ⇪
        </span>{" "}
        {t("hud.capsLock")}
      </Toast>
    );
  }
  const banner = fields.banner.value;
  if (banner === null) return null;
  // Keyed by the message, so a new message pops in and an unchanged one stays still.
  return (
    <Toast key={`${banner.key}:${banner.tone}`} tone={banner.tone}>
      {t(banner.key, banner.params)}
    </Toast>
  );
}

export interface HudKeyboardProps extends Fields {
  layout: LayoutDef;
  hands: boolean;
  labels: boolean;
}

export function HudKeyboard({ fields, layout, hands, labels }: HudKeyboardProps) {
  // Only a new wrong press changes this slice; other custom widgets don't re-render the keyboard.
  const wrong = useComputed(() => wrongKeyOf(fields.custom.value)).value;
  return (
    <OnScreenKeyboard
      layout={layout}
      nextKey={fields.nextKey.value}
      hands={hands}
      labels={labels}
      wrong={wrong}
    />
  );
}

export interface HudProps extends Fields {
  settings: Pick<Settings, "calmMode" | "showKeyboard" | "showHands">;
  band: AgeBand;
  layout: LayoutDef;
}

export function Hud({ fields, settings, band, layout }: HudProps) {
  const keyboard = settings.showKeyboard;
  const hands = keyboard && settings.showHands;
  return (
    <div
      class={styles.hud}
      data-keyboard={keyboard ? "1" : undefined}
      data-hands={hands ? "1" : undefined}
    >
      <div class={styles.top}>
        <HudProgress fields={fields} />
        <HudCombo fields={fields} />
        {timerHidden(band, settings) ? null : <HudTimer fields={fields} />}
      </div>
      <HudWord fields={fields} />
      {/* `data-hud` marks the open stage and the keyboard, so a mode can frame its scene around them. */}
      <div class={styles.stage} data-hud="stage">
        <div class={styles.messages}>
          <HudMessage fields={fields} />
        </div>
      </div>
      {keyboard ? (
        <div class={styles.keyboard} data-hud="keyboard">
          {/* Finger labels on every key for Sprout (M2-09 N3): a keyboard-only child never hovers. */}
          <HudKeyboard fields={fields} layout={layout} hands={hands} labels={band === "sprout"} />
        </div>
      ) : null}
    </div>
  );
}
