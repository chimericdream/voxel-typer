/**
 * Placement test screen (task M3-05, PLAN.md §3.2.8): "Find your level".
 *
 * Shown right after a new player is made, and once more on the next visit if that test was quit or
 * lost to a reload (`shouldOfferPlacement`, M3-FIX-3 N4). Not again in the same visit
 * (`AppApi.placementOffered`, M3-FIX-10). Before the test it explains it in two lines and
 * offers "Let's dig!" and a clear Skip (Skip = start at Meadow Home; Escape skips too). After the
 * test (`route.lesson` is set) it says where the player starts, never a score, and goes on to the
 * world map.
 */
import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { isTestedOut, placementEstimateOf, settleAtMeadow } from "@/app/progress";
import type { ScreenProps } from "@/app/types";
import { t } from "@/i18n";
import { PLACEMENT_LESSON_ID } from "@/modes/placement/lesson";
import type { ModeResult } from "@/modes/types";
import type { Profile } from "@/save/schema";
import { BIOME_ORDER } from "@/types/core";
import type { BiomeId } from "@/types/core";
import { Button } from "@/ui/kit/Button";
import { Panel } from "@/ui/kit/Panel";
import { focusOnControl, useScreenInput } from "./nav";
import screen from "./screen.module.css";

type App = ScreenProps["app"];

const biomeName = (b: BiomeId): string => t(`map.biome.${b}`);

/** What the "you start here" view says, from the saved start and the test's own estimate. */
export function outcomeLines(profile: Readonly<Profile>, result: ModeResult | null): string[] {
  const start = profile.progress.placement?.startBiome ?? "meadow";
  const name = biomeName(start);
  const lines = [t("placement.startAt", { name })];
  const estimate = result === null ? start : placementEstimateOf(profile, result).startBiome;
  if (BIOME_ORDER.indexOf(estimate) > BIOME_ORDER.indexOf(start)) {
    lines.push(t("placement.ahead", { ahead: biomeName(estimate), name }));
  } else if (start === "meadow") {
    lines.push(t("placement.meadow"));
  }
  const testedOut = Object.values(profile.progress.lessons).some(isTestedOut);
  if (testedOut) lines.push(t("placement.testedOut"));
  return lines;
}

function useFocusFirst(): RefObject<HTMLDivElement | null> {
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    actions.current?.querySelector("button")?.focus();
  }, []);
  return actions;
}

function Intro({ app }: { app: App }) {
  const actions = useFocusFirst();
  // Shown once this visit: "Who is playing?" won't offer it again until the next one (M3-FIX-10).
  useEffect(() => {
    const id = app.profile()?.id;
    if (id !== undefined) app.placementOffered().add(id);
  }, [app]);
  const start = (): void =>
    app.navigate({ id: "play", lesson: PLACEMENT_LESSON_ID }, { replace: true });
  const skip = (): void => {
    // Skip settles the start, so a reload later doesn't offer the test again (M3-FIX-3 N4).
    const p = app.profile();
    if (p !== null && p.progress.placement === undefined)
      void app.saveProfile(settleAtMeadow(p, Date.now()));
    app.navigate({ id: "map" }, { replace: true });
  };

  useScreenInput(app, (i) => {
    if (i.kind !== "control") return false;
    // Escape skips: there is nothing to go back to once the player is made.
    if (i.action === "back") {
      skip();
      return true;
    }
    if (i.action === "confirm" && !focusOnControl()) {
      start();
      return true;
    }
    return false;
  });

  return (
    <div class={screen.screen}>
      <h1 class={screen.title}>{t("placement.title")}</h1>
      <Panel>
        <div class={screen.column}>
          <p class={screen.text}>{t("placement.intro")}</p>
          <p class={screen.text}>{t("placement.howTo")}</p>
        </div>
      </Panel>
      <div class={screen.actions} ref={actions}>
        <Button variant="primary" size="lg" onClick={start}>
          {t("placement.start")}
        </Button>
        <Button onClick={skip}>{t("placement.skip")}</Button>
      </div>
      <p class={screen.muted}>{t("placement.skipHint")}</p>
    </div>
  );
}

function Done({ app, profile }: { app: App; profile: Readonly<Profile> }) {
  const actions = useFocusFirst();
  const toMap = (): void => app.navigate({ id: "map" }, { replace: true });

  useScreenInput(app, (i) => {
    if (i.kind !== "control") return false;
    if (i.action === "back" || (i.action === "confirm" && !focusOnControl())) {
      toMap();
      return true;
    }
    return false;
  });

  const [first, ...rest] = outcomeLines(profile, app.lastResult());
  return (
    <div class={screen.screen}>
      <h1 class={screen.title}>{t("placement.doneTitle")}</h1>
      <Panel>
        <div class={screen.column}>
          <p class={screen.text}>
            <strong>{first}</strong>
          </p>
          {rest.map((line) => (
            <p key={line} class={screen.text}>
              {line}
            </p>
          ))}
        </div>
      </Panel>
      <div class={screen.actions} ref={actions}>
        <Button variant="primary" size="lg" onClick={toMap}>
          {t("placement.toMap")}
        </Button>
      </div>
    </div>
  );
}

export default function Placement({ app, route }: ScreenProps) {
  const profile = app.profile();
  const done =
    route.lesson === PLACEMENT_LESSON_ID &&
    profile !== null &&
    profile.progress.placement !== undefined;
  return done ? <Done app={app} profile={profile} /> : <Intro app={app} />;
}
