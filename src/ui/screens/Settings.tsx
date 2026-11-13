/**
 * Settings (task M3-08, PLAN.md §4.6, §6.7). Four tabs:
 *
 * - **Play:** keyboard, hands, finger names, keyboard type, calm mode, break time.
 * - **Look:** letter size (the whole page is the live preview), letters (font), strong colors,
 *   moving things (reduced motion), picture quality.
 * - **Sound:** the four volume buses, read-aloud and a test sound.
 * - **Grown-ups:** behind the parent gate. Group (band) change, the save file (M3-12),
 *   the secure-address note, damaged saves, and the danger zone (delete this player).
 *
 * Every change applies at once (`app.saveProfile` → the shell re-applies theme, size, motion, font
 * and volumes) and is saved. A profile a newer game saved is read-only: everything is disabled.
 *
 * Keyboard: Left/Right on the tabs (the kit `Tabs`; the router never sees those, see `nav.ts`),
 * Up/Down between controls, Tab as usual, Escape back. Arrows inside a slider, a radio group or a
 * text field belong to that control.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { AppApi, ScreenProps } from "@/app/types";
import type { Bus } from "@/audio/types";
import { LAYOUTS } from "@/content/layouts";
import { t } from "@/i18n";
import type { Profile } from "@/save/schema";
import type { Settings as SettingsData } from "@/save/settings";
import type { AgeBand, QualityLevel } from "@/types/core";
import { fingerLabelsOn } from "@/a11y/options";
import { DYSLEXIC_STACK } from "@/a11y/page";
import { ImportExport } from "@/ui/components/ImportExport";
import { handGrownUpPass, ParentGate } from "@/ui/components/ParentGate";
import { Button } from "@/ui/kit/Button";
import { Dialog } from "@/ui/kit/Dialog";
import { Panel } from "@/ui/kit/Panel";
import { Slider } from "@/ui/kit/Slider";
import { Tabs } from "@/ui/kit/Tabs";
import { Toggle } from "@/ui/kit/Toggle";
import {
  arrowStep,
  focusInField,
  focusOnControl,
  moveFocus,
  navItems,
  useScreenInput,
} from "./nav";
import { withBand } from "./profiles-logic";
import screen from "./screen.module.css";
import styles from "./Settings.module.css";

export type SettingsTab = "play" | "look" | "sound" | "grownUps";
export const SETTINGS_TABS: readonly SettingsTab[] = ["play", "look", "sound", "grownUps"];

const AGE_BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];
const BUSES: readonly Bus[] = ["master", "music", "sfx", "voice"];
/**
 * The font choices shown. `"pixel"` (Blocky) is no longer offered: since M3-FIX-2 every UI font
 * is Atkinson, so it looked the same as Clear, and its own label was drawn in Pixelify, which
 * misreads B and C. Saves keep accepting `"pixel"`; the picker shows it as Clear.
 */
const FONTS: readonly SettingsData["font"][] = ["clean", "dyslexic"];
const QUALITIES: readonly (QualityLevel | "auto")[] = ["auto", "low", "medium", "high"];
type MotionChoice = "system" | "full" | "reduced";
const MOTIONS: readonly MotionChoice[] = ["system", "full", "reduced"];

/** Each font choice is shown in its own letters, whatever the current font is. */
const FONT_STACK: Record<SettingsData["font"], string> = {
  pixel: '"Atkinson Hyperlegible", system-ui, sans-serif',
  clean: '"Atkinson Hyperlegible", system-ui, sans-serif',
  dyslexic: DYSLEXIC_STACK,
};

export const TEXT_SCALE = { min: 1, max: 2, step: 0.25 } as const;
export const BREAK_MINUTES = { min: 0, max: 30, step: 5 } as const;

export function motionChoice(v: SettingsData["reducedMotion"]): MotionChoice {
  return v === "system" ? "system" : v ? "reduced" : "full";
}
export function motionValue(c: MotionChoice): SettingsData["reducedMotion"] {
  return c === "system" ? "system" : c === "reduced";
}

