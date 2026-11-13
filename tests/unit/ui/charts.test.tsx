/** @jsxImportSource preact */
/**
 * Parent Dashboard charts and screen (task M3-11): the hand-rolled SVG charts, the gate, empty
 * states, tested-out and remedial rules, and the CSV holding the numbers the page shows.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCsv } from "../../../src/app/csv";
import { testedOut } from "../../../src/app/progress";
import { EN_US } from "../../../src/content/layouts";
import { lessons } from "../../../src/content/lessons";
import { t } from "../../../src/i18n";
import type { Profile, StoredSummary } from "../../../src/save/schema";
import { BarChart, columnPath } from "../../../src/ui/charts/BarChart";
import { niceTicks } from "../../../src/ui/charts/ChartFrame";
import { KeyHeatmap } from "../../../src/ui/charts/KeyHeatmap";
import { LineChart } from "../../../src/ui/charts/LineChart";
import {
  clearGrownUpPass,
  handGrownUpPass,
  PASS_CHECK_MS,
  PASS_TTL_MS,
  takeGrownUpPass,
} from "../../../src/ui/components/ParentGate";
import { contrastRatio, parseColor } from "../../../src/ui/theme/themes";
import { ParentDashboard } from "../../../src/ui/screens/Parent";
import {
  keyHeat,
  RECENT_SESSIONS,
  weakBigrams,
  weakKeys,
} from "../../../src/ui/screens/parent-logic";
import type { Harness } from "./screens/harness";
import { buttonByText, fixture, mount, text } from "./screens/harness";

let host: HTMLElement | null = null;
let h: Harness | null = null;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
  h?.unmount();
  h = null;
});

function draw(node: preact.ComponentChild): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  void act(() => render(node, host!));
  return host;
}

const stored = (over: Partial<StoredSummary> = {}): StoredSummary => ({
  lessonId: "meadow-01",
  mode: "mine",
  seed: 1,
  startedAtT: 0,
  activeMs: 120_000,
  keystrokes: 200,
  correct: 190,
  errors: 10,
  uncorrected: 0,
  grossWpm: 19,
  netWpm: 19,
  accuracy: 0.95,
  consistency: 0.5,
  longestStreak: 20,
  targetsCompleted: 10,
  at: new Date(2026, 10, 10, 16, 30).getTime(),
  ...over,
});

describe("chart maths", () => {
  it("ticks are clean steps that reach the data", () => {
    expect(niceTicks(0, 34)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(80, 100)).toEqual([80, 85, 90, 95, 100]);
    expect(niceTicks(0, 1)).toEqual([0, 0.5, 1]);
    // A floor that isn't a step multiple: the axis still reaches the top (95% stays inside).
    expect(niceTicks(30, 100)).toEqual([20, 40, 60, 80, 100]);
    expect(niceTicks(1, 10)).toEqual([0, 5, 10]);
  });

  it("a column is square at the baseline and rounded at the top", () => {
    const d = columnPath(10, 100, 20, 50);
    expect(d.startsWith("M10,100 V54")).toBe(true);
    expect(d).toContain("Q10,50 14,50");
    expect(d.endsWith("V100 Z")).toBe(true);
  });
});

describe("LineChart", () => {
  it("draws one dot per point, a direct label on the newest only, and an accessible name", () => {
    const root = draw(
      <LineChart
        points={[
          { label: "Nov 1", value: 20 },
          { label: "Nov 2", value: 24 },
          { label: "Nov 3", value: 31 },
        ]}
        format={(v) => String(v)}
        label="Speed summary"
        caption="Higher is better."
        scale={1}
        testId="speed"
      />,
    );
    const svg = root.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Speed summary");
    expect(root.querySelectorAll("circle[r='4']")).toHaveLength(3);
    expect(root.querySelector("path")?.getAttribute("d")?.split("L")).toHaveLength(3);
    const labels = [...root.querySelectorAll("text")].map((n) => n.textContent);
    expect(labels).toContain("31");
    expect(labels).toContain("Nov 1");
    expect(labels).toContain("Nov 3");
    expect(labels).not.toContain("24");
    expect(text(root.querySelector("figcaption"))).toBe("Higher is better.");
    expect([...root.querySelectorAll("title")].map((n) => n.textContent)).toContain(
      t("parent.chart.point", { label: "Nov 2", value: "24" }),
    );
  });
});

describe("BarChart", () => {
  it("skips empty days and labels only the highest one", () => {
    const root = draw(
      <BarChart
        bars={[
          { label: "a", value: 0 },
          { label: "b", value: 12.5 },
          { label: "c", value: 4 },
        ]}
        format={(v) => String(v)}
        label="Minutes summary"
        labelEvery={1}
        scale={1}
        testId="minutes"
      />,
    );
    expect(root.querySelectorAll("path")).toHaveLength(2);
    const labels = [...root.querySelectorAll("text")].map((n) => n.textContent);
    expect(labels).toContain("12.5");
    expect(labels).not.toContain("4");
  });
});

describe("KeyHeatmap", () => {
  it("prints each key's rate on the key; few presses get no color", () => {
    const base = fixture("pinky-weak");
    const p: Profile = {
      ...base,
      keyStats: {
        ...base.keyStats,
        q: { ...stat(), attempts: 100, recentErrRate: 0.25 },
        w: { ...stat(), attempts: 5, recentErrRate: 0.5 },
        e: { ...stat(), attempts: 100, recentErrRate: 0.01 },
      },
    };
    const keys = keyHeat(p, EN_US);
    const root = draw(<KeyHeatmap keys={keys} label="Keys" testId="keys" />);
    const key = (code: string) => root.querySelector(`[data-key='${code}']`);
    expect(key("KeyQ")?.getAttribute("data-bin")).toBe("4");
    expect(text(key("KeyQ"))).toContain("25%");
    expect(key("KeyW")?.getAttribute("data-bin")).toBe("none");
    expect(text(key("KeyW"))).toContain("–");
    expect(key("KeyE")?.getAttribute("data-bin")).toBe("0");
    expect(root.querySelectorAll("[data-key]")).toHaveLength(keys.length);
    // The legend names every step in numbers, not color alone.
    expect(text(root.querySelector("ul"))).toContain(t("parent.keys.over", { pct: 20 }));
  });
});

describe("keys and pairs to practice", () => {
  it("none stand out when every key is alike (the veteran fixture: all 3%)", () => {
    expect(weakKeys(keyHeat(fixture("veteran-builder"), EN_US))).toEqual([]);
  });

  it("lists only keys well above the typical key, highest first", () => {
    const base = fixture("veteran-builder");
    const p: Profile = {
      ...base,
      keyStats: {
        ...base.keyStats,
        q: { ...stat(), attempts: 100, recentErrRate: 0.12 },
        p: { ...stat(), attempts: 100, recentErrRate: 0.06 },
        z: { ...stat(), attempts: 100, recentErrRate: 0.045 },
      },
    };
    expect(weakKeys(keyHeat(p, EN_US)).map((k) => k.char)).toEqual(["q", "p"]);
  });

  it("pairs follow the same rule", () => {
    const p: Profile = {
      ...fixture("veteran-builder"),
      bigramStats: { th: pair(0.02), he: pair(0.02), in: pair(0.02), qu: pair(0.1) },
    };
    expect(weakBigrams(p).map((x) => [x.pair, x.ratePct])).toEqual([["qu", 10]]);
  });
});

function pair(rate: number) {
  return { ...stat(), attempts: 40, recentErrRate: rate };
}

function stat() {
  return {
    attempts: 0,
    errors: 0,
    recentErrRate: 0,
    latencyMedian: null,
    recentLatencies: [],
    lastSeenSession: 1,
    srs: { intervalSessions: 1, dueSession: 2 },
  };
}

async function dashboard(profile: Profile, now = new Date(2026, 11, 10, 12).getTime()) {
  h = await mount({ initial: { id: "splash" }, initialProfile: profile });
  const download = vi.fn<(blob: Blob, name: string) => void>();
  const root = draw(
    <ParentDashboard app={h.shell.api} profile={profile} now={() => now} download={download} />,
  );
  return { root, download };
}

const cells = (tr: Element): string[] => [...tr.children].map((c) => text(c));

describe("Parent Dashboard", () => {
  it("draws every chart from the veteran-builder fixture", async () => {
    const p = fixture("veteran-builder");
    const { root } = await dashboard(p);
    expect(text(root.querySelector("h1"))).toBe(t("parent.title", { name: p.name }));
    for (const id of ["speed-recent", "accuracy-recent", "minutes", "keys"]) {
      expect(root.querySelector(`[data-chart='${id}'] svg[role='img']`)).not.toBeNull();
    }
    expect(root.querySelectorAll("[data-chart='speed-recent'] circle[r='4']")).toHaveLength(30);
    const shipped = new Set(lessons.map((l) => l.biome));
    expect(root.querySelectorAll("[data-biome]")).toHaveLength(shipped.size);
    expect(root.querySelector("[data-empty='trend']")).toBeNull();
    // Builder band: the letter-pair panel is there (the fixture has no pair stats yet).
    expect(root.querySelector("[data-empty='pairs']")).not.toBeNull();
    // Every key is at 3% in the fixture, so none is singled out.
    expect(root.querySelector("[data-weak-keys]")).toBeNull();
    expect(text(root)).toContain(t("parent.keys.topNone"));
    // Every label in the charts and tables went through t(): no raw keys on the page.
    expect(text(root)).not.toMatch(/parent\.[a-z]+\./);
  });

  it("the weekly tab shows week averages", async () => {
    const { root } = await dashboard(fixture("veteran-builder"));
    const tab = buttonByText(root, t("parent.trend.weekly"));
    void act(() => tab.click());
    expect(root.querySelector("[data-trend='weekly']")).not.toBeNull();
    expect(
      root.querySelectorAll("[data-chart='speed-weekly'] circle[r='4']").length,
    ).toBeGreaterThan(1);
  });

  it("the CSV holds exactly the numbers in Recent sessions", async () => {
    const p = fixture("veteran-builder");
    const { root, download } = await dashboard(p);
    void act(() => buttonByText(root, t("parent.download")).click());
    expect(download).toHaveBeenCalledOnce();
    const [blob, name] = download.mock.calls[0] ?? [new Blob(), ""];
    expect(name).toMatch(/^voxel-typer-sessions-captain-quill-2026-12-10\.csv$/);
    const csv = parseCsv(await blob.text());
    expect(csv).toHaveLength(p.history.length + 1);

    const shown = [...root.querySelectorAll("[data-sessions] tbody tr")].map(cells);
    expect(shown).toHaveLength(RECENT_SESSIONS);
    // Newest first on the page, oldest first in the file.
    const tail = csv.slice(-RECENT_SESSIONS).toReversed();
    shown.forEach((row, i) => {
      const line = tail[i] ?? [];
      const [player, , time, activity, minutes, wpm, accuracy] = line;
      expect(player).toBe(p.name);
      expect(row[0]).toContain(time ?? "?");
      expect(row.slice(1)).toEqual([activity, minutes, wpm, `${accuracy}%`]);
    });
    expect(text(root.querySelector("[data-parent-saved]"))).toContain(name);
  });

  it("an empty profile gets friendly empty states and no download", async () => {
    const p = fixture("fresh-sprout");
    const { root, download } = await dashboard(p);
    for (const id of ["trend", "minutes", "keys", "sessions"]) {
      expect(root.querySelector(`[data-empty='${id}']`)).not.toBeNull();
    }
    expect(root.querySelector("svg")).toBeNull();
    // Not the Builder band: no letter-pair panel at all.
    expect(root.querySelector("[data-empty='pairs']")).toBeNull();
    expect(text(root.querySelector("[data-empty='trend']"))).toBe(
      t("parent.trend.empty", { name: p.name }),
    );
    void act(() => buttonByText(root, t("parent.download")).click());
    expect(download).not.toHaveBeenCalled();
    expect(text(root.querySelector("[data-parent-saved]"))).toBe(
      t("parent.downloadNone", { name: p.name }),
    );
  });

  it("tested-out lessons say so instead of a zero score; remedial shows as Practice", async () => {
    const base = fixture("fresh-builder");
    const p: Profile = {
      ...base,
      progress: { ...base.progress, lessons: { "meadow-01": testedOut(0) } },
      history: [stored({ lessonId: "remedial-k2", at: new Date(2026, 11, 10, 9).getTime() })],
    };
    const { root } = await dashboard(p);
    const meadow = root.querySelector("[data-biome='meadow']");
    expect(text(meadow?.querySelector("[data-tested-out]") ?? null)).toBe(
      t("parent.lessons.testedOutCount", { count: 1 }),
    );
    const lessonRows = [...root.querySelectorAll("table")]
      .find((tb) => text(tb.querySelector("caption")) === t("parent.lessons.title"))
      ?.querySelectorAll("tbody tr");
    const first = lessonRows?.[0];
    expect(cells(first ?? document.createElement("tr")).slice(2)).toEqual([
      t("parent.lessons.testedOut"),
      t("parent.lessons.testedOut"),
    ]);
    const session = root.querySelector("[data-sessions] tbody tr");
    expect(cells(session ?? document.createElement("tr"))[1]).toBe(t("parent.activity.practice"));
  });
});

describe("Parent route", () => {
  it("asks the parent gate on a direct visit, then shows the dashboard", async () => {
    h = await mount({ initial: { id: "splash" }, initialProfile: fixture("veteran-builder") });
    h.shell.api.navigate({ id: "parent" });
    await h.settle();
    expect(h.root.querySelector("[data-gate='parentDashboard']")).not.toBeNull();
    expect(h.root.querySelector("[data-parent]")).toBeNull();
    await h.type(text(h.root.querySelector("[data-gate-word]")));
    await h.press("Enter");
    expect(h.root.querySelector("[data-parent]")).not.toBeNull();
    expect(document.activeElement).toBe(h.root.querySelector("[data-parent-back] button"));
    await h.press("ArrowDown");
    expect(document.activeElement).toBe(h.root.querySelector("[data-parent-csv] button"));
    await h.press("ArrowDown");
    expect(document.activeElement).toBe(h.root.querySelector("[role='tab'][aria-selected='true']"));
    await h.press("Escape");
    expect(h.route().id).toBe("splash");
  });

  it("from Settings → Grown-ups, the passed gate carries over", async () => {
    h = await mount({ initial: { id: "settings" }, initialProfile: fixture("veteran-builder") });
    const tab = buttonByText(h.root, t("settings.tab.grownUps"));
    void act(() => tab.click());
    await h.settle();
    await h.type(text(h.root.querySelector("[data-gate-word]")));
    await h.press("Enter");
    const go = buttonByText(h.root, t("settings.grown.progressGo", { name: "Captain Quill" }));
    void act(() => go.click());
    await h.settle();
    expect(h.route().id).toBe("parent");
    expect(h.root.querySelector("[data-gate]")).toBeNull();
    expect(h.root.querySelector("[data-parent]")).not.toBeNull();
  });

  it("without a player, it says so kindly", async () => {
    h = await mount({ initial: { id: "parent" } });
    await h.settle();
    expect(text(h.root)).toContain(t("parent.noProfile"));
  });
});

describe("heat map ink", () => {
  it("every step's printed percent is at least 4.5:1 in every theme", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "../../../src/ui/charts/charts.module.css"),
      "utf8",
    );
    // One block per theme: the default (day), night and contrast.
    const blocks = css.split(/\n(?=[^\n]*\{)/).filter((b) => b.includes("--heat-ink-0: #"));
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      for (let i = 0; i < 5; i += 1) {
        const fill = new RegExp(`--heat-${i}: (#[0-9a-f]{6})`).exec(block)?.[1] ?? "";
        const ink = new RegExp(`--heat-ink-${i}: (#[0-9a-f]{6})`).exec(block)?.[1] ?? "";
        const ratio = contrastRatio(parseColor(fill), parseColor(ink));
        expect(ratio, `${block.split("{")[0]?.trim()} step ${i}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("the handed gate pass", () => {
  afterEach(() => {
    clearGrownUpPass();
    vi.useRealTimers();
  });

  it("is used once", () => {
    handGrownUpPass(() => true);
    expect(takeGrownUpPass()).toBe(true);
    expect(takeGrownUpPass()).toBe(false);
  });

  it("lapses when the app leaves the way to the dashboard before it loads", () => {
    vi.useFakeTimers();
    let going = true;
    handGrownUpPass(() => going);
    vi.advanceTimersByTime(PASS_CHECK_MS * 2);
    going = false;
    vi.advanceTimersByTime(PASS_CHECK_MS);
    expect(takeGrownUpPass()).toBe(false);
  });

  it("lapses after a while if the dashboard never takes it", () => {
    vi.useFakeTimers();
    handGrownUpPass(() => true);
    vi.advanceTimersByTime(PASS_TTL_MS);
    expect(takeGrownUpPass()).toBe(false);
  });

  it("from Settings: Back, then any later visit asks the gate again", async () => {
    h = await mount({ initial: { id: "settings" }, initialProfile: fixture("veteran-builder") });
    void act(() => buttonByText(h!.root, t("settings.tab.grownUps")).click());
    await h.settle();
    await h.type(text(h.root.querySelector("[data-gate-word]")));
    await h.press("Enter");
    void act(() =>
      buttonByText(h!.root, t("settings.grown.progressGo", { name: "Captain Quill" })).click(),
    );
    await h.settle();
    expect(h.root.querySelector("[data-parent]")).not.toBeNull();
    await h.press("Escape");
    expect(h.route().id).toBe("settings");
    h.shell.api.navigate({ id: "parent" });
    await h.settle();
    expect(h.root.querySelector("[data-gate='parentDashboard']")).not.toBeNull();
    expect(h.root.querySelector("[data-parent]")).toBeNull();
  });
});

describe("dashboard details", () => {
  it("Up/Down inside a table area are left to the browser to scroll it", async () => {
    h = await mount({ initial: { id: "splash" }, initialProfile: fixture("veteran-builder") });
    h.shell.api.navigate({ id: "parent" });
    await h.settle();
    await h.type(text(h.root.querySelector("[data-gate-word]")));
    await h.press("Enter");
    const area = h.root.querySelector<HTMLElement>("[data-sessions]");
    void act(() => area?.focus());
    await h.press("ArrowDown");
    expect(document.activeElement).toBe(area);
  });

  it("with only folded weeks, the trend panel still shows the week-by-week view", async () => {
    const p: Profile = {
      ...fixture("fresh-builder"),
      weekly: [
        { weekStart: "2026-01-05", minutes: 30, sessions: 3, avgNetWpm: 12, avgAccuracy: 0.9 },
        { weekStart: "2026-01-12", minutes: 40, sessions: 4, avgNetWpm: 14, avgAccuracy: 0.92 },
      ],
    };
    const { root, download } = await dashboard(p);
    expect(root.querySelector("[data-empty='trend']")).toBeNull();
    expect(text(root)).toContain(t("parent.trend.emptyRecent"));
    expect(text(root.querySelector("[data-compacted]"))).toBe("");
    void act(() => buttonByText(root, t("parent.download")).click());
    expect(download).toHaveBeenCalledOnce();
  });
});
