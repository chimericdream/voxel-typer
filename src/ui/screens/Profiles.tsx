/**
 * Profiles (task M2-11, extended in M3-09): "Who is playing?" Up to 8 player cards with a small
 * voxel avatar, "New player", and "Change a player" for a grown-up.
 *
 * Keyboard: Up/Down (or Left/Right) move between the buttons, Enter picks, Escape goes back (or
 * leaves change mode first). Picking loads the full profile and goes to the map.
 *
 * Change mode: picking a card opens a dialog with New name, Change group and Delete player. Each
 * of those asks a grown-up first (`useGrownUpGate`, a placeholder until M3-08's parent gate), and
 * Delete also asks for the player's name to be typed. The dialog owns the keys while it is open.
 *
 * Every stored profile holds a slot (M1-09), so the "full" check counts the ones that aren't
 * listed too:
 * - One a newer build of the game wrote is read-only this session (`AppApi.readOnlyProfiles`). If
 *   it is the one in play it stays on the list with a kind note, and it can't be changed here;
 *   one the store refused to load is counted in a note.
 * - A damaged one (`AppApi.damagedProfiles`) shows as "A lost player", which a grown-up can delete.
 */
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { settleAtMeadow, shouldOfferPlacement } from "@/app/progress";
import type { ScreenProps } from "@/app/types";
import { NICKNAME_MAX, checkNickname } from "@/content/nickname";
import { t } from "@/i18n";
import type { Profile } from "@/save/schema";
import type { AgeBand } from "@/types/core";
import { AvatarPreview } from "@/ui/components/AvatarPreview";
import { Button } from "@/ui/kit/Button";
import { Dialog } from "@/ui/kit/Dialog";
import { Toast } from "@/ui/kit/Toast";
import { useGrownUpGate } from "./grown-up-gate";
import type { GrownUpAction } from "./grown-up-gate";
import { arrowStep, createLatch, focusOnControl, moveFocus, navItems, useScreenInput } from "./nav";
import { cleanNicknameInput } from "./ProfileCreate";
import { gameIsFull, nameMatches, withBand } from "./profiles-logic";
import screen from "./screen.module.css";
import create from "./ProfileCreate.module.css";
import styles from "./Profiles.module.css";

const BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];

type Player = {
  kind: "player";
  id: string;
  name: string;
  ageBand: AgeBand;
  avatar: Profile["avatar"];
  readOnly: boolean;
};
type Lost = { kind: "lost"; id: string };
type Row = Player | Lost;

type View = "menu" | "rename" | "band" | "remove";
const GATED: Readonly<Record<Exclude<View, "menu">, GrownUpAction>> = {
  rename: "renameProfile",
  band: "changeBand",
  remove: "deleteProfile",
};

type RenameProblem = "empty" | "tooLong" | "notAllowed";

