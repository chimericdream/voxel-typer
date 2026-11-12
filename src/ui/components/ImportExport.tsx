/**
 * Settings → Grown-ups → Save file (task M3-12, PLAN.md §6.6). Already behind the parent gate.
 *
 * - **Export** downloads `voxel-typer-<date>.json` from `store.exportAll()` (the date from the
 *   shell's clock). The store leaves out damaged and newer-game profiles; this lists them.
 * - **Import** reads a file (5 MB cap) with `readExportFile`, then shows what will happen before
 *   anything is written. A profile already on this device is never written over unless the
 *   grown-up picks "Use the file's copy"; the default keeps this device's. Then a summary: added,
 *   updated, not loaded, and why. The rules are in `./import-export-logic`.
 *
 * Nothing is sent anywhere: the export is a local download and the import a local file.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { realClock } from "@/app/clock";
import type { AppApi } from "@/app/types";
import { blocks } from "@/content/blocks";
import { islandBlocks } from "@/engine/island";
import { t } from "@/i18n";
import { newId } from "@/save/id";
import type { Profile } from "@/save/schema";
import { MAX_IMPORT_BYTES, NewerSaveError, ProfileLimitError, readExportFile } from "@/save/store";
import type { ExportFileProblem } from "@/save/store";
import type { EpochMs } from "@/types/core";
import { Button } from "@/ui/kit/Button";
import { Toast } from "@/ui/kit/Toast";
import {
  exportFileName,
  idsInExport,
  lastPlayed,
  leftOut,
  lessonsDone,
  planImport,
  resolveImport,
} from "./import-export-logic";
import type { Choice, DeviceState, ImportStep, PlanRow } from "./import-export-logic";
import styles from "./ImportExport.module.css";

export interface ImportExportProps {
  app: AppApi;
  /** False on a device with no players yet: only import is offered. */
  canExport?: boolean;
  /** Wall-clock time, for the file name. Defaults to the shell's real clock. */
  now?: () => EpochMs;
  /** Hands the file to the browser as a download. Tests replace it. */
  download?: (blob: Blob, name: string) => void;
  /** Called when the file replaced the active player, with the new copy. */
  onActiveReplaced?: (p: Profile) => void;
}

/** A local download through an object URL. Nothing goes over the network. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type ExportState =
  | null
  | { kind: "busy" }
  | { kind: "done"; count: number; file: string; lost: number; newer: number }
  | { kind: "none"; lost: number; newer: number }
  | { kind: "failed" };

export type Outcome =
  | { index: number; kind: "added"; name: string; from?: string }
  | { index: number; kind: "updated"; name: string }
  | {
      index: number;
      kind: "skipped";
      name: string | null;
      reason: Exclude<ImportStep, { kind: "add" | "replace" }>["reason"] | "deviceNewer" | "failed";
    };

type ImportState =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "problem"; problem: ExportFileProblem | "empty" }
  | {
      kind: "review";
      file: string;
      rows: PlanRow[];
      device: DeviceState;
      choices: ReadonlyMap<number, Choice>;
    }
  | { kind: "applying" }
  | { kind: "done"; outcomes: Outcome[] };

const dateText = (at: EpochMs): string =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(at);

/** Which profiles are on this device, with every stored id (each holds one of the 8 slots). */
async function deviceState(app: AppApi): Promise<DeviceState> {
  const listed = await app.store.listProfiles();
  const profiles = new Map<string, Profile>();
  for (const l of listed) {
    const p = await app.store.load(l.id);
    if (p !== null) profiles.set(p.id, p);
  }
  const damaged = new Set(app.damagedProfiles());
  const readOnly = new Set(app.readOnlyProfiles());
  const ids = new Set([...listed.map((l) => l.id), ...damaged, ...readOnly]);
  return { ids, profiles, damaged, readOnly };
}

/** Ids for the preview only: the real ones are made when the grown-up says go. */
function previewIds(): () => string {
  let n = 0;
  return () => `preview-${++n}`;
}

const ISLAND_BLOCKS = islandBlocks(blocks);

