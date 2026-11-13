/**
 * The Parent Dashboard (task M3-11, PLAN.md §4.4), behind the parent gate (M3-08, decision 105: a
 * speed bump, not security). It shows the active player's real numbers to a grown-up:
 *
 * - speed (net WPM) and accuracy over the last 30 sessions, or week by week;
 * - minutes practiced on each of the last 28 days;
 * - a heat map of recent mistakes on the keyboard layout, with the keys to practice most;
 * - for the Builder band, the letter pairs to practice;
 * - stars per part of the world, with tested-out lessons named as such (never a zero score);
 * - the newest sessions, and "Download CSV" with every session.
 *
 * Every chart is hand-rolled SVG (`src/ui/charts/`), with an accessible summary and a "Show the
 * numbers" table. Everything stays on the device: the CSV is a local download (`downloadBlob`).
 *
 * Arrival: from Settings → Grown-ups the gate was already passed (`takeGrownUpPass`); any other
 * way in asks first. Keys: Up/Down step through the controls, Left/Right move the time-span tabs,
 * Escape goes back.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { realClock } from "@/app/clock";
import { csvBlob, csvFileName, toCsv } from "@/app/csv";
import type { AppApi, ScreenProps } from "@/app/types";
import { EN_US, layoutById } from "@/content/layouts";
import { t } from "@/i18n";
import type { Profile } from "@/save/schema";
import type { EpochMs } from "@/types/core";
import { BarChart } from "@/ui/charts/BarChart";
import { DataTable, NumbersToggle } from "@/ui/charts/ChartFrame";
import { KeyHeatmap, keyCapLabel, ratePctLabel } from "@/ui/charts/KeyHeatmap";
import { LineChart } from "@/ui/charts/LineChart";
import { downloadBlob } from "@/ui/components/ImportExport";
import { ParentGate, takeGrownUpPass } from "@/ui/components/ParentGate";
import { Button } from "@/ui/kit/Button";
import { Panel } from "@/ui/kit/Panel";
import { Tabs } from "@/ui/kit/Tabs";
import { arrowStep, useScreenInput } from "./nav";
import {
  curriculumProgress,
  localDate,
  MINUTE_DAYS,
  minutesPerDay,
  noMinutes,
  RECENT_SESSIONS,
  sessionRows,
  sessionsCsv,
  sessionTrend,
  shortDate,
  totals,
  TREND_SESSIONS,
  weakBigrams,
  weakKeys,
  weeklyTrend,
  keyHeat,
} from "./parent-logic";
import type { TrendPoint } from "./parent-logic";
import screen from "./screen.module.css";
import styles from "./Parent.module.css";

const wpmText = (v: number): string => String(Math.round(v));
const pctText = (v: number): string => `${Math.round(v)}%`;
const minText = (v: number): string => String(Math.round(v * 10) / 10);

/** The page's text scale, clamped like `applyTextScale`. */
const scaleOf = (p: Profile): number => Math.min(2, Math.max(1, p.settings.textScale || 1));

export interface ParentDashboardProps {
  app: AppApi;
  profile: Profile;
  /** Wall-clock time for "today". Default: the real clock. */
  now?: () => EpochMs;
  /** Hands the CSV to the browser. Tests replace it. */
  download?: (blob: Blob, name: string) => void;
}

/** Up/Down targets in page order: `[data-nav]` buttons and disclosures, and the chosen tab. */
function navTargets(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-nav], [role='tab'][aria-selected='true']")]
    .map((el) =>
      el.matches("button, summary") ? el : el.querySelector<HTMLElement>("button, summary"),
    )
    .filter((el): el is HTMLElement => el !== null);
}

function trendSummary(points: readonly TrendPoint[], key: "netWpm" | "accuracyPct"): string {
  const values = points.map((p) => p[key]);
  const params = {
    count: values.length,
    first: values[0] ?? 0,
    last: values.at(-1) ?? 0,
    best: Math.max(0, ...values),
  };
  return t(key === "netWpm" ? "parent.speed.summary" : "parent.accuracy.summary", params);
}