/** Settings with `patch` applied. Turning the keyboard off leaves the hands setting as it was. */
export function withSettings(p: Readonly<Profile>, patch: Partial<SettingsData>): Profile {
  return { ...p, settings: { ...p.settings, ...patch } };
}

const pct = (v: number): number => Math.round(v * 100);

/** Controls inside which the arrow keys belong to the control, not to the screen. */
function arrowsOwnedByFocus(): boolean {
  const el = document.activeElement;
  if (focusInField()) return true;
  return el instanceof HTMLInputElement && (el.type === "range" || el.type === "radio");
}

interface ChoiceProps<T extends string> {
  legend: string;
  value: T;
  options: readonly T[];
  label: (v: T) => string;
  onChange: (v: T) => void;
  disabled: boolean;
  /** Optional per-option font, so a font choice shows its own letters. */
  font?: (v: T) => string;
  name: string;
}

/** A row of radio buttons in a fieldset: arrows move the choice natively. */
function Choice<T extends string>(props: ChoiceProps<T>) {
  return (
    <fieldset class={styles.choice} disabled={props.disabled} data-choice={props.name}>
      <legend class={styles.legend}>{props.legend}</legend>
      <div class={styles.options}>
        {props.options.map((o) => {
          const checked = o === props.value;
          return (
            <label key={o} class={styles.option} data-checked={checked ? "" : undefined}>
              <input
                type="radio"
                name={props.name}
                value={o}
                checked={checked}
                // Up/Down from the screen land on the chosen one.
                data-nav={checked ? "" : undefined}
                onChange={() => props.onChange(o)}
              />
              <span style={props.font ? { fontFamily: props.font(o) } : undefined}>
                {props.label(o)}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

interface TabProps {
  s: Readonly<SettingsData>;
  band: AgeBand;
  set: (patch: Partial<SettingsData>) => void;
  disabled: boolean;
}

function PlayTab({ s, band, set, disabled }: TabProps) {
  return (
    <div class={styles.stack}>
      <span data-nav="">
        <Toggle
          checked={s.showKeyboard}
          label={t("settings.play.keyboard")}
          disabled={disabled}
          onChange={(v) => set({ showKeyboard: v })}
        />
      </span>
      <span data-nav="">
        <Toggle
          checked={s.showHands}
          label={t("settings.play.hands")}
          disabled={disabled || !s.showKeyboard}
          onChange={(v) => set({ showHands: v })}
        />
      </span>
      <span data-nav="">
        <Toggle
          checked={fingerLabelsOn(s, band)}
          label={t("settings.play.fingerLabels")}
          disabled={disabled || !s.showKeyboard}
          onChange={(v) => set({ fingerLabels: v })}
        />
      </span>
      <Choice
        name="layout"
        legend={t("settings.play.layout")}
        value={s.layout}
        options={LAYOUTS.map((l) => l.id)}
        label={(id) => t(`settings.play.layoutName.${id}`)}
        disabled={disabled}
        onChange={(id) => set({ layout: id })}
      />
      <span data-nav="">
        <Toggle
          checked={s.calmMode}
          label={t("settings.play.calm")}
          disabled={disabled}
          onChange={(v) => set({ calmMode: v })}
        />
      </span>
      <p class={screen.muted}>{t("settings.play.calmHint")}</p>
      <span data-nav="">
        <Slider
          label={t("settings.play.breaks")}
          value={s.breakReminderMin}
          {...BREAK_MINUTES}
          disabled={disabled}
          valueText={(m) =>
            m === 0 ? t("settings.play.breakOff") : t("settings.play.breakEvery", { min: m })
          }
          onChange={(m) => set({ breakReminderMin: m })}
        />
      </span>
    </div>
  );
}

function LookTab({ s, set, disabled }: TabProps) {
  return (
    <div class={styles.stack}>
      <span data-nav="">
        <Slider
          label={t("settings.look.size")}
          value={s.textScale}
          {...TEXT_SCALE}
          disabled={disabled}
          valueText={(v) => t("settings.look.sizeValue", { pct: pct(v) })}
          onChange={(v) => set({ textScale: v })}
        />
      </span>
      {/* The page already shows the new size; this line makes it obvious. */}
      <p class={styles.preview} data-preview="">
        {t("settings.look.preview")}
      </p>
      <Choice
        name="font"
        legend={t("settings.look.font")}
        value={s.font === "pixel" ? "clean" : s.font}
        options={FONTS}
        label={(f) => t(`settings.look.fontName.${f}`)}
        font={(f) => FONT_STACK[f]}
        disabled={disabled}
        onChange={(f) => set({ font: f })}
      />
      <span data-nav="">
        <Toggle
          checked={s.highContrast}
          label={t("settings.look.contrast")}
          disabled={disabled}
          onChange={(v) => set({ highContrast: v })}
        />
      </span>
      <Choice
        name="motion"
        legend={t("settings.look.motion")}
        value={motionChoice(s.reducedMotion)}
        options={MOTIONS}
        label={(m) => t(`settings.look.motionName.${m}`)}
        disabled={disabled}
        onChange={(m) => set({ reducedMotion: motionValue(m) })}
      />
      <Choice
        name="quality"
        legend={t("settings.look.quality")}
        value={s.quality}
        options={QUALITIES}
        label={(q) => t(`settings.look.qualityName.${q}`)}
        disabled={disabled}
        onChange={(q) => set({ quality: q })}
      />
    </div>
  );
}

function SoundTab({ s, set, disabled, app }: TabProps & { app: AppApi }) {
  return (
    <div class={styles.stack}>
      {BUSES.map((bus) => (
        <span data-nav="" key={bus}>
          <Slider
            label={t(`settings.sound.volume.${bus}`)}
            value={pct(s.volume[bus])}
            min={0}
            max={100}
            step={10}
            disabled={disabled}
            valueText={(v) => t("settings.sound.volumeValue", { pct: v })}
            onChange={(v) => set({ volume: { ...s.volume, [bus]: v / 100 } })}
          />
        </span>
      ))}
      <span data-nav="">
        <Button onClick={() => app.audio.sfx("chime")}>{t("settings.sound.test")}</Button>
      </span>
      <span data-nav="">
        <Toggle
          checked={s.tts}
          label={t("settings.sound.tts")}
          disabled={disabled}
          onChange={(v) => set({ tts: v })}
        />
      </span>
      <p class={screen.muted}>{t("settings.sound.ttsHint")}</p>
    </div>
  );
}

const bandName = (b: AgeBand): string => t(`screens.bands.${b}`);

type Confirm = { kind: "band"; band: AgeBand } | { kind: "remove" } | null;

function GrownUpsTab(props: {
  app: AppApi;
  profile: Profile;
  disabled: boolean;
  onBand: (b: AgeBand) => void;
  onRemoved: () => void;
  /** The save file replaced this player (M3-12): show the new copy. */
  onReplaced: (p: Profile) => void;
}) {
  const { app, profile, disabled } = props;
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [failed, setFailed] = useState(false);
  const name = profile.name;
  const damaged = app.damagedProfiles().size;
  const insecure = typeof window !== "undefined" && !window.isSecureContext;

  const remove = async (): Promise<void> => {
    setConfirm(null);
    if (await app.removeProfile(profile.id)) props.onRemoved();
    else setFailed(true);
  };

  return (
    <div class={styles.stack} data-grown-ups="">
      <p class={screen.text}>{t("settings.grown.intro", { name })}</p>

      <section class={styles.section} aria-labelledby="settings-progress">
        <h2 class={styles.heading} id="settings-progress">
          {t("settings.grown.progressTitle")}
        </h2>
        <span data-nav="">
          <Button
            onClick={() => {
              // The gate was passed for this tab; the dashboard doesn't ask again (M3-11).
              handGrownUpPass();
              app.navigate({ id: "parent" });
            }}
          >
            {t("settings.grown.progressGo", { name })}
          </Button>
        </span>
      </section>

      <section class={styles.section} aria-labelledby="settings-band">
        <h2 class={styles.heading} id="settings-band">
          {t("settings.grown.bandTitle")}
        </h2>
        <p class={screen.muted}>
          {t("settings.grown.bandNow", { name, band: bandName(profile.ageBand) })}
        </p>
        <div class={styles.row}>
          {AGE_BANDS.filter((b) => b !== profile.ageBand).map((b) => (
            <span data-nav="" key={b}>
              <Button disabled={disabled} onClick={() => setConfirm({ kind: "band", band: b })}>
                {bandName(b)}
              </Button>
            </span>
          ))}
        </div>
      </section>

      <section class={styles.section} aria-labelledby="settings-data">
        <h2 class={styles.heading} id="settings-data">
          {t("settings.grown.dataTitle")}
        </h2>
        <ImportExport app={app} onActiveReplaced={props.onReplaced} />
        {insecure ? <p class={screen.muted}>{t("settings.grown.insecure")}</p> : null}
        {damaged > 0 ? (
          <>
            <p class={screen.muted}>{t("settings.grown.damaged", { count: damaged })}</p>
            <span data-nav="">
              <Button onClick={() => app.navigate({ id: "profiles" })}>
                {t("settings.grown.damagedGo")}
              </Button>
            </span>
          </>
        ) : null}
      </section>

      <section class={styles.danger} aria-labelledby="settings-danger">
        <h2 class={styles.heading} id="settings-danger">
          <span aria-hidden="true">⚠ </span>
          {t("settings.grown.dangerTitle")}
        </h2>
        <span data-nav="">
          <Button disabled={disabled} onClick={() => setConfirm({ kind: "remove" })}>
            {t("settings.grown.remove", { name })}
          </Button>
        </span>
        {failed ? <p class={screen.muted}>{t("settings.grown.removeFailed")}</p> : null}
      </section>

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm?.kind === "remove"
            ? t("settings.grown.remove", { name })
            : t("settings.grown.bandTitle")
        }
        closeLabel={t("settings.grown.keep")}
      >
        {confirm?.kind === "band" ? (
          <div class={styles.stack} data-confirm="band">
            <p class={screen.text}>
              {t("settings.grown.bandConfirm", { name, band: bandName(confirm.band) })}
            </p>
            <div class={styles.row}>
              <Button
                variant="primary"
                onClick={() => {
                  setConfirm(null);
                  props.onBand(confirm.band);
                }}
              >
                {t("settings.grown.bandYes")}
              </Button>
            </div>
          </div>
        ) : confirm?.kind === "remove" ? (
          <div class={styles.stack} data-confirm="remove">
            <p class={screen.text}>{t("settings.grown.removeConfirm", { name })}</p>
            <div class={styles.row}>
              <Button variant="secondary" onClick={() => void remove()}>
                {t("settings.grown.removeYes")}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

/**
 * No player picked yet. On a new device the Players screen sends a grown-up here to load a save
 * file (M3-12), behind the same parent gate as the Grown-ups tab.
 */
function NoPlayer({ app }: { app: AppApi }) {
  const [unlocked, setUnlocked] = useState(false);
  const [asking, setAsking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useScreenInput(app, (i) => {
    if (i.kind !== "control") return false;
    const step = arrowStep(i.action);
    if (step === null) return false;
    return arrowsOwnedByFocus() || moveFocus(root.current, step);
  });
  return (
    <div class={screen.screen} ref={root} data-no-player="">
      <h1 class={screen.title}>{t("settings.title")}</h1>
      <Panel class={styles.body ?? ""}>
        <div class={styles.stack}>
          <p class={screen.text}>{t("settings.noPlayer")}</p>
          <section class={styles.section} aria-labelledby="settings-data">
            <h2 class={styles.heading} id="settings-data">
              {t("settings.grown.dataTitle")}
            </h2>
            {unlocked ? (
              <ImportExport app={app} canExport={false} />
            ) : asking ? (
              <ParentGate
                action="grownUps"
                onPass={() => setUnlocked(true)}
                onCancel={() => setAsking(false)}
              />
            ) : (
              <>
                <p class={screen.muted}>{t("importexport.noPlayerIntro")}</p>
                <span data-nav="">
                  <Button onClick={() => setAsking(true)}>{t("importexport.import.button")}</Button>
                </span>
              </>
            )}
          </section>
        </div>
      </Panel>
      <div class={screen.actions}>
        <span data-nav="">
          <Button variant="primary" onClick={() => app.navigate({ id: "profiles" })}>
            {t("settings.players")}
          </Button>
        </span>
      </div>
    </div>
  );
}

function SettingsScreen({ app, start }: { app: AppApi; start: Profile }) {
  const [profile, setProfile] = useState(start);
  const [tab, setTab] = useState<SettingsTab>("play");
  // Bumped to move the tabs from code (back to Play after "Not now" on the gate).
  const [tabsKey, setTabsKey] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const readOnly = app.readOnlyProfiles().has(profile.id);

  const commit = (next: Profile): void => {
    setProfile(next);
    void app.saveProfile(next);
  };
  const set = (patch: Partial<SettingsData>): void => {
    if (readOnly) return;
    commit(withSettings(app.profile() ?? profile, patch));
  };

  const focusTab = (): void => {
    root.current?.querySelector<HTMLElement>("[role='tab'][aria-selected='true']")?.focus();
  };

  // Like every menu screen, arrive with the keyboard cursor on something: the chosen tab.
  useEffect(() => {
    focusTab();
  }, []);

  const toTab = (id: SettingsTab): void => {
    setTab(id);
    setTabsKey((k) => k + 1);
    requestAnimationFrame(focusTab);
  };

  useScreenInput(app, (i) => {
    if (i.kind !== "control") return false;
    // An open confirm dialog owns its keys (it stops Escape and Tab itself).
    if (root.current?.querySelector("dialog[open]")) return true;
    const step = arrowStep(i.action);
    if (step !== null) {
      if (arrowsOwnedByFocus()) return true;
      const r = root.current;
      if (!r) return false;
      // The chosen tab, then every control on the page, in order.
      const tabEl = r.querySelector<HTMLElement>("[role='tab'][aria-selected='true']");
      const items = [...(tabEl ? [tabEl] : []), ...navItems(r)];
      const at = items.findIndex((el) => el === document.activeElement);
      const next = at === -1 ? items[0] : items[(at + step + items.length) % items.length];
      next?.focus();
      return next !== undefined;
    }
    if (i.action === "confirm" && !focusOnControl()) {
      focusTab();
      return true;
    }
    return false;
  });

  const s = profile.settings;
  const common = { s, band: profile.ageBand, set, disabled: readOnly };
  const tabs = SETTINGS_TABS.map((id) => ({
    id,
    label: t(`settings.tab.${id}`),
    content:
      id === "play" ? (
        <PlayTab {...common} />
      ) : id === "look" ? (
        <LookTab {...common} />
      ) : id === "sound" ? (
        <SoundTab {...common} app={app} />
      ) : unlocked ? (
        <GrownUpsTab
          app={app}
          profile={profile}
          disabled={readOnly}
          onBand={(b) => {
            if (!readOnly) commit(withBand(app.profile() ?? profile, b));
          }}
          onRemoved={() => app.navigate({ id: "profiles" }, { replace: true })}
          onReplaced={setProfile}
        />
      ) : (
        <ParentGate
          action="grownUps"
          onPass={() => setUnlocked(true)}
          onCancel={() => toTab("play")}
        />
      ),
  }));

  return (
    <div class={screen.screen} ref={root} data-settings-tab={tab}>
      <h1 class={screen.title}>{t("settings.title")}</h1>
      <div class={styles.body}>
        {readOnly ? (
          <p class={styles.readOnly} data-read-only="">
            {t("settings.readOnly")}
          </p>
        ) : null}
        <Tabs
          key={tabsKey}
          label={t("settings.tabsLabel")}
          tabs={tabs}
          initial={tab}
          onSelect={(id) => setTab(SETTINGS_TABS.find((x) => x === id) ?? "play")}
        />
      </div>
      <div class={screen.actions}>
        <span data-nav="">
          <Button onClick={() => app.back()}>{t("settings.back")}</Button>
        </span>
      </div>
    </div>
  );
}

export default function Settings({ app }: ScreenProps) {
  const profile = app.profile();
  if (profile === null) return <NoPlayer app={app} />;
  return <SettingsScreen key={profile.id} app={app} start={profile} />;
}
