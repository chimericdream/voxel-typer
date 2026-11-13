/**
 * The app view (task M2-10): the current screen (or the play overlays), save notices and the
 * footer disclaimer. The shared canvas lives outside Preact (see `main.ts`), so screens never
 * remount it.
 */
import type { ReadonlySignal } from "@preact/signals";
import type { ComponentType } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { fingerLabelsOn, hearAgainKey, hearAgainShown } from "@/a11y/options";
import { EN_US, layoutById } from "@/content/layouts";
import { t } from "@/i18n";
import { Button } from "@/ui/kit/Button";
import { Panel } from "@/ui/kit/Panel";
import { Toast } from "@/ui/kit/Toast";
import type { AchievementToastProps } from "@/ui/components/AchievementToast";
import { ComingSoon } from "@/ui/screens/ComingSoon";
import { Hud } from "@/ui/hud/Hud";
import { Pause } from "@/ui/screens/Pause";
import styles from "./App.module.css";
import { realClock } from "./clock";
import { FOOTER_ROUTES, screens } from "./routes";
import type { Route } from "./routes";
import type { Shell } from "./shell";
import type { ScreenProps } from "./types";

/** The screen kit's coming-soon panel (M2-11), wired to the shell. */
function Soon({ shell }: { shell: Shell }) {
  const { api } = shell;
  const id = api.route().id;
  const toMap = id !== "map" && api.profile() !== null;
  return (
    <ComingSoon
      onBack={api.canGoBack() ? () => api.back() : null}
      onMap={toMap ? () => api.navigate({ id: "map" }) : null}
      onStart={toMap || id === "splash" ? null : () => api.navigate({ id: "splash" })}
    />
  );
}

function ScreenView({ shell, route }: { shell: Shell; route: Route }) {
  const loader = screens[route.id];
  const [loaded, setLoaded] = useState<{
    id: string;
    Screen: ComponentType<ScreenProps>;
  } | null>(null);

  useEffect(() => {
    if (loader === undefined) return undefined;
    let live = true;
    const p = loader().then((m) => {
      if (live) setLoaded({ id: route.id, Screen: m.default });
    });
    shell.api.whenReady(p);
    return () => {
      live = false;
    };
  }, [route.id, loader, shell.api]);

  if (loader === undefined) return <Soon shell={shell} />;
  if (loaded === null || loaded.id !== route.id) return null;
  const { Screen } = loaded;
  return <Screen app={shell.api} route={route} />;
}

/**
 * Builder's own HUD (M4-07): the command line and palette, in place of the lesson HUD. Loaded
 * with the mode, so it stays out of the first bundle.
 */
function BuilderHudView({ shell }: { shell: Shell }) {
  const [View, setView] = useState<ComponentType<{ fields: Shell["hud"]["fields"] }> | null>(null);
  useEffect(() => {
    let live = true;
    const p = import("@/modes/builder/BuilderHud").then((m) => {
      if (live) setView(() => m.default);
    });
    shell.api.whenReady(p);
    return () => {
      live = false;
    };
  }, [shell]);
  return View === null ? null : <View fields={shell.hud.fields} />;
}

function PlayView({ shell, localVoice }: { shell: Shell; localVoice: boolean }) {
  const status = shell.playStatus.value;
  if (status === "failed") return <Soon shell={shell} />;
  if (status === "loading") {
    return (
      <div class={styles.center}>
        <Panel tone="plate">
          <p class={styles.text}>{t("app.play.loading")}</p>
        </Panel>
      </div>
    );
  }
  if (status !== "running" && status !== "paused" && status !== "break") return null;
  const profile = shell.profile.value;
  // The HUD stays under the pause overlay (the Dialog makes it inert), so nothing jumps on resume.
  return (
    <>
      {shell.play.modeId() === "builder" ? (
        <BuilderHudView shell={shell} />
      ) : profile ? (
        <Hud
          fields={shell.hud.fields}
          settings={profile.settings}
          band={profile.ageBand}
          layout={layoutById(profile.settings.layout) ?? EN_US}
          labels={fingerLabelsOn(profile.settings, profile.ageBand)}
          hearAgainKey={
            hearAgainShown(profile.settings, localVoice) ? hearAgainKey(profile.ageBand) : null
          }
        />
      ) : null}
      {status === "running" ? null : (
        <Pause
          kind={status === "break" ? "break" : "pause"}
          onResume={() => shell.play.resume(realClock.now())}
          onQuit={() => shell.quitPlay()}
        />
      )}
    </>
  );
}

function Notices({ shell }: { shell: Shell }) {
  const list = shell.notices.value;
  if (list.length === 0) return null;
  return (
    <div class={styles.notices}>
      {list.map((n) => (
        <div key={n.id} class={styles.notice}>
          <Toast tone="info">{t(`app.save.${n.kind}`)}</Toast>
          <Button variant="secondary" onClick={() => shell.dismissNotice(n.id)}>
            {t("app.save.dismiss")}
          </Button>
        </div>
      ))}
    </div>
  );
}

/**
 * How long a screen must have been shown before a badge toast opens on it (M3-10 review B1). The
 * route announcer reads the new screen's name (and on Results the stars) as soon as the route
 * changes, through the page's one live region. A toast that announced itself at the same moment
 * would wipe that message, or be wiped by it, so the toast waits until it has been read.
 */
export const BADGE_SETTLE_MS = 1500;

/**
 * Badge toasts (M3-10) never open on the `play` route, whatever the lesson's status: they wait for
 * Results or the next menu, and then for {@link BADGE_SETTLE_MS} on it. A pause is a modal dialog
 * (the rest of the page is inert), so they wait through a pause too.
 */
function Badges({ shell }: { shell: Shell }) {
  const onShown = useCallback(() => shell.nextBadgeToast(), [shell]);
  const queue = shell.badgeToasts.value;
  const route = shell.route.value;
  const onPlay = route.id === "play";
  // Each new route starts unsettled; the timer settles it.
  const [settledOn, setSettledOn] = useState<typeof route | null>(null);
  useEffect(() => {
    if (onPlay) return undefined;
    const timer = setTimeout(() => setSettledOn(route), BADGE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [route, onPlay]);
  // Loaded with the first badge: it draws block icons, which the first screen doesn't need.
  const [View, setView] = useState<ComponentType<AchievementToastProps> | null>(null);
  const want = queue.length > 0;
  useEffect(() => {
    if (!want || View !== null) return;
    void import("@/ui/components/AchievementToast").then((m) => setView(() => m.AchievementToast));
  }, [want, View]);
  if (View === null) return null;
  // needsPlace (M3-FIX-12): only on a screen that made room for it (Results' dock, the map's corner).
  return <View queue={queue} open={!onPlay && settledOn === route} onShown={onShown} needsPlace />;
}

export interface AppProps {
  shell: Shell;
  /** True while the device has an English voice of its own (`src/a11y/voice.ts`). */
  localVoice?: ReadonlySignal<boolean>;
}

export function App({ shell, localVoice }: AppProps) {
  const route = shell.route.value;
  const voice = localVoice?.value ?? false;
  return (
    <div class={styles.app} data-route={route.id}>
      <main class={styles.main}>
        {route.id === "play" ? (
          <PlayView shell={shell} localVoice={voice} />
        ) : (
          <ScreenView key={route.id} shell={shell} route={route} />
        )}
      </main>
      <Notices shell={shell} />
      <Badges shell={shell} />
      {FOOTER_ROUTES.has(route.id) ? (
        <footer class={styles.footer}>{t("common.notAffiliated")}</footer>
      ) : null}
    </div>
  );
}