function TrendCharts(props: { points: readonly TrendPoint[]; weekly: boolean; scale: number }) {
  const { points, weekly, scale } = props;
  const speed = points.map((p) => ({ label: p.label, value: p.netWpm }));
  const accuracy = points.map((p) => ({ label: p.label, value: p.accuracyPct }));
  const lowest = Math.min(100, ...accuracy.map((p) => p.value));
  // Accuracy sits high, so the axis starts at the tens below the lowest point, not at 0.
  const accMin = Math.max(0, Math.floor((lowest - 5) / 10) * 10);
  const id = weekly ? "weekly" : "recent";
  return (
    <div class={styles.trend} data-trend={id}>
      <div class={styles.pair}>
        <div class={styles.chartBox}>
          <h3 class={styles.subhead}>{t("parent.speed.title")}</h3>
          <LineChart
            points={speed}
            format={wpmText}
            label={trendSummary(points, "netWpm")}
            caption={t("parent.speed.caption")}
            scale={scale}
            testId={`speed-${id}`}
          />
        </div>
        <div class={styles.chartBox}>
          <h3 class={styles.subhead}>{t("parent.accuracy.title")}</h3>
          <LineChart
            points={accuracy}
            format={pctText}
            label={trendSummary(points, "accuracyPct")}
            min={accMin}
            max={100}
            caption={t("parent.accuracy.caption")}
            scale={scale}
            testId={`accuracy-${id}`}
          />
        </div>
      </div>
      <NumbersToggle>
        <DataTable
          caption={t("parent.trend.title")}
          columns={[
            { label: t(weekly ? "parent.trend.colWeek" : "parent.trend.colSession") },
            ...(weekly ? [{ label: t("parent.trend.colSessions"), numeric: true }] : []),
            { label: t("parent.speed.col"), numeric: true },
            { label: t("parent.accuracy.col"), numeric: true },
          ]}
          rows={points.map((p) => [
            p.label,
            ...(weekly ? [p.sessions] : []),
            wpmText(p.netWpm),
            pctText(p.accuracyPct),
          ])}
        />
      </NumbersToggle>
    </div>
  );
}

