/**
 * New player (task M2-11): a typed nickname (typing practice too), an age group with friendly
 * descriptions, and a skin color. Keyboard only works end to end: the name field has focus first,
 * Tab moves to the group and color pickers (arrow keys choose, as native radio groups do), and
 * Enter anywhere in the form makes the player.
 *
 * The nickname is checked on the device against the safety blocklist (`@/content/nickname`). A
 * refused name gets one kind line that never says which word was the problem.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { ScreenProps } from "@/app/types";
import { NICKNAME_CHAR, NICKNAME_MAX, checkNickname } from "@/content/nickname";
import { t } from "@/i18n";
import type { Profile } from "@/save/schema";
import { SCHEMA_VERSION } from "@/save/schema";
import { defaultSettings } from "@/save/settings";
import { newId } from "@/save/id";
import { MAX_PROFILES } from "@/save/store";
import type { AgeBand, EpochMs } from "@/types/core";
import { Button } from "@/ui/kit/Button";
import { Toast } from "@/ui/kit/Toast";
import { Avatar, SKIN_TONES } from "./Avatar";
import type { SkinToneId } from "./Avatar";
import { createLatch, useScreenInput } from "./nav";
import screen from "./screen.module.css";
import styles from "./ProfileCreate.module.css";

const BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];

type Problem = "empty" | "tooLong" | "notAllowed" | "full" | "saveFailed";

/** Keeps only the chars a nickname may use, at most {@link NICKNAME_MAX} of them. */
export function cleanNicknameInput(text: string): string {
  return Array.from(text.replace(/\s/g, " "))
    .filter((c) => NICKNAME_CHAR.test(c))
    .slice(0, NICKNAME_MAX)
    .join("");
}

/** A brand-new profile with the band's default settings. */
export function newProfile(
  name: string,
  ageBand: AgeBand,
  skin: string,
  at: EpochMs,
  id: string = newId(),
): Profile {
  return {
    id,
    name,
    ageBand,
    avatar: { skin },
    createdAt: at,
    settings: defaultSettings(ageBand),
    progress: { lessons: {}, unlockedBiomes: ["meadow"] },
    sessionCounter: 0,
    keyStats: {},
    bigramStats: {},
    inventory: {},
    island: null,
    cosmetics: { unlocked: [] },
    achievements: {},
    daily: { streakDates: [] },
    history: [],
    weekly: [],
    schemaVersion: SCHEMA_VERSION,
  };
}

export default function ProfileCreate({ app }: ScreenProps) {
  const [name, setName] = useState("");
  const [band, setBand] = useState<AgeBand>("sprout");
  const [skin, setSkin] = useState<SkinToneId>(SKIN_TONES[0].id);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const [busy] = useState(createLatch);

  useEffect(() => {
    field.current?.focus();
  }, []);

  // Keys go to the focused field, radio or button; Escape (unhandled `back`) leaves.
  useScreenInput(app, () => false);

  const submit = async (): Promise<void> => {
    const check = checkNickname(name);
    if (!check.ok) {
      setProblem(check.reason);
      field.current?.focus();
      return;
    }
    if (!busy.take()) return;
    setSaving(true);
    const existing = await app.store.listProfiles();
    if (existing.length >= MAX_PROFILES) {
      busy.release();
      setSaving(false);
      setProblem("full");
      return;
    }
    const ok = await app.saveProfile(newProfile(check.name, band, skin, Date.now()));
    busy.release();
    setSaving(false);
    if (!ok) {
      setProblem("saveFailed");
      return;
    }
    app.navigate({ id: "map" }, { replace: true });
  };

  const count = Array.from(name).length;
  const hintId = "profile-create-hint";
  const problemId = "profile-create-problem";

  return (
    <div class={screen.screen}>
      <h1 class={screen.title}>{t("screens.profileCreate.title")}</h1>
      <form
        class={styles.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div class={styles.nameRow}>
          <Avatar skin={skin} size="lg" />
          <div class={styles.nameField}>
            <label class={styles.label} for="profile-create-name">
              {t("screens.profileCreate.nameLabel")}
            </label>
            <input
              ref={field}
              id="profile-create-name"
              class={styles.input}
              type="text"
              value={name}
              maxLength={NICKNAME_MAX}
              autoComplete="off"
              autoCapitalize="words"
              spellcheck={false}
              onKeyDown={(e) => {
                // A held Enter repeats; only the first press may submit (PLAN §4.6).
                if (e.repeat && e.key === "Enter") e.preventDefault();
              }}
              aria-describedby={problem ? `${hintId} ${problemId}` : hintId}
              aria-invalid={
                problem === "empty" || problem === "tooLong" || problem === "notAllowed"
              }
              onInput={(e) => {
                const el = e.currentTarget;
                const clean = cleanNicknameInput(el.value);
                if (clean !== el.value) el.value = clean;
                setName(clean);
                setProblem(null);
              }}
            />
            <p id={hintId} class={styles.hint}>
              {t("screens.profileCreate.nameHint")}{" "}
              <span class={styles.count}>
                {t("screens.profileCreate.nameCount", { count, max: NICKNAME_MAX })}
              </span>
            </p>
          </div>
        </div>
        {problem ? (
          <div id={problemId}>
            <Toast tone="info">{t(`screens.profileCreate.${problem}`)}</Toast>
          </div>
        ) : null}

        <fieldset class={styles.group}>
          <legend class={styles.label}>{t("screens.profileCreate.bandLabel")}</legend>
          <div class={styles.bands}>
            {BANDS.map((b) => (
              <label key={b} class={styles.band} data-checked={band === b ? "1" : undefined}>
                <input
                  class={styles.radio}
                  type="radio"
                  name="band"
                  value={b}
                  checked={band === b}
                  onChange={() => setBand(b)}
                />
                <span class={styles.bandName}>{t(`screens.bands.${b}`)}</span>
                <span class={styles.bandInfo}>{t(`screens.bandInfo.${b}`)}</span>
              </label>
            ))}
          </div>
          <p class={styles.hint}>{t("screens.profileCreate.bandNote")}</p>
        </fieldset>

        <fieldset class={styles.group}>
          <legend class={styles.label}>{t("screens.profileCreate.skinLabel")}</legend>
          <div class={styles.skins}>
            {SKIN_TONES.map((s, i) => (
              <label key={s.id} class={styles.skin} data-checked={skin === s.id ? "1" : undefined}>
                <input
                  class={styles.radio}
                  type="radio"
                  name="skin"
                  value={s.id}
                  checked={skin === s.id}
                  aria-label={t("screens.profileCreate.skin", {
                    n: i + 1,
                    count: SKIN_TONES.length,
                  })}
                  onChange={() => setSkin(s.id)}
                />
                <span class={styles.swatch} style={{ backgroundColor: s.color }} />
                <span class={styles.tick} aria-hidden="true">
                  ✓
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div class={screen.actions}>
          <Button type="submit" variant="primary" size="lg" disabled={saving}>
            {saving ? t("screens.profileCreate.saving") : t("screens.profileCreate.create")}
          </Button>
          <Button onClick={() => app.back()}>{t("screens.profileCreate.back")}</Button>
        </div>
      </form>
    </div>
  );
}