export function ImportExport(props: ImportExportProps) {
  const { app, canExport = true } = props;
  const now = props.now ?? (() => realClock.epoch());
  const download = props.download ?? downloadBlob;
  const [exp, setExp] = useState<ExportState>(null);
  const [imp, setImp] = useState<ImportState>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLDivElement>(null);

  // Move the keyboard cursor to what just appeared, so a screen reader reads it too.
  useEffect(() => {
    if (imp.kind === "done" || imp.kind === "problem") result.current?.focus();
  }, [imp.kind]);

  const doExport = async (): Promise<void> => {
    setExp({ kind: "busy" });
    try {
      const blob = await app.store.exportAll();
      const ids = idsInExport(await blob.text()) ?? new Set<string>();
      const out = leftOut(ids, app.damagedProfiles(), app.readOnlyProfiles());
      if (ids.size === 0) {
        setExp({ kind: "none", ...out });
        return;
      }
      const file = exportFileName(now());
      download(blob, file);
      setExp({ kind: "done", count: ids.size, file, ...out });
    } catch (e) {
      console.warn("[save] export failed", e);
      setExp({ kind: "failed" });
    }
  };

  const onFile = async (file: File): Promise<void> => {
    setImp({ kind: "reading" });
    // The store checks the cap too; this never even reads a big file.
    if (file.size > MAX_IMPORT_BYTES) {
      setImp({ kind: "problem", problem: "tooBig" });
      return;
    }
    const read = await readExportFile(file);
    if (!read.ok) {
      setImp({ kind: "problem", problem: read.problem });
      return;
    }
    if (read.entries.length === 0) {
      setImp({ kind: "problem", problem: "empty" });
      return;
    }
    const device = await deviceState(app);
    const rows = planImport(read.entries, device, ISLAND_BLOCKS);
    setImp({ kind: "review", file: file.name, rows, device, choices: new Map() });
  };

  const apply = async (
    rows: PlanRow[],
    device: DeviceState,
    choices: ReadonlyMap<number, Choice>,
  ) => {
    setImp({ kind: "applying" });
    const steps = resolveImport(rows, choices, device, newId);
    const outcomes: Outcome[] = [];
    for (const step of steps) {
      if (step.kind === "skip") {
        outcomes.push({ index: step.index, kind: "skipped", name: step.name, reason: step.reason });
        continue;
      }
      const p = step.profile;
      try {
        // The store keeps this device's copy as `<id>:prev`, refuses a 9th profile and never
        // writes over a newer game's save.
        await app.store.save(p);
      } catch (e) {
        const reason =
          e instanceof ProfileLimitError
            ? "full"
            : e instanceof NewerSaveError
              ? "deviceNewer"
              : "failed";
        if (reason === "failed") console.warn("[save] import save failed", e);
        outcomes.push({ index: step.index, kind: "skipped", name: p.name, reason });
        continue;
      }
      if (app.profile()?.id === p.id) {
        // The playing profile changed under the shell: switch to the saved copy, so the next
        // autosave can't write the old one back over it.
        app.setProfile(p);
        props.onActiveReplaced?.(p);
      }
      if (step.kind === "replace")
        outcomes.push({ index: step.index, kind: "updated", name: p.name });
      else if (step.copyOf !== undefined) {
        outcomes.push({ index: step.index, kind: "added", name: p.name, from: step.copyOf });
      } else outcomes.push({ index: step.index, kind: "added", name: p.name });
    }
    setImp({ kind: "done", outcomes });
  };

  const busy = exp?.kind === "busy" || imp.kind === "reading" || imp.kind === "applying";

  return (
    <div class={styles.box} data-import-export="">
      {canExport ? (
        <div class={styles.part} data-export="">
          <p class={styles.text}>{t("importexport.export.intro")}</p>
          <span data-nav="">
            <Button disabled={busy} onClick={() => void doExport()}>
              {t("importexport.export.button")}
            </Button>
          </span>
          {/* While the check is open, the export message shows by its backup button instead. */}
          {imp.kind === "review" ? null : <ExportMessage state={exp} />}
        </div>
      ) : null}

      <div class={styles.part} data-import="">
        <p class={styles.text}>{t("importexport.import.intro")}</p>
        <input
          ref={input}
          class={styles.file}
          type="file"
          accept=".json,application/json"
          tabIndex={-1}
          aria-label={t("importexport.import.pick")}
          data-import-file=""
          onChange={(ev) => {
            const el = ev.currentTarget;
            const f = el.files?.[0];
            // Cleared, so picking the same file again still fires a change.
            el.value = "";
            if (f !== undefined) void onFile(f);
          }}
        />
        {imp.kind === "review" ? null : (
          <span data-nav="">
            <Button disabled={busy} onClick={() => input.current?.click()}>
              {t("importexport.import.button")}
            </Button>
          </span>
        )}

        {imp.kind === "reading" ? (
          <p class={styles.muted}>{t("importexport.import.reading")}</p>
        ) : null}
        {imp.kind === "applying" ? (
          <p class={styles.muted}>{t("importexport.import.busy")}</p>
        ) : null}

        {imp.kind === "problem" ? (
          <div ref={result} tabIndex={-1} class={styles.result} data-import-problem={imp.problem}>
            <Toast tone="info">
              {imp.problem === "empty"
                ? t("importexport.import.empty")
                : t(`importexport.import.problem.${imp.problem}`)}{" "}
              {t("importexport.import.nothingChanged")}
            </Toast>
          </div>
        ) : null}

        {imp.kind === "review" ? (
          <Review
            state={imp}
            onChoose={(index, c) => {
              const choices = new Map(imp.choices);
              choices.set(index, c);
              setImp({ ...imp, choices });
            }}
            onGo={() => void apply(imp.rows, imp.device, imp.choices)}
            onCancel={() => setImp({ kind: "idle" })}
            onBackup={() => void doExport()}
            exportState={exp}
            busy={busy}
          />
        ) : null}

        {imp.kind === "done" ? (
          <div ref={result} tabIndex={-1} class={styles.result} data-import-result="">
            <Summary outcomes={imp.outcomes} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ExportMessage({ state }: { state: ExportState }) {
  if (state === null) return null;
  if (state.kind === "busy") return <p class={styles.muted}>{t("importexport.export.busy")}</p>;
  if (state.kind === "failed") {
    return (
      <div data-export-result="failed">
        <Toast tone="info">{t("importexport.export.failed")}</Toast>
      </div>
    );
  }
  return (
    <div class={styles.lines} data-export-result={state.kind}>
      <Toast tone="info">
        {state.kind === "done"
          ? t("importexport.export.done", { count: state.count, file: state.file })
          : t("importexport.export.none")}
      </Toast>
      {state.lost > 0 ? (
        <p class={styles.text} data-left-out="lost">
          {t("importexport.export.leftOutLost", { count: state.lost })}
        </p>
      ) : null}
      {state.newer > 0 ? (
        <p class={styles.text} data-left-out="newer">
          {t("importexport.export.leftOutNewer", { count: state.newer })}
        </p>
      ) : null}
    </div>
  );
}

function Review(props: {
  state: Extract<ImportState, { kind: "review" }>;
  onChoose: (index: number, c: Choice) => void;
  onGo: () => void;
  onCancel: () => void;
  /** Downloads a save file of this device first (the export). */
  onBackup: () => void;
  exportState: ExportState;
  busy: boolean;
}) {
  const { rows, device, choices, file } = props.state;
  const root = useRef<HTMLDivElement>(null);
  // Move the keyboard cursor here when the check appears, so a screen reader reads it too.
  useEffect(() => root.current?.focus(), []);
  const preview = resolveImport(rows, choices, device, previewIds());
  const stepOf = (index: number): ImportStep | undefined => preview.find((s) => s.index === index);
  // A replace of a readable player is final (`:prev` goes with the next save, review N2), so
  // offer a backup of this device first. A damaged copy has nothing to back up.
  const replacesPlayer = preview.some((st) => st.kind === "replace" && st.previousName !== null);
  return (
    <div
      ref={root}
      tabIndex={-1}
      class={styles.review}
      data-import-review=""
      aria-labelledby="import-review-title"
    >
      <h3 class={styles.title} id="import-review-title">
        {t("importexport.import.reviewTitle")}
      </h3>
      <p class={styles.muted}>{t("importexport.import.fileName", { file })}</p>
      <p class={styles.text}>{t("importexport.import.reviewIntro")}</p>
      <ul class={styles.rows}>
        {rows.map((row) => (
          <li key={row.index} class={styles.row} data-row={row.kind} data-index={row.index}>
            <RowView
              row={row}
              step={stepOf(row.index)}
              choice={choices.get(row.index)}
              onChoose={props.onChoose}
            />
          </li>
        ))}
      </ul>
      {replacesPlayer ? (
        <div class={styles.lines} data-backup="">
          <p class={styles.wins}>{t("importexport.import.backupNote")}</p>
          <span data-nav="">
            <Button disabled={props.busy} onClick={props.onBackup}>
              {t("importexport.import.backup")}
            </Button>
          </span>
          <ExportMessage state={props.exportState} />
        </div>
      ) : null}
      <div class={styles.actions}>
        <span data-nav="">
          <Button variant="primary" onClick={props.onGo}>
            {t("importexport.import.go")}
          </Button>
        </span>
        <span data-nav="">
          <Button onClick={props.onCancel}>{t("importexport.import.cancel")}</Button>
        </span>
      </div>
    </div>
  );
}

function RowView(props: {
  row: PlanRow;
  step: ImportStep | undefined;
  choice: Choice | undefined;
  onChoose: (index: number, c: Choice) => void;
}) {
  const { row, step } = props;
  if (row.kind === "bad") {
    return (
      <p class={styles.text}>
        {row.reason === "newer"
          ? t("importexport.import.rowBadNewer", { n: row.index + 1 })
          : t("importexport.import.rowBadInvalid", { n: row.index + 1 })}
      </p>
    );
  }
  const name = row.profile.name;
  if (row.kind === "add") {
    return (
      <p class={styles.text}>
        {step?.kind === "skip"
          ? t("importexport.import.rowFull", { name })
          : step?.kind === "add" && step.profile.name !== name
            ? t("importexport.import.rowAddCopy", { name, copy: step.profile.name })
            : t("importexport.import.rowAdd", { name })}
      </p>
    );
  }
  const pick = props.choice ?? row.choices[0] ?? "keepDevice";
  const mine = row.device.kind === "player" ? row.device.profile : null;
  const fileAt = lastPlayed(row.profile);
  const mineAt = mine === null ? null : lastPlayed(mine);
  const wins =
    pick === "keepDevice"
      ? t("importexport.import.wins.keepDevice", { name })
      : pick === "useFile"
        ? row.device.kind === "lost"
          ? t("importexport.import.wins.useFileLost", { name })
          : t("importexport.import.wins.useFile", { name })
        : step?.kind === "add"
          ? t("importexport.import.wins.keepBoth", { copy: step.profile.name })
          : t("importexport.import.wins.keepBothFull");
  return (
    <div class={styles.conflict}>
      <p class={styles.text}>
        {row.device.kind === "player"
          ? t("importexport.import.conflict", { name })
          : row.device.kind === "lost"
            ? t("importexport.import.conflictLost", { name })
            : t("importexport.import.conflictNewer", { name })}
      </p>
      {mine !== null && mineAt !== null ? (
        <p class={styles.muted} data-side="device">
          {t("importexport.import.sideDevice", {
            count: lessonsDone(mine),
            date: dateText(mineAt),
          })}
          {mineAt > fileAt ? <> {t("importexport.import.newerTag")}</> : null}
        </p>
      ) : null}
      <p class={styles.muted} data-side="file">
        {t("importexport.import.sideFile", {
          count: lessonsDone(row.profile),
          date: dateText(fileAt),
        })}
        {mineAt !== null && fileAt > mineAt ? <> {t("importexport.import.newerTag")}</> : null}
      </p>
      {row.fileIslandOk ? null : (
        <p class={styles.muted} data-island-bad="">
          {t("importexport.import.islandBad", { name })}
        </p>
      )}
      <fieldset class={styles.choice} data-choice={row.index}>
        <legend class={styles.legend}>{t("importexport.import.choiceLegend", { name })}</legend>
        <div class={styles.options}>
          {row.choices.map((c) => {
            const checked = c === pick;
            return (
              <label key={c} class={styles.option} data-checked={checked ? "" : undefined}>
                <input
                  type="radio"
                  name={`import-choice-${row.index}`}
                  value={c}
                  checked={checked}
                  data-nav={checked ? "" : undefined}
                  onChange={() => props.onChoose(row.index, c)}
                />
                <span>{t(`importexport.import.choice.${c}`)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <p class={styles.wins} data-wins={pick}>
        {wins}
      </p>
    </div>
  );
}

function Summary({ outcomes }: { outcomes: readonly Outcome[] }) {
  const count = (k: Outcome["kind"]): number => outcomes.filter((o) => o.kind === k).length;
  return (
    <div class={styles.lines}>
      <h3 class={styles.title}>{t("importexport.import.result.title")}</h3>
      <Toast tone="info">
        {t("importexport.import.result.counts", {
          added: count("added"),
          updated: count("updated"),
          skipped: count("skipped"),
        })}
      </Toast>
      <ul class={styles.rows}>
        {outcomes.map((o) => (
          <li
            key={o.index}
            class={styles.text}
            data-outcome={o.kind}
            data-reason={o.kind === "skipped" ? o.reason : undefined}
          >
            {outcomeText(o)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function outcomeText(o: Outcome): string {
  if (o.kind === "added") {
    return o.from === undefined
      ? t("importexport.import.result.added", { name: o.name })
      : t("importexport.import.result.addedCopy", { name: o.name, from: o.from });
  }
  if (o.kind === "updated") return t("importexport.import.result.updated", { name: o.name });
  return t(`importexport.import.result.skip.${o.reason}`, { name: o.name ?? "", n: o.index + 1 });
}
