/**
 * The app view (task M2-10): the current screen (or the play overlays), save notices and the
 * footer disclaimer. The shared canvas lives outside Preact (see `main.ts`), so screens never
 * remount it.
 */
import type { ReadonlySignal } from "@preact/signals";
import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { fingerLabelsOn, hearAgainKey, hearAgainShown } from "@/a11y/options";
import { EN_US, layoutById } from "@/content/layouts";
import { t } from "@/i18n";
import { Button } from "@/ui/kit/Button";
import { Panel } from "@/ui/kit/Panel";
import { Toast } from "@/ui/kit/Toast";
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
      {profile ? (
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
      {FOOTER_ROUTES.has(route.id) ? (
        <footer class={styles.footer}>{t("common.notAffiliated")}</footer>
      ) : null}
    </div>
  );
}