export default function Profiles({ app }: ScreenProps) {
  const [list, setList] = useState<Row[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [full, setFull] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [edit, setEdit] = useState<{ row: Row; view: View } | null>(null);
  const [busy] = useState(createLatch);
  const root = useRef<HTMLDivElement>(null);
  const gate = useGrownUpGate();

  /** Lists the players again. `live` turns false when the screen goes away first. */
  const refresh = useCallback(
    (live: () => boolean = () => true): Promise<void> => {
      const p = app.store.listProfiles().then((found) => {
        if (!live()) return;
        const readOnly = app.readOnlyProfiles();
        const damaged = app.damagedProfiles();
        const rows: Row[] = found.map((f) => ({
          kind: "player",
          ...f,
          readOnly: readOnly.has(f.id),
        }));
        const active = app.profile();
        if (active && readOnly.has(active.id) && !rows.some((r) => r.id === active.id)) {
          const { id, name, ageBand, avatar } = active;
          rows.push({ kind: "player", id, name, ageBand, avatar, readOnly: true });
        }
        const listed = new Set(rows.map((r) => r.id));
        for (const id of [...damaged].toSorted()) {
          if (!listed.has(id)) rows.push({ kind: "lost", id });
        }
        const shown = new Set(rows.map((r) => r.id));
        setHidden([...readOnly].filter((id) => !shown.has(id)).length);
        setFull(gameIsFull(rows, damaged, readOnly));
        setList(rows);
      });
      app.whenReady(p);
      return p;
    },
    [app],
  );

  useEffect(() => {
    let live = true;
    void refresh(() => live);
    return () => {
      live = false;
    };
  }, [refresh]);

  // Focus the first card when the list shows, or again when the focused card went away.
  useEffect(() => {
    if (list === null || edit !== null) return;
    const el = root.current;
    if (el && !el.contains(document.activeElement)) moveFocus(el, 1);
  }, [list, edit, manage]);

  // Change mode starts on the first card.
  useEffect(() => {
    if (manage) navItems(root.current ?? document.body)[0]?.focus();
  }, [manage]);

  const pick = async (row: Player): Promise<void> => {
    if (!busy.take()) return;
    const active = app.profile();
    const profile = active?.id === row.id ? active : await app.store.load(row.id);
    busy.release();
    if (app.route().id !== "profiles") return;
    if (profile === null) {
      setMessage(t("profiles.loadFailed"));
      return;
    }
    // A test quit mid-way, or lost to a reload, is offered once more on the next visit (M3-FIX-3
    // N4), not in the visit that already showed it (M3-FIX-10). The offer settles the start as it
    // shows, so it never comes back a third time. A read-only profile can't keep that mark, so it
    // is never asked again.
    if (
      shouldOfferPlacement(profile) &&
      !app.placementOffered().has(profile.id) &&
      !app.readOnlyProfiles().has(profile.id)
    ) {
      // Picked first, so the save starts from the copy just loaded, not one this tab saw earlier
      // (M3-FIX-9: the two-tab check would refuse that save, and the mark would be lost).
      app.setProfile(profile);
      void app.saveProfile(settleAtMeadow(profile, Date.now()));
      app.navigate({ id: "placement" });
      return;
    }
    app.setProfile(profile);
    app.navigate({ id: "map" });
  };

  const onRow = (row: Row): void => {
    setMessage(null);
    if (row.kind === "lost" || manage) setEdit({ row, view: "menu" });
    else void pick(row);
  };

  const closeEdit = (): void => {
    gate.cancel();
    setEdit(null);
  };

  /** Asks a grown-up, then opens `view`. A "no" stays on the menu. */
  const start = async (view: Exclude<View, "menu">): Promise<void> => {
    if (!(await gate.requireGrownUp(GATED[view]))) return;
    setEdit((e) => (e === null ? e : { ...e, view }));
  };

  /** Saves a change to a player. Resolves false when nothing was written. */
  const update = async (id: string, change: (p: Profile) => Profile): Promise<Profile | null> => {
    if (!busy.take()) return null;
    try {
      if (app.readOnlyProfiles().has(id)) return null;
      const active = app.profile();
      const base = active?.id === id ? active : await app.store.load(id);
      if (base === null) return null;
      const next = change(base);
      if (active?.id === id) return (await app.saveProfile(next)) ? next : null;
      try {
        await app.store.save(next);
        return next;
      } catch {
        return null;
      }
    } finally {
      busy.release();
    }
  };

  const finish = async (text: string): Promise<void> => {
    setEdit(null);
    setMessage(text);
    await refresh();
  };

  useScreenInput(app, (i) => {
    // The dialog owns the keys (it stops Escape and Tab itself); nothing behind it moves.
    if (edit !== null) return i.kind === "control";
    if (i.kind !== "control") return false;
    if (i.action === "back" && manage) {
      setManage(false);
      return true;
    }
    const step = arrowStep(i.action);
    if (step !== null) return moveFocus(root.current, step);
    if (i.action === "confirm" && !focusOnControl()) return moveFocus(root.current, 1);
    return false;
  });

  if (list === null) return null;

  return (
    <div class={screen.screen} ref={root} data-manage={manage ? "1" : undefined}>
      <h1 class={screen.title}>{manage ? t("profiles.manageTitle") : t("profiles.title")}</h1>
      <div class={screen.column}>
        {list.length === 0 ? (
          <p class={styles.note}>{t("profiles.empty")}</p>
        ) : (
          <ul class={styles.list}>
            {list.map((row) => (
              <li key={row.id} class={styles.item}>
                <button
                  type="button"
                  class={styles.player}
                  data-nav=""
                  data-profile={row.id}
                  data-readonly={row.kind === "player" && row.readOnly ? "1" : undefined}
                  data-lost={row.kind === "lost" ? "1" : undefined}
                  onClick={() => onRow(row)}
                  onKeyDown={(e) => {
                    // A held Enter repeats; only the first press picks (PLAN §4.6).
                    if (e.repeat && e.key === "Enter") e.preventDefault();
                  }}
                >
                  {row.kind === "player" ? (
                    <AvatarPreview app={app} skin={row.avatar.skin} />
                  ) : (
                    <span class={styles.lostIcon} aria-hidden="true">
                      ?
                    </span>
                  )}
                  {row.kind === "player" ? (
                    <span class={styles.label}>
                      <span class={styles.name}>{row.name}</span>
                      <span class={styles.band}>{t(`screens.bands.${row.ageBand}`)}</span>
                      {row.readOnly ? (
                        <span class={styles.readOnly}>{t("profiles.readOnly")}</span>
                      ) : null}
                    </span>
                  ) : (
                    <span class={styles.label}>
                      <span class={styles.name}>{t("profiles.lostName")}</span>
                      <span class={styles.band}>{t("profiles.lostNote")}</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 ? (
          <Toast tone="info">{t("profiles.readOnlyHidden", { count: hidden })}</Toast>
        ) : null}
        {message === null ? null : (
          <div data-message="">
            <Toast tone="info">{message}</Toast>
          </div>
        )}
      </div>
      <div class={screen.actions}>
        {manage ? null : (
          <span key="new" data-nav="">
            <Button
              variant={list.length === 0 ? "primary" : "secondary"}
              size="lg"
              onClick={() => {
                // The 9th player is blocked here, kindly; ProfileCreate checks again.
                if (full) setMessage(t("profiles.full"));
                else app.navigate({ id: "profileCreate" });
              }}
            >
              {t("profiles.newPlayer")}
            </Button>
          </span>
        )}
        {list.length === 0 ? null : (
          <span key="manage" data-nav="">
            <Button
              variant={manage ? "primary" : "secondary"}
              onClick={() => {
                setMessage(null);
                setManage(!manage);
              }}
            >
              {manage ? t("profiles.manageDone") : t("profiles.manage")}
            </Button>
          </span>
        )}
        <span key="back" data-nav="">
          <Button onClick={() => (manage ? setManage(false) : app.back())}>
            {t("profiles.back")}
          </Button>
        </span>
      </div>
      {edit === null ? null : (
        <EditDialog
          row={edit.row}
          view={edit.view}
          gateView={gate.view}
          asking={gate.asking}
          onClose={closeEdit}
          onStart={(v) => void start(v)}
          onBackToMenu={() => setEdit({ row: edit.row, view: "menu" })}
          onRename={async (name) => {
            const saved = await update(edit.row.id, (p) => ({ ...p, name }));
            if (saved === null) return false;
            await finish(t("profiles.done.rename", { name: saved.name }));
            return true;
          }}
          onBand={async (band) => {
            const saved = await update(edit.row.id, (p) => withBand(p, band));
            if (saved === null) return false;
            await finish(
              t("profiles.done.band", { name: saved.name, band: t(`screens.bands.${band}`) }),
            );
            return true;
          }}
          onRemove={async () => {
            if (!busy.take()) return false;
            const ok = await app.removeProfile(edit.row.id);
            busy.release();
            if (!ok) return false;
            await finish(t("profiles.done.remove"));
            return true;
          }}
        />
      )}
    </div>
  );
}

interface EditDialogProps {
  row: Row;
  view: View;
  gateView: ComponentChildren;
  asking: boolean;
  onClose: () => void;
  onStart: (view: Exclude<View, "menu">) => void;
  onBackToMenu: () => void;
  /** Each resolves false when nothing was saved. */
  onRename: (name: string) => Promise<boolean>;
  onBand: (band: AgeBand) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}

/** The change dialog: a menu, then one step. Focus goes to each step's first control. */
function EditDialog(props: EditDialogProps) {
  const { row, view, asking } = props;
  const body = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const mark = body.current?.querySelector<HTMLElement>("[data-autofocus]");
    const target = mark?.matches("button, input") ? mark : mark?.querySelector("button, input");
    if (target instanceof HTMLElement) target.focus();
  }, [view, asking]);

  const title = row.kind === "lost" ? t("profiles.lostName") : row.name;
  const save = async (p: Promise<boolean>): Promise<void> => {
    if (!(await p)) setFailed(true);
  };

  let content;
  if (asking) content = props.gateView;
  else if (view === "menu") content = <Menu row={row} onStart={props.onStart} />;
  else if (view === "rename" && row.kind === "player") {
    content = (
      <RenameStep
        name={row.name}
        onCancel={props.onBackToMenu}
        onSave={(n) => void save(props.onRename(n))}
      />
    );
  } else if (view === "band" && row.kind === "player") {
    content = (
      <BandStep
        band={row.ageBand}
        onCancel={props.onBackToMenu}
        onSave={(b) => void save(props.onBand(b))}
      />
    );
  } else {
    content = (
      <RemoveStep
        name={row.kind === "player" ? row.name : null}
        onCancel={props.onBackToMenu}
        onRemove={() => void save(props.onRemove())}
      />
    );
  }

  return (
    <Dialog open onClose={props.onClose} title={title} closeLabel={t("profiles.close")}>
      <div ref={body} data-view={asking ? "gate" : view}>
        {content}
        {failed && !asking ? <Toast tone="info">{t("profiles.saveFailed")}</Toast> : null}
      </div>
    </Dialog>
  );
}

function Menu({ row, onStart }: { row: Row; onStart: (view: Exclude<View, "menu">) => void }) {
  if (row.kind === "player" && row.readOnly) {
    return <p class={styles.stepText}>{t("profiles.menu.readOnly")}</p>;
  }
  if (row.kind === "lost") {
    return (
      <div class={styles.step}>
        <p class={styles.stepText}>{t("profiles.menu.lost")}</p>
        <div class={styles.stepActions} data-autofocus="">
          <Button onClick={() => onStart("remove")}>{t("profiles.menu.remove")}</Button>
        </div>
      </div>
    );
  }
  return (
    <div class={styles.menu} data-autofocus="">
      <Button onClick={() => onStart("rename")}>{t("profiles.menu.rename")}</Button>
      <Button onClick={() => onStart("band")}>{t("profiles.menu.band")}</Button>
      <Button onClick={() => onStart("remove")}>{t("profiles.menu.remove")}</Button>
    </div>
  );
}

/** Enter in a text field submits; a held Enter must only do it once (PLAN §4.6). */
const noRepeatEnter = (e: KeyboardEvent): void => {
  if (e.repeat && e.key === "Enter") e.preventDefault();
};

function RenameStep(props: { name: string; onCancel: () => void; onSave: (name: string) => void }) {
  const [draft, setDraft] = useState(props.name);
  const [problem, setProblem] = useState<RenameProblem | null>(null);
  const id = "profile-rename";
  return (
    <form
      class={styles.step}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const check = checkNickname(draft);
        if (!check.ok) {
          setProblem(check.reason);
          return;
        }
        props.onSave(check.name);
      }}
    >
      <label class={create.label} for={id}>
        {t("profiles.rename.label")}
      </label>
      <input
        id={id}
        class={create.input}
        type="text"
        value={draft}
        maxLength={NICKNAME_MAX}
        autoComplete="off"
        spellcheck={false}
        data-autofocus=""
        aria-invalid={problem !== null}
        aria-describedby={`${id}-hint`}
        onKeyDown={noRepeatEnter}
        onInput={(e) => {
          const el = e.currentTarget;
          const clean = cleanNicknameInput(el.value);
          if (clean !== el.value) el.value = clean;
          setDraft(clean);
          setProblem(null);
        }}
      />
      <p id={`${id}-hint`} class={create.hint}>
        {t("profiles.rename.hint")}
      </p>
      {problem === null ? null : <Toast tone="info">{t(`profiles.rename.${problem}`)}</Toast>}
      <div class={styles.stepActions}>
        <Button type="submit" variant="primary">
          {t("profiles.rename.save")}
        </Button>
        <Button onClick={props.onCancel}>{t("profiles.cancel")}</Button>
      </div>
    </form>
  );
}

function BandStep(props: { band: AgeBand; onCancel: () => void; onSave: (band: AgeBand) => void }) {
  const [band, setBand] = useState(props.band);
  return (
    <form
      class={styles.step}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave(band);
      }}
    >
      <fieldset class={create.group}>
        <legend class={create.label}>{t("profiles.band.label")}</legend>
        <div class={create.bands}>
          {BANDS.map((b) => (
            <label key={b} class={create.band} data-checked={band === b ? "1" : undefined}>
              <input
                class={create.radio}
                type="radio"
                name="profile-band"
                value={b}
                checked={band === b}
                data-autofocus={band === b ? "" : undefined}
                onKeyDown={noRepeatEnter}
                onChange={() => setBand(b)}
              />
              <span class={create.bandName}>{t(`screens.bands.${b}`)}</span>
              <span class={create.bandInfo}>{t(`screens.bandInfo.${b}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div class={styles.stepActions}>
        <Button type="submit" variant="primary">
          {t("profiles.band.save")}
        </Button>
        <Button onClick={props.onCancel}>{t("profiles.cancel")}</Button>
      </div>
    </form>
  );
}

function RemoveStep(props: { name: string | null; onCancel: () => void; onRemove: () => void }) {
  const [typed, setTyped] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const { name } = props;
  const id = "profile-remove";
  if (name === null) {
    // A lost player has no name to type; the grown-up check is enough.
    return (
      <div class={styles.step}>
        <p class={styles.stepText}>{t("profiles.remove.lostWarn")}</p>
        <div class={styles.stepActions}>
          <span data-autofocus="">
            <Button variant="primary" onClick={props.onRemove}>
              {t("profiles.remove.lostConfirm")}
            </Button>
          </span>
          <Button onClick={props.onCancel}>{t("profiles.cancel")}</Button>
        </div>
      </div>
    );
  }
  return (
    <form
      class={styles.step}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (nameMatches(typed, name)) props.onRemove();
        else setMismatch(true);
      }}
    >
      <p class={styles.stepText}>{t("profiles.remove.warn", { name })}</p>
      <label class={create.label} for={id}>
        {t("profiles.remove.label", { name })}
      </label>
      <input
        id={id}
        class={create.input}
        type="text"
        value={typed}
        maxLength={NICKNAME_MAX + 4}
        autoComplete="off"
        spellcheck={false}
        data-autofocus=""
        aria-invalid={mismatch}
        onKeyDown={noRepeatEnter}
        onInput={(e) => {
          setTyped(e.currentTarget.value);
          setMismatch(false);
        }}
      />
      {mismatch ? <Toast tone="info">{t("profiles.remove.mismatch", { name })}</Toast> : null}
      <div class={styles.stepActions}>
        <Button type="submit" variant="primary">
          {t("profiles.remove.confirm", { name })}
        </Button>
        <Button onClick={props.onCancel}>{t("profiles.cancel")}</Button>
      </div>
    </form>
  );
}
