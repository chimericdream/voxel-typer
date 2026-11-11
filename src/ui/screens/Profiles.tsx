/**
 * Profiles (task M2-11): "Who is playing?" One big button per player, and "New player".
 *
 * Keyboard: Up/Down (or Left/Right) move between the buttons, Enter picks, Escape goes back.
 * Picking loads the full profile and goes to the map.
 *
 * A profile a newer build of the game wrote is read-only this session (`AppApi.readOnlyProfiles`).
 * If it is the one in play, it stays on the list with a kind note; one the store refused to load
 * is counted in a note instead of vanishing without a word.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { ScreenProps } from "@/app/types";
import { t } from "@/i18n";
import type { SaveStore } from "@/save/store";
import { MAX_PROFILES } from "@/save/store";
import { Button } from "@/ui/kit/Button";
import { Toast } from "@/ui/kit/Toast";
import { Avatar } from "./Avatar";
import { arrowStep, createLatch, focusOnControl, moveFocus, useScreenInput } from "./nav";
import screen from "./screen.module.css";
import styles from "./Profiles.module.css";

type Listed = Awaited<ReturnType<SaveStore["listProfiles"]>>[number] & { readOnly: boolean };

export default function Profiles({ app }: ScreenProps) {
  const [list, setList] = useState<Listed[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [problem, setProblem] = useState<"loadFailed" | null>(null);
  const [busy] = useState(createLatch);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const p = app.store.listProfiles().then((found) => {
      if (!live) return;
      const readOnly = app.readOnlyProfiles();
      const rows: Listed[] = found.map((f) => ({ ...f, readOnly: readOnly.has(f.id) }));
      const active = app.profile();
      if (active && readOnly.has(active.id) && !rows.some((r) => r.id === active.id)) {
        const { id, name, ageBand, avatar } = active;
        rows.push({ id, name, ageBand, avatar, readOnly: true });
      }
      const shown = new Set(rows.map((r) => r.id));
      setHidden([...readOnly].filter((id) => !shown.has(id)).length);
      setList(rows);
    });
    app.whenReady(p);
    return () => {
      live = false;
    };
  }, [app]);

  useEffect(() => {
    if (list !== null) moveFocus(root.current, 1);
  }, [list]);

  const pick = async (row: Listed): Promise<void> => {
    if (!busy.take()) return;
    const active = app.profile();
    const profile = active?.id === row.id ? active : await app.store.load(row.id);
    busy.release();
    if (app.route().id !== "profiles") return;
    if (profile === null) {
      setProblem("loadFailed");
      return;
    }
    app.setProfile(profile);
    app.navigate({ id: "map" });
  };

  useScreenInput(app, (i) => {
    if (i.kind !== "control") return false;
    const step = arrowStep(i.action);
    if (step !== null) return moveFocus(root.current, step);
    if (i.action === "confirm" && !focusOnControl()) return moveFocus(root.current, 1);
    return false;
  });

  if (list === null) return null;
  const full = list.length >= MAX_PROFILES;

  return (
    <div class={screen.screen} ref={root}>
      <h1 class={screen.title}>{t("screens.profiles.title")}</h1>
      <div class={screen.column}>
        {list.length === 0 ? (
          <p class={styles.note}>{t("screens.profiles.empty")}</p>
        ) : (
          <ul class={styles.list}>
            {list.map((row) => (
              <li key={row.id} class={styles.item}>
                <button
                  type="button"
                  class={styles.player}
                  data-nav=""
                  data-readonly={row.readOnly ? "1" : undefined}
                  onClick={() => void pick(row)}
                  onKeyDown={(e) => {
                    // A held Enter repeats; only the first press picks (PLAN §4.6).
                    if (e.repeat && e.key === "Enter") e.preventDefault();
                  }}
                >
                  <Avatar skin={row.avatar.skin} />
                  <span class={styles.label}>
                    <span class={styles.name}>{row.name}</span>
                    <span class={styles.band}>{t(`screens.bands.${row.ageBand}`)}</span>
                    {row.readOnly ? (
                      <span class={styles.readOnly}>{t("screens.profiles.readOnly")}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 ? (
          <Toast tone="info">{t("screens.profiles.readOnlyHidden", { count: hidden })}</Toast>
        ) : null}
        {problem ? <Toast tone="info">{t(`screens.profiles.${problem}`)}</Toast> : null}
        {full ? <p class={styles.note}>{t("screens.profiles.full")}</p> : null}
      </div>
      <div class={screen.actions}>
        {full ? null : (
          <span data-nav="">
            <Button
              variant={list.length === 0 ? "primary" : "secondary"}
              size="lg"
              onClick={() => app.navigate({ id: "profileCreate" })}
            >
              {t("screens.profiles.newPlayer")}
            </Button>
          </span>
        )}
        <span data-nav="">
          <Button onClick={() => app.back()}>{t("screens.profiles.back")}</Button>
        </span>
      </div>
    </div>
  );
}
