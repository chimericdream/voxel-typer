/**
 * The app view (task M2-10): the current screen (or the play overlays), save notices and the
 * footer disclaimer. The shared canvas lives outside Preact (see `main.ts`), so screens never
 * remount it.
 */
import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { t } from "@/i18n";
import { Button } from "@/ui/kit/Button";
import { Panel } from "@/ui/kit/Panel";
import { Toast } from "@/ui/kit/Toast";
import { Pause } from "@/ui/screens/Pause";
import styles from "./App.module.css";
import { realClock } from "./clock";
import { FOOTER_ROUTES, screens } from "./routes";
import type { Route } from "./routes";
import type { Shell } from "./shell";
import type { ScreenProps } from "./types";

function ComingSoon({ shell }: { shell: Shell }) {
  const { api } = shell;
  return (
    <div class={styles.center}>
      {api.route().id === "splash" ? <h1 class={styles.title}>{t("common.appName")}</h1> : null}
      <Panel heading={t("app.comingSoon.title")}>
        <p class={styles.text}>{t("app.comingSoon.body")}</p>
        <div class={styles.actions}>
          {api.canGoBack() ? (
            <Button onClick={() => api.back()}>{t("app.comingSoon.back")}</Button>
          ) : null}
          {api.route().id === "splash" ? null : (
            <Button variant="secondary" onClick={() => api.navigate({ id: "splash" })}>
              {t("app.comingSoon.start")}
            </Button>
          )}
        </div>
      </Panel>
    </div>
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

  if (loader === undefined) return <ComingSoon shell={shell} />;
  if (loaded === null || loaded.id !== route.id) return null;
  const { Screen } = loaded;
  return <Screen app={shell.api} route={route} />;
}

function PlayView({ shell }: { shell: Shell }) {
  const status = shell.playStatus.value;
  if (status === "failed") return <ComingSoon shell={shell} />;
  if (status === "loading") {
    return (
      <div class={styles.center}>
        <Panel tone="plate">
          <p class={styles.text}>{t("app.play.loading")}</p>
        </Panel>
      </div>
    );
  }
  if (status === "paused" || status === "break") {
    return (
      <Pause
        kind={status === "break" ? "break" : "pause"}
        onResume={() => shell.play.resume(realClock.now())}
        onQuit={() => shell.quitPlay()}
      />
    );
  }
  return null;
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

export function App({ shell }: { shell: Shell }) {
  const route = shell.route.value;
  return (
    <div class={styles.app} data-route={route.id}>
      <main class={styles.main}>
        {route.id === "play" ? (
          <PlayView shell={shell} />
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