export function ParentDashboard({ app, profile, now, download }: ParentDashboardProps) {
  const root = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const today = (now ?? (() => realClock.epoch()))();
  const scale = scaleOf(profile);
  const name = profile.name;
  const lessons = app.lessons;
  const layout = layoutById(profile.settings.layout) ?? EN_US;

  const recent = sessionTrend(profile);
  const weeks = weeklyTrend(profile);
  const days = minutesPerDay(profile, today);
  const heat = keyHeat(profile, layout);
  const weak = weakKeys(heat);
  const heatKnown = heat.some((k) => k.rate !== null);
  const pairs = profile.ageBand === "builder" ? weakBigrams(profile) : null;
  const biomes = curriculumProgress(profile, lessons);
  const rows = sessionRows(profile, lessons);
  const newest = rows.slice(-RECENT_SESSIONS).toReversed();
  const all = totals(profile);

  useEffect(() => {
    root.current?.querySelector<HTMLElement>("[data-parent-back] button")?.focus();
  }, []);

  useScreenInput(app, (i) => {
    if (i.kind !== "control") return false;
    const step = arrowStep(i.action);
    if (step === null || i.action === "left" || i.action === "right") return false;
    const r = root.current;
    if (!r) return false;
    const items = navTargets(r);
    const at = items.findIndex((el) => el === document.activeElement);
    const next = at === -1 ? items[0] : items[(at + step + items.length) % items.length];
    next?.focus();
    return next !== undefined;
  });

  const exportCsv = (): void => {
    if (profile.history.length === 0) return;
    const file = csvFileName(name, localDate(today));
    (download ?? downloadBlob)(csvBlob(toCsv(sessionsCsv(profile, lessons))), file);
    setSaved(file);
  };

  const minutesTotal = Math.round(days.reduce((n, d) => n + d.minutes, 0));
  const activeDays = days.filter((d) => d.minutes > 0).length;

  return (
    <div class={`${screen.screen} ${styles.page}`} ref={root} data-parent="">
      <h1 class={screen.title}>{t("parent.title", { name })}</h1>
      <p class={styles.intro}>{t("parent.intro")}</p>
      <p class={styles.intro} data-parent-totals="">
        {t("parent.totals", { sessions: all.sessions, minutes: all.minutes })}
      </p>
      <div class={screen.actions}>
        <span data-nav="" data-parent-back="">
          <Button variant="primary" onClick={() => app.back()}>
            {t("parent.back")}
          </Button>
        </span>
        <span data-nav="" data-parent-csv="">
          <Button onClick={exportCsv} disabled={profile.history.length === 0}>
            {t("parent.download")}
          </Button>
        </span>
      </div>
      <output class={styles.intro} data-parent-saved="">
        {saved !== null
          ? t("parent.downloaded", { file: saved })
          : profile.history.length === 0
            ? t("parent.downloadNone", { name })
            : null}
      </output>

      <div class={styles.grid}>
        <Panel heading={t("parent.trend.title")} class={styles.wide ?? ""}>
          {recent.length === 0 ? (
            <p class={styles.empty} data-empty="trend">
              {t("parent.trend.empty", { name })}
            </p>
          ) : (
            <Tabs
              label={t("parent.trend.span")}
              tabs={[
                {
                  id: "recent",
                  label: t("parent.trend.recent", { count: TREND_SESSIONS }),
                  content: <TrendCharts points={recent} weekly={false} scale={scale} />,
                },
                {
                  id: "weekly",
                  label: t("parent.trend.weekly"),
                  content: <TrendCharts points={weeks} weekly scale={scale} />,
                },
              ]}
            />
          )}
        </Panel>

        <Panel heading={t("parent.minutes.title")}>
          {noMinutes(days) ? (
            <p class={styles.empty} data-empty="minutes">
              {t("parent.minutes.empty", { days: MINUTE_DAYS })}
            </p>
          ) : (
            <>
              <BarChart
                bars={days.map((d) => ({ label: d.label, value: d.minutes }))}
                format={minText}
                label={t("parent.minutes.summary", {
                  days: MINUTE_DAYS,
                  total: minutesTotal,
                  active: activeDays,
                })}
                caption={t("parent.minutes.caption", { days: MINUTE_DAYS })}
                labelEvery={7}
                scale={scale}
                testId="minutes"
              />
              <NumbersToggle>
                <DataTable
                  caption={t("parent.minutes.title")}
                  columns={[
                    { label: t("parent.minutes.colDay") },
                    { label: t("parent.minutes.colMinutes"), numeric: true },
                  ]}
                  rows={days.map((d) => [d.label, minText(d.minutes)])}
                />
              </NumbersToggle>
            </>
          )}
        </Panel>

        <Panel heading={t("parent.keys.title")}>
          {!heatKnown ? (
            <p class={styles.empty} data-empty="keys">
              {t("parent.keys.empty")}
            </p>
          ) : (
            <>
              <KeyHeatmap
                keys={heat}
                label={
                  weak.length === 0
                    ? t("parent.keys.summaryNone")
                    : t("parent.keys.summary", {
                        list: weak.map((k) => keyCapLabel(k.char)).join(", "),
                      })
                }
                caption={t("parent.keys.caption")}
                testId="keys"
              />
              <h3 class={styles.subhead}>{t("parent.keys.top")}</h3>
              {weak.length === 0 ? (
                <p class={styles.empty}>{t("parent.keys.topNone")}</p>
              ) : (
                <ol class={styles.list} data-weak-keys="">
                  {weak.map((k) => (
                    <li key={k.code}>
                      {t("parent.keys.item", {
                        key: keyCapLabel(k.char),
                        pct: Math.round((k.rate ?? 0) * 100),
                      })}
                    </li>
                  ))}
                </ol>
              )}
              <NumbersToggle>
                <DataTable
                  caption={t("parent.keys.title")}
                  columns={[
                    { label: t("parent.keys.colKey") },
                    { label: t("parent.keys.colMistakes"), numeric: true },
                    { label: t("parent.keys.colPresses"), numeric: true },
                  ]}
                  rows={heat
                    .filter((k) => k.attempts > 0)
                    .map((k) => [keyCapLabel(k.char), ratePctLabel(k.rate), k.attempts])}
                />
              </NumbersToggle>
            </>
          )}
        </Panel>

        {pairs === null ? null : (
          <Panel heading={t("parent.pairs.title")}>
            {pairs.length === 0 ? (
              <p class={styles.empty} data-empty="pairs">
                {t("parent.pairs.empty")}
              </p>
            ) : (
              <>
                <p class={styles.caption}>{t("parent.pairs.caption")}</p>
                <ol class={styles.list} data-weak-pairs="">
                  {pairs.map((p) => (
                    <li key={p.pair}>
                      {t("parent.pairs.item", {
                        pair: p.pair.replaceAll(" ", `(${t("parent.pairs.space")})`),
                        pct: p.ratePct,
                      })}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </Panel>
        )}

        <Panel heading={t("parent.lessons.title")} class={styles.wide ?? ""}>
          <p class={styles.caption}>{t("parent.lessons.caption")}</p>
          <ul class={styles.biomes} data-biomes="">
            {biomes.map((b) => (
              <li key={b.biome} class={styles.biome} data-biome={b.biome}>
                <span class={styles.biomeName}>{b.name}</span>
                <span class={styles.meter} aria-hidden="true">
                  <span
                    class={styles.meterFill}
                    style={{ width: `${b.maxStars === 0 ? 0 : (b.stars / b.maxStars) * 100}%` }}
                  />
                </span>
                <span class={styles.biomeStats}>
                  <span data-stars="">
                    {t("parent.lessons.stars", { stars: b.stars, max: b.maxStars })}
                  </span>
                  <span>
                    {t("parent.lessons.played", { done: b.played, total: b.lessons.length })}
                  </span>
                  {b.testedOut > 0 ? (
                    <span data-tested-out="">
                      {t("parent.lessons.testedOutCount", { count: b.testedOut })}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <NumbersToggle label={t("parent.lessons.showAll")}>
            <DataTable
              caption={t("parent.lessons.title")}
              columns={[
                { label: t("parent.lessons.colLesson") },
                { label: t("parent.lessons.colStars"), numeric: true },
                { label: t("parent.lessons.colSpeed"), numeric: true },
                { label: t("parent.lessons.colAccuracy"), numeric: true },
              ]}
              rows={biomes.flatMap((b) =>
                b.lessons.map((l) =>
                  l.state === "testedOut"
                    ? [
                        l.title,
                        l.stars,
                        t("parent.lessons.testedOut"),
                        t("parent.lessons.testedOut"),
                      ]
                    : l.state === "notYet"
                      ? [l.title, 0, t("parent.lessons.notYet"), t("parent.lessons.notYet")]
                      : [l.title, l.stars, wpmText(l.bestWpm ?? 0), pctText(l.bestPct ?? 0)],
                ),
              )}
            />
          </NumbersToggle>
        </Panel>

        <Panel heading={t("parent.sessions.title")} class={styles.wide ?? ""}>
          {newest.length === 0 ? (
            <p class={styles.empty} data-empty="sessions">
              {t("parent.sessions.empty")}
            </p>
          ) : (
            <>
              <p class={styles.caption}>{t("parent.sessions.caption", { count: newest.length })}</p>
              {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- reason: a scroll area must take focus to scroll by keyboard */}
              <div class={styles.sessions} data-sessions="" tabIndex={0}>
                <DataTable
                  caption={t("parent.sessions.title")}
                  columns={[
                    { label: t("parent.sessions.colDate") },
                    { label: t("parent.sessions.colActivity") },
                    { label: t("parent.sessions.colMinutes"), numeric: true },
                    { label: t("parent.sessions.colSpeed"), numeric: true },
                    { label: t("parent.sessions.colAccuracy"), numeric: true },
                  ]}
                  rows={newest.map((r) => [
                    `${shortDate(r.date)} ${r.time}`,
                    r.activity,
                    minText(r.minutes),
                    wpmText(r.netWpm),
                    pctText(r.accuracyPct),
                  ])}
                />
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** No player picked yet: say so kindly, with the way back. */
function NoPlayer({ app }: { app: AppApi }) {
  useEffect(() => {
    document.querySelector<HTMLElement>("[data-parent-back] button")?.focus();
  }, []);
  return (
    <div class={screen.screen}>
      <p class={screen.text}>{t("parent.noProfile")}</p>
      <span data-parent-back="">
        <Button variant="primary" onClick={() => app.back()}>
          {t("parent.back")}
        </Button>
      </span>
    </div>
  );
}

export default function Parent({ app }: ScreenProps) {
  // Asked once per visit: a pass handed over from Settings, or the gate here.
  const [passed, setPassed] = useState(takeGrownUpPass);
  const profile = app.profile();
  if (profile === null) return <NoPlayer app={app} />;
  if (!passed) {
    return (
      <div class={screen.screen}>
        <Panel class={styles.gate ?? ""}>
          <ParentGate
            action="parentDashboard"
            onPass={() => setPassed(true)}
            onCancel={() => app.back()}
          />
        </Panel>
      </div>
    );
  }
  return <ParentDashboard app={app} profile={profile} />;
}
